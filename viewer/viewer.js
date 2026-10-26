/* =========================================================================
   e-book 뷰어 — WBS 4.1 / 4.3
   교사가 쓰는 화면. 절대 요구 = 수업 흐름이 끊기지 않는 것.

   불러오기 3가지
     1) 저작기 「교사 화면으로 보기」 — 창끼리 postMessage 로 프로젝트·지면 이미지·자료 파일을 받는다
     2) 이북 폴더 열기 — .ebproj.json(또는 book.json+pages+profiles) + 지면 폴더 + 자료가 든 폴더
     3) 주소 ?book=<.ebproj.json 또는 book.json 이 있는 폴더 URL> — 웹에 올렸을 때(엠티처 이관 후)

   자료 열기 (하이브리드, 4.3)
     cmsCode 있음 + 온라인 + 교사 세션 → CMS 최신본 (확인은 1.5초까지만)
     셋 중 하나라도 아니면 → 내장본. 실패·지연은 조용히 내장본으로 (오류 화면 없음)
     「항상 내장본으로 열기」 설정이면 확인 없이 바로 내장본
   ========================================================================= */
(function () {
"use strict";

const A = window.MteacherAdapter;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const SET_KEY = "ebook-viewer:settings:v1";

const V = {
  book: null, profile: null, pages: {},
  bg: {},                 // index → 이미지 주소
  files: new Map(),       // 상대경로 → File
  names: new Map(),       // 파일 이름 → File (경로가 달라도 이름으로 찾기)
  base: null,             // URL 로 불러왔을 때 기준 주소
  spread: 0, single: false,
  net: null, netAt: 0,
  links: new Map()        // 바로가기(.url) 경로 → 주소. 이북을 열 때 미리 읽어 둔다 (누르는 순간 바로 새 탭을 열려고)
};
let settings = { alwaysEmbedded: false };
try { settings = Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY) || "{}")); } catch (_) { /* 저장소 없음 */ }
const saveSettings = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (_) { /* 무시 */ } };

/* 아이콘 — 저작기와 같은 이름표 */
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
const icon = n => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[n] || ICONS.file}"/></svg>`;

function toast(msg, ms) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms || 2600);
}

/* ---------------------------------------------------------------- 프로파일·버튼 해석 */
const btnDef = id => (V.profile.buttons || []).find(b => b.id === id) || {};
const theme = id => (V.profile.themes || []).find(t => t.id === id) || { color: "#5A6472", onColor: "#fff" };
function effSize(o) {
  const d = btnDef(o.buttonId);
  return Object.assign({ h: 0.028, w: null }, V.profile.defaultSize || {}, d.defaultSize || {}, o.size || {});
}
/* 저작기 resolvePageButtons 와 같은 규칙 — 지면 버튼 + 전역 버튼(띄울 지면·숨김·쪽 자료/공통 자료) */
function buttonsOf(idx) {
  const p = V.pages[idx] || { objects: [] };
  const own = (p.objects || []).filter(o => o.kind === "button" && o.target !== "student");
  const ptId = p.pageTypeId || null;
  const gl = (V.profile.globalButtons || []).filter(g =>
    g.showOn === "all" || g.showOn == null || (Array.isArray(g.showOn) && ptId && g.showOn.includes(ptId))
  ).filter(g => !(p.globals && p.globals[g.id] && p.globals[g.id].hidden)).map(g => {
    const l = p.globals && p.globals[g.id];
    const d = btnDef(g.buttonId);
    return { id: "global:" + g.id, kind: "button", buttonId: g.buttonId, label: g.label || d.label, at: g.at,
      size: Object.assign({ h: 0.024, w: null }, g.size || {}), display: g.display,
      asset: (l && l.asset) || g.asset || null, global: true };
  });
  return own.concat(gl);
}

/* ---------------------------------------------------------------- 불러오기 */
function setProject(proj, src) {
  if (!proj || !proj.book || !proj.profile) throw new Error("이북 파일이 아닙니다");
  V.book = proj.book; V.profile = proj.profile; V.pages = {};
  (proj.pages || []).forEach(p => { V.pages[p.index] = p; });
  V.source = src;
  $("#open").hidden = true;
  document.title = V.book.title + " — e-book";
  $("#book-title").textContent = V.book.title;
  V.spread = 0;
  layoutMode(); render();
  refreshNet();
  primeLinks();
}

