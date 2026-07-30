# 검증 절차 · 에이전트 활용 표준 (재사용 문서)

> 이 문서는 **다음 작업에서 그대로 반복해 쓰기 위한 절차서**다.
> 근거: 56~57차 작업에서 이 절차가 실제로 **CRITICAL 3건**(운영 중단급)을 잡았고,
> 빌드·타입·pytest 만으로는 **전부 통과했는데도** 그 결함들이 남아 있었다.
> 갱신 규칙: 새 유형의 결함을 놓쳤으면 그 유형을 §3 체크리스트에 한 줄 추가한다.

---

## 0. 작업 전 3초 확인 (건너뛰면 사고가 난다)

| 확인 | 이유 |
|---|---|
| **어느 저장소인가** — 본체 `C:\Project\SaintviewPACSai` / 스위트 `C:\Project\SaintviewViewerSuite` | 코드·원격·Obsidian 볼트가 전부 다르다. `sv70.cloudcare.life` 는 **스위트**. 두 저장소는 기능을 **따로** 개발한다(이식·통합 금지) |
| **백엔드가 어느 DB로 떠 있나** | `SAINTVIEW_DATABASE_URL` 없이 띄우면 기본값 SQLite `dev.db` 로 붙어 "데이터가 없다"는 오진을 부른다. 반드시 런처(`start_saintview.bat` 55행) 방식으로 기동 |
| **설정 키를 검증에 쓸 것인가** | `app_setting` 은 **이력이 없다**. GET → 백업 → 복원 없이 PUT 하면 사용자 설정이 영구 소실된다(실제로 admin 의 HP 규칙을 날린 적 있음) |

```bash
# 정상 기동 (컨테이너 → 백엔드 → 프론트 3포털)
docker compose -f deploy/docker-compose.yml up -d
SAINTVIEW_DATABASE_URL="postgresql+psycopg2://saintview:saintview_dev@127.0.0.1:5433/saintview" \
  py -3.11 -m uvicorn app.main:app --port 8000
```

---

## 1. 게이트 (매 커밋 전 · 필수)

```bash
cd frontend && npm run build        # ⚠ 타입 게이트는 이것뿐. tsc --noEmit -p tsconfig.json 은 solution 파일이라 app 미검사
cd backend  && SAINTVIEW_AI_MODE=mock py -3.11 -m pytest -q   # .env 가 live 라 mock 강제(실 API 비용)
```

**게이트 통과 ≠ 동작 보장.** 아래가 실제로 놓친 것들이다.

| 게이트가 놓친 결함 | 왜 놓쳤나 |
|---|---|
| `register_study` 에 없는 kwargs 전달 → **Orthanc 자동 동기화 전면 중단** | pytest 가 `sync_new_studies` 를 한 번도 호출하지 않는다. 워커는 예외를 삼켜 로그만 남긴다 |
| `showDirectoryPicker` 를 `await` 뒤에 호출 → USB 저장 **100% 실패** | 브라우저 사용자 제스처 규칙. 타입·유닛으로 잡을 수 없다 |
| `localhost` → IPv6 폴백으로 요청당 **+200ms** | 기능은 정상. 측정하지 않으면 보이지 않는다 |
| HP 배치 과거검사 페인에 **현재 환자 이름** 표시 | 렌더 폴백(`?? detail`)이라 예외도 안 난다 |

---

## 2. 3회 점검 루틴

### 1회차 — 기계 검증
1. `npm run build` (tsc -b + vite)
2. `pytest -q`
3. **정적 불변식 스크립트** — 이번 차수에 세운 규칙이 코드에 남아 있는지 문자열로 확인.
   리팩터링이 규칙을 조용히 되돌리는 것을 막는다.
   ```python
   V = pathlib.Path('frontend/src/pages/Viewer2D.tsx').read_text(encoding='utf-8')
   t("Scout 게이트: 십자선도 scoutOn 안", "if (scoutOn && !refSegs.length && xlink.crosslink)" in V)
   ```
4. **순수 함수는 node 로 실행 검증** — 좌표·날짜·인덱스 계산은 반드시 수치로.
   TS 타입 표기만 걷어내 `node -e` 로 돌린다. 기대값이 틀렸으면 *코드가 아니라 기대값*을 고친다(실제로 2회 발생).

