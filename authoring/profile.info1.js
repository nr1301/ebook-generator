// 「중학 정보」 프로파일 — schema/samples/profile.info1.json 의 인라인 복사본 (file:// 에서 fetch 가 막혀서)
// 마법사 ① 교과 고르기에 카드로 나온다
window.EXTRA_PROFILES = (window.EXTRA_PROFILES || []).concat([
{
  "schemaVersion": "0.1",
  "profileId": "info1",
  "name": "중학 정보",
  "defaultSize": {
    "h": 0.026,
    "w": null,
    "lockAspect": false
  },
  "sizePresets": [
    {
      "id": "s",
      "label": "작게",
      "h": 0.02
    },
    {
      "id": "m",
      "label": "보통",
      "h": 0.026
    },
    {
      "id": "l",
      "label": "크게",
      "h": 0.034
    }
  ],
  "themes": [
    {
      "id": "plan",
      "label": "지도",
      "color": "#2F55E0",
      "onColor": "#FFFFFF"
    },
    {
      "id": "slides",
      "label": "수업",
      "color": "#7A3FCB",
      "onColor": "#FFFFFF"
    },
    {
      "id": "smart",
      "label": "스마트 수업",
      "color": "#0F7C8A",
      "onColor": "#FFFFFF"
    },
    {
      "id": "activity",
      "label": "활동",
      "color": "#1B7F5E",
      "onColor": "#FFFFFF"
    },
    {
      "id": "assess",
      "label": "평가",
      "color": "#C2410C",
      "onColor": "#FFFFFF"
    },
    {
      "id": "media",
      "label": "영상·그림",
      "color": "#BE185D",
      "onColor": "#FFFFFF"
    },
    {
      "id": "etc",
      "label": "엔트리·기타",
      "color": "#5A6472",
      "onColor": "#FFFFFF"
    }
  ],
  "buttons": [
    {
      "id": "textbook-pdf",
      "label": "교과서 PDF",
      "themeId": "plan",
      "assetKind": "etc",
      "fileCode": "TG",
      "icon": "file"
    },
    {
      "id": "guide-pdf",
      "label": "지도서 PDF",
      "themeId": "plan",
      "assetKind": "lesson-plan",
      "fileCode": "TG",
      "icon": "clipboard"
    },
    {
      "id": "class-ppt",
      "label": "수업 PPT",
      "themeId": "slides",
      "assetKind": "slides",
      "fileCode": "PT",
      "icon": "presentation"
    },
    {
      "id": "smart-ppt",
      "label": "스마트 PPT",
      "themeId": "smart",
      "assetKind": "external",
      "fileCode": "EX",
      "icon": "presentation"
    },
    {
      "id": "goal",
      "label": "학습 목표",
      "themeId": "smart",
      "assetKind": "external",
      "fileCode": "EX",
      "icon": "check"
    },
    {
      "id": "flow",
      "label": "학습 흐름도",
      "themeId": "smart",
      "assetKind": "external",
      "fileCode": "EX",
      "icon": "list"
    },
    {
      "id": "think-open",
      "label": "생각 열기",
      "themeId": "smart",
      "assetKind": "external",
      "fileCode": "EX",
      "icon": "link"
    },
    {
      "id": "wrap-up",
      "label": "내용 정리",
      "themeId": "smart",
      "assetKind": "external",
      "fileCode": "EX",
      "icon": "list"
    },
    {
      "id": "evaluate",
      "label": "평가하기",
      "themeId": "smart",
      "assetKind": "external",
      "fileCode": "EX",
      "icon": "check"
    },
    {
      "id": "concept-note",
      "label": "개념 정리",
      "themeId": "activity",
      "assetKind": "worksheet",
      "fileCode": "WS",
      "icon": "list"
    },
    {
      "id": "worksheet",
      "label": "학습 활동지",
      "themeId": "activity",
      "assetKind": "worksheet",
      "fileCode": "WS",
      "icon": "pencil"
    },
    {
      "id": "project-report",
      "label": "프로젝트 보고서",
      "themeId": "activity",
      "assetKind": "worksheet",
      "fileCode": "WS",
      "icon": "pencil"
    },
    {
      "id": "perf-sheet",
      "label": "수행평가 활동지",
      "themeId": "assess",
      "assetKind": "worksheet",
      "fileCode": "WS",
      "icon": "pencil"
    },
    {
      "id": "perf-task",
      "label": "수행평가",
      "themeId": "assess",
      "assetKind": "worksheet",
      "fileCode": "WS",
      "icon": "clipboard"
    },
    {
      "id": "eval-items",
      "label": "평가 문제",
      "themeId": "assess",
      "assetKind": "answer",
      "fileCode": "AN",
      "icon": "check"
    },
    {
      "id": "item-bank",
      "label": "문제은행",
      "themeId": "assess",
      "assetKind": "answer",
      "fileCode": "AN",
      "icon": "list"
    },
    {
      "id": "animation",
      "label": "애니메이션",
      "themeId": "media",
      "assetKind": "video",
      "fileCode": "VD",
      "icon": "play"
    },
    {
      "id": "figure",
      "label": "그림 보기",
      "themeId": "media",
      "assetKind": "image",
      "fileCode": "IM",
      "icon": "image",
      "defaultDisplay": "icon",
      "defaultSize": {
        "h": 0.022,
        "w": null,
        "lockAspect": true
      }
    },
    {
      "id": "entry",
      "label": "엔트리 예제",
      "themeId": "etc",
      "assetKind": "etc",
      "fileCode": "EX",
      "icon": "link"
    },
    {
      "id": "etc",
      "label": "자료",
      "themeId": "etc",
      "assetKind": "etc",
      "icon": "file"
    }
  ],
  "pageTypes": [
    {
      "id": "unit-open",
      "label": "중단원 도입",
      "side": "any",
      "buttonIds": [
        "think-open",
        "animation"
      ]
    },
    {
      "id": "lesson-open",
      "label": "소단원 시작",
      "side": "right",
      "buttonIds": [
        "goal",
        "flow",
        "smart-ppt",
        "class-ppt",
        "concept-note",
        "animation"
      ]
    },
    {
      "id": "activity",
      "label": "개념·활동",
      "side": "any",
      "buttonIds": [
        "smart-ppt"
      ]
    },
    {
      "id": "entry-lab",
      "label": "엔트리 실습",
      "side": "any",
      "buttonIds": [
        "smart-ppt",
        "entry"
      ]
    },
    {
      "id": "wrap-up",
      "label": "스스로 정리하기",
      "side": "any",
      "buttonIds": [
        "wrap-up"
      ]
    },
    {
      "id": "project",
      "label": "창의·융합 프로젝트",
      "side": "any",
      "buttonIds": [
        "smart-ppt",
        "perf-task",
        "entry"
      ]
    },
    {
      "id": "review",
      "label": "스스로 풀어보기",
      "side": "any",
      "buttonIds": [
        "evaluate",
        "eval-items",
        "item-bank"
      ]
    },
    {
      "id": "plain",
      "label": "일반 지면",
      "side": "any",
      "buttonIds": []
    }
  ],
  "globalButtons": []
}
]);
