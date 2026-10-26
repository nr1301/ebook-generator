/* =========================================================================
   v0.9 「자료 폴더로 초안 만들기」 — 쪽 안 자리 잡기 (옵션 모듈)

   초안 만들기가 **새로 놓는 버튼만** 여기로 넘긴다. 기존 버튼·전역 버튼·미리 놓은 빈 버튼은 건드리지 않는다.
   버튼 없이 자동으로 돈다 — 사람이 할 일은 "훑어보고 어색한 것만 옮기기".
   초안 만들기 한 번 = 실행취소 1단계 그대로 (자리까지 한 번에 되돌아감).

   자리 정하는 순서 (AI 없음):
     ① 그림 자료 → 지면에서 그 그림을 찾아(특징점 대조) 그림 오른쪽 위 모서리
     ② 버튼 이름과 같은 글자가 지면에 있으면(「학습 목표」「생각 열기」…) → 그 제목 옆 빈 자리
     ③ 나머지 → 같은 종류가 이미 놓였으면 그 아래, 아니면 그 쪽 바깥 위 머리 → 바깥 여백
   빈 자리 = 지면 그림이 거의 흰 곳 + 글자 상자 밖 + 다른 버튼과 안 겹치는 곳

   이 파일과 index.html 의 <script> 한 줄을 지우면 예전처럼 왼쪽 위에 쌓는다.
   ========================================================================= */