### 2회차 — 라이브 동작 + 성능 실측
```bash
TOK=$(curl -sk -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" -d '{"username":"admin","password":"admin1234"}' \
  | py -3.11 -c "import sys,json;print(json.load(sys.stdin)['token'])")   # ⚠ 필드명은 token (access_token 아님)
```
- 정상 경로 + **가드**(무인증 401 / 빈 입력 400 / 없는 자원 404 / 권한 403)
- 산출물은 **바이트로 검증**: ZIP 항목·DICOMDIR 포함, ISO 는 오프셋 32769 의 `CD001` 서명
- 성능은 `curl -w '%{time_total}'` 로 **숫자를 남긴다**
  - 기준: 워크리스트/상세 < 0.1s · series-tree DR < 0.1s · CT(1000장 이상) < 1.5s · 뷰어 오픈 DR < 1s / CT < 3s
- ⚠ **호스트 비교를 반드시 한다**: `localhost` vs `127.0.0.1` (Windows 는 ::1 먼저 → 연결당 ~200ms)

### 3회차 — 적대 검증(에이전트) + 프롬프트 누락 대조
- 아래 §3 워크플로를 돌린다.
- 이번 차수에 사용자가 요청한 항목을 **한 줄씩 grep 으로 대조**한다(구현 누락·반쪽 구현 색출).
  ```bash
  chk(){ printf "  %-40s " "$1"; grep -rqs "$2" $3 && echo OK || echo "✗ 미발견"; }
  chk "HP 직접설정 저장" "HpSaveDialog" components/HpSaveDialog.tsx
  ```

---

## 3. 적대 검증 워크플로 (Workflow 툴)

**형태**: `pipeline(렌즈들, 탐색, 반박)` — 렌즈마다 찾고, 찾은 즉시 각 지적을 독립 에이전트가 **반박 시도**.
살아남은 것만 보고한다. 배리어(`parallel`)는 렌즈 간 교차 참조가 필요할 때만.

```js
const results = await pipeline(
  LANES,
  (l) => agent(l.prompt, { label: `hunt:${l.key}`, phase: 'Hunt', schema: FIND, effort: 'high' }),
  (r, l) => parallel((r?.findings ?? []).slice(0, 6).map((f) => () =>
    agent(`다음 지적을 **반박**하라. 불확실하면 refuted=true 로 기울여라.\n${...}`,
          { label: `verify:${l.key}:${f.line}`, phase: 'Verify', schema: VERDICT, effort: 'high' })
      .then((v) => (v && !v.refuted ? { ...f, keep: v.reason } : null)))),
)
```

### 실제로 성과를 낸 렌즈 6종
| 렌즈 | 무엇을 찾나 | 성과 예 |
|---|---|---|
| **기존 기능 회귀** | 이번 변경이 이미 동작하던 것을 깼는지. 기본값 변화, 전제 파괴 | Ref 버튼 무력화, 설정 최대화 폭, 세션 레이아웃 기억이 2D-MG 전제를 깸 |
| **로직 정확성** | 경계·정렬·필터·매핑 | priority 정렬, `use_on_exam_open` 을 find 밖에서 검사해 뒤 규칙이 막힘 |
| **왕복 일관성** | 저장→재적용이 같은 결과인지 | applyHp 가 페인 `il` 미적용, `displays[].image` 미저장 |
| **두 구현 대조** | 같은 기능의 뷰어 간 비대칭 = 한쪽이 틀렸다는 신호 | Scout 같은시리즈 기준(series_uid vs 페인 id), I-View Spatial 부재 |
| **백엔드 안전성** | 시그니처·권한·테넌시·멱등·트랜잭션 | 동기화 전면 중단(CRITICAL), 백필 NULL 필터·병원별 Orthanc |
| **성능 병목** | 직렬 await·중복 GET·번들 오염·N+1 | localhost IPv6, 번들에 cornerstone 딸려옴 |

### 프롬프트 작성 규칙 (효과가 확인된 것)
- **"반드시 코드를 실제로 읽고 확인하라. 추측 지적 금지."** — 없으면 상상 결함이 쏟아진다
- 반박 에이전트에는 **"불확실하면 refuted=true"** — 거짓 양성 억제
- 파일·줄·**재현 경로**를 스키마 필수 필드로 강제 → 검증 가능한 지적만 남는다
- 렌즈마다 대상 파일·함수명을 **명시** → 엉뚱한 곳을 훑지 않는다
- **의도된 트레이드오프는 주석에 남긴다** → 다음 검증에서 같은 지적이 반복되지 않는다

