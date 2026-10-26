/* e-book 생성기 — 이름 없는 자료의 쪽·종류 추정
 *
 * 입력: 지면(쪽번호·글자), 자료 내용(guess-read.js), 그림 대조 결과(guess-match.js)
 * 출력: 파일마다 { kind, page, conf: high|mid|low, why, cands:[쪽…] }
 *
 * 단서 (AI 없이 계산만):
 *   ① 자료 속 쪽 표기   「교과서 16쪽」 「교과서 11~15쪽」 「[1단원] 29쪽-1」
 *   ② 지면 그림과 대조   그림·영상 장면
 *   ③ 지면 구조         「학습 목표」 쪽 = 소단원 시작, 「이 단원을 배우면」 = 대단원 도입, 객관식 보기가 몰린 쪽 = 단원 마무리 문제
 *   ④ 지면 글자와 대조   위 셋이 없을 때 (3글자 조각 TF-IDF)
 * 2026-10-18 정보1 1단원 자료 133개(이름 지움)로 맞춘 규칙. 다른 교과에서 다시 재야 한다.
 */
(function (root) {
  "use strict";
  const nz = s => String(s || "").replace(/\s+/g, "");

  // 자료 성격 → 규칙 이름에 쓸 자료코드·이름 (프로파일과 상관없는 일반 이름)
  const KINDS = {
    "textbook-pdf": ["TG", "교과서 PDF"], "guide-pdf": ["TG", "지도서 PDF"], "class-ppt": ["PT", "수업 PPT"],
    "smart-ppt": ["EX", "스마트 PPT"], "concept-note": ["WS", "개념 정리"], "worksheet": ["WS", "학습 활동지"],
    "perf-sheet": ["WS", "수행평가 활동지"], "perf-task": ["WS", "수행평가"], "project-report": ["WS", "프로젝트 보고서"],
    "eval-items": ["AN", "평가 문제"], "item-bank": ["AN", "문제은행"], "animation": ["VD", "애니메이션"],
    "figure": ["IM", "그림 보기"], "entry": ["EX", "엔트리 예제"], "etc": ["", "자료"],
  };
  const IMG = /^(jpg|jpeg|png|gif|webp|bmp)$/, VID = /^(mp4|webm|mov|m4v)$/;

  function kindOf(c) {
    const e = c.ext, t = c.text || "", h = nz(t.slice(0, 400));
    if (IMG.test(e)) return "figure";
    if (VID.test(e)) return "animation";
    if (e === "ent") return "entry";
    if (e === "url") return "smart-ppt";
    if (e === "pptx" || e === "ppt") return "class-ppt";
    if (e === "pdf") {
      if ((c.pages || 0) >= 10) return /지도|핵심아이디어|성취기준/.test(nz(t.slice(0, 3000))) ? "guide-pdf" : "textbook-pdf";
      return "worksheet";
    }
    if (e === "hwp" || e === "hwpx" || e === "docx") {
      if (h.includes("문제은행")) return "item-bank";
      if (h.includes("마무리문제") || h.includes("평가문제")) return "eval-items";
      if (h.includes("개념") && h.includes("정리")) return "concept-note";
      if (h.includes("프로젝트보고서")) return "project-report";
      if (h.includes("수행평가")) return "perf-task";
      if (h.includes("활동지")) return "perf-sheet";
      return "worksheet";
    }
    return "etc";
  }

  /* ---------- 지면 구조 ---------- */
  function structure(pages) {
    const P = pages.map(p => p.printed).sort((a, b) => a - b), T = {};
    pages.forEach(p => T[p.printed] = (p.words || []).map(w => w.t).join(" "));
    const lesson = P.filter(p => nz(T[p]).includes("학습목표"));
    const unit = P.find(p => nz(T[p]).includes("이단원을배우면")) ?? P[0];
    const q = P.filter(p => (T[p].match(/[①②③④⑤]/g) || []).length >= 8);
    return { P, T, lesson, unit, review: q.length ? q[0] : P[P.length - 1] };
  }

  /* ---------- 글자 대조 (3글자 조각 TF-IDF) ---------- */
  function grams(s) { s = nz(s); const m = new Map(); for (let i = 0; i + 3 <= s.length; i++) { const g = s.slice(i, i + 3); m.set(g, (m.get(g) || 0) + 1); } return m; }
  function textIndex(S) {
    const G = {}, DF = new Map();
    for (const p of S.P) { G[p] = grams(S.T[p]); for (const g of G[p].keys()) DF.set(g, (DF.get(g) || 0) + 1); }
    const N = S.P.length, vec = m => { const v = new Map(); let n2 = 0; for (const [g, c] of m) { const w = (1 + Math.log(c)) * Math.log(1 + N / (1 + (DF.get(g) || 0))); v.set(g, w); n2 += w * w; } return { v, n: Math.sqrt(n2) }; };
    const PV = {}; for (const p of S.P) PV[p] = vec(G[p]);
    return t => {
      const q = vec(grams(t)); if (!q.n) return [];
      return S.P.map(p => { let s = 0; for (const [g, w] of q.v) { const x = PV[p].v.get(g); if (x) s += w * x; } return { printed: p, s: PV[p].n ? s / (q.n * PV[p].n) : 0 }; }).sort((a, b) => b.s - a.s);
    };
  }

  /* ---------- 자료 속 쪽 표기 ---------- */
  function mentions(t, S) {
    const set = new Set(S.P), m = [];
    for (const x of t.matchAll(/교과서\s*(\d{1,3})\s*(?:~\s*\d{1,3})?\s*쪽/g)) m.push(+x[1]);
    for (const x of t.matchAll(/\[\d\s*단원\]\s*(\d{1,3})\s*(?:~\s*\d{1,3})?\s*쪽/g)) m.push(+x[1]);
    return m.filter(x => set.has(x));
  }
  const mode = a => { const c = new Map(); a.forEach(x => c.set(x, (c.get(x) || 0) + 1)); return [...c].sort((p, q) => q[1] - p[1])[0][0]; };

  /* ---------- 본체 ---------- */
  // files: [{ name, content, match? (그림 대조 결과), lookup? (온라인 조회 쪽) }]
  function estimate(pages, files) {
    const S = structure(pages), sim = textIndex(S), L = S.lesson;
    const lessonOf = p => L.length ? (p < L[0] ? L[0] : Math.max(...L.filter(l => l <= p))) : p;
    // 소단원 범위: 자료들 속 「교과서 A~B쪽」
    const ranges = {};
    for (const f of files) for (const x of (f.content.text || "").matchAll(/교과서\s*(\d{1,3})\s*~\s*(\d{1,3})\s*쪽/g)) { const a = +x[1], b = +x[2]; if (L.includes(a)) ranges[a] = Math.max(ranges[a] || 0, b); }
    const lessonEnd = l => ranges[l] || ((L.find(x => x > l) || S.P[S.P.length - 1] + 1) - 1);
    // 활동지 머리의 「1-02.」(중단원-소단원) → 소단원 차례
    const codes = [...new Set(files.flatMap(f => [...(f.content.text || "").slice(0, 600).matchAll(/(\d)-(\d{2})\./g)].map(x => x[1] + "-" + x[2])))].sort();
    const out = {};
    for (const f of files) {
      const c = f.content, t = c.text || "", k = kindOf(c);
      let r = { kind: k, page: null, conf: "low", why: "", cands: [] };
      if (k === "figure" || k === "animation") {
        const m = f.match || [];
        if (k === "figure" && m.length) {
          const a = m[0], b = m[1];
          r.page = a.printed; r.cands = m.slice(0, 3).map(x => x.printed);
          r.conf = a.ncc >= 0.85 && (!b || a.ncc - b.ncc >= 0.04) ? "high" : a.ncc >= 0.45 || a.inl >= 40 ? "mid" : "low";
          r.why = `지면 그림과 화소 비교 ${a.ncc.toFixed(2)}` + (b ? ` (다른 쪽 ${b.ncc.toFixed(2)})` : "");
        } else if (m.length) {
          const a = m[0], b = m[1]; r.page = a.printed; r.cands = m.slice(0, 3).map(x => x.printed);
          r.conf = a.score >= 1.0 && (!b || a.score >= 1.5 * b.score) ? "high" : "mid";
          r.why = `영상 장면과 지면 그림 대조 ${a.score}`;
        } else r.why = f.matchErr || "지면에서 같은 그림을 찾지 못함";
      } else if (k === "smart-ppt") {
        if (f.lookup) { r.page = f.lookup; r.conf = "high"; r.why = "스마트 PPT 차시 조회(온라인)"; }
        else r.why = "링크 주소만 있음 — 차시 쪽 조회가 필요해요";
      } else if (k === "textbook-pdf" || k === "guide-pdf") {
        Object.assign(r, { page: S.unit, conf: "high", why: "단원 전체 자료 → 대단원 도입 쪽" });
      } else if (k === "eval-items" || k === "item-bank") {
        Object.assign(r, { page: S.review, conf: "high", why: "평가 자료 → 단원 마무리 문제 첫 쪽" });
      } else {
        const m = mentions(t, S);
        if (m.length) {
          if (k === "class-ppt" || k === "concept-note") { r.page = mode(m.map(lessonOf)); r.why = `자료 속 「교과서 N쪽」 ${[...new Set(m)].sort((a, b) => a - b).slice(0, 4).join("·")} → 소단원 시작 쪽`; }
          else { r.page = mode(m); r.why = `자료 속 쪽 표기 ${[...new Set(m)].slice(0, 3).join("·")}쪽`; }
          r.conf = "high";
        }
        if (r.page == null && k === "perf-sheet") {
          const x = t.slice(0, 600).match(/(\d)-(\d{2})\./), i = x ? codes.indexOf(x[1] + "-" + x[2]) : -1;
          if (i >= 0 && L[i] != null) { const e = lessonEnd(L[i]); Object.assign(r, { page: e, conf: "mid", why: `활동지 머리 차시 「${x[1]}-${x[2]}」 → ${L[i]}~${e}쪽 소단원의 마무리 활동 쪽` }); }
        }
        if (r.page == null && k === "perf-task") {
          const hit = S.P.find(p => nz(S.T[p]).includes("수행평가"));
          if (hit != null) Object.assign(r, { page: hit, conf: "mid", why: "「수행 평가」가 적힌 지면" });
        }
        if (r.page == null && t.trim()) {
          const s = sim(t);
          if (s.length) { const a = s[0], b = s[1] || { s: 0 }; r.page = a.printed; r.cands = s.slice(0, 3).map(x => x.printed);
            r.conf = a.s >= 0.25 && a.s >= 1.5 * b.s ? "high" : a.s >= 0.12 ? "mid" : "low"; r.why = `지면 글자와 대조 ${a.s.toFixed(2)} (다음 ${b.s.toFixed(2)})`; }
        }
        if (r.page == null) r.why = c.err ? `파일을 읽지 못함 (${c.err})` : "단서를 찾지 못함";
      }
      if (!r.cands.length && r.page != null) r.cands = [r.page];
      out[f.name] = r;
    }
    return { results: out, structure: { lessons: L, unit: S.unit, review: S.review, ranges } };
  }

  // 규칙 이름 {쪽}_{코드}_{이름}[ n].ext — 같은 쪽·같은 이름이 여럿이면 번호
  function ruleNames(list) {   // list: [{name, page, kind, cms?}]
    const groups = {};
    for (const x of list) { if (x.page == null) continue; const key = x.page + "|" + x.kind; (groups[key] = groups[key] || []).push(x); }
    const out = {};
    for (const g of Object.values(groups)) g.forEach((x, i) => {
      const [code, label] = KINDS[x.kind] || KINDS.etc, ext = (x.name.match(/\.[^.]+$/) || [""])[0];
      const num = g.length > 1 ? " " + (i + 1) : "";
      out[x.name] = `${x.page}_${code ? code + "_" : ""}${label}${num}${x.cms ? "_@" + x.cms : ""}${ext}`;
    });
    return out;
  }

  root.EbookGuess = { estimate, ruleNames, kindOf, KINDS };
})(typeof window !== "undefined" ? window : globalThis);
