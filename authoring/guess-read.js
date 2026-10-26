/* e-book 생성기 — 자료 내용 읽기 (설치 없이 브라우저에서)
 *
 * 파일 이름을 쓰지 않고 자료의 "내용"에서 글자를 뽑는다. 쪽 추정(guess.js)의 재료.
 *   한글(.hwp)   : 복합 문서(CFB) → BodyText/Section* → 문단 글자 레코드(HWPTAG_PARA_TEXT)
 *   한글(.hwpx)  : zip → Contents/section*.xml 의 <hp:t>
 *   파워포인트   : zip → ppt/slides/slide*.xml 의 <a:t>
 *   PDF          : pdf.js (저작기에 이미 있음) — 앞 60쪽
 *   엔트리(.ent) : gzip+tar → project.json 의 작품 이름·오브젝트 이름
 *   링크(.url)   : 그대로
 * 압축 풀기는 브라우저 기본 DecompressionStream 만 쓴다 (외부 라이브러리 없음).
 */
(function (root) {
  "use strict";
  const td16 = new TextDecoder("utf-16le"), td8 = new TextDecoder("utf-8");

  // 한글 문서 본문은 압축 스트림 뒤에 군더더기가 붙어 있는 경우가 있어, 오류가 나도 그때까지 푼 내용은 살린다
  async function inflate(bytes, format) {
    const ds = new DecompressionStream(format), w = ds.writable.getWriter(), rd = ds.readable.getReader();
    w.write(bytes).catch(() => {}); w.close().catch(() => {});
    const parts = []; let n = 0;
    try { for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; } }
    catch (e) { if (!n) throw e; }
    const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  /* ---------- zip (pptx · hwpx) ---------- */
  async function unzip(buf, want) {
    const b = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("zip 아님");
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const out = {};
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const lh = dv.getUint32(p + 42, true);
      const name = td8.decode(b.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + el + cl;
      if (!want(name)) continue;
      const ln = dv.getUint16(lh + 26, true), le = dv.getUint16(lh + 28, true);
      const data = b.subarray(lh + 30 + ln + le, lh + 30 + ln + le + csize);
      out[name] = method === 0 ? data : await inflate(data, "deflate-raw");
    }
    return out;
  }
  const xmlText = (u8, tag) => {
    const s = td8.decode(u8), re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g"), r = [];
    let m; while ((m = re.exec(s))) r.push(m[1]);
    return r.join(" ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  };
  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });

  async function readPptx(buf) {
    const z = await unzip(buf, n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    const names = Object.keys(z).sort(natural);
    return { text: names.map(n => xmlText(z[n], "a:t")).join("\n"), slides: names.length };
  }
  async function readHwpx(buf) {
    const z = await unzip(buf, n => /^Contents\/section\d+\.xml$/.test(n));
    return { text: Object.keys(z).sort(natural).map(n => xmlText(z[n], "hp:t")).join("\n") };
  }

  /* ---------- 복합 문서 CFB (hwp 5.x) ---------- */
  function cfb(buf) {
    const b = new Uint8Array(buf), dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0xe011cfd0) throw new Error("hwp 5 형식 아님");
    const ss = 1 << dv.getUint16(30, true), mss = 1 << dv.getUint16(32, true);
    const nFat = dv.getUint32(44, true), dirStart = dv.getUint32(48, true);
    const miniCut = dv.getUint32(56, true), miniFatStart = dv.getUint32(60, true);
    let difatNext = dv.getUint32(68, true);
    const off = s => 512 + s * ss;
    const fatSecs = [];
    for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(76 + i * 4, true));
    while (fatSecs.length < nFat && difatNext < 0xfffffffa) {
      for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(off(difatNext) + i * 4, true));
      difatNext = dv.getUint32(off(difatNext) + ss - 4, true);
    }
    const fat = [];
    for (const s of fatSecs) for (let i = 0; i < ss / 4; i++) fat.push(dv.getUint32(off(s) + i * 4, true));
    const chain = (start, tbl) => { const r = []; let s = start, g = 0; while (s < 0xfffffffa && g++ < 1e6) { r.push(s); s = tbl[s]; } return r; };
    const readChain = (start, size) => {
      const secs = chain(start, fat), out = new Uint8Array(secs.length * ss);
      secs.forEach((s, i) => out.set(b.subarray(off(s), off(s) + ss), i * ss));
      return size == null ? out : out.subarray(0, size);
    };
    const dir = readChain(dirStart), ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength), ents = [];
    for (let i = 0; i * 128 < dir.length; i++) {
      const o = i * 128, nl = ddv.getUint16(o + 64, true);
      if (!nl) { ents.push(null); continue; }
      ents.push({
        name: td16.decode(dir.subarray(o, o + nl - 2)), type: dir[o + 66],
        left: ddv.getUint32(o + 68, true), right: ddv.getUint32(o + 72, true), child: ddv.getUint32(o + 76, true),
        start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true),
      });
    }
    const rootE = ents[0];
    const ministream = rootE && rootE.start < 0xfffffffa ? readChain(rootE.start, rootE.size) : new Uint8Array(0);
    const minifat = [];
    if (miniFatStart < 0xfffffffa) { const m = readChain(miniFatStart), mdv = new DataView(m.buffer, m.byteOffset, m.byteLength); for (let i = 0; i < m.length / 4; i++) minifat.push(mdv.getUint32(i * 4, true)); }
    const readStream = e => {
      if (e.size >= miniCut) return readChain(e.start, e.size);
      const secs = chain(e.start, minifat), out = new Uint8Array(secs.length * mss);
      secs.forEach((s, i) => out.set(ministream.subarray(s * mss, s * mss + mss), i * mss));
      return out.subarray(0, e.size);
    };
    // 트리 → 경로
    const paths = {};
    const walk = (id, prefix) => {
      if (id >= 0xfffffffa || !ents[id]) return; const e = ents[id];
      walk(e.left, prefix); walk(e.right, prefix);
      const p = prefix ? prefix + "/" + e.name : e.name;
      if (e.type === 2) paths[p] = e; else if (e.type === 1) walk(e.child, p);
    };
    walk(rootE.child, "");
    return { paths, read: p => readStream(paths[p]) };
  }
  async function readHwp(buf) {
    const c = cfb(buf);
    const hdr = c.read("FileHeader"), compressed = hdr[36] & 1;
    const secs = Object.keys(c.paths).filter(p => /^BodyText\/Section\d+$/.test(p)).sort(natural);
    const out = [];
    for (const s of secs) {
      let d = c.read(s);
      if (compressed) d = await inflate(d, "deflate-raw");
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      let i = 0;
      while (i + 4 <= d.length) {
        const h = dv.getUint32(i, true), tag = h & 0x3ff; let sz = (h >>> 20) & 0xfff; i += 4;
        if (sz === 0xfff) { sz = dv.getUint32(i, true); i += 4; }
        if (tag === 67) out.push(cleanHwp(d.subarray(i, i + sz)));
        i += sz;
      }
    }
    return { text: out.join("\n") };
  }
  // 문단 글자 레코드: 0~31 은 제어 문자. 확장 제어(1~23 중 일부)는 뒤 7글자(14바이트)가 인라인 정보라 건너뛴다
  const EXT = new Set([1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);
  function cleanHwp(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), r = [];
    for (let i = 0; i + 1 < u8.length; i += 2) {
      const c = dv.getUint16(i, true);
      if (c < 32) { if (EXT.has(c)) i += 14; r.push(" "); continue; }
      r.push(String.fromCharCode(c));
    }
    return r.join("");
  }

  /* ---------- 엔트리 (.ent = gzip + tar) ---------- */
  async function readEnt(buf) {
    let b = new Uint8Array(buf);
    if (b[0] === 0x1f && b[1] === 0x8b) b = await inflate(b, "gzip");
    for (let p = 0; p + 512 <= b.length;) {
      const name = td8.decode(b.subarray(p, p + 100)).replace(/\0.*$/s, "");
      if (!name) break;
      const size = parseInt(td8.decode(b.subarray(p + 124, p + 136)).replace(/\0.*$/s, "").trim() || "0", 8);
      if (/project\.json$/.test(name)) {
        const j = JSON.parse(td8.decode(b.subarray(p + 512, p + 512 + size)));
        const names = [j.name, ...(j.objects || []).map(o => o.name), ...(j.scenes || []).map(s => s.name)].filter(Boolean);
        return { text: names.join("\n") };
      }
      p += 512 + Math.ceil(size / 512) * 512;
    }
    return { text: "" };
  }

  /* ---------- PDF (pdf.js) ---------- */
  async function readPdf(buf, maxPages = 60) {
    const lib = root.pdfjsLib; if (!lib) return { text: "", pages: 0 };
    const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise, out = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      out.push(tc.items.map(t => t.str).join(" "));
    }
    const n = doc.numPages; doc.destroy();
    return { text: out.join("\n"), pages: n };
  }

  /* ---------- 진입점 ---------- */
  const extOf = name => (name.match(/\.([^.]+)$/) || ["", ""])[1].toLowerCase();
  async function readContent(file) {
    const ext = extOf(file.name), r = { ext, bytes: file.size, text: "" };
    try {
      if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "mp4", "webm", "mov", "m4v"].includes(ext)) return r;
      const buf = await file.arrayBuffer();
      if (ext === "hwp") Object.assign(r, await readHwp(buf));
      else if (ext === "hwpx") Object.assign(r, await readHwpx(buf));
      else if (ext === "pptx") Object.assign(r, await readPptx(buf));
      else if (ext === "pdf") Object.assign(r, await readPdf(buf));
      else if (ext === "ent") Object.assign(r, await readEnt(buf));
      else if (["url", "txt", "html", "htm"].includes(ext)) r.text = td8.decode(buf);
    } catch (e) { r.err = String(e && e.message || e); }
    return r;
  }

  /* ---------- 영상 → 장면 몇 장 (그림 대조용) ---------- */
  async function videoFrames(file, everySec = 4, maxFrames = 40, width = 800) {
    const url = URL.createObjectURL(file), v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.src = url;
    await new Promise((ok, no) => { v.onloadedmetadata = ok; v.onerror = () => no(new Error("영상 열기 실패")); });
    const h = Math.round(width * v.videoHeight / v.videoWidth), cv = document.createElement("canvas");
    cv.width = width; cv.height = h; const g = cv.getContext("2d", { willReadFrequently: true }), out = [];
    for (let t = everySec / 2; t < v.duration && out.length < maxFrames; t += everySec) {
      await new Promise(ok => { v.onseeked = ok; v.currentTime = t; });
      g.drawImage(v, 0, 0, width, h); out.push(g.getImageData(0, 0, width, h));
    }
    URL.revokeObjectURL(url);
    return out;
  }

  const api = { readContent, videoFrames, extOf, _unzip: unzip, _cfb: cfb };
  root.EbookGuessRead = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
