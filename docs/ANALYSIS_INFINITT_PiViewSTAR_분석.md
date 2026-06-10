# INFINITT PiViewSTAR / RapidiaMPR 정밀 분석 — Saintview PACS AI 개발 기초 자료

> 작성일: 2026-06-11. 분석 대상: `C:\INFINITT` 설치본 (PiViewSTAR 5.0.4 계열 + RapidiaMPR).
> 분석 방법: 디렉터리 구조, 설정 파일(MERGE.INI/MFDCM36.*/각종 INI/XML), 실행 모듈 리소스 문자열 조사.
> 목적: 상용 PACS의 **구조·기능·워크플로를 벤치마크**하여 Saintview PACS AI의 기능 정의(설계 §2)와 우선순위에 반영.
> ⚠ 본 문서는 기능·구조 수준의 벤치마크다. INFINITT의 코드·리소스(스킨, 템플릿 데이터 등)를 복제하지 않는다.

---

## 1. 제품 개요와 세대적 위치

PiViewSTAR는 **2000년대 Windows 데스크톱(MFC/C++) 클라이언트형 PACS 뷰어**다. INFINITT(구 Mediface) STARPACS의 클라이언트로, 서버(Oracle DB + 아카이브)와 연동하되 **로컬 DB(MS Access)와 로컬 영상 캐시를 가진 무거운(fat) 클라이언트** 구조다.

| 항목 | PiViewSTAR | Saintview PACS AI (우리) |
|---|---|---|
| 플랫폼 | Windows 전용 데스크톱(MFC) | 웹(브라우저) |
| DICOM 스택 | MergeCOM-3 상용 툴킷 | pydicom/pynetdicom + Orthanc(DICOMweb) |
| 로컬 상태 | Access MDB + 파일 캐시 | 없음(서버 중심), 브라우저 캐시만 |
| 서버 DB | Oracle (+ LDAP 인증 지원) | PostgreSQL(+pgvector) |
| 라이선스 | HASP 하드웨어 동글 + 기능별 라이선스 | (미정 — 계정/기관 단위 권장) |
| 판독 보조 | 없음(음성 딕테이션 → 전사 워크플로) | **RAG 기반 AI 초안 — 핵심 차별점** |

**시사점:** PiViewSTAR가 별도 모듈·인력(전사자 Transcriber)으로 풀던 "판독문 생산" 문제를, 우리는 AI 초안으로 압축한다(§6.2 워크플로 매핑 참조). 반면 뷰어·워크리스트·DICOM 네트워크의 **기능 폭**은 20년간 검증된 표준이므로 기능 목록으로 삼을 가치가 크다.

---

## 2. 설치 구조 (디렉터리 레이아웃)

```
C:\INFINITT\
├── PiViewSTAR\
│   ├── Database\          # 로컬 DB: PiView.mdb(Access) + .acc/.ldb 잠금 + IMAGE\(픽셀 캐시)
│   ├── BackupDatabase\    # DB 백업
│   ├── Cache\             # 영상 캐시
│   ├── Spool\             # 전송 대기열 (라우터/게이트웨이 공유)
│   ├── Temp\
│   ├── Log\               # 일별 로그 (YYYYMMDDex.log)
│   └── PiView\            # 프로그램 본체 (실행파일 + DLL + 설정)
│       ├── Config\        # Local.dat(로컬 사용자), LogIn.ini(인증 모드), Server\
│       ├── Layout\        # 행잉 프로토콜 레이아웃(.lda)
│       ├── Templates\     # 정형외과/치과 임플란트 템플릿(.itf 160여종) + TemplateCode.xml
│       ├── SR\            # DICOM SR 서브시스템(SRManager.exe + XSL 변환)
│       ├── Skin\          # UI 스킨(.uis/.WBD/.bmp/.tga)
│       ├── lut\           # 디스플레이 LUT(linear/lighten/darken/midtone/philips × 256/4096)
│       ├── bin\           # TWAIN/SCSI 스캐너 모듈
│       └── CDPublishData\ # CD 퍼블리시용 런타임(뷰어+MPR 포함 배포 세트)
└── RapidiaMPR\            # 3D MPR 뷰어 (Intel IPP 가속) + Preset\(Organ/Window .dat)
```

**구조에서 읽히는 설계 원칙:**
1. **스풀 디렉터리 = 모듈 간 통합 지점.** 라우터·게이트웨이·뷰어가 파일시스템 스풀로 느슨하게 결합(SaintRouter와 동일 패턴).
2. **일별 로그 파일** — 운영 진단 단위가 '날짜'.
3. **설정의 계층화:** 프로그램 INI(고정) / Config\(사용자·사이트) / 레지스트리(PiRegistry.exe로 관리).
4. **CD Publish = 자기완결 배포.** 뷰어 런타임을 데이터와 함께 구워 외부 반출 — 웹 시대에는 "공유 링크 + 웹뷰어"로 치환된다.

