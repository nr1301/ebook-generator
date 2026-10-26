/* =========================================================================
   WBS 2.4 — 프로젝트 생성 마법사
   ① 교과·제목  →  ② 지면 불러오기(교과서 PDF 직접 / 변환해 둔 폴더 / 빈 지면)  →  ③ 쪽번호·단원 확인

   원칙 (PRD 사용자 정의)
   - 사람에게 묻는 건 사람만 아는 것뿐. 지면 수·쪽번호·대단원은 산출물에서 읽는다
     · 지면 수      = PDF 쪽수(변환 범위) 또는 master-index.json 의 장수
     · 쪽번호       = 텍스트 레이어 꼬리말의 쪽번호 (지면 전체 다수결)
     · 펼침 좌우 짝 = 쪽번호가 왼쪽 끝/오른쪽 끝 어디에 찍혔는지 (다수결)
     · 대단원       = 꼬리말의 「Ⅰ. 물질의 특성」 같은 로마숫자 머리
   - 자동으로 읽은 값은 썸네일과 함께 보여주고 사람이 확인한다. 틀리면 칸 하나만 고친다
   - 기술 용어 노출 금지 (offset·firstPageAlone·unitId 같은 말은 화면에 안 나온다)
   ========================================================================= */
(function () {
"use strict";

const ROMAN = "ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ";

/* ---------------------------------------------------------------- 텍스트 레이어 판독 */
/* 한 지면에서 인쇄 쪽번호 후보를 찾는다.
   조건: 1~3자리 숫자 / 지면 아래 12% 또는 위 6% 띠 / 좌우 끝 20% 안 / 글자 높이 4% 미만
   (단원 도입 지면의 커다란 장식 숫자 「1」을 거르려고 높이 조건을 둔다) */
function findPageNumber(words) {
  const cands = (words || []).filter(w => {
    if (!/^\d{1,3}$/.test(w.t)) return false;
    const [x, y, bw, bh] = w.b;
    if (bh >= 0.04) return false;
    const band = y > 0.88 || y + bh < 0.06;
    const edge = x < 0.2 || x + bw > 0.8;
    return band && edge;
  });
  if (!cands.length) return null;
  // 가장 아래·가장 바깥 쪽을 고른다
  cands.sort((a, b) => (b.b[1] - a.b[1]) || (Math.abs(b.b[0] - 0.5) - Math.abs(a.b[0] - 0.5)));
  const w = cands[0];
  return { n: parseInt(w.t, 10), side: w.b[0] + w.b[2] / 2 < 0.5 ? "L" : "R" };
}

/* 꼬리말의 대단원 머리 「Ⅰ. 물질의 특성」 */
function findUnitTitle(words) {
  const foot = (words || []).filter(w => w.b[1] > 0.88 && w.b[3] < 0.04);
  // 「Ⅰ.」 「Ⅰ」 처럼 로마 숫자로 시작하는 낱말만 — 그림 번호 「Ⅰ-2」 는 아니다 (중학 정보 꼬리말 2026-10-19)
  const head = foot.find(w => ROMAN.includes(w.t.charAt(0)) && /^.\.?$|^.\.\S/.test(w.t));
  if (!head) return null;
  const line = foot
    .filter(w => Math.abs(w.b[1] - head.b[1]) < 0.008 && !/^\d{1,3}$/.test(w.t))
    .sort((a, b) => a.b[0] - b.b[0]);
  const from = line.indexOf(head), next = line[from + 1];
  // 그림 설명(「▲ 그림 Ⅰ-6 …」)은 꼬리말이 아니다
  if (line.some(w => /그림|▲/.test(w.t)) || (next && /^[-–]/.test(next.t)) || /^.-/.test(head.t)) return null;
  const txt = line.slice(from).map(w => w.t).join(" ")
    .replace(/\s*\.\s*/, ". ").replace(/\s+/g, " ").trim();
  return txt || null;
}

/* PDF 파일명에서 단원명 추정 — 꼬리말에서 못 찾을 때만 */
function unitFromSource(src) {
  const m = /_(\d+)_([^_.]+)\.pdf$/i.exec(src || "");
  return m ? `${m[1]}. ${m[2]}` : "1단원";
}

/* 판독 전체: 지면(1부터) 배열을 받아 쪽번호 규칙·좌우 짝·단원을 돌려준다 */
function analyze(pages, source) {
  // 1) 쪽번호 규칙 — (꼬리말 숫자 − 지면 번호) 다수결
  const votes = {};
  let seen = 0;
  pages.forEach(p => {
    if (!p.num) return;
    seen++;
    const d = p.num.n - p.index;
    votes[d] = (votes[d] || 0) + 1;
  });
  let offset = null, agree = 0;
  Object.entries(votes).forEach(([d, c]) => { if (c > agree) { agree = c; offset = +d; } });

  // 2) 펼침 좌우 짝 — 쪽번호가 찍힌 쪽(왼/오)으로 판정. 홀수 지면이 오른쪽이면 "첫 지면 단독"
  let oddRight = 0, oddLeft = 0;
  pages.forEach(p => {
    if (!p.num) return;
    const odd = p.index % 2 === 1;
    const right = p.num.side === "R";
    if (odd === right) oddRight++; else oddLeft++;
  });
  let firstAlone;
  if (oddRight + oddLeft > 0) firstAlone = oddRight >= oddLeft;
  else firstAlone = offset == null ? true : (1 + offset) % 2 === 1;   // 한국 교과서: 홀수 쪽 = 오른쪽

  // 3) 규칙에서 벗어나는 지면 (삽지·쪽번호 오독 등) — 알려만 준다
  const odd = offset == null ? [] : pages
    .filter(p => p.num && p.num.n !== p.index + offset)
    .map(p => ({ index: p.index, read: p.num.n, calc: p.index + offset }));

  // 4) 대단원 — 꼬리말 머리가 바뀌는 곳에서 끊는다. 못 읽은 지면은 앞 지면을 따른다
  const units = [];
  let cur = null;
  pages.forEach(p => {
    const t = p.unit || (cur ? cur.title : null);
    if (!cur || (t && t !== cur.title)) {
      cur = { title: t, fromIndex: p.index, toIndex: p.index };
      units.push(cur);
    } else cur.toIndex = p.index;
  });
  // 맨 앞 지면들(대단원 도입 등)에 꼬리말이 없으면 뒤 단원에 붙인다
  if (units.length > 1 && !units[0].title) { units[1].fromIndex = units[0].fromIndex; units.shift(); }
  if (!units.length || units.every(u => !u.title)) {
    units.length = 0;
    if (pages.length) units.push({ title: unitFromSource(source), fromIndex: 1, toIndex: pages.length });
  }
  units.forEach((u, i) => { u.id = "unit-" + (i + 1); if (!u.title) u.title = `${i + 1}단원`; });

  return { offset, agree, seen, firstAlone, odd, units };
}

/* ---------------------------------------------------------------- 마법사 상태 */
let W = null;
const C = () => window.__ebookCore;
const esc = s => C().escapeHtml(s == null ? "" : s);

function defaults() {
  const prof = window.DEFAULT_PROFILE;
  return {
    step: 1,
    profile: C().clone(prof),
    profiles: [prof].concat(window.EXTRA_PROFILES || []),
    title: prof.name || "",
    title_touched: false,
    // ② 지면
    src: "pdf", pdf: null, pdfPages: 0, range: { first: 1, last: 1 }, conv: null,
    mi: null, byName: null, pages: [], folder: "",
    manual: false, manualCount: 40,
    // ③ 확인
    ana: null, firstPrinted: 1, flip: false, units: []
  };
}

/* ---------------------------------------------------------------- 열기·닫기 */
function open(opt) {
  opt = opt || {};
  W = defaults();
  W.first = !!opt.first;
  const back = document.createElement("div");
  back.className = "modal-back wiz-back";
  back.innerHTML = `<div class="modal wiz" role="dialog" aria-label="새 프로젝트 만들기"></div>`;
  document.getElementById("modal-root").appendChild(back);
  W.el = back;
  back.addEventListener("keydown", e => {
    if (e.key === "Escape" && !W.first && !(W.conv && W.conv.running)) close();
  });
  render();
}
function close() {
  if (!W) return;
  if (W.conv) W.conv.stop = true;
  (W.thumbUrls || []).forEach(u => URL.revokeObjectURL(u));
  W.el.remove();
  W = null;
}

/* ---------------------------------------------------------------- 렌더 */
function render() {
  const box = W.el.querySelector(".wiz");
  const steps = ["교과·제목", "지면 불러오기", "쪽번호·단원 확인"];
  box.innerHTML = `
    <div class="wiz-head">
      <h3>새 프로젝트 만들기</h3>
      <ol class="wiz-steps">${steps.map((s, i) =>
        `<li class="${i + 1 === W.step ? "on" : i + 1 < W.step ? "done" : ""}"><b>${i + 1}</b>${s}</li>`).join("")}</ol>
    </div>
    <div class="wiz-body"></div>
    <div class="wiz-foot">
      ${W.first ? `<button class="t" data-act="open" title="저장해 둔 .ebproj.json 파일을 엽니다">저장해 둔 프로젝트 열기</button>` : `<button class="t" data-act="cancel">취소</button>`}
      <span class="grow"></span>
      ${W.step > 1 ? `<button class="t" data-act="back">이전</button>` : ""}
      <button class="t primary" data-act="next">${W.step === 3 ? "만들기" : "다음"}</button>
    </div>`;
  const body = box.querySelector(".wiz-body");
  [null, step1, step2, step3][W.step](body);
  box.querySelector("[data-act=next]").onclick = next;
  const b = box.querySelector("[data-act=back]"); if (b) b.onclick = () => { W.step--; render(); };
  const c = box.querySelector("[data-act=cancel]"); if (c) c.onclick = close;
  const o = box.querySelector("[data-act=open]"); if (o) o.onclick = () => { const inp = document.getElementById("in-open"); close(); if (inp) inp.click(); };
  if (W.conv && W.conv.running) box.querySelectorAll(".wiz-foot button").forEach(x => { x.disabled = true; });
  refreshNext();
}
function refreshNext() {
  const btn = W.el.querySelector("[data-act=next]");
  let ok = true;
  if (W.step === 1) ok = !!W.title.trim();
  if (W.step === 2) ok = W.manual ? W.manualCount >= 1 : W.pages.length > 0 && !(W.conv && W.conv.running);
  if (W.step === 3) ok = Number.isFinite(W.firstPrinted) && W.units.every(u => u.title.trim());
  btn.disabled = !ok;
}

/* ① 교과·제목 */
function step1(body) {
  const core = C();
  const warn = core.hasWork()
    ? `<div class="wiz-warn">지금 열려 있는 「${esc(core.S.book.title)}」 작업은 새 프로젝트를 만들면 화면에서 사라집니다.
         <button class="t" data-act="save-cur">지금 작업 저장하기</button></div>` : "";
  body.innerHTML = `
    ${warn}
    <div class="wiz-field">
      <label>교과 <span class="muted">버튼 종류·색·지면 유형이 교과마다 다릅니다</span></label>
      <div class="wiz-profiles"></div>
      <label class="t file sm">다른 교과 파일 불러오기<input type="file" accept=".json" hidden data-in="profile"></label>
    </div>
    <div class="wiz-field">
      <label for="wiz-title">이북 제목</label>
      <input type="text" id="wiz-title" value="${esc(W.title)}" placeholder="예: 중학교 과학2" maxlength="60">
    </div>`;
  const list = body.querySelector(".wiz-profiles");
  const cards = W.profiles.slice();
  if (!cards.some(p => p.profileId === W.profile.profileId)) cards.push(W.profile);
  cards.forEach(p => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "wiz-card" + (p.profileId === W.profile.profileId ? " on" : "");
    const chips = (p.themes || []).slice(0, 7).map(t => `<span class="sw" style="background:${t.color}"></span>`).join("");
    el.innerHTML = `<b>${esc(p.name || p.profileId)}</b>
      <span class="muted">버튼 ${(p.buttons || []).length}종 · 지면 유형 ${(p.pageTypes || []).length}가지</span>
      <span class="sws">${chips}</span>`;
    el.onclick = () => pickProfile(p);
    list.appendChild(el);
  });
  const ti = body.querySelector("#wiz-title");
  ti.oninput = () => { W.title = ti.value; W.title_touched = true; refreshNext(); };
  ti.onkeydown = e => { if (e.key === "Enter" && W.title.trim()) next(); };
  setTimeout(() => ti.focus(), 0);
  body.querySelector("[data-in=profile]").onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => {
      try {
        const p = JSON.parse(t);
        if (!p.buttons || !p.themes || !p.profileId) throw new Error();
        W.profiles.push(p);
        pickProfile(p);
      } catch (_) { toastErr("교과 설정 파일이 아닙니다. 프로파일 JSON 파일을 골라 주세요."); }
    });
  };
  const sv = body.querySelector("[data-act=save-cur]");
  if (sv) sv.onclick = () => { core.saveProject(); sv.textContent = "저장했습니다"; sv.disabled = true; };
}
function pickProfile(p) {
  W.profile = C().clone(p);
  if (!W.title_touched) W.title = p.name || W.title;
  render();
}

