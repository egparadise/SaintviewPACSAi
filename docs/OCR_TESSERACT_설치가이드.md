# 번인 OCR (Tesseract) 설치·정밀도 가이드

vision 전송 이미지의 번인(burn-in) PHI 마스킹 2단 방어 중 **2단(OCR)** 은 Tesseract가 설치돼야 동작한다.
미설치 시에도 **1단(상·하단 10% 스트립 마스킹)** 은 항상 적용되며, OCR 단계만 건너뛴다(무중단 폴백).
관련 코드: `backend/app/rag/image_guard.py`.

## 1. 설치

### Windows
```powershell
# winget 또는 UB-Mangoldt 빌드 설치 후 PATH 등록
winget install --id UB-Mangoldt.TesseractOCR
# 설치 경로 예: C:\Program Files\Tesseract-OCR\tesseract.exe
```
PATH에 없으면 코드에서 지정:
```python
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
```

### Linux (Docker/배포)
```bash
apt-get update && apt-get install -y tesseract-ocr tesseract-ocr-kor   # 한글 번인 시 kor 추가
```

### Python 패키지
```bash
pip install pytesseract pillow   # requirements.txt의 주석 해제
```

## 2. 정밀도 설정 (환경변수)

`backend/.env`에서 기관별 번인 폰트·언어에 맞춰 조정한다.

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `SAINTVIEW_OCR_LANG` | `eng` | 번인은 대개 ASCII. 한글 번인이면 `kor+eng` (kor 언어팩 필요) |
| `SAINTVIEW_OCR_MIN_CONF` | `35` | 신뢰도 임계(0~100). 낮추면 더 공격적 마스킹(오검출↑), 높이면 보수적 |
| `SAINTVIEW_OCR_CONFIG` | `--psm 11` | 페이지 분할 모드. 11=sparse text(흩어진 번인 검출에 유리). 조밀한 텍스트면 `--psm 6` |

## 3. 동작 확인
```bash
python -c "import pytesseract; print(pytesseract.get_tesseract_version())"
```
버전이 출력되면 OCR 단계가 활성화된다. `image_guard.mask_burn_in()` 호출 시 로그에
`OCR 불가 — 스트립 마스킹만 적용`이 더 이상 찍히지 않으면 정상.

## 4. 권장 운영
- 한글 환자명·기관명 번인이 있는 장비(US/2차 캡처 등)는 `kor+eng` + 언어팩 설치 권장.
- 번인 위치가 상·하단 가장자리에 한정되면 OCR 없이 스트립 비율(`TOP_RATIO`/`BOTTOM_RATIO`)만으로 충분.
- vision 자체를 끄려면 설정>AI 정책에서 `ai.policy.vision`을 비활성화(opt-in 기본값).