---

## 3. 모듈 구성 — 프로세스 분리 아키텍처

단일 거대 앱이 아니라 **역할별 실행파일로 분리**되어 있다. 각 모듈은 독립 실행·독립 설정·독립 로그를 가진다.

| 모듈 | 역할 | 우리 제품에서의 대응 |
|---|---|---|
| **PiViewMain.exe** (8.7MB) | 메인 뷰어 + 워크리스트 + 리포트 UI | React SPA (워크리스트/OHIF/SR편집기) |
| PiView.exe | 런처/셸 (로그인 → 메인 기동) | 로그인 라우트 |
| **VGate / VGateExpert.exe** | 영상 획득 게이트웨이: TWAIN 스캔(16bit), JPEG/BMP/TIFF/RAW import, 디지털카메라, **MWL 조회 후 환자정보 매핑 → DICOM(SC) 변환 생성** | P2: 비DICOM 영상 업로드 → SC 변환 (웹 업로드) |
| **DICOMRouter.exe** | 스풀 감시 → 목적지 AE로 자동 전송 (Checking Interval, Spool Directory, Local AE, Destination 구성) | SaintRouter가 별도 제품으로 존재 — 본 제품 범위 외 |
| TeleGate.exe | 원격판독 게이트웨이(모뎀/전화선, 압축 전송) — 2003년 기술 | 레거시. 웹 자체가 원격판독 |
| **SRManager.exe + SR2HTM.exe** | DICOM SR 생성·관리, SR→HTML(XSL) 표시 | `dicom/sr.py`(highdicom) + 웹 렌더링 |
| MFVoice.exe + MP3Manager.dll | 음성 딕테이션 녹음·재생·서버 업로드 | **AI 초안이 대체** (필요시 P2 STT) |
| DemographicManager.exe | 영상 위 환자정보 오버레이 레이아웃 편집 | OHIF 오버레이 설정 |
| PiPresentation.exe | 컨퍼런스/티칭 프레젠테이션 | P2 티칭 폴더 |
| RSPM.exe | 실물 크기 인쇄(Real Size Printing) | P2 (정형 템플레이팅 연계 기능) |
| PiViewCDBurner(7).exe + DDSBroker | CD/DVD 퍼블리시(DICOMDIR + 포터블 뷰어) | "검사 공유 링크"로 치환 |
| TFM.exe | Template File Manager — 임플란트 템플릿 import/관리 | 범위 외 (정형 특화) |
| NetworkWizard.exe | DICOM 네트워크 설정 마법사 | 관리 화면의 연결 테스트 UI |
| PiRegistry.exe | 설정 저장소 관리 | DB `app_setting` |
| **RapidiaMPR.exe** | 3D: MPR(basic/curved/freehand/path/batch), MIP/MinIP, Volume Rendering, SSD, 가상내시경, 세그멘테이션(3D grow/dilate/erode/sculpt), Time-Density Curve, AVI export | P2+ (OHIF 3D/vtk.js로 일부 가능) — MVP 범위 외 |

**시사점:** "수신·라우팅·획득·뷰어·SR·3D"를 별도 프로세스로 나눈 것은 안정성(한 모듈 다운이 전체를 죽이지 않음)과 라이선스 단위 판매를 위한 설계다. 우리는 웹 아키텍처에서 **백엔드 서비스 분리**(api / rag 워커 / dicom 수신)로 같은 효과를 얻는다 — 설계 문서 §3의 작업 큐 분리가 이에 해당.

---

## 4. DICOM 적합성 (MergeCOM-3 설정 분석)

`MFDCM36.SRV`에 **139개 DICOM 서비스**가 정의되고, Storage SCP 서비스 리스트만 **44개 SOP Class**를 수용한다. 핵심 목록:

- **저장:** CR/CT/MR/US/MG(Present·Process)/DX/IO(구내촬영)/NM/PET/RT Image/SC(멀티프레임 포함)/Enhanced CT·MR·XA·XRF/MR Spectroscopy/Raw Data
- **Q/R:** Patient Root·Study Root·Patient-Study Only 각 FIND/MOVE/GET
- **워크플로:** Modality Worklist(MWL), MPPS(+Notify/Retrieve), GP Worklist, Storage Commitment, Instance Availability Notification
- **판독 산출물:** **DICOM SR**(Basic Text/Enhanced/Comprehensive, Chest/Mammo CAD SR), **GSPS**(Grayscale Softcopy Presentation State — 주석·W/L 상태 저장), **Key Object Selection**(키 이미지 문서)
- **출력:** DICOM Print 전체(Film Session/Box, Print Job, Presentation LUT), Media Creation(CD)
- **기타:** Hanging Protocol(FIND/MOVE), DICOMDIR, 한글 등 charset(MFDCMKO1.dll)