/* ② 지면 불러오기
   기본 = 교과서 PDF를 바로 받아 브라우저에서 변환 (pdf-ingest.js)
   보조 = 이미 변환한 폴더 고르기 / 빈 지면으로 시작 */
function step2(body) {
  const links = (except) => `<div class="wiz-alt">
      ${except !== "pdf" ? `<button class="t link" data-src="pdf">← 교과서 PDF로 할게요</button>` : ""}
      ${except !== "folder" ? `<button class="t link" data-src="folder">이미 변환해 둔 폴더가 있어요</button>` : ""}
      ${except !== "manual" ? `<button class="t link" data-src="manual">지면 이미지 없이 빈 지면으로 시작</button>` : ""}
    </div>`;
  const bindLinks = () => body.querySelectorAll("[data-src]").forEach(b => b.onclick = () => switchSrc(b.dataset.src));

  if (W.src === "manual") {
    body.innerHTML = `
      <p class="wiz-lead">배경 없이 빈 지면으로 시작합니다. 버튼 배치는 할 수 있지만 <b>배포 전에 지면 이미지를 반드시 붙여야</b> 합니다.</p>
      <div class="wiz-field">
        <label for="wiz-count">지면 수</label><input type="number" id="wiz-count" min="1" max="600" value="${W.manualCount}">
      </div>${links("manual")}`;
    const ci = body.querySelector("#wiz-count");
    ci.oninput = () => { W.manualCount = parseInt(ci.value, 10) || 0; refreshNext(); };
    bindLinks();
    return;
  }

  if (W.src === "folder") {
    const loaded = W.pages.length;
    body.innerHTML = `
      <p class="wiz-lead">예전에 변환해 둔 지면 폴더를 고르세요. 안에 <b>master</b> 폴더와 <b>master-index.json</b> 이 들어 있는 폴더입니다.</p>
      <label class="wiz-drop ${loaded ? "ok" : ""}">
        <input type="file" webkitdirectory directory multiple hidden data-in="folder">
        ${loaded
          ? `<b>${esc(W.mi.source || W.folder)}</b><span>지면 ${loaded}장 · 쪽번호를 꼬리말에서 ${W.pages.filter(p => p.num).length}장 읽었습니다</span><span class="muted">다른 폴더를 고르려면 누르세요</span>`
          : `<b>폴더 고르기</b><span class="muted">예: 미래엔_과학2_교과서_1_물질의특성_지면</span>`}
      </label>
      ${loaded ? strip() : ""}${links("folder")}`;
    body.querySelector("[data-in=folder]").onchange = e => { readFolder(e.target.files); e.target.value = ""; };
    bindLinks();
    return;
  }

  /* ---- 교과서 PDF ---- */
  const cv = W.conv;
  if (cv && cv.running) {
    body.innerHTML = `
      <p class="wiz-lead"><b>${esc(W.pdf.name)}</b> 변환 중 — 창을 닫지 말고 기다려 주세요.</p>
      <div class="wiz-prog"><div class="bar"><i style="width:0%"></i></div>
        <div class="nums"><b data-p="count">0 / ${cv.total}쪽</b><span data-p="eta"></span></div>
        <div class="muted" data-p="size">&nbsp;</div></div>
      <div class="wiz-strip" data-p="strip"></div>
      <button class="t" data-act="stop">멈추기</button>`;
    body.querySelector("[data-act=stop]").onclick = () => { W.conv.stop = true; body.querySelector("[data-act=stop]").disabled = true; };
    return;
  }
  if (W.pages.length && cv && cv.finished) {
    const where = cv.where
      ? `<span class="ok">저장 위치: ${esc(cv.where)}</span>`
      : `<span class="warn">이 브라우저에서는 폴더에 저장하지 못했습니다. 지금 작업은 할 수 있지만 다음에 열 때 PDF를 다시 변환해야 합니다. 크롬이나 엣지에서 여는 걸 권합니다.</span>`;
    body.innerHTML = `
      <div class="wiz-drop ok static">
        <b>${esc(W.pdf.name)}</b>
        <span>${cv.stopped ? "멈춤 — " : ""}지면 ${W.pages.length}장 변환 · 평균 ${Math.round(cv.avgKb)}KB · 쪽번호를 꼬리말에서 ${W.pages.filter(p => p.num).length}장 읽었습니다</span>
        <span class="muted">250쪽이면 약 ${cv.est250.toFixed(1)}MB (목표 60MB 이하)</span>
      </div>
      <div class="note">${where}</div>
      ${strip()}
      <button class="t link" data-act="repick">다른 PDF 고르기</button>${links("pdf")}`;
    body.querySelector("[data-act=repick]").onclick = () => { resetPages(); W.pdf = null; W.conv = null; render(); };
    bindLinks();
    return;
  }
  const est = W.pdf && W.pdfPages ? Math.max(1, Math.round((W.range.last - W.range.first + 1) * 1.3 / 60)) : 0;
  body.innerHTML = `
    <p class="wiz-lead">교과서 PDF를 고르세요. 쪽마다 지면 이미지로 바꾸고, 쪽번호와 단원 이름도 함께 읽습니다.</p>
    <label class="wiz-drop ${W.pdf ? "ok" : ""}" data-p="drop">
      <input type="file" accept="application/pdf,.pdf" hidden data-in="pdf">
      ${W.pdf
        ? `<b>${esc(W.pdf.name)}</b><span>${W.pdfPages ? `모두 ${W.pdfPages}쪽 · ${(W.pdf.size / 1048576).toFixed(1)}MB` : "읽는 중…"}</span><span class="muted">다른 PDF를 고르려면 누르세요</span>`
        : `<b>교과서 PDF 고르기</b><span class="muted">여기로 끌어다 놓아도 됩니다</span>`}
    </label>
    ${W.pdf && W.pdfPages ? `
      <div class="wiz-field inline-range">
        <label>변환할 쪽</label>
        <div class="inline"><input type="number" id="wiz-r1" min="1" max="${W.pdfPages}" value="${W.range.first}"> ~
          <input type="number" id="wiz-r2" min="1" max="${W.pdfPages}" value="${W.range.last}">
          <span class="muted">PDF 안의 순서 기준 · 약 ${est}분 걸립니다</span></div>
      </div>
      <button class="t primary big" data-act="convert">변환 시작</button>
      <div class="note"><span class="muted">${window.EbookIngest && window.EbookIngest.canSaveToFolder()
        ? "시작하면 지면 이미지를 저장할 폴더를 묻습니다. 고른 폴더 안에 「PDF이름_지면」 폴더가 생깁니다."
        : "이 브라우저는 폴더 저장을 지원하지 않아 변환 결과가 이번 작업에만 남습니다. 크롬이나 엣지를 권합니다."}</span></div>` : ""}
    ${links("pdf")}`;
  const inp = body.querySelector("[data-in=pdf]");
  inp.onchange = e => { if (e.target.files[0]) setPdf(e.target.files[0]); e.target.value = ""; };
  const drop = body.querySelector("[data-p=drop]");
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("hover"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("hover"));
  drop.addEventListener("drop", e => {
    e.preventDefault(); drop.classList.remove("hover");
    const f = Array.from(e.dataTransfer.files || []).find(f => /\.pdf$/i.test(f.name));
    if (f) setPdf(f); else toastErr("PDF 파일을 놓아 주세요.");
  });
  const r1 = body.querySelector("#wiz-r1"), r2 = body.querySelector("#wiz-r2");
  if (r1) {
    const upd = () => {
      let a = parseInt(r1.value, 10) || 1, b = parseInt(r2.value, 10) || W.pdfPages;
      a = Math.min(Math.max(1, a), W.pdfPages); b = Math.min(Math.max(a, b), W.pdfPages);
      W.range = { first: a, last: b }; render();
    };
    r1.onchange = upd; r2.onchange = upd;
  }
  const go = body.querySelector("[data-act=convert]");
  if (go) go.onclick = startConvert;
  bindLinks();
}

