/* 자료 이름 찾기 — 화면
 * 지면 폴더 + 자료 폴더 → 파일마다 쪽·종류 추정 → 애매한 것만 고르기 → 규칙 이름으로 복사 저장
 * 추정은 guess.js, 내용 읽기는 guess-read.js, 그림 대조는 guess-match.js, 순서는 guess-run.js
 */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const G = EbookGuess;
  const RULE = /^(\d{1,4})_([A-Z]{2})_(.+?)(?:_@(\d+))?\.[^.]+$/;   // 이미 규칙 이름인 파일
  const SKIP = /^(Thumbs\.db|desktop\.ini|\.DS_Store)$|^~\$/i;
  const S = { pageFiles: null, pages: null, offset: null, docs: [], rows: [], filter: "must", busy: false };

  const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 3200); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const tick = () => new Promise(r => setTimeout(r, 0));

  /* ---------- ① 지면 폴더 ---------- */
  function pageNumber(words) {   // 저작기 마법사와 같은 조건: 위·아래 띠, 좌우 끝, 작은 숫자
    const c = (words || []).filter(w => /^\d{1,3}$/.test(w.t) && w.b[3] < 0.04 && (w.b[1] > 0.88 || w.b[1] + w.b[3] < 0.06) && (w.b[0] < 0.2 || w.b[0] + w.b[2] > 0.8));
    c.sort((a, b) => b.b[1] - a.b[1]); return c.length ? +c[0].t : null;
  }
  $("#in-pages").addEventListener("change", async e => {
    const files = Array.from(e.target.files || []), by = {};
    files.forEach(f => by[(f.webkitRelativePath || f.name).split("/").slice(1).join("/")] = f);
    const mi = by["master-index.json"];
    if (!mi) { $("#pages-val").innerHTML = `<span class="val warn">master-index.json 이 없어요. 교과서 PDF로 만든 「…_지면」 폴더를 골라 주세요.</span>`; return; }
    const idx = JSON.parse(await mi.text()), pages = [];
    for (const [k, v] of Object.entries(idx.pages)) {
      const img = by[`master/${v.hash}.webp`], tx = by[`text/${k}.json`];
      pages.push({ index: +k + 1, image: img, words: tx ? JSON.parse(await tx.text()).words : [] });
    }
    pages.sort((a, b) => a.index - b.index);
    const votes = {}; pages.forEach(p => { const n = pageNumber(p.words); if (n != null) votes[n - p.index] = (votes[n - p.index] || 0) + 1; });
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    S.offset = best ? +best[0] : 0; S.pages = pages;
    $("#in-first").value = 1 + S.offset; $("#first-row").hidden = false;
    const name = (files[0] && (files[0].webkitRelativePath || "").split("/")[0]) || "지면";
    $("#pages-val").innerHTML = `<span class="val ok">${esc(name)} · ${pages.length}장</span>` + (best ? ` <span class="muted">(꼬리말에서 쪽번호를 읽었어요)</span>` : ` <span class="val warn">꼬리말에서 쪽번호를 못 읽었어요. 첫 지면의 쪽번호를 넣어 주세요.</span>`);
    ready();
  });
  $("#in-first").addEventListener("change", () => { const v = parseInt($("#in-first").value, 10); if (v > 0) S.offset = v - 1; });

  /* ---------- ② 자료 폴더 ---------- */
  $("#in-docs").addEventListener("change", e => {
    S.docs = Array.from(e.target.files || []).filter(f => !SKIP.test(f.name));
    const ruled = S.docs.filter(f => RULE.test(f.name)).length;
    $("#docs-val").innerHTML = `<span class="val ok">자료 ${S.docs.length}개</span>` + (ruled ? ` <span class="muted">(그중 ${ruled}개는 이미 규칙 이름 — 그대로 둡니다)</span>` : "");
    ready();
  });
  function ready() { $("#btn-run").disabled = !(S.pages && S.docs.length) || S.busy; }

  /* ---------- ③ 찾기 ---------- */
  const progress = (frac, msg) => { $("#bar").style.width = Math.round(frac * 100) + "%"; $("#run-val").textContent = msg; };
  $("#btn-run").addEventListener("click", run);
  async function run() {
    S.busy = true; ready(); const t0 = performance.now();
    const off = S.offset, pages = S.pages.map(p => ({ printed: p.index + off, image: p.image, words: p.words }));
    S.rows = S.docs.map(f => {
      const m = f.name.match(RULE);
      return { file: f, name: f.name, content: null, est: null, ruled: !!m, page: m ? +m[1] : null, kind: null, conf: m ? "rule" : "wait", why: m ? "이미 규칙 이름" : "찾는 중…", cands: [] };
    });
    $("#res").hidden = false; draw();
    const todo = S.rows.filter(r => !r.ruled);
    const out = await EbookGuessRun.run(pages, todo, { onProgress: progress, onUpdate: (res, first) => { apply(res, first); draw(); } });
    if (out.matchError) toast("그림 대조를 하지 못했어요: " + out.matchError);
    const sec = out.sec;
    S.busy = false; ready(); $("#btn-save").disabled = false;
    const links = S.rows.filter(r => r.kind === "smart-ppt" && r.page == null).length;
    $("#res-note").textContent = links ? `스마트 PPT 링크 ${links}개는 주소만 있어서 쪽을 알 수 없어요. 차시 순서대로 정렬해 두었으니 쪽만 넣어 주세요.` : "";
    window.__finder = { rows: S.rows.map(r => ({ name: r.name, page: r.page, kind: r.kind, conf: r.conf, why: r.why })), sec };
  }
  // 추정 결과를 행에 반영 — 사람이 고친 값은 덮지 않는다
  function apply(res, first) {
    for (const r of S.rows) {
      if (r.ruled || r.touched) continue; const e = res[r.name]; if (!e) continue;
      const isVis = /^(jpg|jpeg|png|gif|webp|bmp|mp4|webm|mov|m4v)$/.test(r.content.ext);
      if (first && isVis && !r.match) { r.kind = e.kind; r.conf = "wait"; r.why = "그림 대조 차례를 기다리는 중"; continue; }
      Object.assign(r, { kind: e.kind, page: e.page, conf: e.conf, why: e.why, cands: e.cands });
    }
  }

  /* ---------- 표 ---------- */
  const must = r => !r.ruled && !r.touched && r.page == null;                 // 쪽을 정해야 함
  const check = r => !r.ruled && !r.touched && r.page != null && r.conf !== "high";   // 맞는지 봐 주세요
  const needs = r => must(r) || check(r);
  function pageOptions(sel) {
    const off = S.offset, opts = ['<option value="">—</option>'];
    for (const p of S.pages) { const n = p.index + off; opts.push(`<option value="${n}"${n === sel ? " selected" : ""}>${n}쪽</option>`); }
    return opts.join("");
  }
  const kindOptions = sel => Object.entries(G.KINDS).map(([k, [, l]]) => `<option value="${k}"${k === sel ? " selected" : ""}>${l}</option>`).join("");
  const CONF = { high: "높음", mid: "중간", low: "낮음", rule: "규칙 이름", wait: "찾는 중", done: "고름" };
  function urlKey(r) { const m = (r.content && r.content.text || "").match(/classSeq=(\d+)[^]*?detailSeq=(\d*)/); return m ? +m[1] * 1e6 + (+m[2] || 0) : 0; }
  function draw() {
    const all = S.rows;
    $("#n-must").textContent = all.filter(must).length; $("#n-check").textContent = all.filter(check).length;
    $("#n-ok").textContent = all.filter(r => !needs(r)).length; $("#n-all").textContent = all.length;
    let rs = S.filter === "must" ? all.filter(must) : S.filter === "check" ? all.filter(check) : S.filter === "ok" ? all.filter(r => !needs(r)) : all;
    rs = rs.slice().sort((a, b) => (a.kind === "smart-ppt" && b.kind === "smart-ppt") ? urlKey(a) - urlKey(b) : (a.page ?? 9999) - (b.page ?? 9999) || a.name.localeCompare(b.name, "ko", { numeric: true }));
    const names = newNames();
    $("#rows").innerHTML = rs.map(r => {
      const i = S.rows.indexOf(r), conf = r.touched ? "done" : r.conf;
      const cands = (r.cands || []).length > 1 ? `<div class="cands">${r.cands.map(c => `<button data-i="${i}" data-p="${c}" class="${c === r.page ? "on" : ""}" aria-label="${c}쪽으로">${c}</button>`).join("")}</div>` : "";
      const pageCell = r.ruled ? `${r.page}쪽` : `<select data-i="${i}" data-k="page" aria-label="${esc(r.name)} 쪽">${pageOptions(r.page)}</select>`;
      const kindCell = r.ruled ? esc(r.name.match(RULE)[3]) : `<select data-i="${i}" data-k="kind" aria-label="${esc(r.name)} 종류">${kindOptions(r.kind)}</select>`;
      return `<tr class="${must(r) ? "need" : ""}"><td class="f" title="${esc(r.name)}">${esc(r.name)}</td><td>${pageCell}</td><td>${cands}</td><td>${kindCell}</td><td><span class="pill ${conf === "done" ? "rule" : conf}">${CONF[conf]}</span></td><td class="why">${esc(r.why)}</td><td class="new">${esc(names[r.name] || (r.ruled ? r.name : "—"))}</td></tr>`;
    }).join("");
  }
  function newNames() {
    const list = S.rows.filter(r => !r.ruled && r.page != null && r.kind).map(r => ({ name: r.name, page: r.page, kind: r.kind }));
    return G.ruleNames(list);
  }
  $("#rows").addEventListener("change", e => {
    const el = e.target, r = S.rows[+el.dataset.i]; if (!r) return;
    if (el.dataset.k === "page") r.page = el.value ? +el.value : null; else r.kind = el.value;
    r.touched = true; draw();
  });
  $("#rows").addEventListener("click", e => {
    const b = e.target.closest("button[data-p]"); if (!b) return;
    const r = S.rows[+b.dataset.i]; r.page = +b.dataset.p; r.touched = true; draw();
  });
  document.querySelectorAll(".chip").forEach(c => c.addEventListener("click", () => {
    S.filter = c.dataset.f; document.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", String(x === c))); draw();
  }));

  /* ---------- 저장 ---------- */
  $("#btn-save").addEventListener("click", async () => {
    const left = S.rows.filter(r => !r.ruled && r.page == null);
    if (typeof window.showDirectoryPicker !== "function") { toast("이 브라우저는 폴더 저장을 지원하지 않아요. 크롬이나 엣지에서 열어 주세요."); return; }
    let dir; try { dir = await window.showDirectoryPicker({ mode: "readwrite" }); } catch (e) { return; }
    const names = newNames(); let n = 0;
    for (const r of S.rows) {
      const to = r.ruled ? r.name : names[r.name]; if (!to) continue;
      const h = await dir.getFileHandle(to, { create: true }), w = await h.createWritable(); await w.write(r.file); await w.close(); n++;
      $("#save-val").textContent = `복사하는 중 ${n}…`;
    }
    $("#save-val").textContent = `${n}개를 새 이름으로 복사했어요` + (left.length ? ` · 쪽을 정하지 않은 ${left.length}개는 뺐어요` : "") + ". 이 폴더로 「자료 폴더로 초안 만들기」를 하면 됩니다.";
  });
})();
