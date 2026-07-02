# INFINITT PiViewSTAR 파일 수준 정밀 분석 — In Viewer 사양 원천

> 작성일: 2026-07-03. 분석 대상: `C:\INFINITT` 전체 1,044개 파일(PiViewSTAR 961 + RapidiaMPR 83), 읽기 전용.
> 방법: 텍스트 설정파일 12종 전문, 바이너리 설정 4종 헥사/ASCII 해석, `PiViewMain.exe`(8.7MB) 문자열 33,815개,
> `RapidiaMPR.exe`(9.7MB) 문자열 36,555개, 보조 exe 6종 문자열 추출.
> 관계 문서: 스크린샷 기반 화면 분석은 `UI_ANALYSIS_PiViewSTAR_화면분석.md`(존 분해), 본 문서는 **파일 근거**(아이콘·설정·레이아웃·LUT·문자열)를 보강한다.
> 이 문서는 선택 뷰어 **"In Viewer"**(`frontend/src/lib/infiConfig.ts`) 구현의 사양 원천이다.

---

## 1. 프로그램 구조 (폴더별 역할)

```
C:\INFINITT\
├─ PiViewSTAR\
│  ├─ PiView\               ← 메인 프로그램 (exe/dll 178개가 평면 배치)
│  │  ├─ bin\               ← 스캐너 연동 (VdScanTk.dll, Vscsi32.dll — 필름 스캐너 TWAIN/SCSI)
│  │  ├─ Config\            ← LogIn.ini(로그인), Local.dat(로컬 사용자), Server\(빈 폴더=서버모드 미사용)
│  │  ├─ Layout\            ← SAMPLE1.lda (워크리스트/리스트 레이아웃 정의)
│  │  ├─ Skin\              ← Stardock WindowBlinds 스킨 (piview.uis + bmp/tga 40개 + piviewskin.ini)
│  │  ├─ lut\               ← Presentation LUT 10종 (DICOM 포맷)
│  │  ├─ SR\                ← DICOM SR 생성/판독 (SRManager.exe, SRCreator.xml, SRReader.xsl, 노드아이콘 gif)
│  │  ├─ Templates\(+Dental\)← 정형외과/치과 임플란트 템플릿 .itf 358개 + TemplateCode.xml
│  │  ├─ CDPublishData\     ← CD 출판 페이로드 (IHE PDI: CDLOADER, WebView, RapidiaMPR 사본)
│  │  └─ Dump\              ← 크래시 덤프
│  ├─ Database\             ← 로컬 DB = MS Access "PiView.mdb" + IMAGE\YYYYMMDD\E0000xxx\I0000xxx.dcm
│  ├─ BackupDatabase\, Cache\, Spool\, Temp\, Log\(YYYYMMDDex.log)
└─ RapidiaMPR\               ← 3D/MPR 뷰어 (RapidiaMPR.exe + Intel IPP/IPL + Preset\)
```

**주요 실행파일 역할** (문자열 근거):