function strip() {
  const n = W.pages.length;
  return `<div class="wiz-strip">${W.pages.slice(0, 12).map(p =>
    `<figure><img src="${p.thumb}" alt=""><figcaption>${p.num ? p.num.n + "쪽" : "—"}</figcaption></figure>`).join("")}
    ${n > 12 ? `<span class="muted more">외 ${n - 12}장</span>` : ""}</div>`;
}
function resetPages() {
  (W.thumbUrls || []).forEach(u => URL.revokeObjectURL(u));
  W.thumbUrls = []; W.pages = []; W.mi = null; W.byName = null; W.ana = null; W.units = [];
}
function switchSrc(src) {
  if (W.conv && W.conv.running) return;
  resetPages();
  W.src = src; W.manual = src === "manual"; W.conv = null;
  if (src === "manual") W.firstPrinted = 1;
  render();
}
async function setPdf(file) {
  if (!/\.pdf$/i.test(file.name)) { toastErr("PDF 파일을 골라 주세요."); return; }
  resetPages();
  W.pdf = file; W.pdfPages = 0; W.conv = null;
  render();
  try {
    W.pdfPages = await window.EbookIngest.pageCountOf(file);
    W.range = { first: 1, last: W.pdfPages };
  } catch (e) {
    W.pdf = null;
    toastErr("PDF를 열지 못했습니다. 암호가 걸려 있거나 손상된 파일일 수 있습니다.");
  }
  if (W) render();
}

