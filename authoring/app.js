/* =========================================================================
   e-book 저작기 코어 — WBS 2.1 버튼 배치 / 2.2 드래그&드롭 / 2.3 저장·재열기
   schema/ v0.1 (common·book·page·profile) 에 그대로 맞춤.
   - 좌표는 unitCoord 0~1만. 절대 픽셀 저장 없음
   - 크기 상속 3단: profile.defaultSize → button.defaultSize → object.size
   - 펼침 경계 위반은 경고가 아니라 배치 차단
   - 실행취소는 처음부터 스택 방식
   - 코드에 교과 지식 0 — 팔레트·테마·지면유형은 전부 프로파일에서 나온다
   ========================================================================= */
(function () {
"use strict";

const SCHEMA_VERSION = "0.1";
const AUTOSAVE_KEY = "ebook-authoring:autosave:v2";
const UNDO_LIMIT = 60;
const STACK_GAP = 0.006;
const LABEL_MAX = 40;                       // page.schema: label maxLength

/* 파일명 규약: {차시|인쇄쪽}_{자료코드}_{이름}[_@{contentSeq}].{확장자} */
const CODE_LABEL = { TG: "지도안", PT: "수업PPT", WS: "활동지", VD: "영상", IM: "이미지", AN: "예시답·풀이", EX: "외부도구" };

/* 아이콘 — 프로파일의 icon 이름으로 찾는다. 없으면 file */
const ICONS = {
  clipboard: "M9 3h6v3H9zM7 5H5v16h14V5h-2M9 11h6M9 15h6",
  presentation: "M3 4h18M4 4v9h16V4M9 21l3-4 3 4",
  pencil: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z",
  play: "M8 5l11 7-11 7z",
  check: "M4 13l5 5L20 7",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  image: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6",
  link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  file: "M14 3H7v18h12V8zM14 3v5h5"
};
function iconSvg(name) {
  const d = ICONS[name] || ICONS.file;
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

/* ---------------------------------------------------------------- 상태 */
const S = {
  profile: null,
  book: null,
  pages: {},          // { [index]: page.schema 객체 }
  bgUrls: {},         // { [index]: objectURL }  — 저장 대상 아님
  bgFiles: {},        // { [index]: File } — 「교사 화면으로 보기」로 넘길 원본 (저장 안 함)
  pageText: {},       // { [index]: words[] | File(text/{k}.json) } — 쪽 찾기(draft-guess.js)용 지면 글자 (저장 안 함)
  assetFiles: {},     // { [asset.path]: File } — 끌어다 놓은 자료 원본 (세션 동안만)
  spread: 0,
  selId: null,
  selG: null,         // 선택한 전역 버튼 { gid, page }
  undo: [], redo: [],
  dirty: false
};

/* ---------------------------------------------------------------- 유틸 */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const objId = () => "obj-" + Array.from({ length: 8 }, () =>
  "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
const stackId = () => "stk-" + Math.random().toString(36).slice(2, 8);
const nowIso = () => new Date().toISOString();
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function toast(msg, isErr) {
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}
function setStatus(msg, cls) {
  const el = $("#status");
  el.textContent = msg;
  el.className = "status" + (cls ? " " + cls : "");
}

/* ---------------------------------------------------------------- 프로파일 조회 */
const btnDef = id => (S.profile.buttons || []).find(b => b.id === id) || null;
const thm = id => (S.profile.themes || []).find(t => t.id === id) || { id, label: id, color: "#5A6472", onColor: "#fff" };
const themeOf = o => thm((btnDef(o.buttonId) || {}).themeId);
const pageTypeDef = id => (S.profile.pageTypes || []).find(p => p.id === id) || null;
const presets = () => S.profile.sizePresets || [];

/* v0.9 자리 잡기용 — 버튼이 지면에서 차지하는 크기(0~1)를 실제로 그려서 잰다 */
function measureEl(el, pageIdx) {
  let box = document.getElementById("measure-box");
  if (!box) {
    box = document.createElement("div"); box.id = "measure-box"; box.className = "page";
    box.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none";
    box.innerHTML = `<div class="layer"></div>`; document.body.appendChild(box);
  }
  const H = 1000, W = Math.round(H * pageAspect(pageIdx));
  box.style.width = W + "px"; box.style.height = H + "px";
  el.style.left = "0"; el.style.top = "0";
  box.firstChild.appendChild(el);
  const r = [el.offsetWidth / W, el.offsetHeight / H];
  el.remove();
  return r;
}
function measureObj(o, pageIdx) { return measureEl(objEl(o, pageIdx, 1000), pageIdx); }
function occupiedRects(pageIdx, except) {     // 이 쪽에 이미 있는 버튼(전역 포함)의 자리 [x0,y0,x1,y1]
  const out = [];
  S.pages[pageIdx].objects.forEach(o => { if (except && except.has(o)) return; const [w, h] = measureObj(o, pageIdx); out.push([o.at.x, o.at.y, o.at.x + w, o.at.y + h]); });
  globalsFor(pageIdx).filter(gb => !gHidden(pageIdx, gb)).forEach(gb => { const [w, h] = measureEl(globalEl(gb, 1000, pageIdx), pageIdx); out.push([gb.at.x, gb.at.y, gb.at.x + w, gb.at.y + h]); });
  return out;
}

/* 크기 상속 3단 */
function effSize(o) {
  const d = btnDef(o.buttonId) || {};
  return Object.assign({ h: 0.028, w: null, lockAspect: false },
    S.profile.defaultSize || {}, d.defaultSize || {}, o.size || {});
}
function effDisplay(o) {
  if (o.display) return o.display;
  const d = btnDef(o.buttonId) || {};
  return d.defaultDisplay || "pill";
}

/* ---------------------------------------------------------------- 프로젝트 */
function blankPage(index) {
  return {
    schemaVersion: SCHEMA_VERSION,
    index,
    printedPage: index + (S.book ? S.book.pageNumbering.offset : 0),
    pageTypeId: null,
    objects: [],
    authoring: { updatedAt: nowIso(), reviewed: false }
  };
}
function newProject(opt) {
  S.profile = opt.profile || clone(window.DEFAULT_PROFILE);
  ensureGlobalIds(S.profile);
  S.book = {
    schemaVersion: SCHEMA_VERSION,
    bookId: opt.bookId || "untitled-book",
    title: opt.title || "새 이북",
    subject: opt.subject || "",
    grade: opt.grade || "",
    pageCount: opt.pageCount || 40,
    profileId: S.profile.profileId,
    pageNumbering: { offset: opt.offset == null ? 0 : opt.offset },
    spread: { mode: "spread", firstPageAlone: opt.firstPageAlone == null ? true : !!opt.firstPageAlone },
    master: { format: "webp", baseQuality: 72, baseLongEdge: 3000, thumbQuality: 60, thumbLongEdge: 240, targetBytes: 286720, maxBytes: 460800 },
    units: clone(opt.units || []),
    pages: [],
    authoring: { createdAt: nowIso(), updatedAt: nowIso(), sourcePdf: opt.sourcePdf || "" }
  };
  if (!S.book.subject) delete S.book.subject;
  if (!S.book.grade) delete S.book.grade;
  S.pages = {};
  for (let i = 1; i <= S.book.pageCount; i++) S.pages[i] = blankPage(i);
  S.bgUrls = {}; S.bgFiles = {}; S.pageText = {}; S.spread = 0; S.selId = null; S.undo = []; S.redo = []; S.dirty = false;
}

/* book.pages[] 는 목차 캐시 — 저장 직전에 다시 만든다 (validate 의 objectCount 무결성).
   book.schema 가 항목마다 master(마스터 이미지 해시)를 요구하므로, 배경이 붙은 지면만 올라간다.
   → 배경 파이프라인(1.x)이 저작보다 먼저다. 배경 없이 배치한 지면은 검증 패널이 경고한다. */
function rebuildBookPages() {
  const prevAll = S.book.pages || [];
  S.book.pages = Object.values(S.pages)
    .sort((a, b) => a.index - b.index)
    .map(p => {
      const prev = prevAll.find(e => e.index === p.index);
      if (!prev || !prev.master) return null;
      const e = {
        index: p.index,
        printedPage: p.printedPage,
        master: prev.master,
        pageTypeId: p.pageTypeId,
        objectCount: p.objects.length
      };
      if (prev.aspect) e.aspect = prev.aspect;
      if (prev.unitId) e.unitId = prev.unitId;
      return e;
    })
    .filter(Boolean);
}
function bookPageEntry(index) { return (S.book.pages || []).find(p => p.index === index); }
function setBookPageEntry(index, patch) {
  let e = bookPageEntry(index);
  if (!e) { e = { index, printedPage: index + S.book.pageNumbering.offset, pageTypeId: null, objectCount: 0 }; S.book.pages.push(e); }
  Object.assign(e, patch);
}
function pageAspect(index) {
  const e = bookPageEntry(index);
  return (e && e.aspect) || 0.764;
}

/* ---------------------------------------------------------------- 펼침 */
function spreadPages() {
  const n = S.book.pageCount;
  if (S.book.spread.firstPageAlone) {
    if (S.spread === 0) return [null, n >= 1 ? 1 : null];
    const l = S.spread * 2, r = l + 1;
    return [l <= n ? l : null, r <= n ? r : null];
  }
  const l = S.spread * 2 + 1, r = l + 1;
  return [l <= n ? l : null, r <= n ? r : null];
}
function spreadCount() {
  const n = S.book.pageCount;
  return S.book.spread.firstPageAlone ? Math.floor(n / 2) + 1 : Math.ceil(n / 2);
}
function goToPage(idx) {
  S.spread = S.book.spread.firstPageAlone
    ? (idx <= 1 ? 0 : Math.floor(idx / 2))
    : Math.floor((idx - 1) / 2);
}

/* ---------------------------------------------------------------- 편집 신호 (측정 모듈 등 바깥에서 구독) */
const editListeners = [];
function notify(label) { editListeners.forEach(f => { try { f(label); } catch (_) { /* 구독자 오류는 무시 */ } }); }

/* ---------------------------------------------------------------- 실행취소 스택 */
function pushUndo(label) {
  notify(label);
  S.undo.push(snapNow(label));
  if (S.undo.length > UNDO_LIMIT) S.undo.shift();
  S.redo.length = 0;
  S.dirty = true;
  refreshUndoUI();
}
function snapNow(label) { return { label, pages: clone(S.pages), book: clone(S.book), sel: S.selId, selG: clone(S.selG), gbs: clone(S.profile.globalButtons || []) }; }
function applySnap(s) {
  S.pages = clone(s.pages); S.book = clone(s.book); S.selId = s.sel; S.selG = clone(s.selG || null);
  if (s.gbs) S.profile.globalButtons = clone(s.gbs);
  if (S.selG && !gbById(S.selG.gid)) S.selG = null;
}
function undo() {
  if (!S.undo.length) return;
  const s = S.undo.pop(); S.redo.push(snapNow(s.label)); applySnap(s);
  notify("실행취소");
  renderAll(); setStatus("실행취소: " + s.label);
}
function redo() {
  if (!S.redo.length) return;
  const s = S.redo.pop(); S.undo.push(snapNow(s.label)); applySnap(s);
  notify("다시실행");
  renderAll(); setStatus("다시실행: " + s.label);
}
function refreshUndoUI() {
  $("#btn-undo").disabled = !S.undo.length;
  $("#btn-redo").disabled = !S.redo.length;
}

/* ---------------------------------------------------------------- 객체 */
function makeObject(buttonId, x, y, extra) {
  const d = btnDef(buttonId) || { id: "etc", label: "자료", assetKind: "etc" };
  const o = {
    id: objId(),
    kind: "button",
    at: { x, y },
    target: d.defaultTarget || "teacher",
    buttonId: d.id,
    label: (d.label || "").slice(0, LABEL_MAX),
    assetKind: d.assetKind,
    action: "open"
  };
  return Object.assign(o, extra || {});
}
function findObj(id) {
  for (const k of Object.keys(S.pages)) {
    const o = S.pages[k].objects.find(x => x.id === id);
    if (o) return o;
  }
  return null;
}
function findPageOf(id) {
  for (const k of Object.keys(S.pages)) if (S.pages[k].objects.some(x => x.id === id)) return +k;
  return null;
}
function touch(index) {
  S.pages[index].authoring = S.pages[index].authoring || {};
  S.pages[index].authoring.updatedAt = nowIso();
  S.book.authoring.updatedAt = nowIso();
}

/* ---------------------------------------------------------------- 렌더 */
function renderAll() {
  renderPalette();
  renderSpread();
  renderInspector();
  renderValidate();
  refreshUndoUI();
  const [L, R] = spreadPages();
  $("#spread-label").textContent =
    `펼침 ${S.spread + 1} / ${spreadCount()} · 지면 ${[L, R].filter(Boolean).join("–") || "—"}`;
  $("#page-size-note").textContent =
    `${S.book.title} · ${S.book.pageCount}쪽 · 인쇄쪽 = 지면 ${S.book.pageNumbering.offset >= 0 ? "+" : ""}${S.book.pageNumbering.offset}`;
}

function renderPalette() {
  $("#profile-name").textContent = S.profile ? "· " + S.profile.name : "";
  const wrap = $("#palette-list"); wrap.innerHTML = "";
  (S.profile.themes || []).forEach(t => {
    const list = (S.profile.buttons || []).filter(b => b.themeId === t.id);
    if (!list.length) return;
    const g = document.createElement("div"); g.className = "pal-group";
    g.innerHTML = `<h4>${escapeHtml(t.label)}</h4>`;
    list.forEach(b => g.appendChild(palItem(b, t, true)));
    wrap.appendChild(g);
  });
  const gl = $("#global-list"); gl.innerHTML = "";
  (S.profile.globalButtons || []).forEach(gb => {
    const d = btnDef(gb.buttonId) || { icon: "file", themeId: "etc" };
    const it = palItem({ id: gb.buttonId, label: gb.label || d.label, icon: d.icon }, thm(d.themeId), false);
    const st = gStats(gb);
    it.title = `전역 버튼 · ${st.shown}쪽에 표시 · 연결 ${st.linked}/${st.shown} — 눌러서 선택`;
    it.onclick = () => { const [L, R] = spreadPages(); S.selId = null; S.selG = { gid: gb.id, page: L || R || 1 }; renderAll(); };
    if (st.linked < st.shown) it.insertAdjacentHTML("beforeend", `<span class="pcount">${st.linked}/${st.shown}</span>`);
    gl.appendChild(it);
  });
  if (!(S.profile.globalButtons || []).length) gl.innerHTML = `<div class="hint">없음 — 지면의 버튼을 골라 「모든 지면에 (전역으로)」</div>`;
}
function palItem(def, t, draggable) {
  const el = document.createElement("div");
  el.className = "pal-item";
  el.style.background = t.color; el.style.color = t.onColor || "#fff";
  el.innerHTML = iconSvg(def.icon) + `<span class="nm">${escapeHtml(def.label)}</span>`;
  if (draggable) {
    el.draggable = true;
    el.title = def.fileCode ? `파일코드 ${def.fileCode} · ${def.assetKind}` : def.assetKind || "";
    el.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/ebook-button", def.id);
      e.dataTransfer.effectAllowed = "copy";
    });
  } else {
    el.title = "전역 버튼 — 프로파일에만 존재하며 지면마다 저장하지 않습니다";
  }
  return el;
}

function pageGeom() {
  const stage = $("#stage");
  const [L, R] = spreadPages();
  const arL = pageAspect(L || R || 1), arR = pageAspect(R || L || 1);
  const availW = Math.max(200, stage.clientWidth - 48), availH = Math.max(200, stage.clientHeight - 48);
  let h = availH;
  if (h * (arL + arR) + 2 > availW) h = (availW - 2) / (arL + arR);
  return { h: Math.floor(h), wL: Math.floor(h * arL), wR: Math.floor(h * arR) };
}

function renderSpread() {
  const [L, R] = spreadPages();
  const g = pageGeom();
  const grid = $("#chk-grid").checked, safe = $("#chk-safe").checked;
  $$("#spread .page").forEach((pEl, i) => {
    const idx = i === 0 ? L : R;
    pEl.style.width = (i === 0 ? g.wL : g.wR) + "px";
    pEl.style.height = g.h + "px";
    pEl.dataset.page = idx == null ? "" : idx;
    pEl.classList.toggle("dim", idx == null);
    pEl.classList.toggle("grid", grid && idx != null);
    pEl.classList.toggle("safe", safe && idx != null);
    const bg = $(".page-bg", pEl);
    const url = idx != null && S.bgUrls[idx];
    bg.style.backgroundImage = url ? `url("${url}")` : "";
    bg.classList.toggle("empty", !url && idx != null);
    const pt = idx != null && S.pages[idx].pageTypeId ? pageTypeDef(S.pages[idx].pageTypeId) : null;
    $(".page-no", pEl).textContent = idx == null ? ""
      : `${S.pages[idx].printedPage}쪽  (지면 ${idx})${pt ? " · " + pt.label : ""}`;
    const layer = $(".layer", pEl); layer.innerHTML = "";
    if (idx == null) return;
    layoutStacks(idx);
    S.pages[idx].objects.forEach(o => layer.appendChild(objEl(o, idx, g.h)));
    globalsFor(idx).forEach(gb => layer.appendChild(globalEl(gb, g.h, idx)));
  });
  markOverflow();
  $("#nav-prev").disabled = S.spread === 0;
  $("#nav-next").disabled = S.spread >= spreadCount() - 1;
  renderPageTypeBar();
}

function objEl(o, pageIdx, pageH) {
  const sz = effSize(o), disp = effDisplay(o), t = themeOf(o), d = btnDef(o.buttonId) || {};
  const el = document.createElement("div");
  el.className = "obj d-" + disp + (o.id === S.selId ? " sel" : "") + (o.target !== "teacher" ? " t-" + o.target : "");
  el.dataset.id = o.id; el.dataset.page = pageIdx;
  const hpx = sz.h * pageH;
  el.style.left = (o.at.x * 100) + "%";
  el.style.top = (o.at.y * 100) + "%";
  el.style.height = hpx + "px";
  el.style.fontSize = (hpx * 0.44) + "px";
  el.style.background = t.color; el.style.color = t.onColor || "#fff";
  if (disp === "icon") el.style.width = hpx + "px";
  if (sz.w != null) { el.style.width = (sz.w * 100) + "%"; el.classList.add("wrap"); el.style.height = "auto"; }
  el.innerHTML =
    (disp === "label" ? "" : iconSvg(d.icon)) +
    (disp === "icon" ? "" : `<span class="lbl">${escapeHtml(o.label || d.label || "")}</span>`) +
    (o.asset && o.asset.cmsCode ? `<span class="badge">CMS</span>` : "") +
    (!o.asset ? `<span class="badge warn">미연결</span>` : "");
  if (o.asset) el.title = o.asset.path + (o.asset.cmsCode ? ` · @${o.asset.cmsCode}` : "");
  el.addEventListener("pointerdown", startMove);
  if (o.id === S.selId) addHandles(el, o, disp, sz);
  return el;
}
/* ---------------------------------------------------------------- 3.3 전역 버튼
   선언(위치·종류·크기·표시 범위·공통 자료)은 프로파일 globalButtons 에 한 번만,
   쪽마다 다른 것(자료·숨김)은 지면 page.globals[gid] 에만 둔다 — 250쪽에 같은 버튼을 250번 저장하지 않는다 */
function slugId(v) { return String(v || "g").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "g"; }
function ensureGlobalIds(prof) {
  const used = new Set();
  (prof.globalButtons || []).forEach((gb, i) => {
    let id = gb.id && !used.has(gb.id) ? gb.id : `g-${slugId(gb.buttonId)}-${i + 1}`;
    while (used.has(id)) id += "x";
    gb.id = id; used.add(id);
  });
}
const gbById = gid => (S.profile.globalButtons || []).find(g => g.id === gid) || null;
function gShows(gb, pageIdx) {
  const ptId = S.pages[pageIdx] && S.pages[pageIdx].pageTypeId;
  return gb.showOn === "all" || gb.showOn == null || (Array.isArray(gb.showOn) && !!ptId && gb.showOn.includes(ptId));
}
function globalsFor(pageIdx) { return (S.profile.globalButtons || []).filter(gb => gShows(gb, pageIdx)); }
function gLink(pageIdx, gid) { const p = S.pages[pageIdx]; return (p && p.globals && p.globals[gid]) || null; }
function gSetLink(pageIdx, gid, patch) {
  const p = S.pages[pageIdx];
  p.globals = p.globals || {};
  const cur = Object.assign({}, p.globals[gid] || {}, patch);
  Object.keys(cur).forEach(k => { if (cur[k] == null || cur[k] === false) delete cur[k]; });
  if (Object.keys(cur).length) p.globals[gid] = cur; else delete p.globals[gid];
  if (!Object.keys(p.globals).length) delete p.globals;
}
function gAsset(pageIdx, gb) { const l = gLink(pageIdx, gb.id); return (l && l.asset) || gb.asset || null; }
function gHidden(pageIdx, gb) { const l = gLink(pageIdx, gb.id); return !!(l && l.hidden); }
function gSize(gb) { const d = btnDef(gb.buttonId) || {}; return Object.assign({ h: 0.024, w: null }, S.profile.defaultSize || {}, d.defaultSize || {}, gb.size || {}); }
/* 이 쪽에서 실제로 보여야 할 버튼 전부 (뷰어·배포 빌드가 그대로 쓸 해석 규칙) */
function resolvePageButtons(pageIdx) {
  const p = S.pages[pageIdx]; if (!p) return [];
  const own = p.objects.map(o => Object.assign({ source: "page" }, clone(o)));
  const gl = globalsFor(pageIdx).filter(gb => !gHidden(pageIdx, gb)).map(gb => {
    const d = btnDef(gb.buttonId) || {};
    const r = { source: "global", globalId: gb.id, kind: "button", buttonId: gb.buttonId, label: gb.label || d.label || "",
      at: clone(gb.at), size: gSize(gb), display: gb.display || d.defaultDisplay || "pill", target: "teacher", action: "open" };
    const a = gAsset(pageIdx, gb); if (a) r.asset = clone(a);
    return r;
  });
  return own.concat(gl);
}
function globalEl(gb, pageH, pageIdx) {
  const d = btnDef(gb.buttonId) || {};
  const t = thm(d.themeId);
  const sz = gSize(gb);
  const disp = gb.display || d.defaultDisplay || "pill";
  const hidden = gHidden(pageIdx, gb), asset = gAsset(pageIdx, gb);
  const el = document.createElement("div");
  el.className = "obj global d-" + disp + (hidden ? " off" : "") +
    (S.selG && S.selG.gid === gb.id ? " sel" : "");
  el.dataset.gid = gb.id; el.dataset.page = pageIdx;
  const hpx = sz.h * pageH;
  el.style.left = (gb.at.x * 100) + "%"; el.style.top = (gb.at.y * 100) + "%";
  el.style.height = hpx + "px"; el.style.fontSize = (hpx * 0.44) + "px";
  el.style.background = t.color; el.style.color = t.onColor || "#fff";
  if (disp === "icon") el.style.width = hpx + "px";
  if (sz.w != null) { el.style.width = (sz.w * 100) + "%"; el.classList.add("wrap"); el.style.height = "auto"; }
  el.innerHTML = (disp === "label" ? "" : iconSvg(d.icon)) +
    (disp === "icon" ? "" : `<span class="lbl">${escapeHtml(gb.label || d.label || "")}</span>`) +
    `<span class="gtag" title="전역 버튼">전역</span>` +
    (hidden ? "" : !asset ? `<span class="badge warn">미연결</span>` : asset.cmsCode ? `<span class="badge">CMS</span>` : "");
  el.title = hidden ? "전역 버튼 — 이 쪽에서는 숨김" : "전역 버튼 — 모든 지면에서 같은 자리. 자료 파일을 여기 놓으면 이 쪽에만 연결";
  el.addEventListener("pointerdown", startGlobalMove);
  return el;
}
let gdrag = null;
function startGlobalMove(e) {
  if (e.button !== 0) return;
  const el = e.currentTarget, gb = gbById(el.dataset.gid); if (!gb) return;
  e.preventDefault(); e.stopPropagation();
  S.selId = null; S.selG = { gid: gb.id, page: +el.dataset.page };
  const pEl = el.closest(".page"), r = pEl.getBoundingClientRect();
  gdrag = { gid: gb.id, rect: r, moved: false,
    ox: (e.clientX - r.left) / r.width - gb.at.x, oy: (e.clientY - r.top) / r.height - gb.at.y,
    wU: el.offsetWidth / pEl.clientWidth, hU: el.offsetHeight / pEl.clientHeight, before: snapNow("전역 이동") };
  window.addEventListener("pointermove", onGlobalMove);
  window.addEventListener("pointerup", endGlobalMove);
  renderAll();
}
function onGlobalMove(e) {
  if (!gdrag) return;
  const gb = gbById(gdrag.gid); if (!gb) return;
  gb.at = { x: clamp((e.clientX - gdrag.rect.left) / gdrag.rect.width - gdrag.ox, 0, 1 - gdrag.wU),
            y: clamp((e.clientY - gdrag.rect.top) / gdrag.rect.height - gdrag.oy, 0, 1 - gdrag.hU) };
  gdrag.moved = true;
  $$(`#spread .obj.global[data-gid="${gb.id}"]`).forEach(x => { x.style.left = (gb.at.x * 100) + "%"; x.style.top = (gb.at.y * 100) + "%"; });
}
function endGlobalMove() {
  window.removeEventListener("pointermove", onGlobalMove);
  window.removeEventListener("pointerup", endGlobalMove);
  const d = gdrag; gdrag = null; if (!d) return;
  if (d.moved) {
    const gb = gbById(d.gid);
    gb.at = { x: +gb.at.x.toFixed(4), y: +gb.at.y.toFixed(4) };
    notify("전역 이동");
    S.undo.push(d.before); if (S.undo.length > UNDO_LIMIT) S.undo.shift();
    S.redo.length = 0; S.dirty = true; S.book.authoring.updatedAt = nowIso();
    setStatus("전역 버튼 이동 — 모든 지면에 같이 적용", "ok");
  }
  renderAll();
}
/* 파일 한 개 → 이 쪽의 전역 버튼에 연결 */
function linkGlobalFile(gid, pageIdx, file) {
  const p = parseFileName(file.name);
  const asset = { path: `docs/${unitOf(pageIdx)}/${file.name}`, bytes: file.size };
  if (p.cmsCode) asset.cmsCode = p.cmsCode;
  S.assetFiles[asset.path] = file;
  gSetLink(pageIdx, gid, { asset, hidden: null });
}
/* 파일 여러 개 → 파일명 앞 쪽번호대로 쪽마다 연결 ({쪽}_{코드}_{이름}) */
function bulkLinkGlobal(gid, files) {
  const gb = gbById(gid); if (!gb) return;
  const fc = (btnDef(gb.buttonId) || {}).fileCode;
  const off = S.book.pageNumbering.offset;
  const done = [], skip = [];
  const plan = [];
  Array.from(files).forEach(f => {
    const p = parseFileName(f.name);
    const printed = parseInt(p.slot != null ? p.slot : (f.name.match(/^(\d{1,4})[_\s-]/) || [])[1], 10);
    const idx = printed - off;
    if (!Number.isFinite(printed) || !S.pages[idx]) { skip.push(`${f.name} (쪽번호 없음·범위 밖)`); return; }
    if (p.ok && fc && p.code !== fc) { skip.push(`${f.name} (코드 ${p.code} ≠ ${fc})`); return; }
    if (!gShows(gb, idx)) { skip.push(`${f.name} (${printed}쪽은 표시 범위 밖)`); return; }
    plan.push([idx, f, printed]);
  });
  if (!plan.length) { toast(`연결할 파일이 없습니다 — ${skip.length}개 건너뜀`, true); return; }
  pushUndo("전역 한꺼번에 연결");
  plan.forEach(([idx, f, printed]) => { linkGlobalFile(gid, idx, f); done.push(printed); });
  renderAll();
  setStatus(`전역 「${gb.label || gb.buttonId}」 ${done.length}쪽 연결${skip.length ? ` · ${skip.length}개 건너뜀` : ""}`, skip.length ? "warn" : "ok");
  if (skip.length) toast(`건너뜀: ${skip.slice(0, 3).join(" / ")}${skip.length > 3 ? ` 외 ${skip.length - 3}` : ""}`, true);
}
function promoteToGlobal(o) {
  const pi = findPageOf(o.id);
  pushUndo("전역 버튼으로");
  const prof = S.profile; prof.globalButtons = prof.globalButtons || [];
  /* 라벨은 버튼 종류 이름으로 — 쪽마다 자료(파일 이름)가 다르므로 첫 파일 이름을 전 쪽에 쓰면 틀린다 */
  const gb = { id: "", buttonId: o.buttonId, label: (btnDef(o.buttonId) || {}).label || o.label, at: clone(o.at), showOn: "all" };
  if (o.size) gb.size = clone(o.size);
  if (o.display) gb.display = o.display;
  let n = prof.globalButtons.length + 1, id;
  do { id = `g-${slugId(o.buttonId)}-${n++}`; } while (gbById(id));
  gb.id = id;
  prof.globalButtons.push(gb);
  if (o.asset) gSetLink(pi, id, { asset: clone(o.asset) });
  leaveStack(o, pi);
  S.pages[pi].objects = S.pages[pi].objects.filter(x => x.id !== o.id);
  S.selId = null; S.selG = { gid: id, page: pi };
  touch(pi); renderAll();
  setStatus(`「${gb.label}」 전역 버튼이 됨 — 모든 지면 같은 자리. 쪽마다 자료를 연결하세요`, "ok");
}
function removeGlobal(gid) {
  const gb = gbById(gid); if (!gb) return;
  pushUndo("전역 해제");
  S.profile.globalButtons = S.profile.globalButtons.filter(g => g.id !== gid);
  Object.values(S.pages).forEach(p => { if (p.globals) { delete p.globals[gid]; if (!Object.keys(p.globals).length) delete p.globals; } });
  S.selG = null; renderAll();
  setStatus(`전역 「${gb.label || gb.buttonId}」 해제 — 쪽마다 연결도 함께 지웠습니다 (실행취소 가능)`, "ok");
}
function gStats(gb) {
  let shown = 0, linked = 0, hidden = 0;
  Object.keys(S.pages).forEach(k => {
    const i = +k; if (!gShows(gb, i)) return;
    if (gHidden(i, gb)) { hidden++; return; }
    shown++; if (gAsset(i, gb)) linked++;
  });
  return { shown, linked, hidden };
}

function markOverflow() {
  $$("#spread .obj:not(.global)").forEach(el => {
    const pEl = el.closest(".page");
    const o = findObj(el.dataset.id); if (!o) return;
    const wU = el.offsetWidth / pEl.clientWidth, hU = el.offsetHeight / pEl.clientHeight;
    el.classList.toggle("bad",
      o.at.x < -1e-6 || o.at.y < -1e-6 || o.at.x + wU > 1 + 1e-6 || o.at.y + hU > 1 + 1e-6);
  });
}

/* ---------------------------------------------------------------- 지면유형 바 */
function renderPageTypeBar() {
  const bar = $("#pagetype-bar");
  const [L, R] = spreadPages();
  bar.innerHTML = "";
  [L, R].forEach(idx => {
    if (idx == null) return;
    const cur = S.pages[idx].pageTypeId;
    const wrap = document.createElement("div");
    wrap.className = "pt-item";
    wrap.innerHTML = `<span class="muted">${S.pages[idx].printedPage}쪽</span>`;
    const sel = document.createElement("select");
    sel.innerHTML = `<option value="">(유형 없음)</option>` +
      (S.profile.pageTypes || []).map(p =>
        `<option value="${p.id}" ${p.id === cur ? "selected" : ""}>${escapeHtml(p.label)}</option>`).join("");
    sel.onchange = () => {
      pushUndo("지면유형 변경");
      S.pages[idx].pageTypeId = sel.value || null;
      setBookPageEntry(idx, { pageTypeId: sel.value || null });
      touch(idx); renderAll();
    };
    wrap.appendChild(sel);
    const btn = document.createElement("button");
    btn.className = "t"; btn.textContent = "버튼 세트 놓기";
    btn.disabled = !cur;
    btn.title = "이 유형에 늘 붙는 버튼들을 지면 왼쪽 위에 빈 버튼으로 미리 놓습니다. 파일을 버튼 위에 놓으면 연결됩니다";
    btn.onclick = () => applyPageType(idx);
    wrap.appendChild(btn);
    bar.appendChild(wrap);
  });
}
function applyPageType(idx) {
  const pt = pageTypeDef(S.pages[idx].pageTypeId);
  if (!pt || !pt.buttonIds.length) return;
  pushUndo("지면유형 버튼 세트");
  const sid = stackId();
  const base = S.profile.defaultSize || { h: 0.028, w: null };
  let y = 0.08;
  pt.buttonIds.forEach((bid, i) => {
    if (!btnDef(bid)) return;
    const o = makeObject(bid, 0.07, y, { stackId: sid, stackOrder: i, size: clone(base) });
    S.pages[idx].objects.push(o);
    y += (base.h || 0.028) + STACK_GAP;
  });
  touch(idx); renderAll();
  setStatus(`${pt.label} 버튼 ${pt.buttonIds.length}개를 놓았어요 — 파일을 버튼 위에 놓거나 「자료 폴더로 초안 만들기」로 채우세요`, "ok");
}

/* ---------------------------------------------------------------- 스택 */
function layoutStacks(pageIdx) {
  const stacks = {};
  S.pages[pageIdx].objects.forEach(o => { if (o.stackId) (stacks[o.stackId] = stacks[o.stackId] || []).push(o); });
  Object.values(stacks).forEach(list => {
    list.sort((a, b) => (a.stackOrder || 0) - (b.stackOrder || 0));
    list.forEach((o, i) => { o.stackOrder = i; });
    const a = list[0];
    let y = a.at.y;
    list.forEach(o => { o.at.x = a.at.x; o.at.y = y; y += effSize(o).h + STACK_GAP; });
  });
}
/* validate.mjs 는 같은 스택의 size 를 JSON 동일성으로 본다 → 합류 시 앵커 크기로 맞춘다 */
function joinStack(anchor, mover) {
  const sid = anchor.stackId || stackId();
  anchor.stackId = sid;
  if (anchor.stackOrder == null) anchor.stackOrder = 0;
  mover.stackId = sid;
  mover.stackOrder = 999;
  mover.size = anchor.size ? clone(anchor.size) : clone(effSize(anchor));
  if (!anchor.size) anchor.size = clone(effSize(anchor));
}
function leaveStack(o, pageIdx) {
  if (!o || !o.stackId) return;
  const sid = o.stackId;
  delete o.stackId; delete o.stackOrder;
  const rest = S.pages[pageIdx].objects.filter(x => x.stackId === sid);
  if (rest.length === 1) { delete rest[0].stackId; delete rest[0].stackOrder; }
}

/* ---------------------------------------------------------------- 배치 */
function setupPageDrops() {
  $$("#spread .page").forEach(pEl => {
    pEl.addEventListener("dragover", e => {
      if (!pEl.dataset.page) return;
      const ty = Array.from(e.dataTransfer.types);
      if (!ty.includes("text/ebook-button") && !ty.includes("Files")) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "copy";
      pEl.classList.add("drop-ok");
    });
    pEl.addEventListener("dragleave", () => pEl.classList.remove("drop-ok"));
    pEl.addEventListener("drop", e => {
      pEl.classList.remove("drop-ok");
      e.preventDefault();
      const idx = +pEl.dataset.page;
      if (!idx) { toast("빈 지면에는 배치할 수 없습니다", true); return; }
      const r = pEl.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      const files0 = Array.from(e.dataTransfer.files || []);
      const gHit = files0.length && document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList && x.classList.contains("global") && +x.dataset.page === idx);
      if (gHit) {
        const gb = gbById(gHit.dataset.gid);
        pushUndo("전역 자료 연결");
        linkGlobalFile(gb.id, idx, files0[0]);
        S.selId = null; S.selG = { gid: gb.id, page: idx };
        touch(idx); renderAll();
        setStatus(`${S.pages[idx].printedPage}쪽 전역 「${gb.label || gb.buttonId}」 ← ${files0[0].name}`, "ok");
        if (files0.length > 1) toast("전역 버튼에는 한 쪽에 파일 하나만 연결됩니다 — 첫 파일만 연결", true);
        return;
      }
      const bid = e.dataTransfer.getData("text/ebook-button");
      if (bid) return placeButton(bid, idx, x, y, null);
      const files = Array.from(e.dataTransfer.files || []);
      /* v0.8 — 파일 하나를 빈 버튼(세트로 미리 놓은 것 등) 위에 놓으면 그 버튼에 연결. 새 버튼을 만들지 않는다 */
      const hit0 = files.length === 1 ? hitObject(idx, x, y) : null;
      if (hit0 && !(hit0.asset && hit0.asset.path)) return linkFileToObject(hit0, idx, files[0]);
      if (files.length) dropFiles(files, idx, x, y);
    });
  });
}

function measure(o, pageIdx) {
  const pEl = $$("#spread .page").find(p => +p.dataset.page === pageIdx);
  if (!pEl) return { w: 0.2, h: 0.03 };
  const probe = objEl(o, pageIdx, pEl.clientHeight);
  probe.style.visibility = "hidden"; probe.style.left = "0"; probe.style.top = "0";
  $(".layer", pEl).appendChild(probe);
  const r = { w: probe.offsetWidth / pEl.clientWidth, h: probe.offsetHeight / pEl.clientHeight };
  probe.remove();
  return r;
}

function placeButton(buttonId, pageIdx, x, y, extra) {
  const o = makeObject(buttonId, x, y, extra);
  const m = measure(o, pageIdx);
  o.at.x = x - m.w / 2; o.at.y = y - m.h / 2;
  if (m.w > 1 || m.h > 1) { toast("버튼이 지면보다 큽니다 — 배치 차단", true); return null; }
  if (o.at.x < 0 || o.at.y < 0 || o.at.x + m.w > 1 || o.at.y + m.h > 1) {
    toast("펼침 경계를 넘습니다 — 배치 차단", true); return null;
  }
  const hit = hitObject(pageIdx, x, y);
  pushUndo("버튼 배치");
  S.pages[pageIdx].objects.push(o);
  if (hit) joinStack(hit, o);
  S.selId = o.id; S.selG = null;
  touch(pageIdx);
  renderAll();
  setStatus(`배치: ${o.label}${hit ? " (스택 합류)" : ""}`, "ok");
  return o;
}
function hitObject(pageIdx, x, y, exceptId) {
  const pEl = $$("#spread .page").find(p => +p.dataset.page === pageIdx);
  if (!pEl) return null;
  for (const o of S.pages[pageIdx].objects) {
    if (o.id === exceptId) continue;
    const el = $(`.obj[data-id="${o.id}"]`, pEl);
    if (!el) continue;
    const w = el.offsetWidth / pEl.clientWidth, h = el.offsetHeight / pEl.clientHeight;
    if (x >= o.at.x && x <= o.at.x + w && y >= o.at.y && y <= o.at.y + h) return o;
  }
  return null;
}

/* ---------------------------------------------------------------- 3.1 크기 핸들 */
/* 모서리(se) = 비율 유지 확대·축소 (프리셋 근처에서 자석, Alt = 자석 끔)
   오른쪽 변(e) = 고정폭. 더블클릭 = 자동폭. lockAspect·아이콘형에는 없음
   스택은 함께 바뀌고(syncStackSize), 지면 밖으로는 키울 수 없다(펼침 경계 차단) */
const H_MIN = 0.01, H_MAX = 0.3, W_MIN = 0.03, SNAP = 0.12;
function addHandles(el, o, disp, sz) {
  const se = document.createElement("span");
  se.className = "hdl se"; se.title = "끌어서 크기 조정 (Alt: 자석 끄기)";
  se.addEventListener("pointerdown", e => startResize(e, "se"));
  el.appendChild(se);
  if (disp !== "icon" && !sz.lockAspect) {
    const eh = document.createElement("span");
    eh.className = "hdl e"; eh.title = "끌어서 폭 고정 · 더블클릭하면 자동 폭";
    eh.addEventListener("pointerdown", e => startResize(e, "e"));
    eh.addEventListener("dblclick", e => e.stopPropagation());   // 더블클릭 판정은 endResize 에서 (클릭마다 다시 그려져 dblclick 이 안 옴)
    el.appendChild(eh);
  }
}
function stackMembers(o, pageIdx) {
  return o.stackId ? S.pages[pageIdx].objects.filter(x => x.stackId === o.stackId) : [o];
}
function presetOf(h) { return presets().find(p => Math.abs(p.h - h) < 1e-6) || null; }
let rs = null, lastETap = null;
function startResize(e, kind) {
  if (e.button !== 0) return;
  e.stopPropagation(); e.preventDefault();
  const el = e.currentTarget.parentElement;
  const o = findObj(el.dataset.id); if (!o) return;
  const pageIdx = +el.dataset.page, pEl = el.closest(".page");
  const pw = pEl.clientWidth, ph = pEl.clientHeight;
  const mem = stackMembers(o, pageIdx);
  let mw = 0, mh = 0, top = 1;
  mem.forEach(m => {
    const me = $(`.obj[data-id="${m.id}"]`, pEl); if (!me) return;
    mw = Math.max(mw, me.offsetWidth / pw); mh = Math.max(mh, me.offsetHeight / ph);
    top = Math.min(top, m.at.y);
  });
  rs = {
    id: o.id, pageIdx, kind, rect: pEl.getBoundingClientRect(),
    x0: o.at.x, y0: o.at.y, wU0: el.offsetWidth / pw, hU0: el.offsetHeight / ph,
    s0: clone(effSize(o)), n: mem.length, mw, mh, top,
    before: snapNow(kind === "e" ? "폭 조정" : "크기 조정"), changed: false
  };
  window.addEventListener("pointermove", onResize);
  window.addEventListener("pointerup", endResize);
  window.addEventListener("pointercancel", endResize);
  document.body.classList.add(kind === "e" ? "rs-e" : "rs-se");
}
function onResize(e) {
  if (!rs) return;
  const o = findObj(rs.id); if (!o) return;
  const px = (e.clientX - rs.rect.left) / rs.rect.width, py = (e.clientY - rs.rect.top) / rs.rect.height;
  const s0 = rs.s0;
  let h = s0.h, w = s0.w, snapped = null;
  if (rs.kind === "se") {
    let f = ((px - rs.x0) / rs.wU0 + (py - rs.y0) / rs.hU0) / 2;
    const fMax = Math.min(H_MAX / s0.h,
      (1 - rs.x0) / rs.mw,
      (1 - rs.top - (rs.n - 1) * STACK_GAP) / (rs.n * rs.mh));
    f = clamp(f, H_MIN / s0.h, Math.max(H_MIN / s0.h, fMax));
    h = s0.h * f;
    if (s0.w != null) w = Math.min(1 - rs.x0, s0.w * f);
    if (!e.altKey && s0.w == null) {
      const near = presets().find(p => Math.abs(p.h - h) <= p.h * SNAP && p.h / s0.h <= fMax + 1e-9);
      if (near) { h = near.h; snapped = near; }
    }
  } else {
    w = clamp(px - rs.x0, W_MIN, 1 - rs.x0);
  }
  o.size = { h: +h.toFixed(4), w: w == null ? null : +w.toFixed(4), lockAspect: !!s0.lockAspect };
  syncStackSize(o);
  rs.changed = true;
  renderSpread();
  showSizeTip(o, snapped);
}
function showSizeTip(o, snapped) {
  const pEl = $$("#spread .page").find(p => +p.dataset.page === rs.pageIdx); if (!pEl) return;
  const sz = effSize(o), pre = snapped || presetOf(sz.h);
  const tip = document.createElement("div");
  tip.className = "size-tip";
  tip.textContent = `높이 ${(sz.h * 100).toFixed(1)}%` + (pre ? ` · ${pre.label}` : "") +
    (sz.w == null ? " · 폭 자동" : ` · 폭 ${(sz.w * 100).toFixed(0)}%`) +
    (rs.n > 1 ? ` · 스택 ${rs.n}개 함께` : "");
  /* 스택 전체 아래에 띄운다 (위에 두면 스택 윗 버튼을 가림). 지면 아래 끝이면 위로 */
  let bottom = 0, top = 1;
  stackMembers(o, rs.pageIdx).forEach(m => {
    const me = $(`.obj[data-id="${m.id}"]`, pEl); if (!me) return;
    bottom = Math.max(bottom, m.at.y + me.offsetHeight / pEl.clientHeight);
    top = Math.min(top, m.at.y);
  });
  tip.style.left = (o.at.x * 100) + "%";
  tip.style.top = bottom < 0.94 ? `calc(${bottom * 100}% + 10px)` : `calc(${top * 100}% - 30px)`;
  $(".layer", pEl).appendChild(tip);
}
function endResize() {
  if (!rs) return;
  const d = rs; rs = null;
  window.removeEventListener("pointermove", onResize);
  window.removeEventListener("pointerup", endResize);
  window.removeEventListener("pointercancel", endResize);
  document.body.classList.remove("rs-e", "rs-se");
  if (!d.changed && d.kind === "e") {
    const now = performance.now();
    if (lastETap && lastETap.id === d.id && now - lastETap.t < 450) { lastETap = null; setAutoWidth(); return; }
    lastETap = { id: d.id, t: now };
  }
  if (d.changed) {
    lastETap = null;
    const o = findObj(d.id);
    if (o && JSON.stringify(effSize(o)) !== JSON.stringify(Object.assign({}, d.s0, { lockAspect: !!d.s0.lockAspect }))) {
      notify(d.kind === "e" ? "폭 조정" : "크기 조정");
      S.undo.push(d.before); if (S.undo.length > UNDO_LIMIT) S.undo.shift();
      S.redo.length = 0; S.dirty = true;
      touch(d.pageIdx);
      const sz = effSize(o), pre = presetOf(sz.h);
      setStatus(`${d.kind === "e" ? "폭" : "크기"}: 높이 ${(sz.h * 100).toFixed(1)}%${pre ? " (" + pre.label + ")" : ""}${sz.w == null ? "" : " · 폭 " + (sz.w * 100).toFixed(0) + "%"}${d.n > 1 ? ` · 스택 ${d.n}개` : ""}`, "ok");
    }
  }
  renderAll();
}
function setAutoWidth() {
  const o = S.selId && findObj(S.selId); if (!o) return;
  if (effSize(o).w == null) return;
  pushUndo("자동 폭");
  o.size = Object.assign({}, effSize(o), { w: null });
  syncStackSize(o); touch(findPageOf(o.id)); renderAll();
  setStatus("폭: 라벨 길이에 맞춤", "ok");
}
/* [ ] = 프리셋 한 단계. 지면 밖으로 나가면 되돌린다 */
function stepPreset(dir) {
  const o = S.selId && findObj(S.selId); if (!o) return;
  const list = presets().slice().sort((a, b) => a.h - b.h); if (!list.length) return;
  const h = effSize(o).h;
  let i = list.findIndex(p => Math.abs(p.h - h) < 1e-6);
  if (i < 0) i = dir > 0 ? list.findIndex(p => p.h > h) : list.map(p => p.h < h).lastIndexOf(true);
  else i += dir;
  if (i < 0 || i >= list.length) { setStatus(dir > 0 ? "가장 큰 크기입니다" : "가장 작은 크기입니다"); return; }
  const pi = findPageOf(o.id);
  pushUndo("크기 단계");
  const f = list[i].h / h, cur = effSize(o);
  o.size = { h: list[i].h, w: cur.w == null ? null : +Math.min(1, cur.w * f).toFixed(4), lockAspect: !!cur.lockAspect };
  syncStackSize(o); renderAll();
  const bad = stackMembers(o, pi).some(m => { const el = $(`#spread .obj[data-id="${m.id}"]`); return el && el.classList.contains("bad"); });
  if (bad) { undo(); S.redo.length = 0; refreshUndoUI(); toast("지면 밖으로 나가서 키울 수 없습니다", true); return; }
  touch(pi); setStatus(`크기: ${list[i].label}`, "ok");
}

/* ---------------------------------------------------------------- 이동 */
let drag = null;
function startMove(e) {
  if (e.button !== 0) return;
  const el = e.currentTarget;
  if (el.classList.contains("global")) return;
  const id = el.dataset.id, pageIdx = +el.dataset.page, o = findObj(id);
  if (!o) return;
  S.selId = id; S.selG = null;
  $$("#spread .obj").forEach(x => x.classList.toggle("sel", x.dataset.id === id));
  renderInspector();
  const pEl = el.closest(".page"), r = pEl.getBoundingClientRect();
  drag = {
    id, pageIdx, el, rect: r, moved: false,
    ox: (e.clientX - r.left) / r.width - o.at.x,
    oy: (e.clientY - r.top) / r.height - o.at.y,
    wU: el.offsetWidth / pEl.clientWidth,
    hU: el.offsetHeight / pEl.clientHeight,
    start: clone(o.at), before: snapNow("이동")
  };
  el.setPointerCapture(e.pointerId);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", endMove);
  el.addEventListener("pointercancel", endMove);
  e.preventDefault();
}
function onMove(e) {
  if (!drag) return;
  const o = findObj(drag.id); if (!o) return;
  /* 펼침 경계 밖으로는 나가지 못한다 */
  o.at.x = clamp((e.clientX - drag.rect.left) / drag.rect.width - drag.ox, 0, 1 - drag.wU);
  o.at.y = clamp((e.clientY - drag.rect.top) / drag.rect.height - drag.oy, 0, 1 - drag.hU);
  drag.moved = true;
  if (o.stackId) layoutStacks(drag.pageIdx);
  $$(`#spread .page[data-page="${drag.pageIdx}"] .obj:not(.global)`).forEach(el => {
    const oo = findObj(el.dataset.id); if (!oo) return;
    el.style.left = (oo.at.x * 100) + "%"; el.style.top = (oo.at.y * 100) + "%";
  });
}
function endMove(e) {
  if (!drag) return;
  const d = drag; drag = null;
  d.el.removeEventListener("pointermove", onMove);
  d.el.removeEventListener("pointerup", endMove);
  d.el.removeEventListener("pointercancel", endMove);
  const o = findObj(d.id);
  if (!o || !d.moved) { renderAll(); return; }
  const end = clone(o.at);
  notify("이동");
  S.undo.push(d.before); if (S.undo.length > UNDO_LIMIT) S.undo.shift();
  S.redo.length = 0; S.dirty = true;
  o.at = end;
  const hit = hitObject(d.pageIdx, o.at.x + d.wU / 2, o.at.y + d.hU / 2, d.id);
  if (hit) { leaveStack(o, d.pageIdx); joinStack(hit, o); setStatus("스택 합류", "ok"); }
  else if (o.stackId) {
    const mate = S.pages[d.pageIdx].objects.find(x => x.stackId === o.stackId && x.id !== o.id);
    if (mate && Math.abs(o.at.x - mate.at.x) > 0.04) { leaveStack(o, d.pageIdx); setStatus("스택 이탈"); }
  }
  touch(d.pageIdx);
  renderAll();
}

/* ---------------------------------------------------------------- 파일 드롭 → 자료 연결 */
function parseFileName(name) {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  let cmsCode = null;
  const body = stem.replace(/_@(\d{1,12})$/, (m, g) => { cmsCode = g; return ""; });
  const parts = body.split("_");
  if (parts.length >= 3 && CODE_LABEL[parts[1]])
    return { ok: true, slot: parts[0], code: parts[1], title: parts.slice(2).join("_"), cmsCode, ext, name };
  return { ok: false, slot: null, code: null, title: stem, cmsCode, ext, name };
}
function unitOf(pageIdx) {
  const u = (S.book.units || []).find(u => pageIdx >= u.fromIndex && pageIdx <= u.toIndex);
  return u ? u.id : "common";
}
function candidatesForCode(code) { return (S.profile.buttons || []).filter(b => b.fileCode === code); }
const etcId = () => (btnDef("etc") ? "etc" : (S.profile.buttons[0] || {}).id);

/* v0.8 — 자료코드가 여러 버튼에 걸리면 먼저 「파일 이름 = 버튼 이름」으로 고른다.
   16_TG_학습 지도안.hwp → 학습 지도안. 이름으로 안 갈릴 때만 선택 창을 띄운다 */
function normName(s) { return String(s || "").replace(/[\s_\-·.()]/g, "").toLowerCase(); }
function matchByName(cands, title) {
  const t = normName(title);
  if (!t) return null;
  const exact = cands.filter(c => normName(c.label) === t);
  if (exact.length === 1) return exact[0].id;
  const part = cands.filter(c => { const l = normName(c.label); return l && (t.includes(l) || l.includes(t)); });
  if (part.length === 1) return part[0].id;
  /* 「실험 영상_과정」처럼 한쪽이 다른 쪽을 품는 경우가 여럿이면 가장 긴 이름이 이긴다 */
  if (part.length > 1) {
    part.sort((a, b) => normName(b.label).length - normName(a.label).length);
    if (normName(part[0].label).length > normName(part[1].label).length && t.includes(normName(part[0].label))) return part[0].id;
  }
  return null;
}
/* askCache: 같은 이름을 여러 번 물어보지 않도록 (초안 만들기에서 「도움 영상」이 두 쪽에 있을 때 등) */
async function resolveButton(p, askCache) {
  if (!p.ok) return etcId();
  const c = candidatesForCode(p.code);
  if (c.length === 0) return etcId();
  if (c.length === 1) return c[0].id;
  const byName = matchByName(c, p.title);
  if (byName) return byName;
  const key = p.code + "|" + normName(p.title);
  if (askCache && key in askCache) return askCache[key];
  const bid = await chooseButton(c, p);
  if (askCache) askCache[key] = bid;
  return bid;
}

function linkFileToObject(o, pageIdx, f) {
  const p = parseFileName(f.name);
  const asset = { path: `docs/${unitOf(pageIdx)}/${f.name}`, bytes: f.size };
  if (p.cmsCode) asset.cmsCode = p.cmsCode;
  pushUndo("자료 연결");
  S.assetFiles[asset.path] = f;
  o.asset = asset;
  o.label = (p.ok ? p.title : f.name.replace(/\.[^.]+$/, "")).slice(0, LABEL_MAX);
  S.selId = o.id; S.selG = null;
  touch(pageIdx); renderAll();
  setStatus(`「${(btnDef(o.buttonId) || {}).label || o.label}」에 연결 ← ${f.name}`, "ok");
}

async function dropFiles(files, pageIdx, x, y) {
  let dx = x, dy = y, n = 0;
  let sid = null;
  const ask = {};
  for (const f of files) {
    const p = parseFileName(f.name);
    const bid = await resolveButton(p, ask);
    if (bid == null) continue;
    const d = btnDef(bid) || {};
    const asset = { path: `docs/${unitOf(pageIdx)}/${f.name}`, bytes: f.size };
    S.assetFiles[asset.path] = f;
    if (p.cmsCode) asset.cmsCode = p.cmsCode;
    const o = placeButton(bid, pageIdx, dx, dy, {
      label: (p.ok ? p.title : p.name).slice(0, LABEL_MAX),
      assetKind: d.assetKind || "etc",
      asset
    });
    if (!o) continue;
    n++;
    /* 여러 파일을 한 번에 끌어놓으면 같은 stackId (스키마 주석대로) */
    if (files.length > 1) {
      if (!sid) { sid = stackId(); o.stackId = sid; o.stackOrder = 0; o.size = clone(effSize(o)); }
      else {
        const anchor = S.pages[pageIdx].objects.find(z => z.stackId === sid);
        if (anchor) joinStack(anchor, o);
      }
      layoutStacks(pageIdx);
    } else {
      dy += 0.04; if (dy > 0.94) { dy = y; dx += 0.14; }
    }
  }
  if (n) { touch(pageIdx); renderAll(); setStatus(`자료 ${n}개 연결`, "ok"); }
}

function chooseButton(cands, parsed) {
  return new Promise(resolve => {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `
      <div class="modal">
        <h3>자료 종류 선택</h3>
        <p><b>${escapeHtml(parsed.name)}</b><br>
        코드 <b>${parsed.code}</b>(${CODE_LABEL[parsed.code]})가 여러 버튼에 걸려 있습니다. 어느 것인가요?</p>
        <div class="opts"></div>
        <div class="foot"><button class="t" data-cancel>취소</button></div>
      </div>`;
    const opts = $(".opts", back);
    cands.forEach(c => {
      const t = thm(c.themeId);
      const b = document.createElement("button");
      b.className = "t";
      b.innerHTML = `<span class="dot" style="background:${t.color}"></span>${escapeHtml(c.label)}`;
      b.onclick = () => { back.remove(); resolve(c.id); };
      opts.appendChild(b);
    });
    $("[data-cancel]", back).onclick = () => { back.remove(); resolve(null); };
    $("#modal-root").appendChild(back);
    opts.firstChild && opts.firstChild.focus();
  });
}

/* ---------------------------------------------------------------- v0.8 자료 폴더로 초안 만들기
   쪽은 파일명 앞 숫자(교과서 쪽번호)가 정하고, 버튼 종류는 자료코드 + 이름이 정한다.
   ① 그 쪽에 같은 종류의 전역 버튼이 있으면 → 그 쪽 연결만 채운다
   ② 같은 종류의 빈 버튼(「버튼 세트 놓기」로 놓은 것)이 있으면 → 거기에 연결
   ③ 없으면 → 그 쪽 스택에 새로 쌓는다 (스택이 없으면 왼쪽 위에 새 스택)
   쪽번호가 없거나 책에 없는 쪽이면 배치하지 않고 결과 창에 이유와 함께 남긴다.
   한 번 실행 = 실행취소 1단계. 기존 버튼은 지우거나 옮기지 않는다 */
const DRAFT_SKIP = /^(\.|~\$|desktop\.ini$|thumbs\.db$)/i;
function draftPrinted(name, p) {
  const m = String(p.ok ? p.slot : name).match(p.ok ? /^(\d{1,4})$/ : /^(\d{1,4})[_\s-]/);
  return m ? +m[1] : null;
}
async function draftFromFolder(fileList) {
  if (!S.book) return;
  const files = Array.from(fileList || []).filter(f => !DRAFT_SKIP.test(f.name));
  if (!files.length) { toast("폴더에 자료 파일이 없습니다", true); return; }
  const off = S.book.pageNumbering.offset;
  const order = id => (S.profile.buttons || []).findIndex(b => b.id === id);
  const ask = {}, skipped = [], plan = [];
  let dup = 0;
  files.sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
  const unnamed = [];
  /* vname = 규칙 이름 (쪽 찾기로 붙인 이름이면 원래 이름과 다르다). 자산 경로·버튼 이름은 vname 으로 */
  async function take(f, vname, src, box) {
    const p = parseFileName(vname);
    const printed = draftPrinted(vname, p);
    const idx = printed - off;
    if (!S.pages[idx]) { skipped.push([f.name, `${printed}쪽은 이 책에 없어요`]); return; }
    const dpath = `docs/${unitOf(idx)}/${vname}`;
    if (draftHasFile(idx, dpath)) {
      if (!src) { S.assetFiles[dpath] = f; dup++; return; }   // 다시 돌릴 때 묻지도 않고 건너뜀 (저장본을 연 뒤엔 원본만 다시 이어 줌)
      return take(f, vname.replace(/(\.[^.]+)?$/, " (2)$1"), src, box);   // 쪽 찾기로 지은 이름이 겹치면 번호를 붙인다
    }
    const bid = await resolveButton(p, ask);
    if (bid == null) { skipped.push([f.name, "자료 종류를 고르지 않았어요"]); return; }
    plan.push({ f, p, idx, printed, bid, vname, src, box });
  }
  for (const f of files) {
    const p = parseFileName(f.name);
    if (draftPrinted(f.name, p) != null) { await take(f, f.name, null); continue; }
    const back = findBySource(f);
    if (back) { S.assetFiles[back] = f; dup++; continue; }               // 전에 쪽을 찾아 붙인 파일 — 원본만 다시 잇는다
    if (window.EbookDraftGuess) { unnamed.push(f); continue; }
    skipped.push([f.name, "파일 이름 앞에 쪽번호가 없어요"]);
  }
  /* 쪽번호 없는 파일 → 쪽 찾기 (draft-guess.js, 옵션 모듈). 지우면 위의 「쪽번호가 없어요」로 남는다 */
  if (unnamed.length) {
    const got = await window.EbookDraftGuess.run(unnamed, __ebookCore);
    if (!got) unnamed.forEach(f => skipped.push([f.name, "쪽 찾기를 그만뒀어요"]));
    else for (const g of got) {
      if (!g.name) skipped.push([g.file.name, "쪽을 정하지 않았어요"]);
      else await take(g.file, g.name, g.file.name, g.box);
    }
  }
  if (!plan.length) return showDraftResult({ placed: 0, filled: 0, globals: 0, dup, pages: [] }, skipped);

  pushUndo("초안 만들기");
  const r = { placed: 0, filled: 0, globals: 0, dup, pages: new Set(), guessed: plan.filter(x => x.src).length };
  const fresh = {}, hints = [];
  plan.sort((a, b) => a.idx - b.idx || order(a.bid) - order(b.bid));
  plan.forEach(({ f, p, idx, bid, vname, src, box }) => {
    const page = S.pages[idx];
    const path = `docs/${unitOf(idx)}/${vname}`;
    const asset = { path, bytes: f.size };
    if (p.cmsCode) asset.cmsCode = p.cmsCode;
    if (src) asset.sourceName = src;
    const label = (p.ok ? p.title : vname.replace(/\.[^.]+$/, "").replace(/^\d{1,4}[_\s-]+/, "")).slice(0, LABEL_MAX);
    // ① 전역 버튼
    const gb = globalsFor(idx).find(g => g.buttonId === bid && !gHidden(idx, g));
    if (gb) {
      const l = gLink(idx, gb.id);
      if (l && l.asset && l.asset.path) { skipped.push([f.name, `${page.printedPage}쪽 전역 버튼에 이미 다른 자료가 있어요`]); return; }
      S.assetFiles[path] = f;
      gSetLink(idx, gb.id, { asset, hidden: null });
      r.globals++; r.pages.add(idx); return;
    }
    // 같은 파일이 이미 붙어 있으면 건너뜀 (다시 돌려도 안전하게)
    S.assetFiles[path] = f;
    // ② 같은 종류의 빈 버튼
    const empty = page.objects.find(o => o.buttonId === bid && !(o.asset && o.asset.path));
    if (empty) { empty.asset = asset; empty.label = label; r.filled++; r.pages.add(idx); return; }
    // ③ 새 버튼
    const d = btnDef(bid) || {};
    const o = makeObject(bid, 0.07, 0.08, { label, assetKind: d.assetKind || "etc", asset });
    (fresh[idx] = fresh[idx] || []).push(o);
    hints.push({ o, idx, file: f, box: box || null });
  });
  /* v0.9 자리 잡기 (auto-place.js, 옵션 모듈) — 새로 놓는 버튼만. 기존·전역·빈 버튼은 건드리지 않는다.
     모듈이 없거나 실패하면 예전처럼 왼쪽 위에 쌓는다 */
  if (window.EbookAutoPlace && Object.keys(fresh).length) {
    Object.entries(fresh).forEach(([k, list]) => list.forEach(o => S.pages[+k].objects.push(o)));
    try {
      r.auto = await window.EbookAutoPlace.place(hints, __ebookCore);
      Object.keys(fresh).forEach(k => r.pages.add(+k));
      r.placed += hints.length;
    } catch (e) {
      console.error(e);
      Object.entries(fresh).forEach(([k, list]) => { const pg = S.pages[+k]; pg.objects = pg.objects.filter(o => !list.includes(o)); });
      r.auto = null;
    }
  }
  if (!r.auto) Object.entries(fresh).forEach(([k, list]) => {
    const idx = +k, page = S.pages[idx];
    let anchor = page.objects.find(o => o.stackId) || null;
    list.forEach(o => {
      page.objects.push(o);
      if (anchor) joinStack(anchor, o);
      else { o.stackId = stackId(); o.stackOrder = 0; o.size = clone(effSize(o)); anchor = o; }
      r.placed++;
    });
    if (list.length === 1 && anchor === list[0]) { delete anchor.stackId; delete anchor.stackOrder; }
    layoutStacks(idx);
    r.pages.add(idx);
  });
  r.pages.forEach(touch);
  const pages = Array.from(r.pages).sort((a, b) => a - b);
  if (pages.length) goToPage(pages[0]);
  S.selId = null; S.selG = null;
  renderAll();
  notify("초안 만들기");
  showDraftResult(Object.assign(r, { pages }), skipped);
}
function findBySource(f) {
  for (const page of Object.values(S.pages)) {
    for (const o of page.objects) if (o.asset && o.asset.sourceName === f.name && o.asset.bytes === f.size) return o.asset.path;
    for (const l of Object.values(page.globals || {})) if (l && l.asset && l.asset.sourceName === f.name && l.asset.bytes === f.size) return l.asset.path;
  }
  return null;
}
function draftHasFile(idx, path) {
  const page = S.pages[idx];
  if (page.objects.some(o => o.asset && o.asset.path === path)) return true;
  return Object.values(page.globals || {}).some(l => l && l.asset && l.asset.path === path);
}
/* 같은 이유가 여럿이면 한 줄로 묶고 파일 이름은 접어 둔다 (링크 48개가 창을 덮지 않게) */
function skipGroups(skipped) {
  const by = {};
  skipped.forEach(([f, why]) => (by[why] = by[why] || []).push(f));
  return Object.entries(by).map(([why, fs]) => fs.length <= 3
    ? fs.map(f => `<div><b>${escapeHtml(f)}</b><span>${escapeHtml(why)}</span></div>`).join("")
    : `<details><summary><b>${fs.length}개</b> <span>${escapeHtml(why)}</span></summary><div class="muted">${fs.map(escapeHtml).join(", ")}</div></details>`).join("");
}
function showDraftResult(r, skipped) {
  const n = r.placed + r.filled + r.globals;
  const ps = r.pages.map(i => S.pages[i].printedPage);
  setStatus(n ? `초안: 버튼 ${n}개 · ${ps.length}쪽${skipped.length ? ` · ${skipped.length}개 남김` : ""}` : "초안: 배치한 버튼 없음", skipped.length ? "warn" : "ok");
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `
    <div class="modal draft-result">
      <h3>${n ? "초안을 만들었어요" : (r.dup ? "자료 원본을 다시 연결했어요" : "새로 붙일 파일이 없어요")}</h3>
      ${n ? `<p class="big"><b>버튼 ${n}개</b>를 <b>${ps.length}쪽</b>에 붙였습니다 <span class="muted">(${ps[0]}–${ps[ps.length - 1]}쪽)</span></p>` : ""}
      <ul class="draft-sum">
        ${r.placed ? `<li>새로 놓음 ${r.placed}개</li>` : ""}
        ${r.filled ? `<li>미리 놓은 빈 버튼에 연결 ${r.filled}개</li>` : ""}
        ${r.globals ? `<li>전역 버튼에 연결 ${r.globals}쪽</li>` : ""}
        ${r.dup ? `<li>이미 붙어 있어서 원본 파일만 다시 연결 ${r.dup}개</li>` : ""}
      </ul>
      ${r.guessed ? `<p class="muted">그중 ${r.guessed}개는 쪽번호 없는 파일이라 내용·그림으로 쪽을 찾아 붙였어요.</p>` : ""}
      ${skipped.length ? `<h4>붙이지 않은 파일 ${skipped.length}개</h4>
        <div class="draft-skip">${skipGroups(skipped)}</div>
        <p class="muted">지면 위로 직접 끌어다 놓거나, 다시 해 보세요. 다시 해도 이미 붙은 파일은 건너뜁니다.</p>` : ""}
      ${n && r.auto ? `<p class="muted">새 버튼 ${r.auto.total}개의 자리를 잡아 두었어요${r.auto.figure ? ` (그림 옆 ${r.auto.figure} · 제목 옆 ${r.auto.text} · 여백 ${r.auto.margin})` : ""}. 쪽마다 훑어보고 어색한 것만 옮기세요. 마음에 안 들면 실행취소 한 번으로 전부 되돌아갑니다.</p>` : ""}
      ${n && !r.auto ? `<p class="muted">위치는 지면 왼쪽 위에 쌓아 두었어요. 쪽마다 확인하면서 옮겨 주세요. 마음에 안 들면 실행취소 한 번으로 전부 되돌아갑니다.</p>` : ""}
      <div class="foot"><button class="t primary" data-ok>확인</button></div>
    </div>`;
  $("[data-ok]", back).onclick = () => back.remove();
  $("#modal-root").appendChild(back);
  $("[data-ok]", back).focus();
}

/* 창 전체 드래그 베일 */
let veilN = 0;
window.addEventListener("dragenter", e => {
  if (Array.from(e.dataTransfer.types).includes("Files")) { veilN++; $("#drop-veil").hidden = false; }
});
window.addEventListener("dragleave", () => { if (--veilN <= 0) { veilN = 0; $("#drop-veil").hidden = true; } });
window.addEventListener("drop", () => { veilN = 0; $("#drop-veil").hidden = true; });
window.addEventListener("dragover", e => e.preventDefault());

/* ---------------------------------------------------------------- 4.2 CMS 코드 입력
   숫자만 넣어도, 뷰어 주소를 통째로 붙여넣어도 contentSeq 만 뽑는다. 입력하면 칸 아래에 CMS 제목을 보여준다
   (권당 수백 개를 손으로 넣으므로 잘못 붙여넣기를 그 자리에서 잡는 게 목적). 제목 조회는 어댑터 뒤 — 지금은 개발용 */
const cmsTitleCache = {};
function normCms(el) {
  const raw = el.value.trim();
  if (!raw) return "";
  const seq = window.MteacherAdapter ? window.MteacherAdapter.extractSeq(raw) : (/^\d{1,12}$/.test(raw) ? raw : null);
  if (!seq) { toast("CMS 코드를 찾지 못했습니다 — 숫자나 엠티처 뷰어 주소를 넣으세요", true); return null; }
  if (seq !== raw) setStatus(`주소에서 CMS 코드 ${seq} 를 뽑았습니다`, "ok");
  el.value = seq;
  return seq;
}
function looseName(s) { return String(s || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/^[0-9]+_[A-Z]{2}_/, "").replace(/[\s_\-·.()]/g, "").toLowerCase(); }
function showCmsTitle(inputId, seq, fileName) {
  const inp = $("#" + inputId); if (!inp) return;
  const row = inp.closest(".row");
  let el = row.nextElementSibling && row.nextElementSibling.classList.contains("cms-title") ? row.nextElementSibling : null;
  if (!seq) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("div"); el.className = "kv cms-title"; row.insertAdjacentElement("afterend", el); }
  const paint = r => {
    if (!r.title) { el.innerHTML = `<span class="muted">${escapeHtml(r.reason || "제목 확인 불가")}</span>`; return; }
    const a = looseName(r.title), b = looseName(fileName);
    const off = b && a && !a.includes(b) && !b.includes(a);
    el.innerHTML = `CMS: <b>${escapeHtml(r.title)}</b>` + (off ? `<br><span class="cms-warn">파일 이름과 많이 다릅니다 — 코드를 잘못 붙여넣지 않았는지 확인하세요</span>` : "");
  };
  if (cmsTitleCache[seq]) return paint(cmsTitleCache[seq]);
  el.innerHTML = `<span class="muted">CMS 제목 확인 중…</span>`;
  if (!window.MteacherAdapter) return paint({ title: null, reason: "어댑터 없음" });
  window.MteacherAdapter.lookupTitle(seq).then(r => { cmsTitleCache[seq] = r; if (document.body.contains(el)) paint(r); });
}