| 파일 | 역할 | 근거 |
|---|---|---|
| `PiViewMain.exe` (8.7MB) | 뷰어+워크리스트 본체 | "INFINITT PiViewSTAR", 전체 메뉴/툴 문자열 |
| `PiView.exe` (196KB) | 런처/부트스트랩 | PiView.dat에 경로 테이블 |
| `DICOMRouter.exe` | DICOM 자동전달기 | "Spool Directory / Checking Interval / Local AE Title / Destination Remote Host Configuration / Transferring Status" |
| `NetworkWizard.exe` | 네트워크 진단 마법사 | "Step 1 of 3…Ping test is no problem→Cannot send and receive DICOM images→Cannot perform DICOM Query/Retrieve" |
| `TeleGate.exe` / `VGate(Expert).exe` | 원격판독 게이트웨이(모뎀/네트워크) | "TeleGate - Teleradiology Gateway", "Modem Settings/Hayes Compatible" |
| `SRManager.exe`, `SR2HTM.exe` | SR 판독문 작성/HTML변환 | "Begin Reporting / Finalize Report / Retrieve Images" |
| `DemographicManager.exe` | **영상 오버레이(4-코너 텍스트) 레이아웃 편집기** | "Demographic Layout Editor", "TOPLEFT/TOPRIGHT/BOTTOMLEFT/BOTTOMRIGHT", "DICOM Field List", "Prefix/Suffix", "Display Mode/Print Mode", "If Empty, Replace to" |
| `MFDcmLister.dll(+ini)` | DICOM 헤더 뷰어 | "D_MODE=Text / D_MODE2=Tree / Expand / Collapse / Search / Save As.." |
| `PiRegistry.exe` | 설정 저장소(레지스트리 가상화) | PiView.tbr = `HKCU\Software\INFINITT\PiViewSTAR\...\Settings` XML 덤프 |
| `PiViewCDBurner(7).exe`, `DicomComposer.exe` | CD 굽기/DICOMDIR 작성 | CDPublishData 연계 |
| `MFVoice.exe`, `MP3Manager.dll` | 음성 딕테이션 | "Dictation", "Uploading Dictation", "Tape Dictation" |
| `hinstall.exe`, `AKSWrap/HaspHLWrap.dll` | HASP 동글 라이선스 | Aladdin HASP 계열 |

**기술 스택**: MFC 4.0/4.2, DICOM = **MergeCOM-3 3.6.0**(`merge.log`), 이미지 코덱 = LeadTools 13(`lt*13n.dll`)+`jpegpro.dll`, 로컬 DB = Access/DAO(`mfdb.dll`), 서버 프로토콜 = 자체 **MSP(Mediface Service Protocol)** — `msp.ini`: `ServerAddress=spectra, PortNo=8000, PacketSize=4096`(STARPACS 서버 "Spectra"). 한국 PKI 전자서명 모듈(`SKComm/SKCryp/SKOcsp`, `MFKSign_KIRAMS/DMC.dll`) — 판독문 전자서명용.

---

## 2. Worklist 화면 — 구성·컬럼·검색·기능

**로그인**: `Config\LogIn.ini` → `LogIn_Type=Local DB`, `Default_UserID=Administrator`. 사용자 등급 존재("Check your user-level"), 비밀번호 변경("Confirm New Password"), 권한("Read and write"/"Read only", "Delete selected images ( **Administrator only** )").

**리스트(Exam List) 구성** — 근거 `Layout\SAMPLE1.lda` + exe 문자열:
- 컬럼 정의는 **레이아웃 파일(.lda)** 로 외부화: `Name(150) | ID(150) | Age, Sex(150) | Birth date(150) | REPORT(250) | INFINITT hospital(100) | Reading(150) | Dx(150) | Fx(150)` — 필드명+픽셀폭 쌍. exe에 " Worklist layout ", "Layout Designer - Text property" → 컬럼 레이아웃 디자이너 편집.
- 기타 컬럼 후보: Patient ID/Name, Birth Date, Study Date/Time, Modality, Body Part, Accession(%an), Exam date/status, Study Description, Department, Comments.
- **탭 구조**: "Exam tab", "Modality tabs", "Modality layout", "&Modality tab setting" → 모달리티별 탭 필터. 모달리티 목록 `PiView.mol`: `CR CT DR ES MR NM OT RF US XA`.
- **정렬**: Patient ID/Name (Asc/Desc).
- **상태 시각화**: " Status Colors ", " Status Check Duration " → 검사 상태 색 구분·주기 갱신. 판독 상태: "Set Dictated / Set Transcribed / Set Verified / Set Approved / Set Approved2"(+ Transcriber, Approver1/2, Verifying Organization) → **Dictated→Transcribed→Verified→Approved(2단계)** 워크플로.
- **검색**: "Worklist Wizard(- searching condition)", " Today ", " Yesterday ", MonthCalendar → 기간(오늘/어제/달력)+조건 콤보. " Search in custom folder ", "Custom Folder Configuration".
- **소스 전환**: Master Local DB ↔ Spectra 서버 ↔ **DICOM Q/R**(" DICOM Q/R Option ", " Retrieve Queue ") ↔ 폴더/CD("&Open DB Folder…", "Import DICOM Files").
- **동작**: 더블클릭 열기, "Open the worklist Ctrl+W", "Open the previous/next exam Ctrl+←/→", "Close exams Ctrl+C", "New Exam/New Series", "&Merge"(검사 병합), "&Send selected images...", Export CSV, 백업("Backup DB", " Direct Backup ").

