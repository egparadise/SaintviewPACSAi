/* 검사 전환 시 분할 재계산 — lib/viewerConfig.resolveHang2d 를 **실제로** 부른다.
 *
 * 사용자 보고: CT(Series 2×2)를 보다가 탭으로 DR/MG 검사를 열면
 *   · CT 의 2×2 격자가 그대로 남고
 *   · DR 은 시리즈가 1~2개뿐이라 나머지 칸이 빈 채여서 "영상이 안 뜬다" 처럼 보였고
 *   · DR·MG 자기 설정(Series 1×1)은 무시됐다
 *
 * 원인은 둘이었다 — 선택 로직이 Viewer2D·ViewerInfi **각자의 effect 안에 인라인**으로 있어
 * 주 검사 modality 로 한 번만 계산되고 버려졌고(탭 전환에 재계산 지점이 없었다),
 * 전체 재행잉이 **현재** 분할로 페인을 채웠다. 그래서 '어떤 modality 를 열 때 어떤 분할인가' 를
 * 순수 함수 하나로 못박고, 뷰어가 검사마다 이것을 다시 부르게 했다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { paneCountOf, pickHang2d, resolveHang2d } from "../src/lib/viewerConfig.ts";

// 사용자 설정 그대로: CR/DR/DX/US 1×1 · CT 2×2 · MR 2×3
const PREFS = {
  hanging2d_common_on: true,
  hanging2d: {
    CR: "1x1", DR: "1x1", DX: "1x1", US: "1x1",
    CT: "2x2", MR: "2x3", XA: "1x1", NM: "1x1", PT: "1x1", "*": "1x1",
  },
};

test("모달리티마다 자기 분할이 나온다 — CT 만 2×2", () => {
  assert.equal(resolveHang2d(PREFS, "ty", "CT").s, "2x2");
  assert.equal(resolveHang2d(PREFS, "ty", "DR").s, "1x1");
  assert.equal(resolveHang2d(PREFS, "ty", "DX").s, "1x1");
  assert.equal(resolveHang2d(PREFS, "ty", "MR").s, "2x3");
});

test("★ CT 를 보다가 DR 로 바꾸면 분할이 **1×1 로 바뀐다** (핵심 회귀 방어)", () => {
  // 예전 버그: 현재 layout(CT 2×2)을 그대로 써서 DR 이 4칸 격자에 들어갔다.
  const cur = resolveHang2d(PREFS, "ty", "CT");
  const next = resolveHang2d(PREFS, "ty", "DR");
  assert.notEqual(next.s, cur.s, "모달리티가 바뀌었는데 분할이 그대로다");
  assert.equal(paneCountOf(next.s), 1, "DR 인데 페인이 1칸이 아니다");
  assert.equal(paneCountOf(cur.s), 4);
});

test("paneCountOf — setLayout 직후 옛 state 를 읽지 않도록 키에서 직접 센다", () => {
  assert.equal(paneCountOf("2x2"), 4);
  assert.equal(paneCountOf("2x3"), 6);
  assert.equal(paneCountOf("1x1"), 1);
  assert.equal(paneCountOf(null, 4), 4, "없으면 폴백");
  assert.equal(paneCountOf("이상한값", 2), 2, "형식이 아니면 폴백");
});

test("모르는 modality 는 '*'(기타 전체) 를 따른다", () => {
  assert.equal(resolveHang2d(PREFS, "ty", "OT").s, "1x1");
});

test("설정이 없으면 강제하지 않는다 — 현재 분할을 유지하게 null", () => {
  assert.equal(resolveHang2d(undefined, "ty", "CT").s, null);
  assert.equal(resolveHang2d({}, "ty", "CT").s, null);
  assert.equal(resolveHang2d(PREFS, "ty", "").s, null);
});

test("Image 분할은 1×1 이면 없는 것으로 — 페인에 헛된 타일을 걸지 않는다", () => {
  const p = { hanging2d_common_on: true, hanging2d: { CT: { s: "2x2", i: "1x1" }, MR: { s: "1x1", i: "2x2" } } };
  assert.equal(resolveHang2d(p, "ty", "CT").i, null, "1x1 타일은 무의미하다");
  assert.deepEqual(resolveHang2d(p, "ty", "MR").i, { r: 2, c: 2 });
});

test("구 저장 형식(문자열=Series 분할만)도 그대로 읽힌다", () => {
  const p = { hanging2d_common_on: true, hanging2d: { CT: "2x2" } };
  assert.equal(resolveHang2d(p, "ty", "CT").s, "2x2");
  assert.equal(resolveHang2d(p, "ty", "CT").i, null);
});

/* ── 우선순위 — 사용자가 "결코 변하지 않는다" 고 못박은 규정 ─────────────────
 *   ① 행잉 프로토콜이 **선택**되면 그것이 이긴다 (HP 기본은 해제)
 *   ② HP 해제 + '이 공통 설정을 모든 뷰어에 우선 적용' **체크** → 공통 표
 *   ③ HP 해제 + 그 체크 **해제** → 그 뷰어 개별 표
 *   ④ MG 는 언제나 맘모 규정(mg_join)
 */