**Saintview 시사점 (적합성 목표 설정):**

| 우선순위 | 채택할 것 |
|---|---|
| P0 | C-ECHO, C-STORE SCP(주요 영상 SOP), Study Root Q/R(내부적으로 Orthanc), DICOMweb(QIDO/WADO/STOW) |
| P1 | **GSPS 저장**(웹뷰어 주석을 표준으로 보존), **Key Object Selection**(키 이미지), **DICOM SR**(판독문 표준 출력 — 설계 §6) |
| P2 | MWL(검사 예약 연동), MPPS, Storage Commitment |
| 제외 | DICOM Print/필름, Media Creation, 모뎀 전송 — 레거시 |

주석·키이미지를 뷰어 내부 포맷이 아닌 **GSPS/KOS 표준 객체로 저장**하는 것이 PiViewSTAR급 상호운용성의 핵심 — 설계 문서 데이터 모델에 반영 권고(§7 갭 테이블).

---

## 5. 뷰어 기능 인벤토리 (리소스 문자열 기반 전수 조사)

### 5.1 워크리스트 / 검사 관리
- 검색: Patient ID/Name, Study Date, Modality, Accession No, 수행의/판독의, 기관
- **상태별 색상**(Status Colors), 응급(Emergency) 플래그
- **Related Exams**(동일 환자 과거검사 자동 연결) ← 우리 RAG의 "환자 축 검색"과 동일 개념의 UI 표현
- 폴더 기능(티칭/케이스 분류, 접근권한 폴더 숨김), Group Policy(그룹별 화면·권한 정책)
- Exam Merge/Split(잘못 매칭된 검사 병합·분리), 신규 Exam/Series 생성, CSV Export
- 외부 프로그램 호출 연동(&External program), 웹 인터페이스 창 내장

### 5.2 영상 조작·표시
- W/L: 프리셋(모달리티 탭별 구성), 마우스 드래그, Synchro W/L(시리즈간 동기), W/L 메모리, Invert
- Zoom/Pan/Magnifier(크기 설정), 100/200/50% 고정 배율, Fit, 회전/플립, 보간
- 레이아웃: **Layout Designer**(행잉 프로토콜 편집기, .lda 저장), Modality별 기본 레이아웃, 사용자 정의 레이아웃, 시리즈 정렬 규칙(Echo time 등), 창 분할
- Scout(위치결정선): 선택 시리즈에 스카웃 라인 표시, Dynamic scout navigation
- CrossLink(다중 시리즈 위치 동기 스크롤), Cine
- 셔터(Rect/Oval/Free), 썸네일 창, 듀얼/멀티 모니터 배치 설정
- 디스플레이 LUT 선택(linear/lighten/darken/midtone + 제조사 보정)

### 5.3 측정·주석 (Annotation)
- ROI: Line/Free line/Rect/Oval (+정밀도 설정), 픽셀 통계·히스토그램
- 각도: Angle, **Cobb's Angle**(척추측만), Angle with 2 lines
- 전문 측정: **CT Ratio**(심흉비), **Pneumothorax ratio**, **Limb Length**(하지 길이), Center Line, Caliper, Spine Label(척추 레벨 라벨)
- **픽셀 캘리브레이션**(X/Y/Both — 기준 길이 입력으로 spacing 보정)
- 텍스트 주석, 마킹, **Memo(Post-it)**, 주석 색상 설정
- **Key Image 지정** + "키 이미지만 보기/전송/인쇄"
- DICOM Overlay 표시 토글, Show ROI property

### 5.4 영상 처리 필터
Sharpen / Smoothing / Edge Enhance / Emboss / Gamma 보정 / **Pseudo Color**(컬러 마스크) / **Subtraction**(감산)

### 5.5 리포트 / 판독 워크플로
- 상태 체인: **Reading → Dictated → Transcribed → Verified → Approved** (각 "Set ..." 액션 + Approved2 = 2차 승인)
- **Direct Reading**(전사 생략 직접 판독), **Merge Reading**(합동 판독)
- 음성: Dictate(Ctrl+D) 녹음 → 서버 업로드 → Transcriber가 전사
- Standard Report(서식 기반), Predefined Readings(상용구), External Report(외부 리포팅 시스템 직접 호출)
- **리포트 → DICOM SR 변환 → Report repository 서버 전송**
- 리포트 인쇄(키 이미지 첨부, "Print with Report"), 기본 판독일/검사일 규칙 설정