async function startConvert() {
  const ing = window.EbookIngest;
  let root = null;
  if (ing.canSaveToFolder()) {
    try { root = await window.showDirectoryPicker({ id: "ebook-pages", mode: "readwrite" }); }
    catch (e) {
      if (e && e.name === "AbortError") return;          // 폴더 고르기를 취소함 → 그대로 머문다
      root = null;
    }
  }
  const total = W.range.last - W.range.first + 1;
  W.conv = { running: true, total, stop: false };
  render();
  const t0 = performance.now();
  const q = s => W && W.el.querySelector(`[data-p=${s}]`);
  let res;
  try {
    res = await ing.convert(W.pdf, {
      first: W.range.first, last: W.range.last, root,
      shouldStop: () => !W || W.conv.stop,
      onPage: info => {
        if (!W) return;
        const pct = Math.round(info.done / info.total * 100);
        const bar = W.el.querySelector(".wiz-prog .bar i"); if (bar) bar.style.width = pct + "%";
        const c = q("count"); if (c) c.textContent = `${info.done} / ${info.total}쪽`;
        const left = (performance.now() - t0) / info.done * (info.total - info.done) / 1000;
        const eta = q("eta"); if (eta) eta.textContent = left > 1 ? `약 ${left > 90 ? Math.ceil(left / 60) + "분" : Math.ceil(left) + "초"} 남음` : "";
        const sz = q("size"); if (sz) sz.textContent = `지금까지 ${(info.totalKb / 1024).toFixed(1)}MB · 쪽당 평균 ${Math.round(info.totalKb / info.done)}KB`;
        const st = q("strip");
        if (st && st.children.length < 12) {
          const u = URL.createObjectURL(info.thumb); W.thumbUrls = (W.thumbUrls || []).concat(u);
          st.insertAdjacentHTML("beforeend", `<figure><img src="${u}" alt=""><figcaption>${info.pdfPage}</figcaption></figure>`);
        }
      }
    });
  } catch (e) {
    if (!W) return;
    W.conv = null;
    toastErr("변환하다 멈췄습니다: " + (e && e.message ? e.message : e));
    render();
    return;
  }
  if (!W) return;                                          // 도중에 창을 닫음
  (W.thumbUrls || []).forEach(u => URL.revokeObjectURL(u));
  W.thumbUrls = [];
  W.pages = res.pages.map((p, i) => {
    const url = URL.createObjectURL(p.thumb); W.thumbUrls.push(url);
    return { index: i + 1, key: p.key, hash: p.hash, thumb: url, words: p.words, num: findPageNumber(p.words), unit: findUnitTitle(p.words) };
  });
  W.mi = res.mi; W.byName = res.byName; W.ana = null; W.units = [];
  const n = res.rows.length || 1;
  const baseKb = res.rows.reduce((a, r) => a + r.base_kb, 0), allKb = res.rows.reduce((a, r) => a + r.base_kb + r.thumb_kb, 0);
  W.conv = {
    running: false, finished: true, stopped: res.stopped,
    avgKb: baseKb / n, est250: allKb / n * 250 / 1024,
    where: res.saved && root ? [root.name, res.folderName].filter(Boolean).join("\\") : null
  };
  if (!W.pages.length) { W.conv = null; toastErr("변환된 쪽이 없습니다."); }
  render();
}

