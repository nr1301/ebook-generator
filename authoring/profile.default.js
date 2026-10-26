// profiles/science2.json (schema/samples/profile.science2.json) 인라인 복사본
// file:// 에서 fetch 가 막히므로 script 로 싣는다. 원본이 바뀌면 이 파일도 갱신할 것.
window.DEFAULT_PROFILE =
{
  "schemaVersion": "0.1",
  "profileId": "science2",
  "name": "중학 과학2",
  "defaultSize": { "h": 0.028, "w": null, "lockAspect": false },
  "sizePresets": [
    { "id": "s", "label": "작게", "h": 0.021 },
    { "id": "m", "label": "보통", "h": 0.028 },
    { "id": "l", "label": "크게", "h": 0.038 }
  ],
  "themes": [
    { "id": "plan",     "label": "지도",   "color": "#2F55E0", "onColor": "#FFFFFF" },
    { "id": "slides",   "label": "수업",   "color": "#7A3FCB", "onColor": "#FFFFFF" },
    { "id": "activity", "label": "활동",   "color": "#1B7F5E", "onColor": "#FFFFFF" },
    { "id": "media",    "label": "영상",   "color": "#C0392B", "onColor": "#FFFFFF" },
    { "id": "answer",   "label": "답·풀이", "color": "#B26A05", "onColor": "#FFFFFF" },
    { "id": "visual",   "label": "그림",   "color": "#0E7490", "onColor": "#FFFFFF" },
    { "id": "etc",      "label": "기타",   "color": "#5A6472", "onColor": "#FFFFFF" }
  ],
  "buttons": [
    { "id": "lesson-plan",     "label": "학습 지도안",   "themeId": "plan",     "assetKind": "lesson-plan", "fileCode": "TG", "icon": "clipboard" },
    { "id": "inquiry-plan",    "label": "탐구 지도안",   "themeId": "plan",     "assetKind": "lesson-plan", "fileCode": "TG", "icon": "clipboard" },
    { "id": "class-ppt",       "label": "수업 PPT",     "themeId": "slides",   "assetKind": "slides",      "fileCode": "PT", "icon": "presentation" },
    { "id": "worksheet",       "label": "학습 활동지",   "themeId": "activity", "assetKind": "worksheet",   "fileCode": "WS", "icon": "pencil" },
    { "id": "inquiry-sheet",   "label": "탐구 활동지",   "themeId": "activity", "assetKind": "worksheet",   "fileCode": "WS", "icon": "pencil" },
    { "id": "tryit-sheet",     "label": "해 보기 활동지", "themeId": "activity", "assetKind": "worksheet",   "fileCode": "WS", "icon": "pencil" },
    { "id": "exp-video-proc",  "label": "실험 영상_과정", "themeId": "media",    "assetKind": "video",       "fileCode": "VD", "icon": "play" },
    { "id": "exp-video-res",   "label": "실험 영상_결과", "themeId": "media",    "assetKind": "video",       "fileCode": "VD", "icon": "play" },
    { "id": "concept-video",   "label": "개념 영상",     "themeId": "media",    "assetKind": "video",       "fileCode": "VD", "icon": "play" },
    { "id": "sample-answer",   "label": "예시 답 확인",  "themeId": "answer",   "assetKind": "answer",      "fileCode": "AN", "icon": "check" },
    { "id": "solution",        "label": "풀이",         "themeId": "answer",   "assetKind": "answer",      "fileCode": "AN", "icon": "check" },
    { "id": "summary",         "label": "정리",         "themeId": "answer",   "assetKind": "answer",      "fileCode": "AN", "icon": "list" },
    { "id": "figure",          "label": "그림 보기",     "themeId": "visual",   "assetKind": "image",       "fileCode": "IM", "icon": "image", "defaultDisplay": "icon", "defaultSize": { "h": 0.022, "w": null, "lockAspect": true } },
    { "id": "external-tool",   "label": "외부 도구",     "themeId": "etc",      "assetKind": "external",    "fileCode": "EX", "icon": "link" },
    { "id": "etc",             "label": "자료",         "themeId": "etc",      "assetKind": "etc",         "icon": "file" }
  ],
  "pageTypes": [
    { "id": "lesson-open",  "label": "차시 시작(좌면)",  "side": "left",  "buttonIds": ["lesson-plan", "class-ppt"] },
    { "id": "inquiry",      "label": "탐구·실험",       "side": "any",   "buttonIds": ["inquiry-plan", "inquiry-sheet", "exp-video-proc", "exp-video-res"] },
    { "id": "tryit",        "label": "해 보기 활동",     "side": "any",   "buttonIds": ["tryit-sheet", "sample-answer"] },
    { "id": "lesson-close", "label": "차시 마무리(우면)", "side": "right", "buttonIds": ["solution", "worksheet", "summary", "concept-video"] },
    { "id": "unit-review",  "label": "단원 마무리 문제",  "side": "any",   "buttonIds": ["solution"] },
    { "id": "plain",        "label": "일반 지면",        "side": "any",   "buttonIds": [] }
  ],
  "globalButtons": [
    {
      "buttonId": "etc",
      "label": "교과서 전체 자료",
      "at": { "x": 0.93, "y": 0.03 },
      "size": { "h": 0.024, "w": null, "lockAspect": true },
      "display": "icon",
      "asset": { "path": "docs/common/전체자료.hwp", "cmsCode": "464100" },
      "showOn": "all"
    }
  ]
}
;
