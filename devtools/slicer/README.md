# 3D Slicer 개발 플랫폼 (devtools)

> **용도**: 서비스 내장이 아닌 **개발·검증용** (사용자 결정 2026-06-11).
> ① 새 AI 모델(병변 분할) 프로토타이핑 ② 자체 MPR/MIP(Cornerstone3D 뷰어) 결과의 시각적 교차 검증.
> VTK/ITK 기반 완성형 도구이므로 알고리즘 레퍼런스로 활용한다.

## 설치
1. https://download.slicer.org — Stable(5.6+) 설치
2. Saintview 스택 기동: `docker compose -f deploy/docker-compose.yml up -d`
3. Slicer 메뉴 `View > Python Console`에서 아래 스크립트 실행

## 스크립트

| 파일 | 용도 |
|---|---|
| `fetch_study.py` | Orthanc DICOMweb에서 StudyUID로 검사 pull → Slicer 로드 |
| `validate_mpr_mip.py` | 로드된 볼륨에 4분할(MPR 3면+3D) + MIP 레이아웃 구성 — **Cornerstone3D 뷰어와 동일 검사로 비교**(W/L·slab 두께 일치 여부 확인) |
| `segment_prototype.py` | 병변 분할 프로토타입: HU threshold 분할 + 부피/통계 → AI 분할 모델로 교체할 골격 |

## 사용 예 (Python Console)

```python
exec(open(r"C:/Project/SaintviewPACSai/devtools/slicer/fetch_study.py", encoding="utf-8").read())
load_study("1.2.840.999.x.x")        # Saintview 워크리스트에서 StudyUID 복사

exec(open(r"C:/Project/SaintviewPACSai/devtools/slicer/validate_mpr_mip.py", encoding="utf-8").read())
setup_mpr_mip(slab_mm=30)            # Cornerstone 뷰어의 MIP slab과 같은 값으로

exec(open(r"C:/Project/SaintviewPACSai/devtools/slicer/segment_prototype.py", encoding="utf-8").read())
segment_by_threshold(low_hu=-600, high_hu=-400, name="LesionProto")
```

## 검증 절차 (MPR/MIP 교차 검증)
1. 같은 검사를 Saintview 3D 뷰어(Cornerstone3D)와 Slicer에 로드
2. 동일 W/L·동일 slab 두께 설정 → 단면 위치(IS/AP/LR mm)를 맞춰 스크린샷 비교
3. 불일치 시 의심 순서: ① 보간 방식 ② slab 적용 축 ③ spacing 메타데이터(QIDO 메타 누락)

## AI 분할 모델 연구 경로
- `segment_prototype.py`의 threshold 부분을 모델 추론으로 교체:
  Slicer Extension **TotalSegmentator**(전신 104 구조물) 또는 **MONAILabel** 설치 후
  `slicer.modules.totalsegmentator` 호출 — 결과 Segmentation을 같은 통계 코드로 정량화.
- 검증된 분할 결과는 DICOM SEG로 내보내 Orthanc에 저장하면(동일 StudyUID)
  Saintview/OHIF에서 오버레이로 확인 가능 — 서비스 편입 전 평가 루프.

⚠ PHI: Slicer로 불러온 실환자 데이터는 devtools 밖으로 내보내지 말 것(스크린샷 포함 §8.1 준수).
