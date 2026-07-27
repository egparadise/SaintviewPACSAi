"""검사(DICOM) 내보내기 — CD/USB/로컬 저장용 미디어 생성.

Orthanc 의 `create-media` 로 **DICOMDIR 포함 ZIP** 을 받아 그대로 주거나(폴더·USB 저장용),
ISO9660 이미지로 변환해 준다(CD 굽기용 — 브라우저는 CD 를 직접 구울 수 없으므로
사용자가 ISO 를 내려받아 Windows 탐색기의 '디스크 이미지 굽기' 로 마무리한다).

⚠ 병원 스코프는 호출측(API)에서 검사마다 확인한 뒤 여기로 넘어온다.
"""
from __future__ import annotations

import io
import logging
import zipfile

log = logging.getLogger(__name__)

# 한 번에 내보낼 수 있는 최대 검사 수 — 실수로 워크리스트 전체를 굽는 것 방지
MAX_STUDIES = 200
# CD 한 장 용량(700MB) — 초과 시 경고만(굽기 자체는 사용자 판단)
CD_BYTES = 700 * 1024 * 1024


def build_media_zip(client, orthanc_ids: list[str]) -> bytes:
    """Orthanc 검사들을 DICOMDIR 포함 ZIP 으로 묶는다(표준 DICOM 미디어 구성)."""
    if not orthanc_ids:
        raise ValueError("내보낼 검사가 없습니다")
    # create-media: DICOMDIR 를 포함한 미디어. Extended 는 일부 버전에만 있어 기본형 사용.
    r = client._client.post(
        "/tools/create-media",
        json={"Resources": orthanc_ids, "Extended": True},
        timeout=600.0,
    )
    if r.status_code == 404:   # 구버전 폴백 — 리소스 배열만 받는 형태
        r = client._client.post("/tools/create-media", json=orthanc_ids, timeout=600.0)
    r.raise_for_status()
    return r.content


def zip_to_iso(zip_bytes: bytes, volume_label: str = "SAINTVIEW") -> bytes:
    """DICOMDIR ZIP → ISO9660(Joliet) 이미지. Windows 에서 우클릭 '디스크 이미지 굽기' 로 굽는다.

    DICOM 미디어 규격상 파일명은 8.3 대문자라 ISO9660 level 1 로도 충분하지만,
    뷰어/안내문 등 긴 이름을 위해 Joliet 을 함께 넣는다.
    """
    import pycdlib   # 지연 import — 내보내기를 쓰지 않는 배포에서는 없어도 기동된다

    iso = pycdlib.PyCdlib()
    iso.new(interchange_level=3, joliet=3, vol_ident=volume_label[:32])
    made_dirs: set[str] = set()

    def _iso_name(part: str, is_dir: bool) -> str:
        # ISO9660 은 대문자·숫자·언더스코어만 안전. 파일은 확장자 없으면 '.;1'
        safe = "".join(ch if (ch.isalnum() or ch == "_") else "_" for ch in part.upper())
        safe = safe[:30] or "_"
        return safe if is_dir else (safe if "." in safe else safe) + ";1"

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            parts = [p for p in info.filename.replace("\\", "/").split("/") if p]
            if not parts:
                continue
            # 상위 디렉터리 생성(중복 방지)
            iso_dir = ""
            joliet_dir = ""
            for d in parts[:-1]:
                iso_dir += "/" + _iso_name(d, True)
                joliet_dir += "/" + d[:64]
                if iso_dir not in made_dirs:
                    iso.add_directory(iso_path=iso_dir, joliet_path=joliet_dir)
                    made_dirs.add(iso_dir)
            data = zf.read(info)
            iso.add_fp(
                io.BytesIO(data), len(data),
                iso_path=iso_dir + "/" + _iso_name(parts[-1], False),
                joliet_path=joliet_dir + "/" + parts[-1][:64],
            )

    out = io.BytesIO()
    iso.write_fp(out)
    iso.close()
    return out.getvalue()