---

## 3. Viewer 화면 — 레이아웃 시스템·툴바·툴 목록

**레이아웃 시스템**:
- 이미지 격자: `1x1, 2x2, 2x3, 3x3, 3x4, 4x4`(WEBVIEW.HTM selLayout), 데스크톱 "Image Layouts", "New Layout", " Default Layout ", "Fix Layout", "&User defined layout", "Monitor Layout".
- **멀티모니터**: "…location of PiView on the Windows screen for one VGA and **Diagnostic Monitors**" → VGA(워크리스트)+진단모니터 분리.
- **행잉 프로토콜**: "Default hanging protocol" → " Current Hanging protocol " → "**Advanced Hanging Protocol Configuration**" 3단계, 모달리티 탭과 연동.
- **시리즈 내비게이션**: " Thumbnail window ", "Series list/mode", "Series Sort"(Image number/Image time/Slice position/Echo time 각 Asc/Desc), "&Exam mode"/"&Single mode", " Related Exam "(과거검사), "&CrossLink mode"(동기 스크롤), "Scout(line)", "&Draw scout line"(참조선).
- **툴바 워크스페이스**: `PiSTAR2.tbx/tby`에 **"Default / Display / Annotation / Etc / Diagnose / Verify"** 그룹 — 판독의/검증의 툴바 세트 분리. 사용자 배치는 레지스트리(PiView.tbr) + "User Roaming Profile Configuration" 로밍.

**툴 전체 목록** (PiViewMain.exe 문자열 전수):

| 분류 | 툴 |
|---|---|
| 탐색/표시 | Zoom(1%~3000%, 100%/200%/50%/Fit), Pan, Magnifier(Ctrl+M), Maximize Image, Interpolation, Full-page(First/Last/Next Page) |
| W/L | Window/Level, W/L Presets(모달리티 탭별), NonLinear W/L, W/L optimizer, W/L Memory, Synchro Window Level, Apply Window level(전체), Invert |
| 방향 | Rotate CW/CCW/180, Flip |
| 측정 | Caliper(Ctrl+L), Angle, Double Angle, Cobb's Angle, CT Ratio(심흉비), Limb Length, Pneumothorax(기흉%), ROI(Rect/Oval/Free + 픽셀통계), Histogram, Profile, Scale Bar(Alt+S) |
| 주석 | Annotation(Alt+A), Text, Pen, Line, Marking, Memo(Post-it), Annotation Color, Edit text |
| 셔터 | Rect/Oval/Free Shutter |
| 필터 | Sharpen, Smoothing, Emboss, Edge enhance, Gamma correction, Contrast, Pseudo Color(Color Mask) |
| 시네 | Auto Play, Loop, Frames/Sec, AVI 내보내기, DSA(Mask Frame) |
| 오버레이 | Show DICOM Overlay(Ctrl+T), Information(Alt+I), Overlay color — 4코너 배치는 DemographicManager |
| 키이미지/GSPS | Key Image, Create Key Image Note(DICOM KO), Attach Key Images, Presentation State(GSPS)+Presentation LUT |
| 저장/클립보드 | Copy(Current region/Whole), Save As, Save all changes(Ctrl+S), Save image changes(Verified) |
| 인쇄 | Print(Ctrl+P), Preview, Print Layout, 실물크기, With Report/Annotations, **DICOM Print**(Laser Imager) |
| 판독 | Report(Ctrl+R), Edit Standard Report, Direct reading, Dictate(Ctrl+D), Convert to DICOM SR, Send SR to server, Approve |
| 정형/치과 | Orthopedics Toolbox, Implant Template(Wizard Hip/Toolbox/Part Zoom/SwitchSide), Dental |
| 기타 | Undo/Redo/Reset(Ctrl+Z), Select All(Ctrl+A), External program(Ctrl+X), Hotkey Configuration, Network test, DICOM TLS |