/* ---------------------------------------------------------------- 속성 패널 */
function renderGlobalInspector() {
  const gb = gbById(S.selG.gid), pi = S.selG.page;
  const body = $("#insp-body");
  $("#insp-empty").hidden = true; body.hidden = false;
  const d = btnDef(gb.buttonId) || {}, t = thm(d.themeId), sz = gSize(gb);
  const pre = presets().find(p => Math.abs(p.h - sz.h) < 1e-6);
  const st = gStats(gb), link = gLink(pi, gb.id) || {}, pa = link.asset || null;
  const types = Array.isArray(gb.showOn) ? gb.showOn : null;
  const printed = S.pages[pi] ? S.pages[pi].printedPage : pi;
  const shownHere = gShows(gb, pi);
  body.innerHTML = `
    <div class="insp-head">
      <span class="chip" style="background:${t.color};color:${t.onColor || "#fff"}">${escapeHtml(d.label || gb.buttonId)}</span>
      <span class="muted">전역 버튼 · ${st.shown}쪽에 표시 · 연결 ${st.linked}/${st.shown}${st.hidden ? ` · 숨김 ${st.hidden}` : ""}</span>
    </div>
    <div class="gsec">모든 지면 공통 <span class="muted">— 바꾸면 모든 쪽에 적용</span></div>
    <div class="row"><label>라벨</label><input type="text" id="g-label" maxlength="${LABEL_MAX}" value="${escapeHtml(gb.label || d.label || "")}"></div>
    <div class="row"><label>버튼</label><select id="g-btn">
      ${(S.profile.buttons || []).map(b => `<option value="${b.id}" ${b.id === gb.buttonId ? "selected" : ""}>${escapeHtml(b.label)}</option>`).join("")}
    </select></div>
    <div class="row"><label>크기</label><div class="seg" id="g-preset">
      ${presets().map(p => `<button data-h="${p.h}" class="${pre && pre.id === p.id ? "on" : ""}">${escapeHtml(p.label)}</button>`).join("")}
    </div></div>
    <div class="row"><label>띄울 지면</label><div class="seg" id="g-scope">
      <button data-v="all" class="${types ? "" : "on"}">모든 지면</button><button data-v="types" class="${types ? "on" : ""}">유형 골라서</button>
    </div></div>
    ${types ? `<div class="gtypes">${(S.profile.pageTypes || []).map(p =>
      `<label class="chk"><input type="checkbox" data-pt="${p.id}" ${types.includes(p.id) ? "checked" : ""}> ${escapeHtml(p.label)}</label>`).join("")}</div>` : ""}
    <div class="row"><label>공통 자료</label><input type="text" id="g-apath" value="${gb.asset ? escapeHtml(gb.asset.path) : ""}" placeholder="모든 쪽이 같은 자료일 때만"></div>
    <div class="row"><label>공통 CMS</label><input type="text" id="g-acms" value="${gb.asset && gb.asset.cmsCode ? gb.asset.cmsCode : ""}" placeholder="숫자 또는 뷰어 주소"></div>

    <div class="gsec">${printed}쪽만 <span class="muted">— 이 쪽에만 적용${shownHere ? "" : " · 지금 이 쪽은 띄울 지면이 아님"}</span></div>
    <div class="row"><label>자료 경로</label><input type="text" id="g-path" value="${pa ? escapeHtml(pa.path) : ""}" placeholder="${gb.asset ? "비우면 공통 자료" : "파일을 버튼 위에 놓아도 됨"}"></div>
    <div class="row"><label>CMS 코드</label><input type="text" id="g-cms" value="${pa && pa.cmsCode ? pa.cmsCode : ""}" placeholder="숫자 또는 뷰어 주소"></div>
    <div class="row"><label>이 쪽</label><label class="chk"><input type="checkbox" id="g-hide" ${link.hidden ? "checked" : ""}> 이 쪽에서 숨기기</label></div>

    <div class="gsec">쪽마다 한꺼번에</div>
    <label class="t file sm gbulk">파일 여러 개로 쪽마다 연결<input type="file" id="g-bulk" multiple hidden></label>
    <div class="kv">예) <b>16</b>_PT_밀도 수업.pptx → 16쪽. 코드가 ${d.fileCode ? `<b>${d.fileCode}</b>` : "맞는"} 파일만 받습니다</div>
    <div class="row danger-row"><button class="t danger" id="g-del">전역 해제</button></div>`;

  const shared = (label, fn) => { pushUndo(label); fn(gbById(S.selG.gid)); S.book.authoring.updatedAt = nowIso(); renderAll(); };
  const here = (label, fn) => { pushUndo(label); fn(); touch(S.selG.page); renderAll(); };
  $("#g-label").onchange = e => shared("전역 라벨", g => { g.label = e.target.value.slice(0, LABEL_MAX); });
  $("#g-btn").onchange = e => shared("전역 버튼 종류", g => { g.buttonId = e.target.value; });
  $$("#g-preset button").forEach(b => b.onclick = () => shared("전역 크기", g => { g.size = Object.assign({ w: null }, g.size, { h: +b.dataset.h }); }));
  $$("#g-scope button").forEach(b => b.onclick = () => shared("전역 표시 범위", g => {
    g.showOn = b.dataset.v === "all" ? "all" : (Array.isArray(g.showOn) ? g.showOn : []);
  }));
  $$(".gtypes input").forEach(c => c.onchange = () => shared("전역 표시 범위", g => {
    const set = new Set(Array.isArray(g.showOn) ? g.showOn : []);
    c.checked ? set.add(c.dataset.pt) : set.delete(c.dataset.pt);
    g.showOn = Array.from(set);
  }));
  $("#g-apath").onchange = e => shared("전역 공통 자료", g => {
    const v = e.target.value.trim();
    if (!v) delete g.asset; else g.asset = Object.assign({}, g.asset, { path: v });
  });
  $("#g-acms").onchange = e => {
    const v = normCms(e.target); if (v === null) return;
    if (!gb.asset) { toast("공통 자료 경로가 먼저 필요합니다", true); e.target.value = ""; return; }
    shared("전역 공통 CMS", g => { if (v) g.asset.cmsCode = v; else delete g.asset.cmsCode; });
  };
  $("#g-path").onchange = e => here("전역 쪽 자료", () => {
    const v = e.target.value.trim(), cur = gLink(pi, gb.id) || {};
    gSetLink(pi, gb.id, { asset: v ? Object.assign({}, cur.asset, { path: v }) : null });
  });
  $("#g-cms").onchange = e => {
    const v = normCms(e.target); if (v === null) return;
    const cur = gLink(pi, gb.id) || {};
    if (!cur.asset) { toast("이 쪽 자료 경로가 먼저 필요합니다", true); e.target.value = ""; return; }
    here("전역 쪽 CMS", () => { const a = Object.assign({}, cur.asset); if (v) a.cmsCode = v; else delete a.cmsCode; gSetLink(pi, gb.id, { asset: a }); });
  };
  if (gb.asset && gb.asset.cmsCode) showCmsTitle("g-acms", gb.asset.cmsCode, gb.asset.path.split("/").pop());
  if (pa && pa.cmsCode) showCmsTitle("g-cms", pa.cmsCode, pa.path.split("/").pop());
  $("#g-hide").onchange = e => here(e.target.checked ? "전역 이 쪽 숨김" : "전역 이 쪽 보임", () => gSetLink(pi, gb.id, { hidden: e.target.checked || null }));
  $("#g-bulk").onchange = e => { if (e.target.files.length) bulkLinkGlobal(gb.id, e.target.files); e.target.value = ""; };
  $("#g-del").onclick = () => {
    const n = gStats(gb).linked;
    if (n && !confirm(`「${gb.label || d.label}」 전역 버튼을 해제하면 ${n}쪽의 연결도 함께 지워집니다. 계속할까요? (실행취소로 되돌릴 수 있음)`)) return;
    removeGlobal(gb.id);
  };
}

