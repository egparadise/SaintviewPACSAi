# 07. 구현 스키마 & 개발 PLAN

> 코드 구현을 위한 **데이터 스키마(타입)** + **모드 설정 스키마** + **단계별 개발 계획**. 앞 문서(01~06)의 분석을 코드로 옮기기 위한 청사진.

---

## PART A. 데이터 스키마

### A.1 도메인 모델 (DICOM 계층)
```typescript
interface Patient { idMasked: string; name?: string; dob?: string; sex?: "M"|"F"|"O"; }

interface Study {
  studyUid: string;
  patient: Patient;
  modality: string;            // CT, MR, CR, US, DX ...
  bodyPart?: string;
  studyDate: string;           // ISO
  accessionNo?: string;
  description?: string;
  reportStatus: "none"|"draft"|"final"|"suspended";
  seriesCount: number;
  referringPhysician?: string;
  institution?: string;
}

interface Series { seriesUid: string; studyUid: string; modality: string;
  description?: string; instanceCount: number; thumbnailUrl?: string; }

interface Instance { sopUid: string; seriesUid: string; index: number;
  rows: number; cols: number; wadoUrl: string;
  windowWidth?: number; windowCenter?: number; pixelSpacing?: [number, number]; }
```

### A.2 쿼리/검색 스키마
```typescript
interface QueryFilter {
  patientId?: string; patientName?: string;
  modality?: string[]; bodyPart?: string;
  studyDate?: "none"|"today"|"yesterday"|"lastWeek"|"lastMonth"|{ from: string; to: string };
  description?: string; accessionNo?: string;
  reportStatus?: ("none"|"draft"|"final")[];
  institution?: string; referringPhysician?: string;
  operator?: "="|"prefix"|"contains"|"not";   // =K / K% / %K% / !=K
}
interface SearchShortcut { id: string; label: string; filter: QueryFilter; }
```

### A.3 뷰/조작 상태
```typescript
interface ViewTransform { zoom: number; panX: number; panY: number;
  rotate: number; flipH: boolean; flipV: boolean; }
interface WindowLevel { width: number; center: number; preset?: string; auto?: boolean; }
type SyncMode = "slice"|"ratio"|"normal"|"mm"|"px"|"percent"|"crosslink"|"off";
type ColorMap = "grayscale"|"invert"|"hotIron"|"hotMetalBlue"|"pet"|"pet20";
type Interpolation = "nearest"|"bilinear"|"bicubic";
```

### A.4 주석/계측 스키마
```typescript
type AnnotationKind =
  | "line"|"arrow"|"rect"|"ellipse"|"polygon"|"freehand"
  | "text"|"memo"|"marking"
  | "length"|"angle"|"cobb"|"ctr"|"roi"
  | "limbLD"|"qAngle"|"spineLabel"|"calibrate"|"shutter";

interface Annotation {
  id: string; kind: AnnotationKind;
  instanceUid: string;
  points: Array<[number, number]>;        // 이미지 좌표
  value?: number; unit?: "mm"|"deg"|"ratio"|"HU"|"mm2";
  text?: string;
  source: "user"|"ai";
  confidence?: number;                     // ai일 때
  verified?: boolean;                      // numeric_verify 결과
  createdBy: string; createdAt: string;
}
```

### A.5 판독(리포트) 스키마
```typescript
interface Report {
  reportId: string; studyUid: string;
  title?: string;
  findings: string; impression: string; comments?: string;
  status: "draft"|"final";
  templateId?: string;
  source: "manual"|"voice"|"ai_draft";
  aiEvidence?: Array<{ skill: string; value: any; confidence: number }>;
  history: Array<{ ts: string; by: string; action: "create"|"update"|"confirm"|"suspend"|"delete" }>;
  createdBy: string; updatedAt: string;
}
interface ReportTemplate { id: string; name: string; section: "findings"|"impression"|"comments"; body: string; }
```