(function () {
"use strict";
const IMG = /\.(jpe?g|png|gif|webp|bmp)$/i;
const GW = 240;                         // 빈 자리 지도 가로 칸 수
const WHITE = 232;                      // 이보다 밝으면 빈 곳
const tick = () => new Promise(r => setTimeout(r, 0));
const nz = s => String(s || "").replace(/[\s·\-_.()]/g, "");

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[data-lazy="${src}"]`)) return res();
    const s = document.createElement("script"); s.src = src; s.dataset.lazy = src;
    s.onload = () => res(); s.onerror = () => rej(new Error(src)); document.head.appendChild(s);
  });
}

/* ---------------------------------------------------------------- 빈 자리 지도 */
async function freeMap(image, words, aspect) {
  const W = GW, H = Math.max(1, Math.round(GW / aspect));
  const busy = new Uint8Array(W * H);
  if (image) {
    try {
      const bmp = await createImageBitmap(image, { resizeWidth: W, resizeHeight: H, resizeQuality: "medium" });
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0); bmp.close();
      const d = g.getImageData(0, 0, W, H).data;
      for (let i = 0; i < W * H; i++) { const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; if (v < WHITE) busy[i] = 1; }
    } catch (_) { /* 그림을 못 읽으면 글자 상자만 */ }
  }
  for (const w of words || []) {
    const [x, y, ww, hh] = w.b, p = 0.004;
    for (let yy = Math.max(0, Math.floor((y - p) * H)); yy < Math.min(H, Math.ceil((y + hh + p) * H)); yy++)
      for (let xx = Math.max(0, Math.floor((x - p) * W)); xx < Math.min(W, Math.ceil((x + ww + p) * W)); xx++) busy[yy * W + xx] = 1;
  }
  const sat = new Uint32Array((W + 1) * (H + 1));   // 합 표 — 사각형 안 빈 정도를 한 번에
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += busy[y * W + x]; sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row; } }
  return {
    W, H,
    busyFrac(r) {
      const x0 = Math.max(0, Math.floor(r[0] * W)), y0 = Math.max(0, Math.floor(r[1] * H));
      const x1 = Math.min(W, Math.max(x0 + 1, Math.ceil(r[2] * W))), y1 = Math.min(H, Math.max(y0 + 1, Math.ceil(r[3] * H)));
      const s = sat[y1 * (W + 1) + x1] - sat[y0 * (W + 1) + x1] - sat[y1 * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
      return s / ((x1 - x0) * (y1 - y0));
    }
  };
}

/* ---------------------------------------------------------------- 지면 글자 → 줄 */
function lines(words) {
  const ws = (words || []).filter(w => w && w.t && w.b).slice().sort((a, b) => (a.b[1] + a.b[3] / 2) - (b.b[1] + b.b[3] / 2));
  const out = [];
  for (const w of ws) {
    const cy = w.b[1] + w.b[3] / 2;
    const L = out.find(l => Math.abs(l.cy - cy) < Math.max(l.h, w.b[3]) * 0.5 && (w.b[0] < l.x1 + 0.06 && w.b[0] + w.b[2] > l.x0 - 0.06));
    if (L) { L.ws.push(w); L.x0 = Math.min(L.x0, w.b[0]); L.x1 = Math.max(L.x1, w.b[0] + w.b[2]); }
    else out.push({ cy, h: w.b[3], x0: w.b[0], x1: w.b[0] + w.b[2], ws: [w] });
  }
  return out.map(l => { l.ws.sort((a, b) => a.b[0] - b.b[0]); return l; });
}
/* 버튼 이름과 같은 글자를 지면에서 찾는다 → 그 글자들의 상자 [x0,y0,x1,y1] (큰 글씨 = 제목 먼저) */
function findText(L, label, used) {
  const key = nz(label); if (key.length < 2) return null;
  const hits = [];
  for (const l of L) {
    let txt = "", spans = [];
    for (const w of l.ws) { const t = nz(w.t); spans.push([txt.length, txt.length + t.length, w]); txt += t; }
    let at = txt.indexOf(key);
    while (at >= 0) {
      const ws = spans.filter(([a, b]) => b > at && a < at + key.length).map(s => s[2]);
      const r = [Math.min(...ws.map(w => w.b[0])), Math.min(...ws.map(w => w.b[1])), Math.max(...ws.map(w => w.b[0] + w.b[2])), Math.max(...ws.map(w => w.b[1] + w.b[3]))];
      const id = r.map(v => v.toFixed(3)).join(",");
      if (!used.has(id)) hits.push({ r, h: Math.max(...ws.map(w => w.b[3])), id });
      at = txt.indexOf(key, at + 1);
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.h - a.h || a.r[1] - b.r[1]);
  used.add(hits[0].id);
  return hits[0].r;
}

/* ---------------------------------------------------------------- 자리 찾기 */
function overlaps(r, placed, pad) {
  pad = pad == null ? 0.004 : pad;
  return placed.some(q => r[0] < q[2] + pad && r[2] + pad > q[0] && r[1] < q[3] + pad && r[3] + pad > q[1]);
}
const inPage = (r, m) => r[0] >= m && r[1] >= m && r[2] <= 1 - m && r[3] <= 1 - m;
function nearSpot(fm, placed, w, h, a, prefer, tols, maxD) {
  const gap = 0.008, cands = [];
  if (prefer === "down") cands.push([a[0], a[3] + gap], [a[2] + gap, a[1]], [a[0] - gap - w, a[1]], [a[0], a[1] - gap - h]);
  else cands.push([a[2] + gap, a[1] + (a[3] - a[1] - h) / 2], [a[2] + gap, a[1]], [a[0], a[3] + gap], [a[0] - gap - w, a[1]], [a[0], a[1] - gap - h]);
  const cx = (a[0] + a[2]) / 2, cy = (a[1] + a[3]) / 2, ring = [];
  const R = maxD || 0.45;
  for (let dy = -Math.min(0.3, R); dy <= Math.min(0.3, R); dy += 0.006) for (let dx = -R; dx <= R; dx += 0.01) ring.push([cx + dx - w / 2, cy + dy - h / 2, (dx * 0.6) ** 2 + dy * dy]);
  ring.sort((p, q) => p[2] - q[2]); ring.forEach(p => cands.push([p[0], p[1]]));
  for (const tol of tols || [0.02, 0.06, 0.15]) {
    for (const [x, y] of cands) {
      const r = [x, y, x + w, y + h];
      if (inPage(r, 0.008) && fm.busyFrac(r) <= tol && !overlaps(r, placed)) return [x, y];
    }
  }
  return null;
}
/* 바깥 머리 → 바깥 여백 줄 (왼쪽 지면은 왼쪽, 오른쪽 지면은 오른쪽이 바깥) */
function railSpot(fm, placed, w, h, outerLeft, startY, tols) {
  for (const tol of tols || [0.02, 0.08]) {
    for (let y = Math.max(0.012, startY || 0.012); y <= 0.97 - h; y += 0.004) {
      for (let k = 0; k <= 30; k++) {
        const x = outerLeft ? 0.012 + k * 0.01 : 0.988 - w - k * 0.01;
        const r = [x, y, x + w, y + h];
        if (inPage(r, 0.008) && fm.busyFrac(r) <= tol && !overlaps(r, placed)) return [x, y];
      }
    }
  }
  return null;
}

/* ---------------------------------------------------------------- 진행 창 */
function progress(n) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal gs-prog"><h3>버튼 ${n}개의 자리를 잡는 중</h3>
    <p>그림 자료는 지면에서 그 그림을 찾아 옆에, 나머지는 관련 제목 옆 빈 자리에 놓아요.</p>
    <div class="gs-bar"><i></i></div><div class="gs-msg muted">준비 중…</div></div>`;
  document.getElementById("modal-root").appendChild(back);
  return {
    set(f, m) { back.querySelector(".gs-bar i").style.width = Math.round(f * 100) + "%"; back.querySelector(".gs-msg").textContent = m; },
    close() { back.remove(); }
  };
}

/* ---------------------------------------------------------------- 진입점
   hints: [{ o(이미 지면에 들어간 새 객체), idx, file, box? }] → 통계 */
async function place(hints, core) {
  const S = core.S, st = { total: hints.length, figure: 0, text: 0, margin: 0 };
  const byPage = {};
  hints.forEach(h => (byPage[h.idx] = byPage[h.idx] || []).push(h));
  const pages = Object.keys(byPage).map(Number).sort((a, b) => a - b);
  const needMatch = hints.filter(h => IMG.test(h.file ? h.file.name : "") && !h.box && S.bgFiles[h.idx]);
  const pm = hints.length > 6 ? progress(hints.length) : null;
  let M = window.EbookGuessMatch;
  if (needMatch.length && M) {
    try { if (!window.cv) { pm && pm.set(0.02, "그림 대조 도구 읽는 중…"); await loadScript("vendor/opencv.js"); } await M.ready(); }
    catch (_) { M = null; }
  } else M = null;
  const off = S.book.pageNumbering.offset;
  try {
    for (let pi = 0; pi < pages.length; pi++) {
      const idx = pages[pi], list = byPage[idx], printed = idx + off;
      pm && pm.set(pi / pages.length, `${printed}쪽 (${pi + 1}/${pages.length})`);
      let words = S.pageText[idx] || [];
      if (!Array.isArray(words)) { try { words = JSON.parse(await words.text()).words || []; } catch (_) { words = []; } S.pageText[idx] = words; }
      const aspect = core.pageAspect(idx);
      const fm = await freeMap(S.bgFiles[idx], words, aspect);
      const L = lines(words), usedText = new Set();
      const mine = new Set(list.map(h => h.o));
      const placed = core.occupiedRects(idx, mine);
      const outerLeft = (S.book.spread && S.book.spread.firstPageAlone) ? idx % 2 === 0 : idx % 2 === 1;
      const lastOf = {};          // buttonId → 마지막에 놓은 자리
      let firstText = null;
      /* 잰 크기에 여유를 둔다 — 화면 크기에 따라 글자 폭이 조금씩 달라서 (실측 5% 안팎) */
      const size = o => { const [w, hh] = core.measureObj(o, idx); return [w * 1.08 + 0.004, hh + 0.004]; };
      const put = (h, x, y, w, hh, how) => {
        x = Math.min(Math.max(x, 0.01), 0.99 - w); y = Math.min(Math.max(y, 0.01), 0.99 - hh);
        h.o.at = { x: +x.toFixed(4), y: +y.toFixed(4) };
        delete h.o.stackId; delete h.o.stackOrder;
        const r = [x, y, x + w, y + hh]; placed.push(r); lastOf[h.o.buttonId] = r; st[how]++;
        return r;
      };
      // 라벨 다듬기 — 「그림 보기 2」처럼 버튼 이름 + 번호면 번호를 뗀다 (교사 화면에 번호가 보일 이유가 없음)
      list.forEach(h => {
        const d = core.btnDef0(h.o.buttonId) || {};
        if (d.label && new RegExp("^" + d.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\d+$").test(h.o.label || "")) h.o.label = d.label;
        else if (/_/.test(h.o.label || "")) h.o.label = h.o.label.replace(/\s*_\s*/g, " · ");   // 「엔트리 예제_자동 신호등」 → 「엔트리 예제 · 자동 신호등」
      });
      const figs = list.filter(h => IMG.test(h.file ? h.file.name : ""));
      const rest = list.filter(h => !figs.includes(h));
      // ① 그림
      let P = null;
      for (const h of figs) {
        const [w, hh] = size(h.o);
        let box = h.box;
        if (!box && M) {
          try {
            P = P || await M.preparePagesCached([{ printed, image: S.bgFiles[idx], words }]);
            const m = (await M.matchImage(h.file, P)).find(x => x.printed === printed);
            if (m && m.box) box = m.box;
          } catch (_) { /* 못 찾으면 아래 여백으로 */ }
          await tick();
        }
        if (box && box[2] - box[0] > 0.02 && box[3] - box[1] > 0.02) {
          const [x0, y0, x1, y1] = box, g = 0.004;
          const c = [[x1 - w - g, y0 + g], [x1 + g, y0], [x1 - w - g, y1 - hh - g], [x0 + g, y0 + g], [x0, y1 + g]].find(([x, y]) => { const r = [x, y, x + w, y + hh]; return inPage(r, 0.008) && !overlaps(r, placed); });
          if (c) { put(h, c[0], c[1], w, hh, "figure"); continue; }
          const s = nearSpot(fm, placed, w, hh, box, "right");
          if (s) { put(h, s[0], s[1], w, hh, "figure"); continue; }
        }
        rest.push(h);
      }
      // ② 버튼 이름 = 지면 글자
      const rest2 = [];
      for (const h of rest) {
        const d = core.btnDef0(h.o.buttonId) || {};
        const a = findText(L, d.label, usedText) || (h.o.label !== d.label ? findText(L, h.o.label, usedText) : null);
        if (!a) { rest2.push(h); continue; }
        const [w, hh] = size(h.o);
        const s = nearSpot(fm, placed, w, hh, a, "right", [0.02, 0.06], 0.2);
        if (s) { const r = put(h, s[0], s[1], w, hh, "text"); firstText = firstText || r; } else rest2.push(h);
      }
      // ③ 나머지 — 같은 종류 아래 → 첫 제목 옆 → 바깥 머리·여백
      rest2.sort((a, b) => String(a.o.buttonId).localeCompare(String(b.o.buttonId)) || String(a.o.label).localeCompare(String(b.o.label), "ko", { numeric: true }));
      for (const h of rest2) {
        const [w, hh] = size(h.o);
        /* 깨끗한 빈 곳 먼저: 같은 종류 바로 옆 → 첫 제목 옆 → 바깥 머리·여백. 그다음에야 조금 덜 빈 곳 */
        const near = lastOf[h.o.buttonId] || firstText;
        let s = null;
        if (lastOf[h.o.buttonId]) s = nearSpot(fm, placed, w, hh, lastOf[h.o.buttonId], "down", [0.02], 0.12);
        if (!s && firstText) s = nearSpot(fm, placed, w, hh, firstText, "down", [0.02], 0.12);
        if (!s) s = railSpot(fm, placed, w, hh, outerLeft, 0.012, [0.02]);
        if (!s && near) s = nearSpot(fm, placed, w, hh, near, "down", [0.06, 0.15], 0.25);
        if (!s) s = railSpot(fm, placed, w, hh, outerLeft, 0.012, [0.08, 0.2]);
        if (!s) s = outerLeft ? [0.012, 0.02] : [0.988 - w, 0.02];
        put(h, s[0], s[1], w, hh, "margin");
      }
      core.renderAll && pi % 4 === 3 && await tick();
    }
  } finally { pm && pm.close(); }
  return st;
}

window.EbookAutoPlace = { place, _lines: lines, _findText: findText };
})();