let inspAdvOpen = false;   // 「세부 설정」 펼침 상태 — 다시 그려도 유지
function renderInspector() {
  if (!S.selId && S.selG && gbById(S.selG.gid)) return renderGlobalInspector();
  const o = S.selId ? findObj(S.selId) : null;
  $("#insp-empty").hidden = !!o;
  const body = $("#insp-body");
  body.hidden = !o;
  if (!o) return;
  const pageIdx = findPageOf(o.id), d = btnDef(o.buttonId) || {}, t = themeOf(o);
  const sz = effSize(o), disp = effDisplay(o);
  const pre = presets().find(p => Math.abs(p.h - sz.h) < 1e-6);
  const fname = o.asset && o.asset.path ? o.asset.path.split("/").pop() : "";
  const pg = S.pages[pageIdx];
  /* v0.8 — 늘 쓰는 칸(라벨·종류·크기·자료·CMS 코드)만 위에, 나머지는 「세부 설정」에 접어 둔다 */
  body.innerHTML = `
    <div class="insp-head">
      <span class="chip" style="background:${t.color};color:${t.onColor || "#fff"}">${escapeHtml(d.label || o.buttonId || "기타")}</span>
      <span class="muted">${pg ? pg.printedPage + "쪽" : ""}</span>
    </div>
    <div class="row"><label>라벨</label><input type="text" id="f-label" maxlength="${LABEL_MAX}" value="${escapeHtml(o.label || "")}"></div>
    <div class="row"><label>종류</label><select id="f-btn">
      ${(S.profile.buttons || []).map(b => `<option value="${b.id}" ${b.id === o.buttonId ? "selected" : ""}>${escapeHtml(b.label)}</option>`).join("")}
    </select></div>
    <div class="row"><label>크기</label><div class="seg" id="f-preset">
      ${presets().map(p => `<button data-h="${p.h}" class="${pre && pre.id === p.id ? "on" : ""}">${escapeHtml(p.label)}</button>`).join("")}
    </div></div>
    <div class="row"><label>자료</label><span class="fileval ${fname ? "" : "none"}" title="${escapeHtml(fname)}">${fname ? escapeHtml(fname) : "아직 없음 — 파일을 이 버튼 위에 놓으세요"}</span></div>
    <div class="row"><label>CMS 코드</label><input type="text" id="f-cms" pattern="[0-9]*" value="${o.asset && o.asset.cmsCode ? o.asset.cmsCode : ""}" placeholder="있을 때만 · 숫자 또는 뷰어 주소"></div>
    <div class="kv">지면 위 □ 모서리를 끌면 크기 · <b>[</b> <b>]</b> 한 단계${o.stackId ? " · 함께 쌓인 버튼도 같이 바뀜" : ""}</div>
    <details class="adv" id="f-adv" ${inspAdvOpen ? "open" : ""}>
      <summary>세부 설정</summary>
      <div class="row"><label>표시</label><div class="seg" id="f-display">
        ${[["pill", "아이콘+라벨"], ["icon", "아이콘"], ["label", "라벨"]].map(([v, n]) =>
          `<button data-v="${v}" class="${v === disp ? "on" : ""}">${n}</button>`).join("")}
      </div></div>
      <div class="row"><label>높이</label><input type="number" id="f-h" step="0.001" min="0.008" max="0.3" value="${sz.h.toFixed(3)}"></div>
      <div class="row"><label>고정폭</label><input type="number" id="f-w" step="0.01" min="0.03" max="1" placeholder="자동(라벨 길이)" value="${sz.w == null ? "" : sz.w}">
        ${sz.w == null ? "" : `<button class="t sm" id="f-wauto" title="라벨 길이에 맞춤">자동</button>`}</div>
      <div class="row"><label>비율 고정</label><label class="chk"><input type="checkbox" id="f-lock" ${sz.lockAspect ? "checked" : ""}> 폭만 따로 바꾸지 않기</label></div>
      <div class="row"><label>대상</label><div class="seg" id="f-target">
        ${[["teacher", "교사"], ["student", "학생"], ["both", "모두"]].map(([v, n]) =>
          `<button data-v="${v}" class="${v === o.target ? "on" : ""}">${n}</button>`).join("")}
      </div></div>
      <div class="row"><label>동작</label><div class="seg" id="f-action">
        ${[["open", "열기"], ["download", "받기"], ["external", "외부"]].map(([v, n]) =>
          `<button data-v="${v}" class="${v === (o.action || "open") ? "on" : ""}">${n}</button>`).join("")}
      </div></div>
      <div class="row"><label>자료 경로</label><input type="text" id="f-path" value="${o.asset ? escapeHtml(o.asset.path) : ""}" placeholder="docs/u01/…"></div>
      <div class="row"><label>메모</label><input type="text" id="f-note" value="${o.note ? escapeHtml(o.note) : ""}" placeholder="배포할 때는 빠짐"></div>
    </details>
    <div class="row danger-row">
      ${o.stackId ? `<button class="t" id="f-unstack" title="함께 쌓인 묶음에서 이 버튼만 떼어 냅니다">묶음에서 빼기</button>` : ""}
      <button class="t" id="f-global" title="모든 지면의 같은 자리에 뜨게 합니다. 쪽마다 자료만 따로 연결">모든 지면에 (전역으로)</button>
      <button class="t danger" id="f-del">삭제</button>
    </div>`;
  $("#f-adv").ontoggle = e => { inspAdvOpen = e.target.open; };

  const commit = (label, fn) => {
    pushUndo(label);
    const o2 = findObj(S.selId);
    fn(o2);
    touch(findPageOf(S.selId));
    renderAll();
  };
  $("#f-label").onchange = e => commit("라벨 변경", x => x.label = e.target.value.slice(0, LABEL_MAX));
  $("#f-btn").onchange = e => commit("버튼 변경", x => {
    x.buttonId = e.target.value;
    const nd = btnDef(x.buttonId) || {};
    x.assetKind = nd.assetKind || x.assetKind;
    if (!x.asset) x.label = (nd.label || "").slice(0, LABEL_MAX);
  });
  $$("#f-display button").forEach(b => b.onclick = () => commit("표시 변경", x => x.display = b.dataset.v));
  $$("#f-preset button").forEach(b => b.onclick = () => commit("크기 프리셋", x => {
    x.size = Object.assign({ w: null }, x.size, { h: +b.dataset.h });
    syncStackSize(x);
  }));
  $("#f-h").onchange = e => commit("높이 변경", x => {
    x.size = Object.assign({ w: null }, x.size, { h: +e.target.value }); syncStackSize(x);
  });
  $("#f-w").onchange = e => commit("폭 변경", x => {
    const v = e.target.value.trim();
    x.size = Object.assign({ h: effSize(x).h }, x.size, { w: v === "" ? null : +v }); syncStackSize(x);
  });
  const wa = $("#f-wauto"); if (wa) wa.onclick = setAutoWidth;
  $("#f-lock").onchange = e => commit("비율 고정", x => {
    x.size = Object.assign({}, effSize(x), { lockAspect: e.target.checked }); syncStackSize(x);
  });
  $$("#f-target button").forEach(b => b.onclick = () => commit("대상 변경", x => x.target = b.dataset.v));
  $$("#f-action button").forEach(b => b.onclick = () => commit("동작 변경", x => x.action = b.dataset.v));
  $("#f-path").onchange = e => commit("자료 경로", x => {
    const v = e.target.value.trim();
    if (!v) { delete x.asset; return; }
    x.asset = Object.assign({}, x.asset, { path: v });
  });
  $("#f-cms").onchange = e => {
    const v = normCms(e.target); if (v === null) return;
    const cur = findObj(S.selId);
    if (!cur.asset) { toast("자료 경로가 먼저 필요합니다", true); e.target.value = ""; return; }
    commit("CMS 코드", x => { if (v) x.asset.cmsCode = v; else delete x.asset.cmsCode; });
  };
  if (o.asset && o.asset.cmsCode) showCmsTitle("f-cms", o.asset.cmsCode, o.asset.path.split("/").pop());
  $("#f-note").onchange = e => commit("메모", x => {
    const v = e.target.value.trim(); if (v) x.note = v; else delete x.note;
  });
  const un = $("#f-unstack");
  if (un) un.onclick = () => commit("스택 빼기", x => { leaveStack(x, findPageOf(x.id)); x.at.x += 0.03; });
  $("#f-del").onclick = () => deleteSelected();
  $("#f-global").onclick = () => promoteToGlobal(findObj(S.selId));
}
/* 같은 스택은 size 가 JSON 수준에서 같아야 한다 (validate.mjs) */
function syncStackSize(o) {
  if (!o.stackId) return;
  const pi = findPageOf(o.id);
  S.pages[pi].objects.forEach(x => { if (x.stackId === o.stackId) x.size = clone(o.size); });
}
function deleteSelected() {
  if (!S.selId) return;
  const pi = findPageOf(S.selId);
  pushUndo("삭제");
  leaveStack(findObj(S.selId), pi);
  S.pages[pi].objects = S.pages[pi].objects.filter(x => x.id !== S.selId);
  S.selId = null; touch(pi); renderAll();
}

