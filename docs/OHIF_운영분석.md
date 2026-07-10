# OHIF 운영 분석 — 무엇이, 어떻게 동작하는가 (레인 O)

> 관리자 콘솔 [인프라] 패널의 "어떻게 동작하나" 가이드 원본 문서.
> 구성 소스: `deploy/docker-compose.yml`(ohif 서비스) + `deploy/ohif/app-config.js` + `deploy/ohif/nginx-default.conf`.

## 1. OHIF가 무엇인가

- **OHIF Viewer**(Open Health Imaging Foundation)는 오픈소스 **웹 DICOM 뷰어**다. Saintview 자체 뷰어(2D/3D/Infi)와 별개로, 표준 DICOMweb 기반의 범용 참조 뷰어로 함께 배포한다.
- 이미지: `ohif/app:v3.9.2` — 빌드된 정적 SPA(React)를 **nginx**가 서빙하는 컨테이너.
- 컨테이너 이름: `saintview-ohif`, 포트 매핑: **호스트 3000 → 컨테이너 80**.
- OHIF 자체는 **아무 데이터도 저장하지 않는다.** 화면·조작만 담당하고, 영상 데이터는 전부 Orthanc(DICOMweb)에서 조회한다.

## 2. 어떻게 동작하는가 (구성 3요소)

### 2.1 docker-compose.yml — 컨테이너 정의

```yaml
ohif:
  image: ohif/app:v3.9.2
  container_name: saintview-ohif
  depends_on: [orthanc]
  ports: ["3000:80"]
  volumes:
    - ./ohif/app-config.js:/usr/share/nginx/html/app-config.js:ro   # 앱 설정 주입
    - ./ohif/nginx-default.conf:/etc/nginx/conf.d/default.conf:ro   # 프록시 주입
```

- 두 볼륨 마운트(**읽기 전용**)가 핵심이다. 이미지를 다시 빌드하지 않고 호스트 파일 교체 + 컨테이너 재시작만으로 설정을 바꾼다.

### 2.2 app-config.js — OHIF 앱 설정 (설정 위치 ①)

- 경로: `deploy/ohif/app-config.js` → 컨테이너 `/usr/share/nginx/html/app-config.js`.
- 데이터소스는 1개(`dicomweb`)이며 **상대경로 `/dicom-web`** 을 가리킨다:
  - `wadoUriRoot` / `qidoRoot` / `wadoRoot` = `/dicom-web`
  - `imageRendering`/`thumbnailRendering` = `wadors`, `enableStudyLazyLoad` = true
- 상대경로를 쓰는 이유: OHIF(3000)와 DICOMweb이 **같은 오리진**이 되어 브라우저 CORS 문제를 원천 차단하기 위해서다(아래 2.3 프록시가 완성).

### 2.3 nginx-default.conf — 같은 오리진 프록시 (설정 위치 ②)

- 경로: `deploy/ohif/nginx-default.conf` → 컨테이너 `/etc/nginx/conf.d/default.conf`.
- `location /dicom-web/ { proxy_pass http://orthanc:8042/dicom-web/; }` — OHIF로 들어온 DICOMweb 요청을 compose 내부 네트워크의 **Orthanc(8042)** 로 중계한다.
- `/rendered` 경로는 `Accept: image/png` 를 강제한다(브라우저의 `image/avif` Accept를 Orthanc가 400 처리하는 문제 우회).
- dev 환경에선 CORS 헤더(`Access-Control-Allow-Origin *`)도 붙여 Saintview 프론트(5173)의 Cornerstone3D 볼륨 로딩까지 허용한다.

## 3. 데이터 흐름 다이어그램 (텍스트)