/* ---------------------------------------------------------------- 바로가기 미리 읽기
   브라우저는 「누른 바로 그 순간」에 연 창만 허용한다. 파일을 읽느라 기다리면 팝업으로 막히므로 미리 읽어 둔다 */
function linkFromText(txt) {
  const m = String(txt || "").match(/^URL=(.+)$/mi) || String(txt || "").match(/https?:\/\/\S+/);
  return m ? (m[1] || m[0]).trim() : null;
}
async function primeLinks() {
  V.links.clear();
  const paths = new Set();
  Object.keys(V.pages).forEach(i => buttonsOf(+i).forEach(b => { if (b.asset && /\.url$/i.test(b.asset.path || "")) paths.add(b.asset.path); }));
  for (const p of paths) {
    const emb = embeddedOf(p); if (!emb) continue;
    try {
      const txt = emb.file ? await emb.file.text() : await (await fetch(emb.url)).text();
      const link = linkFromText(txt); if (link) V.links.set(p, link);
    } catch (_) { /* 못 읽으면 누를 때 안내 창으로 */ }
  }
}

/* 1) 저작기 미리보기 */
function listenPreview() {
  if (!window.opener || !/preview/.test(location.hash)) return false;
  let got = false;
  window.addEventListener("message", e => {
    const d = e.data;
    if (!d || d.type !== "ebook-preview") return;
    got = true;
    V.files.clear(); V.names.clear();
    Object.entries(d.assets || {}).forEach(([path, f]) => { V.files.set(path, f); V.names.set(f.name, f); });
    V.bg = {};
    Object.entries(d.bg || {}).forEach(([idx, blob]) => { V.bg[idx] = URL.createObjectURL(blob); });
    try {
      setProject(d.project, "preview");
      const at = d.goto ? +d.goto : null;
      if (at) goToIndex(at);
      toast("생성기에서 연 미리보기입니다 — 생성기에서 고치면 다시 「교사 화면으로 보기」");
    } catch (err) { $("#open-msg").textContent = err.message; }
  });
  let n = 0;
  const ping = () => { if (got || n++ > 40) return; try { window.opener.postMessage({ type: "ebook-viewer-ready" }, "*"); } catch (_) { /* 닫힘 */ } setTimeout(ping, 250); };
  ping();
  return true;
}

/* 2) 폴더 */
async function loadFolder(fileList) {
  const files = Array.from(fileList);
  const rel = f => (f.webkitRelativePath || f.name).replace(/\\/g, "/").split("/").slice(1).join("/") || f.name;
  V.files.clear(); V.names.clear();
  files.forEach(f => { V.files.set(rel(f), f); if (!V.names.has(f.name)) V.names.set(f.name, f); });
  let proj = null;
  const eb = files.filter(f => /\.ebproj\.json$/i.test(f.name)).sort((a, b) => b.lastModified - a.lastModified)[0];
  if (eb) proj = JSON.parse(await eb.text());
  else {
    const bookF = files.find(f => f.name === "book.json");
    if (!bookF) throw new Error("이 폴더에는 이북 파일(.ebproj.json 또는 book.json)이 없습니다");
    const book = JSON.parse(await bookF.text());
    const profF = files.find(f => /^profiles[_/]/.test(rel(f)) || new RegExp(`^profiles_${book.profileId}\\.json$`).test(f.name));
    if (!profF) throw new Error("교과 설정(profiles) 파일이 없습니다");
    const pages = [];
    for (const f of files) if (/(^|\/)pages[_/]\d+\.json$/.test(rel(f)) || /^pages_\d+\.json$/.test(f.name)) pages.push(JSON.parse(await f.text()));
    proj = { book, profile: JSON.parse(await profF.text()), pages };
  }
  V.bg = {};
  (proj.book.pages || []).forEach(e => {
    const f = V.names.get(e.master + ".webp");
    if (f) V.bg[e.index] = URL.createObjectURL(f);
  });
  V.base = null;
  setProject(proj, "folder");
  const miss = (proj.book.pages || []).filter(e => !V.bg[e.index]).length;
  if (miss) toast(`지면 이미지 ${miss}장을 찾지 못했습니다 — 지면 폴더가 이 폴더 안에 있는지 확인하세요`, 4000);
}

