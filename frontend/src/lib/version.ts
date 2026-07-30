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