async function readFolder(fileList) {
  const files = Array.from(fileList);
  const miFile = files.find(f => f.name === "master-index.json");
  if (!miFile) { toastErr("이 폴더에는 master-index.json 이 없습니다. 변환 결과 폴더(out)를 골라 주세요."); return; }
  let mi;
  try { mi = JSON.parse(await miFile.text()); } catch (_) { toastErr("master-index.json 을 읽지 못했습니다."); return; }
  const byName = {};
  const textByKey = {};
  files.forEach(f => {
    byName[f.name] = f;
    const rel = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
    const m = /(?:^|\/)text\/(\d+)\.json$/.exec(rel);
    if (m) textByKey[m[1]] = f;
  });
  (W.thumbUrls || []).forEach(u => URL.revokeObjectURL(u));
  W.thumbUrls = [];
  const keys = Object.keys(mi.pages || {}).sort((a, b) => +a - +b);
  const pages = [];
  for (let i = 0; i < keys.length; i++) {
    const e = mi.pages[keys[i]];
    const img = byName[e.hash + ".thumb.webp"] || byName[e.hash + ".webp"];
    if (!byName[e.hash + ".webp"]) continue;          // 본 이미지가 없으면 지면으로 치지 않음
    const url = URL.createObjectURL(img);
    W.thumbUrls.push(url);
    let num = null, unit = null;
    const tf = textByKey[keys[i]];
    if (tf) {
      try {
        const words = JSON.parse(await tf.text()).words;
        num = findPageNumber(words);
        unit = findUnitTitle(words);
      } catch (_) { /* 텍스트 레이어 없음 — 사람이 입력 */ }
    }
    pages.push({ index: pages.length + 1, key: keys[i], hash: e.hash, thumb: url, num, unit });
  }
  if (!pages.length) { toastErr("지면 이미지를 찾지 못했습니다. master 폴더까지 함께 들어 있는 폴더를 골라 주세요."); return; }
  W.mi = mi; W.byName = byName; W.pages = pages;
  W.folder = (files[0].webkitRelativePath || "").split("/")[0];
  W.ana = null;               // ③에서 다시 판독
  render();
}