/* ---------------------------------------------------------------- 검증 */
function validateProject() {
  const out = [];
  const buttonIds = new Set((S.profile.buttons || []).map(b => b.id));
  const ptIds = new Set((S.profile.pageTypes || []).map(p => p.id));
  Object.values(S.pages).forEach(p => {
    if (p.printedPage !== p.index + S.book.pageNumbering.offset)
      out.push({ lv: "err", internal: true, page: p.index, msg: `[지면 ${p.index}] 인쇄 쪽번호 불일치` });
    if (p.pageTypeId && !ptIds.has(p.pageTypeId))
      out.push({ lv: "err", internal: true, page: p.index, msg: `[지면 ${p.index}] 지면유형 '${p.pageTypeId}' 가 프로파일에 없음` });
    const be = bookPageEntry(p.index);
    if (p.objects.length && !(be && be.master))
      out.push({ lv: "warn", page: p.index, msg: `[${p.printedPage}쪽] 지면 이미지가 없어요 — 「지면 폴더 불러오기」로 붙이세요` });
    const stacks = {};
    p.objects.forEach(o => {
      if (!o.asset || !o.asset.path)
        out.push({ lv: "err", page: p.index, id: o.id, msg: `[${p.printedPage}쪽] "${o.label}" 자료가 없어요 — 파일을 버튼 위에 놓으세요` });
      if (o.buttonId && !buttonIds.has(o.buttonId))
        out.push({ lv: "err", internal: true, page: p.index, id: o.id, msg: `[${p.printedPage}쪽] buttonId '${o.buttonId}' 가 프로파일에 없음` });
      if (o.asset && o.asset.cmsCode && !/^[0-9]{1,12}$/.test(o.asset.cmsCode))
        out.push({ lv: "warn", page: p.index, id: o.id, msg: `[${p.printedPage}쪽] "${o.label}" CMS 코드가 숫자가 아니에요 — 비워 둬도 됩니다` });
      if ((o.label || "").length > LABEL_MAX)
        out.push({ lv: "err", page: p.index, id: o.id, msg: `[${p.printedPage}쪽] 라벨이 ${LABEL_MAX}자를 넘어요 — 줄여 주세요` });
      if (o.stackId) (stacks[o.stackId] = stacks[o.stackId] || []).push(o);
    });
    Object.entries(stacks).forEach(([sid, list]) => {
      if (new Set(list.map(o => JSON.stringify(o.size || null))).size > 1)
        out.push({ lv: "err", internal: true, page: p.index, id: list[0].id, msg: `[${p.printedPage}쪽] 스택 ${sid} 안의 버튼 크기가 서로 다름` });
    });
  });
  (S.profile.globalButtons || []).forEach(gb => {
    const name = gb.label || (btnDef(gb.buttonId) || {}).label || gb.buttonId;
    if (!btnDef(gb.buttonId)) out.push({ lv: "err", internal: true, gid: gb.id, page: 1, msg: `전역 「${name}」 buttonId '${gb.buttonId}' 가 프로파일에 없음` });
    const miss = [];
    Object.keys(S.pages).map(Number).sort((a, b) => a - b).forEach(i => {
      if (gShows(gb, i) && !gHidden(i, gb) && !gAsset(i, gb)) miss.push(i);
    });
    if (miss.length) {
      const ps = miss.map(i => S.pages[i].printedPage);
      out.push({ lv: "err", gid: gb.id, page: miss[0],
        msg: `전역 「${name}」 자료가 없는 쪽 ${miss.length}곳 (${ps.slice(0, 6).join(", ")}${ps.length > 6 ? " …" : ""}) — 쪽마다 연결하거나 그 쪽에서 숨기세요` });
    }
    Object.keys(S.pages).forEach(k => {
      const l = gLink(+k, gb.id);
      if (l && l.asset && l.asset.cmsCode && !/^[0-9]{1,12}$/.test(l.asset.cmsCode))
        out.push({ lv: "warn", gid: gb.id, page: +k, msg: `[${S.pages[k].printedPage}쪽] 전역 「${name}」 CMS 코드가 숫자가 아니에요` });
    });
  });
  $$("#spread .obj.bad").forEach(el => {
    const o = findObj(el.dataset.id); if (!o) return;
    out.push({ lv: "err", page: +el.dataset.page, id: o.id, msg: `[${(S.pages[+el.dataset.page] || {}).printedPage}쪽] "${o.label}" 지면 밖으로 나갔어요 — 안쪽으로 옮겨 주세요` });
  });
  return out;
}
function renderValidate() {
  const all = validateProject();
  /* v0.8 — 작업자가 손댈 수 없는 내부 점검(쪽번호 공식·프로파일 참조·스택 크기)은 한 줄로 묶는다.
     저장 파일 검증(validate-project.mjs)은 그대로 전부 본다 */
  const internal = all.filter(i => i.internal);
  const items = all.filter(i => !i.internal);
  if (internal.length) items.push({ lv: "warn", internal: true, page: internal[0].page, id: internal[0].id, gid: internal[0].gid,
    msg: `내부 점검 ${internal.length}건 — 작업은 계속해도 됩니다. 저장 파일을 개발 담당에게 보내 주세요`, title: internal.map(i => i.msg).join("\n") });
  const box = $("#validate");
  const errs = items.filter(i => i.lv === "err").length;
  $("#validate-sum").textContent = items.length ? `오류 ${errs} · 경고 ${items.length - errs}` : "";
  if (!items.length) { box.innerHTML = `<div class="v-ok">문제 없음 — 배포할 수 있어요</div>`; return; }
  box.innerHTML = "";
  items.slice(0, 80).forEach(it => {
    const el = document.createElement("div");
    el.className = "v-item " + it.lv + (it.internal ? " internal" : "");
    el.textContent = it.msg;
    if (it.title) el.title = it.title;
    el.onclick = () => {
      goToPage(it.page); S.selId = it.id || null;
      S.selG = it.gid ? { gid: it.gid, page: it.page } : null;
      renderAll();
    };
    box.appendChild(el);
  });
  if (items.length > 80) box.insertAdjacentHTML("beforeend", `<div class="hint">외 ${items.length - 80}건</div>`);
}

