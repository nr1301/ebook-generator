/* =========================================================================
   WBS 5.0 — 수동 배치 시간 재기
   발표 3부 "수동 N분 → AI 10분"의 N(기준선)을 만든다. AI가 붙은 뒤에는 이 숫자를 만들 기회가 없다.

   - 저작기의 편집 신호(__ebookCore.onEdit)만 구독한다. 이 파일과 index.html 의 <script> 두 줄을 지우면
     깨끗이 사라진다 (AI 모듈과 같은 분리 원칙)
   - 실제 작업 시간 = 편집과 편집 사이 간격의 합. 단 한 간격은 최대 60초까지만 센다(손 놓고 쉰 시간 제외).
     일시정지 중은 아예 안 센다. 경과 시간(벽시계)도 같이 남긴다
   - 쪽별 시간 = 각 간격을 그 편집이 일어난 쪽(선택한 버튼의 쪽, 없으면 보고 있던 펼침의 왼쪽)에 귀속
   - 정답지(measure-key.*.js)가 있으면 쪽마다 "놓아야 할 버튼"과 비교해 종류 일치·자리 근접을 채점
   ========================================================================= */
(function () {
"use strict";

const IDLE_CAP = 60 * 1000;       // 이보다 긴 간격은 60초로 자른다
const NEAR = 0.08;                // 중심 거리 8% 이내면 "자리 맞음"

let M = null;                     // 진행 중인 측정
const C = () => window.__ebookCore;
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => C().escapeHtml(s == null ? "" : String(s));
const keys = () => window.MEASURE_KEYS || [];
const fmt = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, "0")}초`; };
const clock = ms => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

/* ---------------------------------------------------------------- 쪽 번호 ↔ 지면 */
const offset = () => C().S.book.pageNumbering.offset;
const idxOf = printed => printed - offset();
const printedOf = idx => idx + offset();
function objectsIn(from, to) {
  const S = C().S, out = [];
  for (let p = from; p <= to; p++) {
    const pg = S.pages[idxOf(p)];
    if (pg) pg.objects.forEach(o => out.push({ printed: p, o }));
  }
  return out;
}
function currentPrinted() {
  const S = C().S, core = C();
  let idx = S.selId ? core.findPageOf(S.selId) : null;
  if (idx == null) { const [L, R] = core.spreadPages(); idx = L || R; }
  return idx == null ? null : printedOf(idx);
}

/* ---------------------------------------------------------------- 시작 화면 */
function openStart() {
  if (M) return;
  const core = C(), S = core.S;
  const k = keys().find(k => k.profileId === S.book.profileId) || keys()[0] || null;
  const first = printedOf(1), last = printedOf(S.book.pageCount);
  let from = k ? k.defaultRange[0] : first, to = k ? k.defaultRange[1] : Math.min(last, first + 7);
  if (from < first || to > last) { from = first; to = Math.min(last, first + 7); }
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `
    <div class="modal ms">
      <h3>수동 배치 시간 재기</h3>
      <p>AI 비교의 기준선이 되는 숫자입니다. 평소 하던 대로 버튼을 놓고 자료를 연결하세요.</p>
      <div class="ms-row"><label>잴 범위</label>
        <input type="number" id="ms-from" value="${from}" min="${first}" max="${last}"> ~
        <input type="number" id="ms-to" value="${to}" min="${first}" max="${last}"> 쪽
        <span class="muted" id="ms-have"></span></div>
      <div class="ms-row"><label>정답지</label>
        <select id="ms-key"><option value="">없음 (시간만 잼)</option>
          ${keys().map((x, i) => `<option value="${i}" ${x === k ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
      <ul class="ms-rules">
        <li>정답지 화면(엠티처 e-book)을 옆 창에 띄워 두고 <b>같은 버튼을 비슷한 자리에</b> 놓습니다${k && k.viewer ? ` — <a href="${esc(k.viewer)}" target="_blank" rel="noopener">엠티처 과학2 열기</a>` : ""}</li>
        <li>CMS 코드는 넣지 않습니다 (AI 쪽도 넣지 않으므로 똑같이 뺍니다)</li>
        <li>자리를 다듬느라 오래 끌지 말고, <b>평소 배포할 수준</b>까지만 합니다</li>
        <li>자리를 비울 땐 「일시정지」. 깜빡해도 1분 넘게 손을 놓으면 그 시간은 빼고 셉니다</li>
      </ul>
      <div class="foot"><button class="t" data-x>취소</button><button class="t primary" data-go>시작</button></div>
    </div>`;
  document.getElementById("modal-root").appendChild(back);
  const upd = () => {
    const f = +$("#ms-from", back).value, t = +$("#ms-to", back).value;
    const n = f && t ? objectsIn(f, t).length : 0;
    $("#ms-have", back).innerHTML = n ? `<span class="warn">이 범위에 이미 버튼 ${n}개 — 빈 상태에서 재야 정확합니다</span>` : "";
  };
  $("#ms-from", back).oninput = upd; $("#ms-to", back).oninput = upd; upd();
  $("[data-x]", back).onclick = () => back.remove();
  $("[data-go]", back).onclick = () => {
    const f = +$("#ms-from", back).value, t = +$("#ms-to", back).value;
    if (!(f <= t)) { core.toast("쪽 범위를 확인하세요", true); return; }
    const kv = $("#ms-key", back).value;
    back.remove();
    start(f, t, kv === "" ? null : keys()[+kv]);
  };
}

/* ---------------------------------------------------------------- 진행 */
function start(from, to, key) {
  const now = Date.now();
  M = {
    from, to, key, startedAt: new Date(now).toISOString(),
    t0: now, last: now, active: 0, paused: false, pauseAt: 0, pausedTotal: 0,
    perPage: {}, counts: {}, events: [],
    preexisting: objectsIn(from, to).length
  };
  const S = C().S;
  const [L] = C().spreadPages();
  const target = idxOf(from);
  if (S.pages[target] && L !== target) { /* 범위 첫 쪽으로 이동 */
    const core = C(); core.goToPage(target); core.renderAll();
  }
  chip();
  M.tick = setInterval(chip, 1000);
  C().setStatus(`시간 재기 시작 — ${from}–${to}쪽`, "ok");
}
function onEdit(label) {
  if (!M || M.paused) return;
  const now = Date.now();
  const gap = Math.min(now - M.last, IDLE_CAP);
  const p = currentPrinted();
  M.active += gap;
  const key = p != null && p >= M.from && p <= M.to ? p : "범위 밖";
  M.perPage[key] = (M.perPage[key] || 0) + gap;
  M.counts[label] = (M.counts[label] || 0) + 1;
  M.events.push({ t: now - M.t0, label, page: p, gap });
  M.last = now;
  chip();
}
function togglePause() {
  if (!M) return;
  const now = Date.now();
  if (!M.paused) { M.paused = true; M.pauseAt = now; }
  else { M.paused = false; M.pausedTotal += now - M.pauseAt; M.last = now; }
  chip();
}
function liveActive() {
  if (!M) return 0;
  return M.active + (M.paused ? 0 : Math.min(Date.now() - M.last, IDLE_CAP));
}
function chip() {
  let el = document.getElementById("ms-chip");
  if (!M) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "ms-chip";
    el.innerHTML = `<span class="dot"></span><b data-c></b><span data-n></span>
      <button class="t sm" data-p></button><button class="t sm primary" data-e>끝내기</button>`;
    document.body.appendChild(el);
    $("[data-p]", el).onclick = togglePause;
    $("[data-e]", el).onclick = finish;
  }
  const placed = objectsIn(M.from, M.to).length - M.preexisting;
  const need = M.key ? expectedCount(M.key, M.from, M.to) : null;
  el.classList.toggle("paused", M.paused);
  $("[data-c]", el).textContent = clock(liveActive());
  $("[data-n]", el).textContent = ` · 버튼 ${placed}${need != null ? " / " + need : ""} · ${M.from}–${M.to}쪽${M.paused ? " · 일시정지" : ""}`;
  $("[data-p]", el).textContent = M.paused ? "계속" : "일시정지";
}