**확인된 단축키**: Ctrl+W(워크리스트) Ctrl+O(폴더) Ctrl+←/→(이전/다음 검사) Ctrl+C(검사닫기) Ctrl+S(저장) Ctrl+A(전체선택) Ctrl+T(오버레이) Ctrl+M(돋보기) Ctrl+L(캘리퍼) Ctrl+P(인쇄) Ctrl+R(리포트) Ctrl+D(딕테이션) Ctrl+X(외부프로그램) Ctrl+Z(리셋) Alt+A(주석) Alt+I(정보) Alt+S(스케일바).

---

## 4. 툴·아이콘 카탈로그 (이미지 파일 전수 93개)

주의: **뷰어 툴바 아이콘 자체는 PiViewMain.exe 내부 리소스**(ToolBarEx 명령ID)이며 외부 파일이 아니다. 외부 이미지는 3그룹:

**(a) Skin\ — UI 크롬 (40개)**: FrameTop/Left/Right/Bottom.bmp(커스텀 창 프레임), Menu/MDIButtons/Close·Minimize·Maximize·Restore·rollup.bmp(메뉴·타이틀 버튼), buttons_noani/checkbox/radio.tga(버튼류 스킨), toolbar_bg/toolbutton.tga·Rebar.bmp(툴바 normal·hover·pressed), Tab.tga/TabPanel/header/GroupBox.bmp, H·VScroll(Shaft/Thumb)/ScrollArrows/spinner.bmp, dialog_bg/explorer_bg/mdi_bg.bmp, ComboBox/Progressbar/Status.bmp/tree_expander.tga, piview.uis 등 WindowBlinds 정의.

**(b) SR 노드 아이콘 (13종×2)**: CONTAINER, TEXT, CODE, NUM, PNAME, DATE, TIME, DATETIME, UIDREF, IMAGE, COMPOSITE, WAVEFORM, BLANK(.gif) — DICOM SR Value Type별 트리 아이콘(SRReader.xsl 사용).

**(c) CDPublishData 웹 인덱스 크롬 (26개)**: ARR_PREV/ARR_NEXT.GIF(페이징), LOGO.GIF, VIEW_TT/OFF/USE_TT.GIF(뷰어 열기 버튼), MNU_MIN/PLUS.GIF(트리 접기/펼치기), 나머지 테두리·배경 조각.

---

## 5. 디자인/스킨 — 색상·폰트

`Skin\piviewskin.ini` [Skin] — **청회색 라이트 테마 토큰**:

```
DialogBkColor      = RGB(114,130,139)   ← 다이얼로그 배경(진한 blue-gray)
DialogBkColor2     = RGB(142,155,161)   ← 그라데이션 보조
HilightColor       = RGB(201,211,215)   / ShadowColor = RGB(55,59,62)
TreeListColumnColor= RGB(238,246,249)   / TreeListColumnColor2 = RGB(230,239,245)  ← 줄무늬 리스트
TreeListText = RGB(0,0,0), ListBk = RGB(255,255,255)
EditBoxBkColor     = RGB(238,246,249)   ← 옅은 하늘색 입력창
```