/* ---------------------------------------------------------------- 저장·재열기 */
function pagesForSave() {
  return Object.values(S.pages)
    .filter(p => p.objects.length || p.pageTypeId || (p.globals && Object.keys(p.globals).length))
    .sort((a, b) => a.index - b.index)
    .map(p => {
      const c = clone(p);
      c.objects = c.objects.map(o => {
        const q = clone(o);
        if (q.stackId == null) { delete q.stackId; delete q.stackOrder; }
        if (!q.asset) delete q.asset;       // 미연결 객체는 asset 없이 나간다 (schema 상 배포 불가 = 의도)
        return q;
      });
      return c;
    });
}
function serialize() {
  rebuildBookPages();
  return {
    format: "ebook-authoring-project",
    schemaVersion: SCHEMA_VERSION,
    savedAt: nowIso(),
    book: clone(S.book),
    profile: clone(S.profile),
    pages: pagesForSave()
  };
}
function deserialize(data) {
  if (!data || !data.book || !data.profile) throw new Error("프로젝트 파일이 아닙니다");
  if (data.schemaVersion !== SCHEMA_VERSION) toast(`스키마 ${data.schemaVersion} → ${SCHEMA_VERSION} 호환 시도`);
  S.profile = data.profile;
  ensureGlobalIds(S.profile); S.selG = null;
  S.book = data.book;
  S.pages = {};
  for (let i = 1; i <= S.book.pageCount; i++) S.pages[i] = blankPage(i);
  (data.pages || []).forEach(p => { if (S.pages[p.index]) S.pages[p.index] = p; });
  S.bgUrls = {}; S.bgFiles = {}; S.pageText = {}; S.spread = 0; S.selId = null; S.undo = []; S.redo = []; S.dirty = false;
}
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}
function saveProject() {
  const d = serialize();
  download((S.book.bookId || "book") + ".ebproj.json", JSON.stringify(d, null, 2));
  autosave(); S.dirty = false;
  setStatus("저장됨 — 배경 이미지는 다시 불러와야 합니다", "ok");
}
/* schema 파일 구성 그대로 내보내기: book.json + pages/{index}.json + profiles/{id}.json */
function exportSchemaFiles() {
  const d = serialize();
  const files = [["book.json", d.book], [`profiles/${d.profile.profileId}.json`, d.profile]];
  d.pages.forEach(p => files.push([`pages/${p.index}.json`, p]));
  let i = 0;
  const tick = () => {
    if (i >= files.length) { setStatus(`내보내기 ${files.length}개 완료`, "ok"); return; }
    const [n, o] = files[i++];
    download(n.replace(/\//g, "_"), JSON.stringify(o, null, 2));
    setTimeout(tick, 220);   // 브라우저 연속 다운로드 제한 회피
  };
  if (!confirm(`${files.length}개 파일을 내려받습니다. 받은 뒤 book.json / pages_*.json / profiles_*.json 으로 폴더에 정리하세요.`)) return;
  tick();
}
function autosave() {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serialize())); } catch (e) { /* 용량 초과 무시 */ }
}
function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    deserialize(JSON.parse(raw));
    setStatus("자동저장본을 복원했습니다");
    return true;
  } catch (e) { return false; }
}
setInterval(() => { if (S.dirty) { autosave(); S.dirty = false; setStatus("자동저장됨"); } }, 15000);