/* 3) 주소 */
async function loadUrl(u) {
  const url = new URL(u, location.href);
  let proj;
  if (/\.json$/i.test(url.pathname) && !/book\.json$/i.test(url.pathname)) {
    proj = await (await fetch(url)).json();
    V.base = new URL(".", url).href;
  } else {
    const base = /book\.json$/i.test(url.pathname) ? new URL(".", url).href : url.href.replace(/\/?$/, "/");
    const book = await (await fetch(base + "book.json")).json();
    const profile = await (await fetch(base + `profiles/${book.profileId}.json`)).json();
    const pages = (await Promise.all((book.pages || []).map(e =>
      fetch(base + `pages/${e.index}.json`).then(r => r.ok ? r.json() : null).catch(() => null)))).filter(Boolean);
    proj = { book, profile, pages }; V.base = base;
  }
  V.bg = {};
  (proj.book.pages || []).forEach(e => { V.bg[e.index] = V.base + `master/${e.master}.webp`; });
  setProject(proj, "url");
}

/* ---------------------------------------------------------------- 펼침 */
function layoutMode() {
  const st = $("#stage");
  V.single = st.clientWidth < st.clientHeight * 1.05;     // 세로 화면(태블릿 세로)은 한 쪽씩
}
function unitsOfView() {
  const n = V.book.pageCount;
  if (V.single) return n;
  return V.book.spread && V.book.spread.firstPageAlone !== false ? Math.floor(n / 2) + 1 : Math.ceil(n / 2);
}
function viewPages() {
  const n = V.book.pageCount;
  if (V.single) { const i = V.spread + 1; return [i <= n ? i : null]; }
  if (V.book.spread && V.book.spread.firstPageAlone !== false) {
    if (V.spread === 0) return [null, n >= 1 ? 1 : null];
    const l = V.spread * 2, r = l + 1;
    return [l <= n ? l : null, r <= n ? r : null];
  }
  const l = V.spread * 2 + 1, r = l + 1;
  return [l <= n ? l : null, r <= n ? r : null];
}
function goToIndex(idx) {
  if (V.single) V.spread = idx - 1;
  else if (V.book.spread && V.book.spread.firstPageAlone !== false) V.spread = idx <= 1 ? 0 : Math.floor(idx / 2);
  else V.spread = Math.floor((idx - 1) / 2);
  V.spread = Math.max(0, Math.min(unitsOfView() - 1, V.spread));
  render();
}
const printed = idx => {
  const e = (V.book.pages || []).find(p => p.index === idx);
  if (e && e.printedPage != null) return e.printedPage;
  return idx + ((V.book.pageNumbering && V.book.pageNumbering.offset) || 0);
};
const aspectOf = idx => { const e = (V.book.pages || []).find(p => p.index === idx); return (e && e.aspect) || 0.764; };

function render() {
  if (!V.book) return;
  const vp = viewPages();
  const st = $("#stage");
  const pad = V.single ? 16 : 144;
  const availW = st.clientWidth - pad, availH = st.clientHeight - 36;
  const ars = vp.map(i => aspectOf(i || vp.find(Boolean) || 1));
  const sumAr = ars.reduce((a, b) => a + b, 0);
  const h = Math.floor(Math.min(availH, availW / sumAr));
  const sp = $("#spread"); sp.innerHTML = "";
  vp.forEach((idx, k) => {
    const pg = document.createElement("div");
    pg.className = "page" + (idx == null ? " blank" : "");
    pg.style.width = Math.floor(h * ars[k]) + "px"; pg.style.height = h + "px";
    if (idx != null) {
      if (V.bg[idx]) pg.innerHTML = `<img class="bg" src="${V.bg[idx]}" alt="${printed(idx)}쪽" draggable="false">`;
      const layer = document.createElement("div"); layer.className = "layer";
      buttonsOf(idx).forEach(b => layer.appendChild(btnEl(b, h, idx)));
      pg.appendChild(layer);
    }
    sp.appendChild(pg);
  });
  $("#nav-prev").disabled = V.spread <= 0;
  $("#nav-next").disabled = V.spread >= unitsOfView() - 1;
  const shown = vp.filter(Boolean);
  const ptxt = shown.map(printed).join("–");
  const unit = (V.book.units || []).find(u => shown[0] >= u.fromIndex && shown[0] <= u.toIndex);
  $("#book-sub").textContent = (unit ? unit.title + " · " : "") + (ptxt ? ptxt + "쪽" : "");
  const sl = $("#slider"); sl.max = unitsOfView() - 1; sl.value = V.spread;
  $("#goto").value = shown.length ? printed(shown[0]) : "";
  $("#pageinfo").textContent = `/ ${printed(1)}–${printed(V.book.pageCount)}`;
}