/* ③ 쪽번호·단원 확인 */
function prepareStep3() {
  if (W.manual) {
    W.ana = { offset: null, agree: 0, seen: 0, firstAlone: true, odd: [], units: [] };
    if (!W.units.length) W.units = [{ id: "unit-1", title: "1단원", fromIndex: 1, toIndex: W.manualCount }];
    W.units[W.units.length - 1].toIndex = W.manualCount;
    return;
  }
  if (W.ana) return;
  W.ana = analyze(W.pages, W.mi.source);
  W.firstPrinted = W.ana.offset == null ? 1 : 1 + W.ana.offset;
  W.flip = false;
  W.units = W.ana.units.map(u => Object.assign({}, u));
}
function firstAlone() {
  // 사람이 쪽번호를 바꾸면 홀짝으로 다시 판정, "한 칸 밀기"를 누르면 뒤집는다
  const auto = W.ana && W.ana.offset != null && W.firstPrinted === 1 + W.ana.offset
    ? W.ana.firstAlone
    : W.firstPrinted % 2 === 1;
  return W.flip ? !auto : auto;
}
function pageCount() { return W.manual ? W.manualCount : W.pages.length; }

function step3(body) {
  prepareStep3();
  const a = W.ana, n = pageCount();
  const off = W.firstPrinted - 1;
  const lastPrinted = n + off;
  const readNote = W.manual ? "" : a.seen === 0
    ? `<span class="warn">꼬리말에서 쪽번호를 읽지 못했습니다. 첫 지면의 쪽번호를 직접 넣어 주세요.</span>`
    : W.firstPrinted === 1 + a.offset
      ? `<span class="ok">꼬리말에서 읽음 — ${a.seen}장 중 ${a.agree}장 일치</span>`
      : `<span class="muted">직접 고친 값입니다 (꼬리말에서는 ${1 + a.offset}쪽으로 읽었습니다)</span>`;

  // 펼침 미리보기: 첫 펼침 두 개
  const fa = firstAlone();
  const spreads = [];
  if (fa) { spreads.push([null, 1]); spreads.push([2, 3]); }
  else { spreads.push([1, 2]); spreads.push([3, 4]); }
  const cell = idx => {
    if (idx == null || idx > n) return `<div class="pv empty"></div>`;
    const p = W.pages[idx - 1];
    return `<div class="pv">${p ? `<img src="${p.thumb}" alt="">` : ""}<span>${idx + off}쪽</span></div>`;
  };
  const odd = a.odd.filter(o => o.index + off !== o.read);

  const gbs = (W.profile.globalButtons || []);
  const gbHtml = gbs.length
    ? gbs.map(g => {
        const d = (W.profile.buttons || []).find(b => b.id === g.buttonId) || {};
        const t = (W.profile.themes || []).find(t => t.id === d.themeId) || { color: "#5A6472", onColor: "#fff" };
        return `<span class="gchip" style="background:${t.color};color:${t.onColor || "#fff"}">${C().iconSvg(d.icon)}${esc(g.label || d.label)}</span>`;
      }).join("")
    : `<span class="muted">없음</span>`;

  body.innerHTML = `
    <div class="wiz-grid">
      <div>
        <div class="wiz-field">
          <label for="wiz-first">첫 지면의 교과서 쪽번호</label>
          <div class="inline"><input type="number" id="wiz-first" value="${W.firstPrinted}" min="-20" max="999"> <span>쪽 → 마지막 지면 ${lastPrinted}쪽 · 모두 ${n}장</span></div>
          <div class="note">${readNote}</div>
          ${odd.length ? `<div class="note"><span class="warn">쪽번호가 규칙에서 벗어나는 지면 ${odd.length}곳</span>
              <span class="muted">${odd.slice(0, 4).map(o => `지면 ${o.index}(꼬리말 ${o.read}쪽)`).join(", ")}${odd.length > 4 ? " 외" : ""} — 만든 뒤 검증 패널에서 확인하세요</span></div>` : ""}
        </div>
        <div class="wiz-field">
          <label>대단원 <span class="muted">자료가 단원별로 묶여 저장됩니다</span></label>
          <div class="wiz-units">${W.units.map((u, i) => `
            <div class="u"><input type="text" data-u="${i}" value="${esc(u.title)}" maxlength="40">
              <span class="muted">${u.fromIndex + off}–${u.toIndex + off}쪽</span></div>`).join("")}</div>
        </div>
        <div class="wiz-field">
          <label>모든 지면에 자동으로 붙는 버튼</label>
          <div class="gchips">${gbHtml}</div>
        </div>
      </div>
      <div>
        <label class="lbl">펼침 미리보기</label>
        <div class="wiz-spreads">${spreads.map(s => `<div class="sp">${cell(s[0])}${cell(s[1])}</div>`).join("")}</div>
        <label class="chk sm"><input type="checkbox" id="wiz-flip" ${W.flip ? "checked" : ""}> 좌우 짝이 안 맞아요 (한 칸 밀기)</label>
      </div>
    </div>`;
  const fi = body.querySelector("#wiz-first");
  fi.onchange = () => {
    const v = parseInt(fi.value, 10);
    W.firstPrinted = Number.isFinite(v) ? v : W.firstPrinted;
    render();
  };
  fi.onkeydown = e => { if (e.key === "Enter") fi.onchange(); };
  body.querySelector("#wiz-flip").onchange = e => { W.flip = e.target.checked; render(); };
  body.querySelectorAll("[data-u]").forEach(inp => {
    inp.oninput = () => { W.units[+inp.dataset.u].title = inp.value; refreshNext(); };
  });
}