/* ---------------------------------------------------------------- 채점 */
function expectedCount(key, from, to) {
  let n = 0;
  for (let p = from; p <= to; p++) n += (key.pages[p] || []).length;
  return n;
}
function grade(key, from, to) {
  const rows = [];
  for (let p = from; p <= to; p++) {
    const exp = (key.pages[p] || []).map(e => Object.assign({ used: false }, e));
    const got = objectsIn(p, p).map(x => x.o);
    let typeOk = 0, posOk = 0;
    const core = C();
    got.forEach(o => {
      const cands = exp.filter(e => !e.used && (key.accept[e.label] || []).includes(o.buttonId));
      if (!cands.length) return;
      // 가장 가까운 정답과 짝짓기
      const sz = o.size || {};
      const w = sz.w != null ? sz.w : 0.18, h = sz.h || 0.028;
      const cx = o.at.x + w / 2, cy = o.at.y + h / 2;
      let best = null, bd = 9;
      cands.forEach(e => { const d = Math.hypot(cx - (e.x + e.w / 2), cy - (e.y + e.h / 2)); if (d < bd) { bd = d; best = e; } });
      best.used = true; typeOk++; if (bd <= NEAR) posOk++;
    });
    const missing = exp.filter(e => !e.used).map(e => e.label);
    rows.push({ printed: p, expected: exp.length, placed: got.length, typeOk, posOk, missing,
      linked: got.filter(o => o.asset).length });
  }
  return rows;
}