function btnEl(b, pageH, idx) {
  const d = btnDef(b.buttonId), t = theme(d.themeId), sz = effSize(b);
  const disp = b.display || d.defaultDisplay || "pill";
  const el = document.createElement("button");
  el.type = "button";
  el.className = "btn d-" + disp;
  const hpx = sz.h * pageH;
  el.style.left = (b.at.x * 100) + "%"; el.style.top = (b.at.y * 100) + "%";
  el.style.height = hpx + "px"; el.style.fontSize = (hpx * 0.44) + "px";
  el.style.background = t.color; el.style.color = t.onColor || "#fff";
  if (disp === "icon") el.style.width = hpx + "px";
  if (sz.w != null) { el.style.width = (sz.w * 100) + "%"; el.classList.add("wrap"); el.style.height = "auto"; }
  const label = b.label || d.label || "자료";
  el.innerHTML = (disp === "label" ? "" : icon(d.icon)) + (disp === "icon" ? "" : `<span class="lbl">${esc(label)}</span>`);
  el.title = label; el.setAttribute("aria-label", label);
  el.addEventListener("click", e => { e.stopPropagation(); openButton(b, el); });
  return el;
}

/* ---------------------------------------------------------------- 4.3 하이브리드 자료 열기 */
function embeddedOf(path) {
  if (!path) return null;
  if (V.files.has(path)) return { file: V.files.get(path) };
  const name = path.split("/").pop();
  // 경로 끝이 같은 파일 → 이름만 같은 파일 순서로
  for (const [k, f] of V.files) if (k.endsWith("/" + path) || k.endsWith(path)) return { file: f };
  if (V.names.has(name)) return { file: V.names.get(name) };
  if (V.base) return { url: V.base + path.split("/").map(encodeURIComponent).join("/") };
  return null;
}
async function netState(force) {
  if (!force && V.net && Date.now() - V.netAt < 30000) return V.net;
  const [n, s] = await Promise.all([A.probe(), A.session()]);
  V.net = { online: n.online, session: s, why: n.why, ms: n.ms }; V.netAt = Date.now();
  showNet();
  return V.net;
}
function showNet() {
  const el = $("#net"); el.hidden = false;
  if (settings.alwaysEmbedded) { el.className = "net"; el.textContent = "내장본으로 열기"; el.title = "설정에서 「항상 내장본으로 열기」를 켰습니다"; return; }
  if (!V.net) { el.className = "net"; el.textContent = "연결 확인 중…"; return; }
  if (V.net.online && V.net.session) { el.className = "net on"; el.textContent = "온라인 · 최신 자료"; el.title = "CMS 코드가 있는 자료는 최신본으로 엽니다"; }
  else if (V.net.online) { el.className = "net off"; el.textContent = "로그인하면 최신 자료"; el.title = "교사 로그인이 필요합니다. 지금은 내장본으로 엽니다"; }
  else { el.className = "net off"; el.textContent = "오프라인 · 내장 자료"; el.title = V.net.why || ""; }
}
function refreshNet() { netState(true).catch(() => { /* 무시 */ }); }