### A.6 AI 결과 스키마
```typescript
interface AiResult {
  skill: "ai_detect"|"ai_classify"|"ai_quantify"|"ai_triage"|"ai_overlay";
  studyUid: string; instanceUid?: string;
  model: { name: string; version: string };
  output: any;                 // bbox/mask/label/value/priority
  confidence: number;          // 0~1
  labeled: true;               // 항상 라벨링
  verified?: boolean;          // numeric_verify 통과
  humanConfirmed?: boolean;
}
```

### A.7 모드 설정 스키마 (05 연계)
```typescript
interface ModeProfile {
  product: "INFINITT"|"UBPACS_Z"|"SONIC"|"SAINTVIDW";
  extends?: "commonCore";
  worklist: {
    panels: Array<{ id: string; slot: string; visible?: boolean; primary?: boolean }>;
    maxPanels?: number; userCustomizable?: boolean;
    search?: { operators?: string[]; addKeyword?: boolean; dateTokens?: string[] };
  };
  viewer: {
    openModes: string[];
    layout: { study: string[]; series: string[]; image: string[] };
    sync?: { modes?: SyncMode[]; crosslink?: boolean; autoSync?: boolean; scoutLine?: boolean };
    imageProc?: { colorMap?: ColorMap[]|boolean; interpolation?: Interpolation[]; sharpen?: number; average?: number };
    threeD?: { mpr?: boolean; mip?: boolean; vr?: boolean; endoscopy?: boolean };
    compare?: { autoMatch?: string[] };
    wlPreset?: { hotkeys?: string; fullDynamic?: boolean };
    report?: { voice?: boolean; stdReport?: boolean; merge?: boolean; suspend?: boolean };
  };
  toolbarGroups: string[];
  featureFlags: Record<string, boolean|number>;
  shortcuts?: Record<string, string>;
  theme?: Record<string, string>;
}
```

---

## PART B. 모듈/패키지 설계

```
saintvidw-pacs-ai/
├── core/
│   ├── worklist-engine/      # 검색·트리·정렬·패널 슬롯
│   ├── viewer-engine/        # 렌더·openMode·transform·W/L
│   ├── layout-engine/        # NxN·hanging
│   ├── annotation-engine/    # 주석·계측·ROI
│   ├── report-engine/        # 판독·템플릿·상태
│   └── data-layer/           # DICOMweb(QIDO/WADO/STOW)·DIMSE·report DB
├── agents/                   # 02의 에이전트(10종)
├── skills/                   # 03의 스킬(도구 핸들러)
├── hooks/                    # 03b 훅(pre/post/stop/sessionStart)
├── prompts/                  # 03c 프롬프트 템플릿
├── context/                  # 06 AppContext + 영속화
├── modes/                    # 05 프로파일 JSON(infinitt/ubpacs_z/sonic/saintvidw)
├── ai-gateway/               # 09 AI 스킬 모델 연동
└── harness/                  # 02 런타임(루프·라우터·eval)
```

### 권장 기술 스택(예시·대안 가능)
- **뷰어 렌더링**: Cornerstone3D(웹 DICOM 렌더·MPR·도구) 또는 OHIF 기반.
- **데이터 계층**: DICOMweb(QIDO/WADO/STOW-RS), 백엔드 DIMSE 게이트웨이(dcm4chee/Orthanc 연동).
- **에이전트 런타임**: Claude Agent SDK(에이전트·툴·훅·서브에이전트).
- **판독 DB/표준**: FHIR DiagnosticReport 또는 자체 스키마 + HL7 연계.
- **AI 게이트웨이**: REST/gRPC, 모델 버전 관리.

---

## PART C. 개발 PLAN (단계별)

### C.0 사전 준비
- [ ] 테스트용 DICOM 데이터셋(모달리티별: CT/MR/CR/US) 확보·익명화.
- [ ] DICOMweb 서버(Orthanc 등) 로컬 구축, QIDO/WADO/STOW 검증.
- [ ] 모드 프로파일 4종 JSON 초안(05) 작성.