---

## 4. 마무리 순서 (고정)

```bash
git add -A && git commit    # 커밋 메시지에 '왜' 와 '어떻게 잡았는지'를 남긴다
git push origin main
```
1. **CLAUDE.md** 차수 항목 갱신(무엇을·왜·놓쳤던 함정)
2. **Obsidian 리포트** — 볼트 `Saintview PACS AI 개발기록`(본체) / `SaintviewPACSai_Seperate`(스위트).
   `00 INDEX (MOC).md` 세션 리포트 목록에 링크 추가
3. **배포 빌드** `cd frontend && npm run build`
4. **서비스 재기동** — 백엔드(8000) + 프론트 3포털, `/api/health` 와 https 3포털 200 확인
   (⚠ 프론트는 **HTTPS 전용** — `curl -k https://…`. 평문 http 로 확인하면 empty reply 오탐)

---

## 5. 도구 사용 요령

| 도구 | 언제 | 주의 |
|---|---|---|
| **Workflow** | 다각도 탐색·적대검증·대규모 대조 | 정찰(Recon)과 검증(Hunt+Verify)을 분리하면 정확도가 올라간다 |
| **Agent** | 단일 축의 넓은 탐색 | 사용자가 요청하지 않으면 쓰지 않는다 |
| **node -e** | 순수 함수 수치 검증 | TS 표기 제거 필요. optional chaining/기본값은 stub 에도 그대로 옮겨야 결과가 같다 |
| **py -3.11 heredoc** | 대량 문자열 치환 편집 | `assert a in s` 로 **앵커 존재를 강제**한다. 없으면 조용히 실패한다(실제로 따옴표가 깨진 파일을 만든 적 있음) |
| **PowerShell** | 프로세스 종료 | Git Bash 의 `pkill -f uvicorn` 은 Windows python 프로세스를 못 죽인다. `Get-CimInstance Win32_Process` → `Stop-Process` |
| 내장 브라우저 | 화면 확인 | 자체서명 인증서로 **접근 불가**. 육안 확인은 사용자에게 의존 → 보고에 명시할 것 |

---

## 6. 되풀이되는 함정 (같은 실수를 두 번 하지 않기 위한 목록)

1. **"기본값을 바꾸는 기능"은 다른 기능의 전제를 깬다.** 새 전역 상태를 넣을 때 그것을 소비하는 지점 전부를 목록화한다.
2. **비대칭은 버그의 신호.** 같은 기능의 두 구현이 다르면 한쪽이 틀렸다.
3. **`useCallback([])` 안에서 상태를 읽지 말 것.** 첫 렌더 값으로 굳는다 → ref 로 읽는다.
4. **렌더 폴백(`?? detail`)은 조용한 오표기를 만든다.** 폴백 전에 등록을 보장한다.
5. **pytest 가 호출하지 않는 경로**(워커·동기화·하네스)는 실행으로 확인한다.
6. **길이 제한 있는 DB 컬럼에 넣는 문자열은 잘라서 넣는다.** 하나가 넘치면 트랜잭션 전체가 죽는다.
7. **컨테이너 내부는 서비스명, 호스트→컨테이너는 127.0.0.1.** 섞으면 한쪽이 깨진다.
8. **gitignore 된 설정(.env)의 기본값**이 새 클론의 실제 동작이 된다 — 기본값을 안전한 쪽으로.
9. **"고쳤다"의 범위를 스스로 좁게 잡지 말 것.** 렌더가 안 보이는 문제를 고쳤다면 **같은 기능의 입력 경로**도 같은 전제로 깨져 있는지 확인한다(타일 주석: 렌더를 고치자 좌표 오류가 드러났다).
10. **클램프는 오류를 숨긴다.** `[0,1]` 로 자르는 좌표 변환은 범위 밖 입력도 '유효하지만 틀린' 값으로 통과시켜 예외가 나지 않는다 — 입력 출처가 맞는지를 따로 검증한다.