/* ---------------------------------------------------------------- 1.x 파이프라인 산출물 불러오기 */
async function loadPipeline(fileList) {
  const files = Array.from(fileList);
  const indexFile = files.find(f => f.name === "master-index.json");
  if (!indexFile) { toast("지면 폴더가 아닙니다 — 「PDF이름_지면」 폴더를 고르세요", true); return; }
  const mi = JSON.parse(await indexFile.text());
  const byName = {};
  files.forEach(f => { byName[f.name] = f; });
  const startStr = prompt("이 산출물의 첫 쪽을 몇 번째 지면에 둘까요? (지면 번호)", "1");
  if (startStr == null) return;
  const start = Math.max(1, parseInt(startStr, 10) || 1);
  pushUndo("배경 불러오기");
  const n = applyPipeline(mi, byName, start);
  goToPage(start);
  renderAll();
  setStatus(`지면 ${n}쪽 연결 (${mi.source || ""})`, "ok");
}
/* master-index 를 지면에 붙인다. 2.4 마법사도 이걸 그대로 쓴다. 반환 = 붙은 지면 수 */
function applyPipeline(mi, byName, start) {
  const keys = Object.keys(mi.pages).sort((a, b) => +a - +b);
  let n = 0;
  keys.forEach((k, i) => {
    const idx = start + i;
    if (idx > S.book.pageCount) return;
    const e = mi.pages[k];
    const f = byName[e.hash + ".webp"];
    if (!f) return;
    S.bgUrls[idx] = URL.createObjectURL(f); S.bgFiles[idx] = f;
    if (byName[k + ".json"]) S.pageText[idx] = byName[k + ".json"];   // text/{k}.json — 지면 폴더를 골랐을 때만
    const [w, h] = (e.basePx || "1603x2100").split("x").map(Number);
    const patch = { master: e.hash, aspect: +(w / h).toFixed(3) };
    const u = (S.book.units || []).find(u => idx >= u.fromIndex && idx <= u.toIndex);
    if (u) patch.unitId = u.id;
    setBookPageEntry(idx, patch);
    n++;
  });
  S.book.authoring.sourcePdf = mi.source || S.book.authoring.sourcePdf;
  if (mi.settings) {
    S.book.master.baseQuality = mi.settings.quality ?? S.book.master.baseQuality;
    S.book.master.baseLongEdge = mi.settings.longEdge ?? S.book.master.baseLongEdge;
  }
  return n;
}