const COMMON_ON = {
  hanging2d_common_on: true,
  hanging2d: { CT: "2x2", DR: "1x1", "*": "1x1" },
  hanging2d_by_viewer: { ty: { CT: "1x2", DR: "2x2" } },   // 체크 상태에서는 무시돼야 한다
};
const COMMON_OFF = { ...COMMON_ON, hanging2d_common_on: false };

test("① HP 가 선택되면 공통·뷰어별을 **무시**한다 (분할을 건드리지 않는다)", () => {
  const r = resolveHang2d(COMMON_ON, "ty", "CT", null, true);
  assert.equal(r.s, null, "HP 가 걸렸는데 공통 표로 덮었다 — 규정 위반");
  assert.equal(r.i, null);
  // MG 도 마찬가지 — HP 가 이긴다
  assert.equal(resolveHang2d(COMMON_ON, "ty", "MG", "2x2", true).s, null);
});

test("② 공통 체크 — 공통 표만 본다(뷰어별 값이 있어도 무시)", () => {
  assert.equal(resolveHang2d(COMMON_ON, "ty", "CT").s, "2x2", "공통 2x2 가 이겨야 한다");
  assert.equal(resolveHang2d(COMMON_ON, "ty", "DR").s, "1x1");
  // 다른 뷰어도 같은 공통 표를 본다
  assert.equal(resolveHang2d(COMMON_ON, "infi", "CT").s, "2x2");
  assert.equal(resolveHang2d(COMMON_ON, "sv", "CT").s, "2x2");
});

test("③ 공통 해제 — 그 뷰어 개별 표만 본다(공통으로 폴백하지 않는다)", () => {
  assert.equal(resolveHang2d(COMMON_OFF, "ty", "CT").s, "1x2", "뷰어별 1x2 가 이겨야 한다");
  assert.equal(resolveHang2d(COMMON_OFF, "ty", "DR").s, "2x2");
  // 개별 표가 없는 뷰어는 **강제하지 않는다** — 공통으로 새면 규정 위반
  assert.equal(resolveHang2d(COMMON_OFF, "infi", "CT").s, null);
});

test("④ MG 는 어느 표에도 안 걸리고 맘모 규정(mg_join)만 따른다", () => {
  const p = { ...COMMON_ON, hanging2d: { ...COMMON_ON.hanging2d, MG: "2x3" } };
  assert.equal(resolveHang2d(p, "ty", "MG", "1x2").s, "1x2", "mg_join 이 이겨야 한다");
  assert.equal(resolveHang2d({ ...p, hanging2d_common_on: false }, "ty", "MG", "1x2").s, "1x2");
  assert.equal(resolveHang2d(p, "ty", "MG", null).s, null, "2D-MG 가 꺼져 있으면 강제하지 않는다");
  assert.equal(resolveHang2d(p, "ty", "MG", "2x2").i, null, "MG 는 페인 안 타일을 겹치지 않는다");
  assert.equal(pickHang2d(p, "ty", "MG"), null, "표 조회 자체가 MG 를 제외한다");
});

test("HP 해제가 기본 — hpActive 를 안 넘기면 ②③ 규칙이 그대로 돈다", () => {
  assert.equal(resolveHang2d(COMMON_ON, "ty", "CT").s, "2x2");
  assert.equal(resolveHang2d(COMMON_ON, "ty", "CT", null, false).s, "2x2");
});

