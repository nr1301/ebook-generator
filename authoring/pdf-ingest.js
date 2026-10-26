/* =========================================================================
   교과서 PDF → 지면 이미지 + 텍스트 레이어  (브라우저 안에서, 서버·파이썬 없이)
   pipeline/ingest.py 와 같은 결과 폴더를 만든다 → 저장·재열기·뷰어·검증이 그대로 동작
     {PDF이름}_지면/master/{hash}.webp        base  (WebP q72, 긴 변 3000px)
     {PDF이름}_지면/master/{hash}.thumb.webp  thumb (WebP q60, 긴 변 240px)
     {PDF이름}_지면/text/{index}.json         단어 bbox 0~1 상대좌표 {t, b:[x,y,w,h]}
     {PDF이름}_지면/master-index.json         index → pdfPage·hash·basePx
     {PDF이름}_지면/report.csv                쪽별 KB — 발표 3부 숫자의 원본

   - pdf.js 3.11 (vendor/) 를 <script> 로 두 개 다 올려 "메인 스레드 모드"로 쓴다.
     file:// 에서는 Worker 생성이 막히기 때문 (pdf.worker.min.js 가 globalThis.pdfjsWorker 를 만들면
     pdf.js 가 그걸 자동으로 쓴다)
   - 렌더는 ingest.py 와 같이 1.15배로 그린 뒤 줄인다.
     2026-09-27 과학2 1단원 40쪽 실측: 파이썬 8.07MB → 브라우저 7.71MB (0.955배), x3 확대 육안 동등
   - 폴더 저장은 File System Access API(크롬·엣지). 없으면 메모리에만 두고 알린다
   ========================================================================= */
(function () {
"use strict";

const BASE_Q = 0.72, BASE_LONG = 3000;
const THUMB_Q = 0.60, THUMB_LONG = 240;
const RENDER_MARGIN = 1.15;
const TARGET_KB = 280, LIMIT_KB = 450;

const canSaveToFolder = () => typeof window.showDirectoryPicker === "function";

function lib() {
  if (!window.pdfjsLib) throw new Error("PDF 변환 부품(vendor/pdf.min.js)을 찾지 못했습니다");
  return window.pdfjsLib;
}

async function openPdf(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await lib().getDocument({ data, isEvalSupported: false }).promise;
  return doc;
}

function toBlob(canvas, q) {
  return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("이미지 인코딩 실패")), "image/webp", q));
}
async function sha1Hex16(blob) {
  const buf = await blob.arrayBuffer();
  const h = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
function shrink(src, w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, w, h);
  return c;
}
function release(c) { if (c) { c.width = 0; c.height = 0; } }

/* 텍스트 레이어: pdf.js 텍스트 항목 → 단어 단위 bbox (pdftotext -bbox 와 같은 모양) */
async function extractWords(page) {
  const vp = page.getViewport({ scale: 1 });
  const W = vp.width, H = vp.height;
  const tc = await page.getTextContent();
  const words = [];
  const U = lib().Util;
  for (const it of tc.items) {
    const s = it.str;
    if (!s || !s.trim()) continue;
    const tx = U.transform(vp.transform, it.transform);
    const fh = Math.hypot(tx[2], tx[3]) || Math.abs(it.height) || 10;
    const x0 = tx[4], base = tx[5];
    const top = base - fh * 0.88;                 // 윗선 = 기준선 − 어센트(대략)
    const totalW = it.width || fh * s.length * 0.5;
    const n = s.length;
    const re = /\S+/g; let m;
    while ((m = re.exec(s))) {
      const a = m.index / n, b = (m.index + m[0].length) / n;
      const x = x0 + totalW * a, w = totalW * (b - a);
      words.push({
        t: m[0],
        b: [+(x / W).toFixed(5), +(top / H).toFixed(5), +(w / W).toFixed(5), +(fh / H).toFixed(5)]
      });
    }
  }
  return { words, pageSizePt: [+W.toFixed(2), +H.toFixed(2)] };
}

/* 폴더 쓰기 도우미 */
async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}
async function exists(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch (_) { return false; }
}

/* 변환 본체
   opt: { first, last, root (DirectoryHandle|null), onPage(info), shouldStop() }
   반환: { mi, byName, pages:[{key, hash, base, thumb, words}], folderName, saved, stopped } */
