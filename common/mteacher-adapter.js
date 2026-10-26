/* =========================================================================
   엠티처 어댑터 — 인증·CMS·네트워크 확인을 이 파일 한 곳에 가둔다
   저작기와 뷰어가 같이 쓴다. 엠티처 도메인으로 옮기면 이 파일의 "mteacher" 모드만 채우면 된다.

   모드
     dev      — 지금. 별도 도메인(file:// 포함)이라 CMS·세션을 직접 조회할 수 없다(크로스 오리진).
                네트워크 확인만 실제로 하고, 세션은 개발용 스위치, 제목 조회는 개발용 목록.
     mteacher — 이관 후. 같은 도메인이라 기존 교사 세션·CMS 조회를 그대로 쓴다. (TODO 표시 부분)

   확정 규칙 (cms-viewer-integration)
     - 진입 주소: g.m-teacher.co.kr/pages/api/preview/viewer.mrn?source=CMS&contentSeq={코드}
     - contentSeq 하나만 저장. 자산 실주소(JWT 1시간)는 저장·캐시 불가 → 항상 코드로만 진입
     - 온라인 판정은 navigator.onLine 만 믿지 말고 실제로 두드려 본다. 1.5초 넘으면 포기
   ========================================================================= */
(function () {
"use strict";

const CMS_HOST = "https://g.m-teacher.co.kr";
const VIEWER = CMS_HOST + "/pages/api/preview/viewer.mrn?source=CMS&contentSeq=";
const PROBE_URL = CMS_HOST + "/favicon.ico";
const TIMEOUT = 1500;
const DEV_KEY = "ebook-dev-adapter:v1";

/* 개발용 설정 — 브라우저 저장소가 막혀도 동작해야 한다 */
const devDefaults = { loggedIn: true, network: "auto" };   // network: auto | online | offline | slow
function readDev() {
  try { return Object.assign({}, devDefaults, JSON.parse(localStorage.getItem(DEV_KEY) || "{}")); }
  catch (_) { return Object.assign({}, devDefaults, memDev); }
}
let memDev = {};
function writeDev(patch) {
  const v = Object.assign(readDev(), patch);
  memDev = v;
  try { localStorage.setItem(DEV_KEY, JSON.stringify(v)); } catch (_) { /* 메모리로만 */ }
  return v;
}

const mode = /(^|\.)m-teacher\.co\.kr$/.test(location.hostname) ? "mteacher" : "dev";

/* 붙여넣은 글에서 contentSeq 만 뽑는다 — 숫자만, 또는 뷰어 주소 통째로 */
function extractSeq(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  const m = s.match(/contentSeq=(\d{1,12})/i);
  if (m) return m[1];
  if (/^\d{1,12}$/.test(s)) return s;
  const n = s.match(/(?:^|[^\d])(\d{5,12})(?:[^\d]|$)/);   // 주소 모양이 아니어도 긴 숫자 하나면 그걸로
  return n ? n[1] : null;
}
const viewerUrl = seq => VIEWER + encodeURIComponent(seq);

const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

/* 실제로 CMS 서버에 닿는지 — no-cors 라 응답 내용은 못 보지만 "닿았다"는 알 수 있다 */
async function probe() {
  const t0 = performance.now();
  const dev = readDev();
  if (mode === "dev" && dev.network === "offline") return { online: false, ms: 0, why: "개발용: 오프라인 가정" };
  if (mode === "dev" && dev.network === "online") return { online: true, ms: 0, why: "개발용: 온라인 가정" };
  if (mode === "dev" && dev.network === "slow") {
    await sleep(TIMEOUT);
    return { online: false, ms: Math.round(performance.now() - t0), why: "개발용: 느린 네트워크(1.5초 초과)" };
  }
  if (navigator.onLine === false) return { online: false, ms: 0, why: "기기가 오프라인" };
  try {
    await withTimeout(fetch(PROBE_URL + "?t=" + Date.now(), { mode: "no-cors", cache: "no-store" }), TIMEOUT);
    return { online: true, ms: Math.round(performance.now() - t0), why: "CMS 서버 응답" };
  } catch (e) {
    return { online: false, ms: Math.round(performance.now() - t0), why: e.message === "timeout" ? "1.5초 안에 응답 없음" : "CMS 서버에 닿지 않음" };
  }
}

/* 교사 세션 — dev 는 스위치, mteacher 는 같은 도메인의 기존 세션 */
async function session() {
  if (mode === "dev") return readDev().loggedIn;
  // TODO(이관): 엠티처 기존 세션 확인 엔드포인트로 교체. 같은 도메인이므로 쿠키가 그대로 실린다
  //   ※ 아래 주소는 자리표시(가정). 실제 이름은 개발조직 확인 필요. 실패하면 false → 내장본으로 열리므로 안전
  try {
    const r = await withTimeout(fetch("/pages/api/session/check", { credentials: "include" }), TIMEOUT);
    return r.ok;
  } catch (_) { return false; }
}

/* CMS 자료 제목 — 저작기에서 코드 입력 즉시 확인용 (4.2) */
const DEV_TITLES = {
  "464103": "미래엔_사회2_동영상_1_p8_대통령제정부형태.mp4",   // 2026-09-04 실제 확인한 코드
  "464100": "(개발용) 교과서 전체 자료"
};
async function lookupTitle(seq) {
  if (!seq) return { title: null, reason: "코드 없음" };
  if (mode === "dev") {
    if (DEV_TITLES[seq]) return { title: DEV_TITLES[seq], reason: "개발용 목록" };
    return { title: null, reason: "제목 확인은 엠티처 이관 후에 됩니다 (지금은 형식만 확인)" };
  }
  // TODO(이관): previewCmsItem.ax 의 제목 조회를 같은 도메인에서 호출
  //   ※ previewCmsItem.ax 는 실제 체인에서 확인한 이름, 파라미터·응답 모양은 가정. 개발조직 확인 필요
  try {
    const r = await withTimeout(fetch(`/pages/api/preview/previewCmsItem.ax?source=CMS&contentSeq=${encodeURIComponent(seq)}`, { credentials: "include" }), TIMEOUT);
    const j = await r.json();
    return { title: j && (j.title || j.fileName || j.contentName) || null, reason: "CMS" };
  } catch (_) { return { title: null, reason: "CMS 조회 실패" }; }
}

window.MteacherAdapter = {
  mode, TIMEOUT, extractSeq, viewerUrl, probe, session, lookupTitle,
  dev: { read: readDev, write: writeDev }
};
})();
