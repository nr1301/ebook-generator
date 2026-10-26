/* =========================================================================
   v0.9 「자료 폴더로 초안 만들기」 — 쪽번호 없는 파일의 쪽 찾기 (옵션 모듈)

   초안 만들기에서 이름 앞에 쪽번호가 없는 파일만 여기로 온다.
   내용·그림으로 쪽과 종류를 추정 → 애매한 것만 사람에게 보여 주고 → 규칙 이름을 붙여 돌려준다.
   돌려받은 저작기는 규칙 이름 파일과 똑같이 배치한다 (자산에는 원래 이름을 sourceName 으로 남긴다).

   - 이 파일과 index.html 의 <script> 다섯 줄(guess-read·guess-match·guess·guess-run·draft-guess)을
     지우면 깨끗이 사라지고, 초안 만들기는 쪽번호 있는 파일만 붙이는 v0.8 동작으로 돌아간다
   - vendor/opencv.js(10.8MB)는 그림·영상이 있을 때만 그때 읽는다
   - 지면 그림 준비(가장 느린 단계, guess-match.js 가 기억)와 파일별 읽기·대조 결과는 창을 닫을 때까지 기억 → 두 번째부터 빠르다
   ========================================================================= */
(function () {
"use strict";
const C = () => window.__ebookCore;
const G = () => window.EbookGuess;
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => C().escapeHtml(s == null ? "" : String(s));
const IMG = /^(jpg|jpeg|png|gif|webp|bmp)$/i, VID = /^(mp4|webm|mov|m4v)$/i;
const extOf = n => (String(n).match(/\.([^.]+)$/) || ["", ""])[1].toLowerCase();

const memo = {};                      // name|size|mtime → { content, match, matchErr }
const fkey = f => `${f.name}|${f.size}|${f.lastModified}`;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[data-lazy="${src}"]`)) return res();
    const s = document.createElement("script");
    s.src = src; s.dataset.lazy = src;
    s.onload = () => res(); s.onerror = () => rej(new Error(src + " 를 읽지 못했어요"));
    document.head.appendChild(s);
  });
}

async function bookPages() {
  const S = C().S, off = S.book.pageNumbering.offset, out = [];
  for (const k of Object.keys(S.pages).map(Number).sort((a, b) => a - b)) {
    let w = S.pageText[k] || [];
    if (w && !Array.isArray(w)) { try { w = JSON.parse(await w.text()).words || []; } catch (_) { w = []; } S.pageText[k] = w; }
    out.push({ printed: k + off, image: S.bgFiles[k] || null, words: w });
  }
  return out;
}

/* ---------------------------------------------------------------- 진행 창 */
function progressModal(n) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `
    <div class="modal gs-prog">
      <h3>쪽번호 없는 자료 ${n}개 — 쪽을 찾는 중</h3>
      <p>파일 내용과 그림을 교과서 지면과 맞춰 봐요. 그림·영상이 많으면 몇 분 걸려요.<br>두 번째부터는 지면 준비를 건너뛰어서 빨라요.</p>
      <div class="gs-bar"><i></i></div>
      <div class="gs-msg muted">준비 중…</div>
      <div class="foot"><button class="t" data-stop>그만두고 지금까지 찾은 것 보기</button></div>
    </div>`;
  $("#modal-root").appendChild(back);
  const st = { stop: false };
  $("[data-stop]", back).onclick = () => { st.stop = true; $("[data-stop]", back).disabled = true; $(".gs-msg", back).textContent = "멈추는 중…"; };
  return {
    st,
    set(frac, msg) { $(".gs-bar i", back).style.width = Math.round(frac * 100) + "%"; if (!st.stop) $(".gs-msg", back).textContent = msg; },
    close() { back.remove(); }
  };
}

/* ---------------------------------------------------------------- 확인 창 */
const must = r => r.page == null;
const check = r => r.page != null && r.conf !== "high" && !r.touched;
function review(rows, pages, info) {
  return new Promise(resolve => {
    const urls = [];
    const back = document.createElement("div");
    back.className = "modal-back";
    const K = G().KINDS;
    const pageOpts = sel => `<option value="">— 빼기</option>` + pages.map(p => `<option value="${p.printed}"${p.printed === sel ? " selected" : ""}>${p.printed}쪽</option>`).join("");
    const kindOpts = sel => Object.entries(K).map(([k, [, l]]) => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(l)}</option>`).join("");
    const CONF = { high: "확실함", mid: "봐 주세요", low: "봐 주세요" };
    let showAll = false, openLinks = false;
    const isLink = r => r.kind === "smart-ppt" && must(r) && !r.touched;
    const urlKey = r => { const m = (r.content && r.content.text || "").match(/classSeq=(\d+)[^]*?detailSeq=(\d*)/); return m ? +m[1] * 1e6 + (+m[2] || 0) : 0; };
    back.innerHTML = `
      <div class="modal gs">
        <h3>쪽을 찾았어요 — 애매한 것만 봐 주세요</h3>
        <p class="gs-sum"></p>
        <label class="gs-all"><input type="checkbox"> 확실한 것도 보기</label>
        <div class="gs-tbl"><table><thead><tr><th></th><th>파일</th><th>쪽</th><th>후보</th><th>종류</th><th>근거</th></tr></thead><tbody></tbody></table></div>
        <p class="muted gs-note"></p>
        <div class="foot"><button class="t" data-cancel>취소</button><button class="t primary" data-ok>이대로 초안 만들기</button></div>
      </div>`;
    const tb = $("tbody", back);
    function thumb(r) {
      const e = extOf(r.name);
      if (IMG.test(e)) { if (!r.url) { r.url = URL.createObjectURL(r.file); urls.push(r.url); } return `<img src="${r.url}" alt="">`; }
      return `<span class="gs-ext">${esc(VID.test(e) ? "영상" : e || "?")}</span>`;
    }
    function draw() {
      const nm = rows.filter(must).length, nc = rows.filter(check).length, nh = rows.length - nm - nc;
      $(".gs-sum", back).innerHTML = `<b>${rows.length}개</b> 중 확실함 <b>${nh}</b> · 봐 주세요 <b class="w">${nc}</b> · 쪽을 정해 주세요 <b class="b">${nm}</b>`;
      /* 순서: 쪽을 정해야 하는 것(링크 제외) → 봐 주세요 → (확실함) → 링크 묶음(접힘, 차시 순) */
      const rank = r => must(r) ? 0 : check(r) ? 1 : 2;
      const list = rows.filter(r => !isLink(r) && (showAll || must(r) || check(r) || r.touched))
        .sort((a, b) => (rank(a) - rank(b)) || ((a.page ?? 9999) - (b.page ?? 9999)) || a.name.localeCompare(b.name, "ko", { numeric: true }));
      const links = rows.filter(isLink).sort((a, b) => urlKey(a) - urlKey(b));
      const rowHtml = r => {
        const i = rows.indexOf(r);
        const cands = (r.cands || []).length > 1 ? r.cands.map(c => `<button data-i="${i}" data-p="${c}" class="${c === r.page ? "on" : ""}">${c}</button>`).join("") : "";
        const pill = r.touched ? `<span class="gs-pill done">고름</span>` : must(r) ? `<span class="gs-pill b">정해 주세요</span>` : `<span class="gs-pill ${r.conf === "high" ? "ok" : "w"}">${CONF[r.conf] || ""}</span>`;
        return `<tr class="${must(r) ? "need" : ""}"><td class="th">${thumb(r)}</td><td class="f" title="${esc(r.name)}">${esc(r.name)}<br>${pill}</td>
          <td><select data-i="${i}" data-k="page" aria-label="${esc(r.name)} 쪽">${pageOpts(r.page)}</select></td>
          <td class="cands">${cands}</td>
          <td><select data-i="${i}" data-k="kind" aria-label="${esc(r.name)} 종류">${kindOpts(r.kind)}</select></td>
          <td class="why">${esc(r.why)}</td></tr>`;
      };
      const grp = links.length ? `<tr class="gs-grp"><td colspan="6"><button class="t sm" data-links>${openLinks ? "▾" : "▸"} 스마트 PPT 링크 ${links.length}개</button>
        <span class="muted">주소만 있어서 쪽을 알 수 없어요. 그대로 두면 빼고 만들어요. 쪽을 넣으려면 펼치세요 (차시 순서대로 정렬).</span></td></tr>` : "";
      tb.innerHTML = (list.length ? list.map(rowHtml).join("") : (links.length ? "" : `<tr><td colspan="6" class="muted gs-empty">다 확실해요. 「이대로 초안 만들기」를 누르세요.</td></tr>`))
        + grp + (openLinks ? links.map(rowHtml).join("") : "");
      $(".gs-note", back).innerHTML = [
        nm ? `쪽을 정하지 않은 ${nm}개는 빼고 만들어요. 나중에 지면 위로 끌어다 놓아도 돼요.` : "",
        info.matchError ? `그림 대조를 못 했어요 (${esc(info.matchError)}) — 그림은 글자 단서로만 찾았어요.` : "",
        info.stopped ? "중간에 멈춰서 일부는 덜 찾았어요." : "",
        `걸린 시간 ${info.sec}초`
      ].filter(Boolean).join(" ");
    }
    tb.addEventListener("change", e => {
      const el = e.target, r = rows[+el.dataset.i]; if (!r) return;
      if (el.dataset.k === "page") r.page = el.value ? +el.value : null; else r.kind = el.value;
      r.touched = true; draw();
    });
    tb.addEventListener("click", e => {
      if (e.target.closest("[data-links]")) { openLinks = !openLinks; draw(); return; }
      const b = e.target.closest("button[data-p]"); if (!b) return;
      const r = rows[+b.dataset.i]; r.page = +b.dataset.p; r.touched = true; draw();
    });
    $(".gs-all input", back).onchange = e => { showAll = e.target.checked; draw(); };
    const done = v => { urls.forEach(u => URL.revokeObjectURL(u)); back.remove(); resolve(v); };
    $("[data-cancel]", back).onclick = () => done(null);
    $("[data-ok]", back).onclick = () => done(rows);
    $("#modal-root").appendChild(back);
    draw();
    $("[data-ok]", back).focus();
  });
}