/* ---------------------------------------------------------------- 교사 화면으로 보기 (시연 1부 → 2부)
   뷰어를 새 창으로 열고, 뷰어가 "준비됨"을 보내면 프로젝트·지면 이미지·자료 원본을 넘긴다.
   파일(Blob)은 창끼리 그대로 복제되어 넘어간다 — 서버·저장 없이 지금 작업을 그대로 본다 */
let previewWin = null;
function openPreview() {
  const data = serialize();
  const [L, R] = spreadPages();
  const msg = { type: "ebook-preview", project: data, bg: Object.assign({}, S.bgFiles), assets: Object.assign({}, S.assetFiles), goto: L || R || 1 };
  const nBg = Object.keys(msg.bg).length, nAs = Object.keys(msg.assets).length;
  previewWin = window.open("../viewer/index.html#preview", "ebook-viewer");
  if (!previewWin) { toast("새 창이 막혔습니다 — 브라우저 주소창 오른쪽의 팝업 허용을 눌러 주세요", true); return; }
  const onMsg = e => {
    if (e.source !== previewWin || !e.data || e.data.type !== "ebook-viewer-ready") return;
    window.removeEventListener("message", onMsg);
    previewWin.postMessage(msg, "*");
  };
  window.addEventListener("message", onMsg);
  setStatus(`교사 화면 열기 — 지면 ${nBg}장 · 자료 ${nAs}개${nAs ? "" : " (자료 원본은 이번에 끌어다 놓은 것만 넘어갑니다)"}`, "ok");
}

