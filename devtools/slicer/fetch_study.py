# -*- coding: utf-8 -*-
"""Slicer Python Console용 — Orthanc DICOMweb에서 검사 pull 후 로드.

실행(콘솔): exec(open(r"...fetch_study.py", encoding="utf-8").read())
          load_study("<StudyInstanceUID>")
"""
import os
import tempfile

ORTHANC = os.environ.get("SAINTVIEW_ORTHANC_URL", "http://localhost:8042")
AUTH = (os.environ.get("SAINTVIEW_ORTHANC_USER", "saintview"),
        os.environ.get("SAINTVIEW_ORTHANC_PASSWORD", "saintview_dev"))


def load_study(study_uid: str):
    """StudyUID로 Orthanc에서 모든 인스턴스를 받아 DICOM 모듈로 로드."""
    import requests  # Slicer 내장
    import slicer
    from DICOMLib import DICOMUtils

    found = requests.post(
        f"{ORTHANC}/tools/find", auth=AUTH,
        json={"Level": "Study", "Query": {"StudyInstanceUID": study_uid}},
    ).json()
    if not found:
        raise RuntimeError(f"Orthanc에서 검사 미발견: {study_uid}")
    orthanc_study = found[0]

    tmpdir = tempfile.mkdtemp(prefix="saintview_slicer_")
    instances = requests.get(f"{ORTHANC}/studies/{orthanc_study}/instances", auth=AUTH).json()
    for i, inst in enumerate(instances):
        dcm = requests.get(f"{ORTHANC}/instances/{inst['ID']}/file", auth=AUTH).content
        with open(os.path.join(tmpdir, f"{i:05d}.dcm"), "wb") as f:
            f.write(dcm)
    print(f"다운로드 {len(instances)}개 → {tmpdir}")

    with DICOMUtils.TemporaryDICOMDatabase() as db:
        DICOMUtils.importDicom(tmpdir, db)
        patient_uids = db.patients()
        loaded = []
        for p in patient_uids:
            loaded += DICOMUtils.loadPatientByUID(p)
    print(f"로드된 노드: {loaded}")
    return loaded


print("사용법: load_study('<StudyInstanceUID>')  — Saintview 워크리스트에서 UID 복사")