/* ---------------------------------------------------------------- 진입점
   files: 쪽번호 없는 File[] → [{ file, name: 규칙 이름 | null }] (취소면 null) */
async function run(files) {
  const pages = await bookPages();
  const rows = files.map(f => Object.assign({ file: f, name: f.name, page: null, kind: null, conf: "low", why: "", cands: [] }, memo[fkey(f)] || {}));
  const pm = progressModal(files.length);
  let info;
  try {
    if (rows.some(r => IMG.test(extOf(r.name)) || VID.test(extOf(r.name))) && !window.cv) {
      pm.set(0.02, "그림 대조 도구 읽는 중…");
      try { await loadScript("vendor/opencv.js"); } catch (e) { /* 그림 대조 없이 계속 — 결과 창에 알림 */ }
    }
    info = await window.EbookGuessRun.run(pages, rows, {
      onProgress: (f, m) => pm.set(f, m),
      onUpdate: res => rows.forEach(r => { const e = res[r.name]; if (e) Object.assign(r, { kind: e.kind, page: e.page, conf: e.conf, why: e.why, cands: e.cands }); }),
      stopped: () => pm.st.stop,
      keepPrep: true,
      prep: (withImg, onP) => window.EbookGuessMatch.preparePagesCached(withImg, onP)
    });
  } catch (e) {
    info = { sec: 0, stopped: true, matchError: e.message || String(e) };
  } finally { pm.close(); }
  rows.forEach(r => { if (r.content) memo[fkey(r.file)] = { content: r.content, match: r.match, matchErr: r.matchErr }; });

  const got = await review(rows, pages, info);
  if (!got) return null;
  const names = G().ruleNames(got.filter(r => r.page != null && r.kind).map(r => ({ name: r.name, page: r.page, kind: r.kind })));
  /* 그림이 그 쪽에서 찾아졌으면 지면 위 자리(box)도 넘긴다 — 자리 잡기(auto-place.js)가 다시 대조하지 않게 */
  const boxOf = r => { const m = (r.match || []).find(x => x.printed === r.page && x.box); return m ? m.box : null; };
  return got.map(r => ({ file: r.file, name: names[r.name] || null, box: boxOf(r) }));
}

window.EbookDraftGuess = { run, _memo: memo };
})();
