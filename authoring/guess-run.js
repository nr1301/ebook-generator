/* e-book 생성기 — 쪽 찾기 실행 순서 (「자료 이름 찾기」 화면과 저작기 「초안 만들기」가 같이 쓴다)
 *
 *   1. 자료 내용 읽기 (빠름)         guess-read.js
 *   2. 1차 추정 — 글자·구조 단서       guess.js
 *   3. 그림·영상만 지면 그림과 대조     guess-match.js  (느림 — 하나 끝날 때마다 다시 추정)
 *
 * rows: [{ name, file, content?, match?, matchErr? }] — content·match 가 이미 있으면 건너뛴다(다시 돌릴 때 빠르게)
 * pages: [{ printed, image(File|null), words[] }]
 * opt: { onProgress(frac, msg), onUpdate(results, first), stopped(), prep(pagesWithImage, onProgress) → P, keepPrep }
 */
(function (root) {
  "use strict";
  const VIS = /^(jpg|jpeg|png|gif|webp|bmp|mp4|webm|mov|m4v)$/, VID = /^(mp4|webm|mov|m4v)$/;
  const tick = () => new Promise(r => setTimeout(r, 0));

  async function run(pages, rows, opt) {
    const R = root.EbookGuessRead, M = root.EbookGuessMatch, G = root.EbookGuess;
    const prog = opt.onProgress || (() => {}), upd = opt.onUpdate || (() => {}), stopped = opt.stopped || (() => false);
    const out = { sec: 0, stopped: false, matchError: null };
    const t0 = performance.now();
    // 1. 내용 읽기
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].content) rows[i].content = await R.readContent(rows[i].file);
      prog(0.1 * (i + 1) / rows.length, `자료 읽는 중 ${i + 1}/${rows.length}`);
      if (stopped()) { out.stopped = true; break; }
    }
    const files = () => rows.filter(r => r.content).map(r => ({ name: r.name, content: r.content, match: r.match, matchErr: r.matchErr, lookup: null }));
    upd(G.estimate(pages, files()).results, true);
    // 2. 그림 대조
    const vis = rows.filter(r => r.content && VIS.test(r.content.ext) && !r.match);
    const withImg = pages.filter(p => p.image);
    if (vis.length && withImg.length && !out.stopped) {
      let P = null;
      try {
        await M.ready();
        const pp = (i, n) => prog(0.1 + 0.15 * i / n, `지면 그림 준비 ${i}/${n}`);
        P = opt.prep ? await opt.prep(withImg, pp) : await M.preparePages(withImg, pp);
        for (let i = 0; i < vis.length; i++) {
          if (stopped()) { out.stopped = true; break; }
          const r = vis[i];
          prog(0.25 + 0.75 * i / vis.length, `그림 맞춰 보는 중 ${i + 1}/${vis.length} · ${r.name}`);
          try {
            if (VID.test(r.content.ext)) r.match = await M.matchFrames(await R.videoFrames(r.file, 8, 6), P);
            else r.match = await M.matchImage(r.file, P);
          } catch (e) { r.match = []; r.matchErr = /영상/.test(e.message) ? "이 브라우저에서 영상을 열지 못함" : "그림을 읽지 못함"; }
          upd(G.estimate(pages, files()).results, false);
          await tick();
        }
      } catch (e) { out.matchError = e.message || String(e); }
      finally { if (!opt.keepPrep) M.release(P); }
    } else if (vis.length && !withImg.length) out.matchError = "지면 그림이 없어 그림 대조를 건너뜀";
    upd(G.estimate(pages, files()).results, false);
    out.sec = Math.round((performance.now() - t0) / 1000);
    prog(1, out.stopped ? `멈췄어요 · ${out.sec}초` : `다 찾았어요 · ${out.sec}초`);
    return out;
  }
  root.EbookGuessRun = { run, VIS };
})(typeof window !== "undefined" ? window : globalThis);