### 5.6 입출력·연동
- DICOM Q/R 클라이언트(기본 서버 지정, C-MOVE/C-GET 선택)
- Import: DICOM 파일/폴더(예: "567 files processed, 488 imported"), JPEG/BMP/TIFF/RAW, TWAIN 스캐너, 디지털카메라 → 신규 Exam/Series 생성, 비표준영상 처리
- Export: 파일(압축 선택), 클립보드 복사(영역/전체), AVI(시네), E-mail 전송
- DICOM Print(레이저 이미저, 필름 사이즈/캘리브레이션 관리) + Windows 프린터(실물 크기 인쇄 RSPM)
- CD Publish(뷰어 포함, MPR 라이선스 별도), DICOMDIR
- DICOM Header 뷰어(태그 트리/텍스트 표시, 검색, 저장 — MFDcmLister)

### 5.7 보안·인증
- 로그인 모드 전환: **Local DB / 서버 인증**(LogIn.ini `LogIn_Type`), LDAP 클라이언트 보유
- 사용자 레벨/권한(이미지 위치 보기 제한 등 "Check your user-level"), 관리자 전용 삭제, 시스템 비밀번호(설정 보호)
- 비밀번호 정책(4~16자), 변경 다이얼로그
- **전자서명 모듈**(MFKSign — 기관별 변형 KIRAMS/DMC), 국산 암호 스택(SK* 모듈, OCSP 인증서 검증) → 판독 승인 서명에 사용
- 감사 흔적: 일별 로그 + 상태 변경 이력

### 5.8 특화 패키지 (별도 라이선스)
- **STARPACS Orthopedics Toolbox:** 임플란트 템플레이팅(.itf 템플릿: Zimmer/Depuy/Aesculap/Corentec 등 제조사·부위·사이즈 체계), Hip/Knee/Shoulder, 실물 크기 인쇄 연계
- **Dental:** Cephalo 분석, ToothMap(FDI 표기 ↔ SNOMED 코드 매핑), 구내촬영(IO) SOP
- **RapidiaMPR(3D):** §3 표 참조. 케이스: Batch MPR(자동 재구성 시리즈 생성), Curved MPR(혈관/척추), 가상내시경, 볼륨 측정

---

## 6. 디자인(UX) 분석

### 6.1 UI 구조
- **3대 작업 공간: Exam List(워크리스트) ↔ Viewer ↔ Report.** 검사 더블클릭 → 뷰어, 뷰어에서 리포트 창 호출(창 타입 설정 가능). 우리 React 라우팅(`Worklist/Study/ReportEditor`)과 1:1 대응.
- 커스텀 스킨 엔진(Stardock .uis): 어두운 톤 + 평면 버튼 — 판독실 저조도 환경 최적화. **웹에서도 다크 테마 기본**이 의료영상 표준 관례.
- 썸네일 스트립 + 메인 뷰포트 그리드(가변 분할) 구조. OHIF 기본 구조와 동일.
- 풍부한 단축키(Ctrl+D 딕테이션, Alt+A 주석 등) — 판독의 작업 속도가 곧 제품 가치. **웹에서도 키보드 우선 설계 필수.**

### 6.2 판독 워크플로 — 우리 제품의 핵심 차별 지점

```
PiViewSTAR (인력 기반):
  영상도착 → [판독의] Dictate(음성) → [전사자] Transcribe → [판독의] Verify → Approve(+전자서명)

Saintview PACS AI (AI 기반):
  영상도착 → [AI] RAG 초안 자동 생성(draft) → [판독의] 검토·수정(in_review) → 확정(finalized)
```

- INFINITT의 5단계 상태는 "음성→텍스트 변환에 사람이 필요했던" 시대의 산물. AI 초안이 Dictate+Transcribe 두 단계를 제거한다 — 이것이 영업 포인트이자 UX 설계의 중심.
- 단, **Approved2(2차 승인)·전자서명·Emergency 우선처리**는 의료 현장의 본질적 요구 → 우리 워크플로에도 반영 필요(§7 갭 테이블 G-3, G-6).
- "Predefined Readings(상용구)"는 AI 시대에도 유효 — 판독의가 자주 쓰는 문구를 SR 편집기에 보존.