```
[브라우저]
   │  http://<서버>:3000            (OHIF SPA 정적 파일)
   ▼
[saintview-ohif 컨테이너: nginx]
   │  /               → 정적 SPA (index.html, app-config.js)
   │  /dicom-web/*    → proxy_pass ───────────────┐
   ▼                                              ▼
   (같은 오리진 — CORS 없음)          [saintview-orthanc 컨테이너: 8042]
                                        │  QIDO-RS  /dicom-web/studies      (검사 목록)
                                        │  WADO-RS  /dicom-web/.../frames   (픽셀 데이터)
                                        │  /rendered                        (썸네일 PNG)
                                        ▼
                                     [Orthanc 저장소 volume: saintview_orthanc]

장비(CT/MR…) ──C-STORE(4242)──▶ saintview-orthanc ◀──REST/DICOMweb── Saintview 백엔드(8000)
```

- 조회 순서: OHIF 접속 → QIDO-RS로 검사/시리즈 목록 → 사용자가 검사 선택 → WADO-RS로 인스턴스/프레임 로딩 → Cornerstone 렌더링.
- 인증: dev 프로필은 `ORTHANC__AUTHENTICATION_ENABLED=false`(프록시에 인증 헤더가 없기 때문). **운영 배포 시 true + 프록시단 인증이 필수**(compose 주석·prod 게이트 참조).

## 4. 운영 시 만지는 곳 요약

| 하려는 일 | 위치 | 방법 |
|---|---|---|
| OHIF 시작/중지/재시작 | 관리자 콘솔 [인프라] 또는 `docker restart saintview-ohif` | 컨테이너 액션(감사 로그 기록) |
| 데이터소스(Orthanc 주소) 변경 | `deploy/ohif/nginx-default.conf` 의 `proxy_pass` | 파일 수정 후 재시작 |
| 뷰어 동작 옵션(지연 로딩·워커 수 등) | `deploy/ohif/app-config.js` | 파일 수정 후 재시작 |
| OHIF 버전 업그레이드 | `deploy/docker-compose.yml` 의 `image:` 태그 | `docker compose up -d ohif` |
| 상태 확인 | GET `/api/infra/containers`, GET `/api/infra/ohif/config` | 패널 상태등(●) |

## 5. 병원별 컨테이너 구조와의 관계

- 영상 저장은 `deploy/hospital-orthanc.template.yml` 로 병원별 Orthanc(`saintview-orthanc-h{hid}`, 포트 자동 할당, 병원별 볼륨)를 프로비저닝해 **물리 분리**할 수 있다(레지스트리: 전역 설정 `infra.containers`).
- 백엔드 Orthanc 접근은 `app/dicom/orthanc.py: client_for_hospital()` 이 병원별 URL을 해석하고, 미등록 병원은 **공유 컨테이너로 폴백**한다(기존 동작 무회귀).
- 현재 배포되는 OHIF는 공유 Orthanc 1대를 바라본다. 병원별 Orthanc를 OHIF에서 보려면 nginx `proxy_pass` 대상을 해당 컨테이너로 바꾸거나 병원별 OHIF를 별도 기동해야 한다(추후 과제 — 패널에 정직하게 안내).
- **DB는 이미 hospital_id 논리 분리**이며 병원 단위 백업/복원/지우기는 유지관리(레인 B)가 제공한다 — 컨테이너 분리는 영상 저장소에 대한 것이다.

## 6. 알려진 주의점

1. `app-config.js` 는 컨테이너에 **:ro** 마운트 — 컨테이너 안에서 고치지 말 것(재시작 시 소실 아님, 애초에 수정 불가). 호스트 파일이 원본이다.
2. Orthanc 인증을 켜면(운영) 프록시에 Basic 헤더 주입이 없는 현 nginx 설정으로는 OHIF 조회가 401 — `proxy_set_header Authorization` 추가가 함께 필요하다.
3. `showWarningMessageForCrossOrigin=false` 등은 dev 편의 설정 — 외부 공개 시 재검토.
4. 포트 3000이 사용 중이면 OHIF가 뜨지 않는다 — `docker ps` 상태와 포트 충돌부터 확인.
