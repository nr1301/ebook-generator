/* e-book 생성기 — 그림 대조 (자료 이미지·영상 장면 → 교과서 쪽)
 *
 * vendor/opencv.js (Apache-2.0) 의 AKAZE 특징점을 쓴다. (opencv.js 에는 SIFT 가 없다)
 *  1. 지면마다 특징점을 뽑는다. 본문 글자 상자(지면 텍스트 레이어)는 가려서 그림 쪽 특징만 남긴다
 *  2. 자료 이미지의 특징점을 지면마다 맞춰 보고(비율 검사 0.8), 호모그래피 인라이어 수를 센다
 *  3. 인라이어가 충분한 후보 쪽만, 지면 영역을 잘라 자료 이미지와 화소 비교(NCC) → 같은 사진이 여러 쪽에 있을 때 가른다
 * file:// 에서는 Worker 를 못 쓰므로 메인 스레드에서 쪽마다 쉬어 가며 돈다.
 */
(function (root) {
  "use strict";
  const CFG = { pageLong: 2000, imgLong: 700, th: 0.0003, pageFeats: 1500, imgFeats: 700, ratio: 0.8, minInl: 8 };
  let cv = null;
  const tick = () => new Promise(r => setTimeout(r, 0));

  // 주의: opencv.js 의 Module 은 then 을 가진 객체라, await 하거나 async 함수에서 return 하면 끝나지 않는다.
  //       그래서 cv.Mat 이 생길 때까지 기다리고, 돌려주는 값은 true 로 한다
  async function ready() {
    if (cv) return true;
    if (!root.cv) throw new Error("vendor/opencv.js 가 로드되지 않았습니다");
    for (let i = 0; i < 600 && !(root.cv && root.cv.Mat); i++) await new Promise(r => setTimeout(r, 50));
    if (!(root.cv && root.cv.Mat)) throw new Error("opencv.js 초기화 실패");
    cv = root.cv;
    return true;
  }

  // 파일 머리에서 그림 크기만 읽는다 (JPEG·PNG·WebP) — 아주 큰 그림을 통째로 풀지 않으려고
  async function headSize(blob) {
    const b = new Uint8Array(await blob.slice(0, 512 * 1024).arrayBuffer()), dv = new DataView(b.buffer);
    if (b[0] === 0x89 && b[1] === 0x50) return { w: dv.getUint32(16), h: dv.getUint32(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1], len = dv.getUint16(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) };
        i += 2 + len;
      }
    }
    return null;
  }
  // 이미지(File·Blob·ImageBitmap·ImageData) → 회색조 Mat (긴 변 maxLong)
  async function grayMat(src, maxLong) {
    let w, h, draw;
    if (src instanceof ImageData) { w = src.width; h = src.height; draw = g => g.putImageData(src, 0, 0); }
    else {
      let bmp = src instanceof ImageBitmap ? src : null;
      if (!bmp) {
        const sz = await headSize(src).catch(() => null);
        if (sz && Math.max(sz.w, sz.h) > maxLong * 1.5) {   // 줄여서 푼다
          const s = maxLong / Math.max(sz.w, sz.h);
          bmp = await createImageBitmap(src, { resizeWidth: Math.max(1, Math.round(sz.w * s)), resizeHeight: Math.max(1, Math.round(sz.h * s)), resizeQuality: "medium" });
        } else bmp = await createImageBitmap(src);
      }
      const own = !(src instanceof ImageBitmap);
      w = bmp.width; h = bmp.height; draw = (g, W, H) => { g.drawImage(bmp, 0, 0, W, H); if (own) bmp.close(); };
    }
    const s = Math.min(1, maxLong / Math.max(w, h)), W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    if (src instanceof ImageData) {   // 영상 프레임: 원 크기로 그린 뒤 줄이기
      const c0 = document.createElement("canvas"); c0.width = w; c0.height = h; c0.getContext("2d").putImageData(src, 0, 0);
      g.drawImage(c0, 0, 0, W, H);
    } else draw(g, W, H);
    const rgba = cv.matFromImageData(g.getImageData(0, 0, W, H)), gray = new cv.Mat();
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY); rgba.delete();
    return gray;
  }

  // 특징점 → 응답 큰 순 n개만 (점 좌표 배열 + 기술자 Mat)
  function features(gray, mask, n) {
    const det = new cv.AKAZE(); det.setThreshold(CFG.th);
    const kp = new cv.KeyPointVector(), des = new cv.Mat(), m = mask || new cv.Mat();
    det.detectAndCompute(gray, m, kp, des); det.delete(); if (!mask) m.delete();
    const N = kp.size(), idx = [];
    for (let i = 0; i < N; i++) idx.push([kp.get(i).response, i]);
    idx.sort((a, b) => b[0] - a[0]); const keep = idx.slice(0, n).map(x => x[1]);
    const cols = des.cols, out = new cv.Mat(keep.length, cols, des.type()), pts = [];
    keep.forEach((i, r) => { out.data.set(des.data.subarray(i * cols, i * cols + cols), r * cols); const p = kp.get(i).pt; pts.push(p.x, p.y); });
    kp.delete(); des.delete();
    return { pts, des: out, n: keep.length };
  }

  /* 지면 준비: pages = [{ printed, image(File|Blob), words:[{b:[x,y,w,h]}] }] */
  async function preparePages(pages, onProgress) {
    await ready();
    const out = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i], gray = await grayMat(p.image, CFG.pageLong);
      const mask = new cv.Mat(gray.rows, gray.cols, cv.CV_8UC1, new cv.Scalar(255));
      for (const w of p.words || []) {
        const [x, y, ww, hh] = w.b;
        cv.rectangle(mask, new cv.Point(Math.round(x * gray.cols) - 2, Math.round(y * gray.rows) - 2),
          new cv.Point(Math.round((x + ww) * gray.cols) + 2, Math.round((y + hh) * gray.rows) + 2), new cv.Scalar(0), -1);
      }
      const f = features(gray, mask, CFG.pageFeats); mask.delete();
      out.push({ printed: p.printed, gray, f });
      onProgress && onProgress(i + 1, pages.length); await tick();
    }
    return out;
  }

  function ncc(a, b) {
    let ma = 0, mb = 0; const n = a.length;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
    let s = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; da += x * x; db += y * y; }
    return da && db ? s / Math.sqrt(da * db) : 0;
  }
  function small(gray) {   // 폭 200으로 줄인 회색 화소 배열
    const h = Math.max(1, Math.round(200 * gray.rows / gray.cols)), d = new cv.Mat();
    cv.resize(gray, d, new cv.Size(200, h), 0, 0, cv.INTER_AREA); const a = Float32Array.from(d.data); d.delete(); return a;
  }

  // 회색조 Mat 하나를 준비된 지면들에 맞춰 본다 → [{printed, inl, ncc}] (좋은 순)
  async function matchGray(gray, P) {
    const f = features(gray, null, CFG.imgFeats);
    const res = [];
    if (f.n < 5) { f.des.delete(); return res; }
    const bf = new cv.BFMatcher(cv.NORM_HAMMING, false), imgSmall = small(gray);
    for (const pg of P) {
      if (pg.f.n < 5) continue;
      const mm = new cv.DMatchVectorVector(); bf.knnMatch(f.des, pg.f.des, mm, 2);
      const src = [], dst = [];
      for (let i = 0; i < mm.size(); i++) {
        const v = mm.get(i); if (v.size() < 2) continue;
        const a = v.get(0), b = v.get(1);
        if (a.distance < CFG.ratio * b.distance) { dst.push(f.pts[a.queryIdx * 2], f.pts[a.queryIdx * 2 + 1]); src.push(pg.f.pts[a.trainIdx * 2], pg.f.pts[a.trainIdx * 2 + 1]); }
      }
      mm.delete();
      if (src.length / 2 < CFG.minInl) continue;
      const sM = cv.matFromArray(src.length / 2, 1, cv.CV_32FC2, src), dM = cv.matFromArray(dst.length / 2, 1, cv.CV_32FC2, dst), msk = new cv.Mat();
      const H = cv.findHomography(sM, dM, cv.RANSAC, 5.0, msk);   // 지면 → 자료
      let inl = 0, bx0 = 1, by0 = 1, bx1 = 0, by1 = 0;
      for (let i = 0; i < msk.rows; i++) if (msk.data[i]) {      // 맞은 점들의 지면 위 범위 = 그림이 놓인 자리 (자리 잡기에 씀)
        inl++; const x = src[i * 2] / pg.gray.cols, y = src[i * 2 + 1] / pg.gray.rows;
        if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (x > bx1) bx1 = x; if (y > by1) by1 = y;
      }
      sM.delete(); dM.delete(); msk.delete();
      if (H.empty() || inl < CFG.minInl) { H.delete(); continue; }
      const warped = new cv.Mat();
      cv.warpPerspective(pg.gray, warped, H, new cv.Size(gray.cols, gray.rows), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255));
      const score = ncc(imgSmall, small(warped)); warped.delete(); H.delete();
      res.push({ printed: pg.printed, inl, ncc: +score.toFixed(3), box: [bx0, by0, bx1, by1].map(v => +v.toFixed(4)) });
      await tick();
    }
    bf.delete(); f.des.delete();
    // 인라이어가 너무 적은 후보는 버리고, 화소 비교 순 (비교가 안 되면 인라이어 순)
    const mx = Math.max(0, ...res.map(r => r.inl)), keep = res.filter(r => r.inl >= Math.max(CFG.minInl, 0.25 * mx));
    keep.sort((a, b) => b.ncc - a.ncc);
    if (keep.length && keep[0].ncc < 0.3) keep.sort((a, b) => b.inl - a.inl);
    return keep;
  }

  async function matchImage(file, P) { await ready(); const g = await grayMat(file, CFG.imgLong); const r = await matchGray(g, P); g.delete(); return r; }
  // 영상: 장면마다 맞춰 보고 화소 비교 점수를 쪽별로 더한다
  async function matchFrames(frames, P) {
    await ready(); const tot = {};
    for (const fr of frames) {
      const g = await grayMat(fr, CFG.imgLong), r = await matchGray(g, P); g.delete();
      for (const x of r) if (x.ncc > 0.5) tot[x.printed] = (tot[x.printed] || 0) + x.ncc;
    }
    return Object.entries(tot).map(([p, s]) => ({ printed: +p, score: +s.toFixed(2) })).sort((a, b) => b.score - a.score);
  }
  function release(P) { for (const p of P || []) { if (p.cached) continue; p.gray.delete(); p.f.des.delete(); } }

  /* 지면 준비 기억 — 쪽 찾기와 자리 잡기가 같이 쓴다. 창을 닫을 때까지 (지면 그림이 바뀌면 다시 준비) */
  const cache = {};
  const pkey = p => `${p.printed}|${p.image.size}|${p.image.lastModified || 0}|${p.image.name || ""}`;
  async function preparePagesCached(pages, onProgress) {
    const need = pages.filter(p => p.image && !cache[pkey(p)]);
    if (need.length) {
      const P = await preparePages(need, onProgress);
      P.forEach((x, i) => { x.cached = true; cache[pkey(need[i])] = x; });
    }
    return pages.filter(p => p.image).map(p => cache[pkey(p)]);
  }
  function clearCache() { for (const k of Object.keys(cache)) { cache[k].gray.delete(); cache[k].f.des.delete(); delete cache[k]; } }

  root.EbookGuessMatch = { ready, preparePages, preparePagesCached, clearCache, matchImage, matchFrames, release, CFG };
})(window);