test("스킨 이름이 뭐든 두 뷰어가 같은 규정을 본다 — 규칙이 갈리지 않는다", () => {
  // 예전에는 Viewer2D 와 ViewerInfi 에 같은 삼항이 각자 있어 한쪽만 고치면 결과가 갈렸다.
  for (const v of ["sv", "ty", "infi"]) {
    assert.equal(resolveHang2d(COMMON_ON, v, "CT").s, "2x2", `${v} 가 공통 표를 안 본다`);
  }
});

/* ── 탭 전환은 **예외가 없다** ────────────────────────────────────────────────
 * 사용자 재확인: "뷰어 모니터의 현재 열려있는 layout 구조로 이후 Exam 탭을 전환하더라도
 *                같이 적용된다. 이 부분이 항상 Setting 의 Modality별 Layout 을 따르게 하라."
 *
 * 코드에서도 분기를 없앴다 — 분기가 있으면 그 분기가 곧 구멍이 된다. 아래는 그 규정을 값으로 고정한다.
 */

test("★ 어떤 조합으로 전환해도 **대상 모달리티의 설정값**이 나온다", () => {
  const seq = ["CT", "DR", "MR", "DX", "CT", "US"];
  for (const mod of seq) {
    const r = resolveHang2d(PREFS, "ty", mod);
    const expected = PREFS.hanging2d[mod] ?? PREFS.hanging2d["*"];
    assert.equal(r.s, expected, `${mod} 전환 시 ${expected} 가 아니라 ${r.s}`);
  }
});

test("★ 직전에 무엇을 보고 있었는지는 결과에 영향이 없다 (상태 무관)", () => {
  // resolveHang2d 는 '현재 화면' 을 인자로 받지 않는다 — 그것이 이 규정을 구조적으로 보장한다.
  const a = resolveHang2d(PREFS, "ty", "DR");
  const b = resolveHang2d(PREFS, "ty", "DR");
  assert.deepEqual(a, b);
  assert.equal(a.s, "1x1", "CT 를 보다 왔든 MR 을 보다 왔든 DR 은 1x1");
});

test("모달리티를 못 읽으면 **분할을 강제하지 않는다** (엉뚱한 '*' 로 새지 않는다)", () => {
  // 호출부는 메타가 없으면 1회 조회한다. 그래도 모르면 s=null → 호출부가 1×1 로 리셋한다.
  // ⚠ trim 이 없으면 "   " 가 '*'(기타 전체) 로 폴백해 **모르는 상태에서 분할을 강제**했다.
  assert.equal(resolveHang2d(PREFS, "ty", "").s, null);
  assert.equal(resolveHang2d(PREFS, "ty", "   ").s, null);
});

test("소문자·공백 섞인 modality 도 같은 설정을 찾는다", () => {
  assert.equal(resolveHang2d(PREFS, "ty", "ct").s, "2x2");
  assert.equal(resolveHang2d(PREFS, "ty", " dr ").s, "1x1");
});

/* ── MG 분할 **방식**이 탭 전환에도 반영된다 ───────────────────────────────── */

test("★ MG Image 분할 — Series 1×1 + 페인 안 타일", () => {
  const r = resolveHang2d(PREFS, "ty", "MG", { layout: "2x2", series: false });
  assert.equal(r.s, "1x1", "Image 모드인데 Series 분할이 나왔다");
  assert.deepEqual(r.i, { r: 2, c: 2 }, "타일 격자가 없다");
});

test("MG Series 분할 — 뷰당 페인 하나 (이 저장소의 mg_join 기본 경로)", () => {
  const r = resolveHang2d(PREFS, "ty", "MG", { layout: "2x2", series: true });
  assert.equal(r.s, "2x2");
  assert.equal(r.i, null);
});

test("MG 문자열 인자는 구 호출(Series 분할)로 취급 — 기존 호출부 호환", () => {
  assert.equal(resolveHang2d(PREFS, "ty", "MG", "2x2").s, "2x2");
});

test("MG 1×2 Image 모드 — 타일 1×2", () => {
  const r = resolveHang2d(PREFS, "ty", "MG", { layout: "1x2", series: false });
  assert.equal(r.s, "1x1");
  assert.deepEqual(r.i, { r: 1, c: 2 });
});
