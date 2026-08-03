/* MG 4-view 표준 순서 — R 이 화면 왼쪽, 흉벽이 가운데.
 *
 * 실제 증상: 4뷰가 한 시리즈에 든 검사가 저장 순서(LCC,RCC,LMLO,RMLO)대로 깔려
 * **L 유방이 화면 왼쪽**에 왔다. 표준은 환자를 마주 본 배치 — [RCC, LCC, RMLO, LMLO].
 * 화면의 큰 LCC/RCC 글자는 픽셀에 구워진 것이라 코드가 읽을 수 없다 — 근거는
 * (0018,5101) ViewPosition / (0020,0062) ImageLaterality 태그뿐이다.
 * (백엔드 dicom/orthanc.py 의 series_tree requestedTags 가 이 두 태그를 실어 준다)
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mgInstView, mgOrderIndexes } from "../src/lib/mgHang.ts";

const V = (laterality, view_position) => ({ laterality, view_position });

test("★ 저장 순서 [LCC,RCC,LMLO,RMLO] → 표준 [RCC,LCC,RMLO,LMLO] (핵심 회귀 방어)", () => {
  const stored = [V("L", "CC"), V("R", "CC"), V("L", "MLO"), V("R", "MLO")];
  assert.deepEqual(mgOrderIndexes(stored), [1, 0, 3, 2]);
});

test("이미 표준 순서면 그대로", () => {
  const ok = [V("R", "CC"), V("L", "CC"), V("R", "MLO"), V("L", "MLO")];
  assert.deepEqual(mgOrderIndexes(ok), [0, 1, 2, 3]);
});

test("태그가 하나라도 없으면 **손대지 않는다** — 확신 없이 섞으면 더 위험하다", () => {
  const partial = [V("L", "CC"), V("R", "CC"), V("", "MLO"), V("R", "MLO")];
  assert.deepEqual(mgOrderIndexes(partial), [0, 1, 2, 3], "판정 불가인데 재배열했다");
  const none = [{}, {}, {}, {}];
  assert.deepEqual(mgOrderIndexes(none), [0, 1, 2, 3]);
});

test("뷰가 중복이면(RCC 두 장 등) 손대지 않는다", () => {
  const dup = [V("R", "CC"), V("R", "CC"), V("R", "MLO"), V("L", "MLO")];
  assert.deepEqual(mgOrderIndexes(dup), [0, 1, 2, 3]);
});

test("4장이 아니면 손대지 않는다 (토모신테시스·추가 촬영 혼재)", () => {
  const five = [V("R", "CC"), V("L", "CC"), V("R", "MLO"), V("L", "MLO"), V("R", "XCCL")];
  assert.deepEqual(mgOrderIndexes(five), [0, 1, 2, 3, 4]);
  assert.deepEqual(mgOrderIndexes([]), []);
});

test("mgInstView — 태그 정규화(소문자·공백·MLO 변형)", () => {
  assert.deepEqual(mgInstView(V(" r ", " mlo ")), { lat: "R", view: "MLO" });
  assert.deepEqual(mgInstView(V("L", "CC")), { lat: "L", view: "CC" });
  // XCCL(확대 CC 변형)은 CC 로 새면 안 된다 — 배치가 틀어진다
  assert.deepEqual(mgInstView(V("R", "XCCL")), { lat: "R", view: "" });
  assert.deepEqual(mgInstView(V("B", "CC")).lat, "", "R/L 이 아닌 laterality 는 버린다");
  assert.deepEqual(mgInstView(null), { lat: "", view: "" });
});