`piview.uis`(WindowBlinds "Beacon" 개조): 메뉴 RGB(155,155,155), 활성 타이틀 텍스트 흰색, 프레임 5px. 폰트: UI = **Verdana**(PiView.dat, WEBVIEW.HTM 8pt), 사용자 변경 가능(" Screen/Report Font name and size "). 영상 뷰포트는 검정 배경 + 상태·주석색 사용자 지정.

---

## 6. W/L·LUT 프리셋

**(a) 모달리티별 W/L 프리셋** — `PiView.win`: 모달리티(OT/MR/CT/CR/XA/US/ES/DS/CD/NM)별 프리셋. **CT: Original, Crane(두개), Abdomen, Pelvis, Mediastinum, Bone, Lung**.

**(b) Presentation LUT** — `lut\` 10개(DICOM 파일, DCMTK 3.4.0 생성): linear/lighten/darken/midtone/philips × 256(8bit)/4096(12bit). philips = "Difference between GSDF and Philips Standard Display Curve" — 모니터 GSDF 보정.

**(c) RapidiaMPR MR 윈도 프리셋** — `Preset\WindowMR.dat`(12레코드, 이름+WL/WW): Abdomen T1(165/200), Abdomen T2(266/256), Chest T1 Sag(168/230), Chest T2 Sag(129/290), Head T1Axi(400/858), Head T1Cor(776/880), Head T2Axi(279/948), Neck T1Sag(274/442), Neck T2Sag(62/152), Spine T1Sag(69/168), Spine T2 Sag(316/1264), T1(210/1000). + Window/Organ(SSD)/Threshold 3계층 프리셋과 "Preset Tree/Gallery".

---

## 7. 행잉/템플릿/SR/CD출판

- **행잉**: 기본/현재/고급 3단계, 모달리티 탭·워크스페이스(Diagnose/Verify) 결합, 레지스트리 저장.
- **임플란트 템플릿**: `Templates\` .itf 358개, 파일명 = **11필드 도트 코드**(TemplateCode.xml, Dept.Projection.BodyPart.….Manufacturer.제품.사이즈 — Zimmer/Depuy/Corentec/Biomet/Osstem/Dentium…). 치과 `ToothMap.xml`(FDI↔SNOMED↔ISO3950). "Template Wizard Hip" 등 수술 전 계획 모듈.
- **SR**: `SRCreator.xml` = Basic Text SR(88.11) 스켈레톤 — **TID 2000 "Radiology Report"**: Language→Observer→**History/Findings/Conclusions**→Status(PARTIAL/UNVERIFIED)→Verifier. `SRReader.xsl` = SR→HTML. 뷰어에서 "Convert a report to DICOM SR"/"Send SR to server".
- **CD 출판**("STARPACS CD Publisher 5.0.9.2"): **IHE PDI 준수** — 루트 `INDEX.HTM + README + DICOMDIR + IMAGE\ + DATA\(ActiveX 뷰어, License=CD) + WEBVIEW\(MSXML+XSL 웹뷰어: Layout 1x1~4x4, Auto-Play 500ms, 환자 패널, SR 팝업)` + **RapidiaMPR 전체 사본 동봉**.

---

## 8. RapidiaMPR (3D/MPR)

Intel IPP/IPL(CPU별 dll 스위칭), 모드 = **[Analysis] / [Edit && Segment]** + Report.
- **MPR**: Basic(십자선 드래그 회전, 우클릭 두께), Curved, Freehand, Batch(간격·매수), Path, Slab, 3D Localizer.
- **렌더링**: MIP/MinIP, Volume Rendering, SSD(프리셋), Unfold, Batch Render(회전 캡처), Cine.
- **가상내시경**: Endo VR/Axial/PathMPR/Resolution.
- **세그멘테이션**: Thresholding(2D/3D), Grow(시드+Tolerance), Fence, Sculpt(+Undo/Redo), Paint, Fill Holes, Dilate/Erode, Batch(Spine/Rib 제거).
- **분석**: 3D 거리/각도/Curve/Path distance, ROI, **Volume 계산**, **Calcium Scoring**(Export), **Time Density Curve**, Grid, Annotate.
- **산출**: Capture→Image Gallery→Report(드래그 셀 배치, HTML Report), AVI, DICOM 저장·전송.

---

## 9. 기능 상관관계 맵

```
[로그인 LogIn.ini] → [Exam List] ←검색← Worklist Wizard(기간/조건)
   │  소스: Local DB(Access) ┃ Spectra 서버(MSP:8000) ┃ DICOM Q/R ┃ 폴더/CD
   │  표시: Layout\*.lda(컬럼·폭) + Modality 탭(PiView.mol) + Status Colors(판독상태)
   ├─열기→ [Viewer] 행잉(Default→Advanced) · W/L(PiView.win) · LUT(lut\) · 오버레이 4코너(DemographicManager)
   │        · 툴바 워크스페이스(Default/Diagnose/Verify, 레지스트리 로밍) · 측정/주석/필터/시네/KO/GSPS
   │        · 정형 템플릿(Templates\) · 3D(RapidiaMPR: MPR/VR/내시경/세그먼트→Gallery→HTML Report)
   ├─판독→ [Report] Direct/Standard → Dictation → Dictated→Transcribed→Verified→Approved(1·2) [색상 반영]
   │        → SR(TID2000) → SR서버 전송 · 전자서명(MFKSign)
   └─출력→ 인쇄(Windows/DICOM Print) ┃ CD(IHE PDI) ┃ 전송(Send/DICOMRouter/TeleGate) ┃ Export(AVI/CSV/클립보드)