### 6.3 설정 UX
- 거의 모든 동작이 Option 다이얼로그에서 설정 가능(상태 확인 주기, 썸네일 크기, 주석 색상, 압축률, 프리셋…) — 사이트마다 운영 관행이 달라 **설정 외부화가 PACS 제품의 생존 조건**임을 보여줌. SaintRouter CLAUDE.md의 "축 C(GUI 설정화)"와 동일 교훈.
- Network Wizard·연결 테스트·네트워크 상태 창 — 장애 진단 도구가 1급 기능.

---

## 7. Saintview PACS AI 기능 갭 분석 (설계 문서 §2.1 보강)

PiViewSTAR 대비 현 설계(F-1~F-12)에서 **누락되었거나 격상이 필요한 항목:**

| ID | 항목 | 근거(PiViewSTAR) | 반영 권고 |
|---|---|---|---|
| G-1 | **뷰어 측정·주석 최소 세트 명시** (W/L 프리셋, Zoom/Pan, 길이/각도/ROI, Cobb, CT ratio, 캘리브레이션) | §5.2~5.3 | F-3 상세화. OHIF 기본 도구 + 부족분 확장. **P0** |
| G-2 | **주석·키이미지의 표준 보존** (GSPS + Key Object Selection) | §4 | 데이터 모델에 추가. P1 |
| G-3 | **2차 승인 + 전자서명** 워크플로 옵션 | §5.5, §5.7 | reports 상태에 `approved2`(옵션), 서명 메타 필드. P1 |
| G-4 | **Related Exams UI**(과거검사 자동 연결·비교 보기) | §5.1 | RAG 환자 축 검색을 UI로도 노출(비교 뷰포트). **P0** |
| G-5 | 행잉 프로토콜(모달리티별 기본 레이아웃 + 사용자 정의) | §5.2 | OHIF Hanging Protocol 활용. P1 |
| G-6 | **Emergency/STAT 플래그 + 상태 색상** 워크리스트 | §5.1 | 설계 §6.2 critical findings와 통합. **P0** |
| G-7 | 비DICOM 영상 업로드 → SC 변환 (VGate 대응) | §3 | P2 (F-신규) |
| G-8 | Exam Merge/Split (오매칭 정정) | §5.1 | 관리 기능. P2 |
| G-9 | DICOM Header 뷰어 (진단 도구) | §5.6 | 관리자 화면. P2 |
| G-10 | 상용구(Predefined Readings) | §5.5 | SR 편집기 기능. P1 |
| G-11 | 이메일/링크 공유 (CD Publish의 현대적 대체) | §3, §5.6 | 만료형 공유 링크. P2 |
| G-12 | 영상 처리 필터·Pseudo color·3D/MPR | §5.4, §3 | P2+ / 범위 외 후보 — MVP에서 제외 명시 |

**의도적으로 채택하지 않는 것:** 음성 딕테이션·전사자 워크플로(AI 초안으로 대체), DICOM Print/필름, CD/DVD 굽기, 모뎀 원격판독, TWAIN 스캔, 하드웨어 동글 라이선스, 임플란트 템플레이팅(정형 특화 — 별도 제품 영역).

---

## 8. 아키텍처 교훈 요약 (설계에 이미 반영된 것 / 추가 반영할 것)

| 교훈 | 현 설계 반영 상태 |
|---|---|
| 역할별 프로세스 분리(뷰어/수신/라우터/SR/3D) | ✅ api / rag 워커 / dicom 수신 분리 (§3) |
| 스풀·큐 기반 느슨한 결합 | ✅ 작업 큐 (§3) |
| 표준 객체 우선(SR/GSPS/KOS)으로 산출물 보존 | ⚠ SR만 반영 → **GSPS/KOS 추가 권고(G-2)** |
| 판독 상태 머신 + 상태 색상 + 응급 우선 | ⚠ 상태는 있음 → **Emergency 플래그·색상 P0 격상(G-6)** |
| 과거검사 자동 연결(Related Exams) | ⚠ RAG 내부 로직만 → **비교 뷰어 UI 격상(G-4)** |
| 모든 운영 파라미터의 GUI 설정화 | ✅ 관리 화면 (§2.1 F-10) — 범위 유지 |
| 진단 도구(네트워크 테스트, 헤더 뷰어, 상태 창) 1급 취급 | ⚠ 관리 화면에 추가(G-9) |
| 판독실 다크 테마 + 키보드 우선 UX | 신규 — 프론트엔드 설계 원칙으로 채택 |

---

*다음 단계: 본 분석의 G-1~G-12를 설계 문서 §2.1 기능 요구사항에 반영(P0 격상 항목 우선), MVP 범위 재확정.*