/* ---------------------------------------------------------------- 끝내기 → 결과 */
function finish() {
  if (!M) return;
  if (M.paused) togglePause();
  onEdit("끝내기");                                  // 마지막 편집 → 끝내기 사이 간격도 그 쪽에 귀속
  const now = Date.now();
  delete M.counts["끝내기"];
  clearInterval(M.tick);
  const r = M; M = null; chip();
  const core = C(), S = core.S;
  const objs = objectsIn(r.from, r.to);
  const placed = objs.length - r.preexisting;
  const linked = objs.filter(x => x.o.asset).length;
  const pages = r.to - r.from + 1;
  const g = r.key ? grade(r.key, r.from, r.to) : null;
  const need = r.key ? expectedCount(r.key, r.from, r.to) : null;
  const typeOk = g ? g.reduce((a, x) => a + x.typeOk, 0) : null;
  const posOk = g ? g.reduce((a, x) => a + x.posOk, 0) : null;
  const perBtn = placed ? r.active / placed : 0;
  const lessons = r.key && r.key.lessons ? r.key.lessons.filter(l => l.from >= r.from && l.to <= r.to).map(l => {
    let ms = 0; for (let p = l.from; p <= l.to; p++) ms += r.perPage[p] || 0;
    return { label: `${l.label} (${l.from}–${l.to}쪽)`, ms, n: objectsIn(l.from, l.to).length };
  }) : [];
  const unitBtns = r.key ? Object.values(r.key.pages).reduce((a, v) => a + v.length, 0) : null;
  const unitPages = r.key ? 40 : null;
  const result = {
    kind: "ebook-manual-placement-measure", version: 1,
    book: S.book.title, profile: S.book.profileId, range: [r.from, r.to], key: r.key ? r.key.id : null,
    startedAt: r.startedAt, endedAt: new Date(now).toISOString(),
    activeMs: r.active, wallMs: now - r.t0, pausedMs: r.pausedTotal,
    placed, linked, expected: need, typeOk, posOk,
    perButtonMs: Math.round(perBtn), perPageMs: Math.round(r.active / pages),
    perPage: r.perPage, lessons, counts: r.counts, grade: g, events: r.events
  };
  showReport(result, { pages, unitBtns, unitPages });
}