### C.1 P0 — MVP 코어 (공통기능)
| 작업 | 산출 | 검증 |
|------|------|------|
| data-layer: QIDO/WADO | 검색·영상 조회 API | 검사목록·영상 표시 |
| worklist-engine | 검색/트리/정렬/패널 슬롯 | 무조건·조건·기간 검색 |
| viewer-engine | View/Add/Stack·W/L·Pan/Zoom·회전 | 영상 조작 동작 |
| layout-engine | Study/Series/Image NxN | 분할 표시 |
| annotation-engine | 기본 도형·길이·각도·ROI | 계측 정확도(px) |
| report-engine | Findings/Impression·저장·템플릿 | Draft 저장/조회 |
| harness+context | 에이전트 루프·AppContext | 시나리오 1~3 |
| hooks(기본) | phi_safe_log, delete_block, send/export confirm | 가드레일 테스트 |

### C.2 P1 — 워크플로우 확장
- prior 비교, 동기화(crosslink/series_sync), Cine, Std Report, 전송·내보내기(가드레일 강화), 단축키 체계, 모드 전환(`applyMode`) 4종.

### C.3 P2 — AI 차별화
- ai-gateway 연동, 자동 W/L, 자동 계측(CTR/Cobb/결절), ai_detect/triage/overlay, AI 판독초안, 변화 강조, 자연어 검색.
- 각 AI 스킬: `ai_result_label` + `numeric_verify` + human-in-the-loop 필수.

### C.4 P3 — 고급/특화
- 3D(MPR→MIP→VR), 음성판독(STT), 상세 동기화, External Link(OCS), DICOMDIR+뷰어첨부, CD Burn.

### C.5 검증·릴리즈 게이트
- eval harness(02 §1.3) 통과를 머지 게이트로.
- 안전 회귀: 파괴적 액션 차단율, PHI 누출 0, AI 결과 라벨링 100%.
- 정량 계측 골든 케이스 수치 일치(허용오차 내).

---

## PART D. 시나리오 기반 수용 테스트 (예)

| ID | 시나리오 | 기대 |
|----|----------|------|
| S1 | "지난주 흉부CT 미판독 열어줘" | nl_to_query 미리보기→검색→열기 |
| S2 | 흉부 정면 심흉비 자동 계측 | CTR 값+4선, 신뢰도·검증, 확정 아님 표기 |
| S3 | prior와 비교 결절 변화 | 자동매칭·동기화·변화 강조 |
| S4 | AI 판독 초안 생성 | 근거 포함 초안, Final 저장 시 확인 |
| S5 | 검사 외부전송 | 대상·건수 고지 후 확인, 미확인 시 차단 |
| S6 | 검사 삭제 요청 | 직접 미수행, 사용자 수행 안내 |
| S7 | 모드 전환(INFINITT→Sonic) | 워크리스트·툴바·기능 노출 변경 |

---

## PART E. 분석 → 코드 추적표

| 분석 문서 | 코드 산출물 |
|-----------|-------------|
| 01 기능카탈로그 | featureFlags 목록, 우선순위 |
| 02 아키텍처/하네스 | harness/, agents/ |
| 03 스킬카탈로그 | skills/ 핸들러 시그니처 |
| 03b 훅/가드레일 | hooks/ 구현 |
| 03c 프롬프트 | prompts/ 템플릿 |
| 05 제품모드 | modes/*.json, modeRegistry.ts |
| 06 컨텍스트 | context/AppContext.ts |
| 07(본문) | 도메인 타입·모듈·PLAN |

---

*본 PLAN은 분석 기반 설계 청사진이며, 실제 구현 시 데이터·규제(식약처/FDA·HIPAA·개인정보보호법) 검토를 병행한다.*