설정→화면: piviewskin.ini→UI 색 ┃ .lda→컬럼 ┃ PiView.win→W/L ┃ .lut→감마 ┃ PiView.tbr→툴바 ┃ msp.ini→서버
```

---

## 10. In Viewer 구현 권고 (우선순위)

**P0 — INFINITT 사용감의 핵심**
1. 워크리스트: 모달리티 탭 + 기간 프리셋(Today/Yesterday/달력) + 판독상태 색 코딩 + 컬럼 폭 저장(.lda 등가 JSON). 더블클릭, Ctrl+←/→.
2. 뷰포트 격자 1x1~4x4 + 시리즈 썸네일 + 시리즈 정렬(4기준) + Scout 참조선 + CrossLink.
3. W/L 모달리티별 프리셋(CT: Crane/Abdomen/Pelvis/Mediastinum/Bone/Lung) + Invert + 드래그 W/L + 전체 적용.
4. 기본 툴: Zoom(1~3000%, Fit/100%), Pan, Magnifier, Rotate/Flip, Caliper/Angle/Cobb/ROI(+통계), 주석(Text/Pen/Arrow), Scale Bar, Reset.
5. 오버레이 4코너 시스템: DICOM 필드 토큰+prefix/suffix+표시/인쇄 모드 분리(DemographicManager 모델).
6. 단축키 체계 재현 + 사용자 재정의(Hotkey Configuration).

**P1 — 판독 워크플로**: Cine+멀티프레임 · Key Image Note(KO)+GSPS · 행잉(기본→모달리티→고급)+멀티모니터 · Report 패널+상태전이+SR(TID2000) · 필터/Pseudo Color/셔터 · DICOM Q/R·Retrieve Queue·Import.

**P2 — 차별화**: MPR 3면+Slab(십자선+우클릭 두께 UX) · 인쇄/반출(PII 게이트) · 정형 템플릿(니치) · 디자인 토큰 — 원본 라이트 청회색은 **보조 테마**로, 기본은 다크+검정 뷰포트.

**아키텍처 교훈**: ① 컬럼/툴바/W-L/오버레이/행잉 전부 **외부화된 선언적 설정**+사용자 로밍 — In Viewer도 사용자별 JSON 설정으로 동일 원칙. ② 위성 앱 느슨 결합 → 웹은 모듈 lazy-load. ③ CD출판 IHE PDI는 반출 설계 참조.