function showReport(R, x) {
  const core = C();
  /* 한 차시당 = 버튼을 하나라도 놓은 차시만 평균 (손대지 않은 차시 0초가 평균을 끌어내리지 않게) */
  const done = R.lessons.filter(l => l.n > 0);
  const perLesson = done.length ? done.reduce((a, l) => a + l.ms, 0) / done.length : R.activeMs / Math.max(1, x.pages / 4);
  const unitMs = x.unitBtns ? R.perButtonMs * x.unitBtns : null;
  const bookMs = x.unitBtns ? R.perButtonMs * x.unitBtns / x.unitPages * 250 : null;
  const pct = (a, b) => b ? Math.round(a / b * 100) + "%" : "—";
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `
    <div class="modal ms wide">
      <h3>수동 배치 측정 결과 · ${R.range[0]}–${R.range[1]}쪽</h3>
      <div class="ms-big">
        <div><b>${fmt(R.activeMs)}</b><span>실제 작업 시간</span></div>
        <div><b>${R.placed}개</b><span>놓은 버튼${R.expected != null ? ` / 정답 ${R.expected}` : ""}</span></div>
        <div><b>${Math.round(R.perButtonMs / 1000)}초</b><span>버튼 하나당</span></div>
        <div><b>${fmt(perLesson)}</b><span>한 차시(4쪽)당${done.length && done.length < R.lessons.length ? ` · ${done.length}개 차시 기준` : ""}</span></div>
      </div>
      <p class="muted">경과 ${fmt(R.wallMs)} · 일시정지 ${fmt(R.pausedMs)} · 1분 넘게 손 놓은 시간 ${fmt(Math.max(0, R.wallMs - R.pausedMs - R.activeMs))}은 뺐습니다 · 자료 연결 ${R.linked}개</p>
      ${R.lessons.length ? `<table class="ms-t"><tr><th>차시</th><th>시간</th><th>버튼</th></tr>
        ${R.lessons.map(l => `<tr><td>${esc(l.label)}</td><td>${fmt(l.ms)}</td><td>${l.n}개</td></tr>`).join("")}</table>` : ""}
      ${R.grade ? `<h4>정답지와 비교 — 종류 일치 ${R.typeOk}/${R.expected} (${pct(R.typeOk, R.expected)}) · 자리 근접 ${R.posOk}/${R.expected} (${pct(R.posOk, R.expected)})</h4>
        <table class="ms-t"><tr><th>쪽</th><th>시간</th><th>정답</th><th>놓음</th><th>종류 일치</th><th>빠진 것</th></tr>
        ${R.grade.map(g => `<tr><td>${g.printed}</td><td>${fmt(R.perPage[g.printed] || 0)}</td><td>${g.expected}</td><td>${g.placed}</td><td>${g.typeOk}</td><td class="muted">${esc(g.missing.join(", ")) || "—"}</td></tr>`).join("")}</table>` : ""}
      ${unitMs ? `<h4>환산 (버튼 하나당 시간 × 버튼 수)</h4>
        <div class="ms-big sm">
          <div><b>${(unitMs / 3600000).toFixed(1)}시간</b><span>1단원 ${x.unitPages}쪽 · 버튼 ${x.unitBtns}개</span></div>
          <div><b>${(bookMs / 3600000).toFixed(0)}시간</b><span>한 권 250쪽 추정</span></div>
        </div>` : ""}
      <p class="muted">조작: ${Object.entries(R.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${v}`).join(" · ") || "—"}</p>
      <div class="foot"><button class="t" data-dl>기록 파일 받기</button><button class="t primary" data-x>닫기</button></div>
    </div>`;
  document.getElementById("modal-root").appendChild(back);
  $("[data-x]", back).onclick = () => back.remove();
  $("[data-dl]", back).onclick = () => {
    const d = new Date(R.endedAt);
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(R, null, 2)], { type: "application/json" }));
    a.download = `측정기록_${R.range[0]}-${R.range[1]}쪽_${stamp}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  };
  window.__lastMeasure = R;
  core.setStatus(`측정 끝 — ${fmt(R.activeMs)} · 버튼 ${R.placed}개`, "ok");
}

/* ---------------------------------------------------------------- 배선 */
function mount() {
  const core = C(); if (!core || !core.onEdit) return;
  core.onEdit(onEdit);
  const b = document.createElement("button");
  b.className = "t"; b.id = "btn-measure"; b.textContent = "⏱ 시간 재기";
  b.title = "수동 배치 시간을 잽니다 (WBS 5.0)";
  b.onclick = openStart;
  /* v0.8 — 작업자 툴바에서는 빼고 「더보기」 안에 둔다 */
  const menu = document.getElementById("more-menu");
  if (menu) { menu.appendChild(b); return; }
  const redo = document.getElementById("btn-redo");
  redo.insertAdjacentElement("afterend", b);
  redo.insertAdjacentHTML("afterend", `<span class="sep"></span>`);
}
document.addEventListener("DOMContentLoaded", mount);
window.EbookMeasure = { start, finish, togglePause, _grade: grade, get running() { return M; } };
})();
