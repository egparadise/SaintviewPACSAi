/**
 * 제품 버전 — 단일 진실 공급원(SSOT).
 *
 * 릴리스(개발 차수 마감)마다 이 파일 **한 곳만** 고친다.
 *  · APP_VERSION      = major.minor.patch — minor 는 개발 차수(52차 → 0.52.x), patch 는 차수 내 보정 릴리스.
 *                       정식 출시 시 major 를 1로 올린다.
 *  · APP_RELEASE_DATE = 해당 버전을 적용한 날짜(YYYY-MM-DD).
 *
 * 표시 위치: 설정 창 상단 버전 칩 + 설정 > 정보(Information).
 */
export const APP_NAME = "Saintview PACS AI";
export const APP_VERSION = "0.57.0";
export const APP_RELEASE_DATE = "2026-07-30";
export const APP_VENDOR = "Inviz corporation";

/** 화면 표기용 — "v0.52.0" */
export const APP_VERSION_LABEL = `v${APP_VERSION}`;

/* ── 배포 커밋 해시 ─────────────────────────────────────────────────────────
 * 위 APP_VERSION 은 사람이 올리는 값이라 **같은 버전으로 여러 번 배포**된다.
 * ⚠ 실제 사고: 수정을 배포했는데 증상이 계속돼 원인을 찾았더니 서버에 **옛 빌드**가
 *   돌고 있었다. 화면에 커밋이 없으면 사용자에게는 그걸 알 방법이 없다.
 * vite.config.ts 의 define 이 빌드 시 `git rev-parse --short HEAD` 를 주입한다.
 * ⚠ vite 의 define 은 **식별자 치환**이라 globalThis 에는 안 붙는다 —
 *   globalThis.__BUILD_SHA__ 를 읽으면 늘 빈 값이다(그 실수를 한 적이 있다).
 */
declare const __BUILD_SHA__: string;

/** 배포 커밋 짧은 해시 — 예: "617b521". 개발 서버·git 없는 환경에서는 빈 문자열. */
export const BUILD_SHA: string =
  typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "";

/** 화면 표기용 — "Ver 0-57-0_617b521" (버전 + 실제 배포 커밋) */
export const VERSION_LABEL: string =
  `Ver ${APP_VERSION.replace(/\./g, "-")}${BUILD_SHA ? `_${BUILD_SHA}` : ""}`;