/* ---------------------------------------------------------------- 진행·생성 */
function next() {
  if (W.step < 3) { W.step++; render(); return; }
  create();
}
function create() {
  const core = C();
  const n = pageCount();
  const offset = W.firstPrinted - 1;                 // printedPage = index + offset
  const units = W.units.map(u => ({ id: u.id, title: u.title.trim(), fromIndex: u.fromIndex, toIndex: u.toIndex }));
  const bookId = `${W.profile.profileId}-${new Date().getFullYear()}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  core.newProject({
    title: W.title.trim(),
    pageCount: n,
    offset,
    firstPageAlone: firstAlone(),
    bookId,
    profile: core.clone(W.profile),
    units,
    sourcePdf: W.mi ? W.mi.source || "" : ""
  });
  let attached = 0;
  if (!W.manual) attached = core.applyPipeline(W.mi, W.byName, 1);
  if (!W.manual) W.pages.forEach(p => { if (p.words && !core.S.pageText[p.index]) core.S.pageText[p.index] = p.words; });   // PDF로 바로 만든 경우 — 쪽 찾기에 씀
  core.goToPage(1);
  core.autosave();
  const summary = `${1 + offset}–${n + offset}쪽 ${n}장` + (W.manual ? " · 배경 없음" : attached < n ? ` · 이미지 ${attached}장만 연결` : "");
  const manual = W.manual;
  close();                                            // 썸네일 URL은 여기서 해제 — 배경은 app 이 본 이미지로 따로 만든다
  core.renderAll();
  core.setStatus("새 프로젝트 준비됨 — " + summary, attached < n && !manual ? "warn" : "ok");
}

function toastErr(msg) {
  const el = document.createElement("div");
  el.className = "toast err"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

window.EbookWizard = { open, close, _analyze: analyze, _findPageNumber: findPageNumber, _findUnitTitle: findUnitTitle };
})();