/* 어떤 경로로 열지 정한다 — 결과: {how:"cms"|"embedded"|"link"|"need-online"|"missing", ...} */
async function resolveAsset(a) {
  if (!a || !a.path && !a.cmsCode) return { how: "missing" };
  const emb = embeddedOf(a.path);
  if (a.cmsCode && !settings.alwaysEmbedded) {
    const n = await netState();
    if (n.online && n.session) return { how: "cms", url: A.viewerUrl(a.cmsCode), emb };
  }
  if (emb) return { how: "embedded", emb, fellBack: !!a.cmsCode && !settings.alwaysEmbedded };
  if (a.cmsCode) return { how: "need-online", url: A.viewerUrl(a.cmsCode) };
  return { how: "missing", path: a.path };
}

/* 누르면 바로 — 창을 거치지 않는 두 가지 (기다림 없이 이 함수 맨 앞에서 끝낸다)
   ① 바로가기·바깥 도구 → 새 탭   ② 수업 PPT 같은 발표 파일·「내려받기」 버튼 → 받아서 프로그램으로 */
const APP_NAME = ext => /^(pptx?|ppsx?|potx?)$/i.test(ext) ? "파워포인트" : /^(hwpx?|hwt)$/i.test(ext) ? "한글" : /^(xlsx?|xlsm|csv)$/i.test(ext) ? "엑셀" : /^(docx?)$/i.test(ext) ? "워드" : "프로그램";
const ro = w => { const c = w.charCodeAt(w.length - 1) - 0xAC00; return w + (c >= 0 && c <= 11171 && c % 28 !== 0 && c % 28 !== 8 ? "으로" : "로"); };   // 한글로·엑셀로·파워포인트로·워드로
const OPEN_IN_APP = /^(pptx?|ppsx?|potx?)$/i;          // 수업 중 띄워서 진행하는 것 — 미리보기 없이 바로 프로그램으로
function fileOf(emb, path) {
  return emb.file ? { url: URL.createObjectURL(emb.file), name: emb.file.name } : { url: emb.url, name: decodeURIComponent(String(path || emb.url).split("/").pop()) };
}
function saveNow(emb, path) {
  const f = fileOf(emb, path), a = document.createElement("a");
  a.href = f.url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  return f.name;
}
function appHint(name) {
  const app = APP_NAME(name.split(".").pop());
  let first = true;
  try { first = !localStorage.getItem("ebook-viewer:app-hint"); localStorage.setItem("ebook-viewer:app-hint", "1"); } catch (_) { /* 무시 */ }
  toast(first
    ? `${app} 파일을 받았어요. 브라우저의 받은 파일을 누르면 ${ro(app)} 열려요. 받은 파일 옆 「⋯ → 이 유형의 파일 항상 열기」를 한 번 켜 두면 다음부터 누르자마자 열립니다.`
    : `${ro(app)} 여는 중 — ${name}`, first ? 9000 : 2500);
}
async function openButton(b, el) {
  const a = b.asset || {}, ext = (a.path || "").split(".").pop();
  if (/\.url$/i.test(a.path || "") || b.action === "external") {
    const link = V.links.get(a.path);
    if (link) { window.open(link, "_blank", "noopener"); toast(`새 탭에서 열었어요 — ${b.label || "바로가기"}`, 2000); return; }
  }
  if (a.path && (b.action === "download" || OPEN_IN_APP.test(ext))) {
    const emb = embeddedOf(a.path);
    if (emb) { appHint(saveNow(emb, a.path)); return; }
  }
  if (el.classList.contains("opening")) return;
  el.classList.add("opening");
  const label = b.label || btnDef(b.buttonId).label || "자료";
  showModal(label, "", `<div class="m-msg"><div class="spin"></div>여는 중…</div>`);
  try {
    const r = await resolveAsset(b.asset);
    await present(label, r, b.asset);
  } catch (err) {
    showModal(label, "", `<div class="m-msg"><b>열지 못했습니다</b>${esc(err.message)}</div>`);
  } finally { el.classList.remove("opening"); }
}