/* ---------------------------------------------------------------- 배선 */
function bind() {
  $("#btn-new").onclick = () => window.EbookWizard.open();   // 2.4 — wizard.js
  $("#btn-save").onclick = saveProject;
  $("#btn-preview").onclick = openPreview;
  $("#btn-export").onclick = exportSchemaFiles;
  $("#btn-open").onclick = () => $("#in-open").click();
  $("#in-open").onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => {
      try { deserialize(JSON.parse(t)); renderAll(); setStatus("열기 완료 — 「지면 폴더 불러오기」로 지면 이미지를 다시 붙이세요", "ok"); }
      catch (err) { toast("열기 실패: " + err.message, true); }
    });
    e.target.value = "";
  };
  $("#btn-undo").onclick = undo;
  $("#btn-redo").onclick = redo;

  $("#in-profile").onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => {
      try {
        const p = JSON.parse(t);
        if (!p.buttons || !p.themes || !p.profileId) throw new Error("프로파일 형식이 아님");
        pushUndo("프로파일 교체");
        S.profile = p; S.book.profileId = p.profileId; ensureGlobalIds(p); S.selG = null;
        renderAll();
        setStatus(`프로파일 교체: ${p.name} (버튼 ${p.buttons.length}종)`, "ok");
      } catch (err) { toast("프로파일 오류: " + err.message, true); }
    });
    e.target.value = "";
  };
  $("#in-pipeline").onchange = e => { if (e.target.files.length) loadPipeline(e.target.files); e.target.value = ""; };
  $("#in-draft").onchange = e => { const fs = Array.from(e.target.files); e.target.value = ""; if (fs.length) draftFromFolder(fs); };
  /* 더보기 메뉴 — 항목을 누르거나 바깥을 누르면 닫힌다 */
  const more = $("#more");
  if (more) {
    $("#more-menu").addEventListener("click", e => { if (e.target.closest("button,label")) setTimeout(() => more.open = false, 0); });
    document.addEventListener("pointerdown", e => { if (more.open && !more.contains(e.target)) more.open = false; });
  }
  $("#in-bg").onchange = e => {
    const files = Array.from(e.target.files)
      .filter(f => /^image\//.test(f.type))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const [L, R] = spreadPages();
    let idx = L || R || 1;
    files.forEach(f => {
      if (idx > S.book.pageCount) return;
      S.bgUrls[idx] = URL.createObjectURL(f); S.bgFiles[idx] = f;
      const im = new Image(); const at = idx;
      im.onload = () => { setBookPageEntry(at, { aspect: +(im.width / im.height).toFixed(3) }); renderSpread(); };
      im.src = S.bgUrls[idx];
      idx++;
    });
    renderAll(); setStatus(`배경 ${files.length}쪽 지정`, "ok");
    e.target.value = "";
  };

  $("#nav-prev").onclick = () => { S.spread = Math.max(0, S.spread - 1); S.selId = null; renderAll(); notify("펼침 이동"); };
  $("#nav-next").onclick = () => { S.spread = Math.min(spreadCount() - 1, S.spread + 1); S.selId = null; renderAll(); notify("펼침 이동"); };
  $("#chk-grid").onchange = renderSpread;
  $("#chk-safe").onchange = renderSpread;
  $("#stage").addEventListener("pointerdown", e => {
    if (!e.target.closest(".obj")) { S.selId = null; S.selG = null; renderAll(); }
  });

  document.addEventListener("keydown", e => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    else if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveProject(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && S.selId) { e.preventDefault(); deleteSelected(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && S.selG) { e.preventDefault(); setStatus("전역 버튼은 속성 패널의 「이 쪽에서 숨기기」나 「전역 해제」로 지웁니다", "warn"); }
    else if (S.selId && !mod && (e.key === "[" || e.key === "]")) { e.preventDefault(); stepPreset(e.key === "]" ? 1 : -1); }
    else if (S.selId && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const step = e.shiftKey ? 0.01 : 0.002;
      pushUndo("미세 이동");
      const o = findObj(S.selId);
      if (e.key === "ArrowLeft") o.at.x -= step;
      if (e.key === "ArrowRight") o.at.x += step;
      if (e.key === "ArrowUp") o.at.y -= step;
      if (e.key === "ArrowDown") o.at.y += step;
      o.at.x = clamp(o.at.x, 0, 1); o.at.y = clamp(o.at.y, 0, 1);
      renderAll();
    }
    else if (e.key === "PageDown") $("#nav-next").click();
    else if (e.key === "PageUp") $("#nav-prev").click();
  });

  window.addEventListener("resize", () => renderSpread());
  window.addEventListener("beforeunload", () => { if (S.dirty) autosave(); });
}

/* ---------------------------------------------------------------- 시작 */
function init() {
  if (!window.DEFAULT_PROFILE) { alert("profile.default.js 를 찾을 수 없습니다"); return; }
  const restored = loadAutosave();
  if (!restored) newProject({ title: "새 이북", pageCount: 2, offset: 0, bookId: "untitled-book", profile: clone(window.DEFAULT_PROFILE) });
  bind();
  renderAll();
  setupPageDrops();
  if (!restored && window.EbookWizard) window.EbookWizard.open({ first: true });   // 처음 여는 사람은 마법사부터
}
document.addEventListener("DOMContentLoaded", init);

/* 2.4 마법사(wizard.js)가 쓰는 입구 */
window.__ebookCore = {
  S, clone, parseFileName: n => parseFileName(n), unitOf: i => unitOf(i),
  measureObj: (o, i) => measureObj(o, i), occupiedRects: (i, ex) => occupiedRects(i, ex), pageAspect: i => pageAspect(i), btnDef0: id => btnDef(id),
  hasWork: () => Object.values(S.pages).some(p => p.objects.length),
  newProject, applyPipeline, goToPage, renderAll, setStatus, saveProject, autosave,
  escapeHtml, iconSvg, thm, btnDef: id => btnDef(id),
  onEdit: f => editListeners.push(f), spreadPages, findPageOf, toast
};
/* 테스트 훅 (헤드리스 검증용) */
window.__ebook = { S, openPreview, serialize, validateProject, placeButton, applyPageType, effSize, joinStack, stepPreset,
  resolvePageButtons, promoteToGlobal, bulkLinkGlobal, removeGlobal, undo, redo,
  draftFromFolder, resolveButton, matchByName };
})();