async function convert(file, opt) {
  opt = opt || {};
  const doc = await openPdf(file);
  const first = Math.max(1, opt.first || 1);
  const last = Math.min(doc.numPages, opt.last || doc.numPages);
  const stem = file.name.replace(/\.pdf$/i, "");
  const folderName = `${stem}_지면`;

  let out = null, master = null, text = null;
  if (opt.root) {
    out = await opt.root.getDirectoryHandle(folderName, { create: true });
    master = await out.getDirectoryHandle("master", { create: true });
    text = await out.getDirectoryHandle("text", { create: true });
  }

  const byName = {}, pages = [], rows = [], index = {};
  let stopped = false;
  for (let p = first; p <= last; p++) {
    if (opt.shouldStop && opt.shouldStop()) { stopped = true; break; }
    const t0 = performance.now();
    const idx = p - first;
    const page = await doc.getPage(p);
    const vp1 = page.getViewport({ scale: 1 });
    const fit = BASE_LONG / Math.max(vp1.width, vp1.height);
    const bw = Math.round(vp1.width * fit), bh = Math.round(vp1.height * fit);

    // 1.15배로 그리고 → 3000px 로 줄인다
    const vp = page.getViewport({ scale: fit * RENDER_MARGIN });
    const big = document.createElement("canvas");
    big.width = Math.round(vp.width); big.height = Math.round(vp.height);
    const g = big.getContext("2d", { alpha: false });
    g.fillStyle = "#fff"; g.fillRect(0, 0, big.width, big.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    const baseC = shrink(big, bw, bh); release(big);
    const baseBlob = await toBlob(baseC, BASE_Q);
    const hash = await sha1Hex16(baseBlob);

    const ts = THUMB_LONG / Math.max(bw, bh);
    const mid = shrink(baseC, Math.round(bw * ts * 4), Math.round(bh * ts * 4));   // 두 번에 나눠 줄여야 썸네일이 뭉개지지 않음
    release(baseC);
    const thumbC = shrink(mid, Math.round(bw * ts), Math.round(bh * ts)); release(mid);
    const thumbBlob = await toBlob(thumbC, THUMB_Q); release(thumbC);

    const tl = await extractWords(page);
    page.cleanup();

    const baseFile = new File([baseBlob], `${hash}.webp`, { type: "image/webp" });
    const thumbFile = new File([thumbBlob], `${hash}.thumb.webp`, { type: "image/webp" });
    byName[baseFile.name] = baseFile;
    byName[thumbFile.name] = thumbFile;

    if (out) {
      if (!(await exists(master, baseFile.name))) await writeFile(master, baseFile.name, baseBlob);
      if (!(await exists(master, thumbFile.name))) await writeFile(master, thumbFile.name, thumbBlob);
      await writeFile(text, `${idx}.json`, JSON.stringify(tl));
    }

    const basePx = `${bw}x${bh}`;
    index[String(idx)] = { pdfPage: p, hash, basePx, zoom: null };
    const kb = +(baseBlob.size / 1024).toFixed(1);
    rows.push({ index: idx, hash, base_kb: kb, base_px: basePx, thumb_kb: +(thumbBlob.size / 1024).toFixed(1),
      zoom_tiles: 0, zoom_kb: 0, words: tl.words.length, over_target: kb > TARGET_KB, over_limit: kb > LIMIT_KB });
    pages.push({ key: String(idx), hash, base: baseFile, thumb: thumbFile, words: tl.words });

    if (opt.onPage) opt.onPage({
      done: idx + 1, total: last - first + 1, pdfPage: p, kb, thumb: thumbFile,
      ms: Math.round(performance.now() - t0),
      totalKb: rows.reduce((a, r) => a + r.base_kb + r.thumb_kb, 0)
    });
    await new Promise(r => setTimeout(r, 0));    // 화면 갱신 틈
  }

  const mi = {
    source: file.name,
    settings: { quality: Math.round(BASE_Q * 100), longEdge: BASE_LONG, thumbQuality: Math.round(THUMB_Q * 100), zoomScale: 2, converter: "browser-pdfjs" },
    pages: index
  };
  if (out && rows.length) {
    await writeFile(out, "master-index.json", JSON.stringify(mi, null, 2));
    const head = Object.keys(rows[0]);
    const csv = "﻿" + [head.join(",")].concat(rows.map(r => head.map(k =>
      typeof r[k] === "boolean" ? (r[k] ? "True" : "False") : r[k]).join(","))).join("\r\n") + "\r\n";
    await writeFile(out, "report.csv", csv);
  }
  try { await doc.destroy(); } catch (_) { /* 무시 */ }
  return { mi, byName, pages, rows, folderName, saved: !!out, stopped };
}

async function pageCountOf(file) {
  const doc = await openPdf(file);
  const n = doc.numPages;
  try { await doc.destroy(); } catch (_) { /* 무시 */ }
  return n;
}

window.EbookIngest = { convert, pageCountOf, canSaveToFolder, _extractWords: extractWords };
})();