const KIND = ext => {
  ext = (ext || "").toLowerCase();
  if (/^(png|jpe?g|gif|webp|svg|bmp)$/.test(ext)) return "image";
  if (/^(mp4|webm|m4v|mov|ogv)$/.test(ext)) return "video";
  if (/^(mp3|wav|m4a|ogg)$/.test(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (/^(html?|txt)$/.test(ext)) return "doc";
  if (ext === "url") return "url";
  return "download";          // hwp·pptx·docx·xlsx·zip… 브라우저가 못 여는 것 → 받아서 열기
};
async function present(label, r, asset) {
  const dl = $("#m-dl"), nw = $("#m-new");
  dl.hidden = true; nw.hidden = true;
  if (r.how === "cms") {
    showModal(label, `<span class="src cms">CMS 최신본</span>`,
      `<iframe src="${esc(r.url)}" title="${esc(label)}" allow="autoplay; fullscreen" referrerpolicy="no-referrer-when-downgrade"></iframe>`);
    nw.href = r.url; nw.hidden = false;     // 틀 안에서 막히는 경우를 위한 탈출구
    return;
  }
  if (r.how === "need-online") {
    showModal(label, "", `<div class="m-msg"><b>인터넷에 연결되면 열 수 있어요</b>이 자료는 이북 안에 들어 있지 않고 CMS 에만 있습니다.<br><br><a class="big-btn" href="${esc(r.url)}" target="_blank" rel="noopener">연결되면 새 창에서 열기</a></div>`);
    return;
  }
  if (r.how === "missing") {
    showModal(label, "", `<div class="m-msg"><b>자료 파일을 찾지 못했어요</b><span class="sub">${esc(r.path || "")}</span><br><br>이북 폴더 안에 자료가 함께 들어 있는지 확인해 주세요.</div>`);
    return;
  }
  const f = r.emb.file, url = f ? URL.createObjectURL(f) : r.emb.url;
  const name = f ? f.name : decodeURIComponent(r.emb.url.split("/").pop());
  const ext = name.split(".").pop();
  const badge = `<span class="src emb" title="${r.fellBack ? "최신본을 받지 못해 이북에 들어 있는 자료로 열었습니다" : "이북에 들어 있는 자료"}">내장본</span>`;
  dl.href = url; dl.download = name; dl.hidden = false; dl.textContent = "받기";
  const k = KIND(ext);
  let body;
  if (k === "image") body = `<img src="${url}" alt="${esc(label)}">`;
  else if (k === "video") body = `<video src="${url}" controls autoplay playsinline></video>`;
  else if (k === "audio") body = `<audio src="${url}" controls autoplay></audio>`;
  else if (k === "pdf" || k === "doc") { body = `<iframe src="${url}" title="${esc(label)}"></iframe>`; nw.href = url; nw.hidden = false; }
  else if (k === "url") {
    const txt = f ? await f.text() : r.emb.url ? await (await fetch(r.emb.url)).text().catch(() => "") : "";
    const link = linkFromText(txt);
    if (link) V.links.set(asset.path, link);       // 다음부터는 바로 새 탭
    body = link ? `<div class="m-msg"><b>바깥 도구로 이동합니다</b><span class="sub">${esc(link)}</span><br><br><a class="big-btn" href="${esc(link)}" target="_blank" rel="noopener">새 창에서 열기</a></div>`
                : `<div class="m-msg"><b>바로가기 파일</b>주소를 읽지 못했습니다. 받아서 열어 주세요.</div>`;
  } else {
    /* 한글·엑셀·워드 — 미리보기용 PDF(배포 빌드가 만들어 둠: 같은 이름 .preview.pdf)가 있으면 그걸 보여 주고 원본은 「받기」로 */
    const pv = embeddedOf(String(asset.path || "").replace(/\.[^./]+$/, ".preview.pdf"));
    const app = APP_NAME(ext);
    if (pv) {
      const pu = pv.file ? URL.createObjectURL(pv.file) : pv.url;
      body = `<iframe src="${pu}" title="${esc(label)}"></iframe>`;
      dl.textContent = `받아서 ${ro(app)} 열기`;
    } else {
      body = `<div class="m-msg"><b>${esc(name)}</b><span class="sub">이 자료는 미리보기가 아직 없어요. 받으면 ${ro(app)} 열려요.</span><br><br><a class="big-btn" href="${url}" download="${esc(name)}" data-app>받아서 ${ro(app)} 열기</a></div>`;
    }
  }
  showModal(label, badge, body);
}

function showModal(title, badge, body) {
  $("#m-title").textContent = title;
  $("#m-src").outerHTML = `<span id="m-src">${badge || ""}</span>`;
  $("#m-body").innerHTML = body;
  $("#modal").hidden = false;
}
function closeModal() {
  $("#modal").hidden = true;
  $("#m-body").innerHTML = "";          // 영상 멈춤
}

/* ---------------------------------------------------------------- 조작 */
function step(d) {
  if (!V.book || !$("#modal").hidden) return;
  const n = Math.max(0, Math.min(unitsOfView() - 1, V.spread + d));
  if (n !== V.spread) { V.spread = n; render(); }
}
function bind() {
  /* 「받아서 …으로 열기」를 누르면 처음 한 번 「항상 열기」 안내 */
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-app], #m-dl"); if (!t) return;
    const n = t.getAttribute("download") || "";
    if (/\.(pptx?|ppsx?|hwpx?|xlsx?|docx?)$/i.test(n)) appHint(n);
  });
  $("#nav-prev").onclick = () => step(-1);
  $("#nav-next").onclick = () => step(1);
  $("#slider").oninput = e => { V.spread = +e.target.value; render(); };
  $("#goto").onchange = e => {
    const p = parseInt(e.target.value, 10); if (!Number.isFinite(p)) return;
    const off = (V.book.pageNumbering && V.book.pageNumbering.offset) || 0;
    const idx = Math.max(1, Math.min(V.book.pageCount, p - off));
    goToIndex(idx);
  };
  document.addEventListener("keydown", e => {
    if (!$("#modal").hidden) { if (e.key === "Escape") closeModal(); return; }
    if (!$("#settings").hidden) { if (e.key === "Escape") $("#settings").hidden = true; return; }
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); step(1); }
    else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); step(-1); }
    else if (e.key === "Home") { V.spread = 0; render(); }
    else if (e.key === "End") { V.spread = unitsOfView() - 1; render(); }
  });
  /* 밀어서 넘기기 (태블릿·전자칠판) */
  let sx = null;
  $("#stage").addEventListener("pointerdown", e => { if (!e.target.closest(".btn")) sx = e.clientX; });
  $("#stage").addEventListener("pointerup", e => {
    if (sx == null) return; const dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
  });
  $("#m-close").onclick = closeModal;
  $("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
  window.addEventListener("resize", () => { const s = V.single; layoutMode(); if (s !== V.single && V.book) { const first = viewPages().find(Boolean) || 1; goToIndex(first); } else render(); });
  window.addEventListener("online", refreshNet);
  window.addEventListener("offline", refreshNet);
  $("#in-folder").onchange = e => {
    if (!e.target.files.length) return;
    loadFolder(e.target.files).catch(err => { $("#open-msg").textContent = err.message; });
    e.target.value = "";
  };
  /* 설정 */
  $("#btn-settings").onclick = () => {
    $("#s-embedded").checked = !!settings.alwaysEmbedded;
    const dev = A.dev.read();
    $("#s-dev").hidden = A.mode !== "dev";
    $("#s-login").checked = !!dev.loggedIn; $("#s-net").value = dev.network;
    $("#settings").hidden = false;
  };
  $("#s-close").onclick = () => { $("#settings").hidden = true; };
  $("#settings").addEventListener("click", e => { if (e.target.id === "settings") $("#settings").hidden = true; });
  $("#s-embedded").onchange = e => { settings.alwaysEmbedded = e.target.checked; saveSettings(); showNet(); };
  $("#s-login").onchange = e => { A.dev.write({ loggedIn: e.target.checked }); refreshNet(); };
  $("#s-net").onchange = e => { A.dev.write({ network: e.target.value }); V.net = null; showNet(); refreshNet(); };
}

function init() {
  bind();
  const q = new URLSearchParams(location.search).get("book");
  if (listenPreview()) { $("#open").hidden = true; $("#book-title").textContent = "생성기에서 불러오는 중…"; return; }
  if (q) { loadUrl(q).catch(err => { $("#open").hidden = false; $("#open-msg").textContent = "불러오지 못했습니다: " + err.message; }); return; }
  $("#open").hidden = false;
}
document.addEventListener("DOMContentLoaded", init);
window.__viewer = { V, resolveAsset, buttonsOf, goToIndex, netState, settings };
})();
