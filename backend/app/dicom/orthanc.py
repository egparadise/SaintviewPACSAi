"""Orthanc 클라이언트 (D-3) — DICOMweb 위임 + 메타 동기화."""
from __future__ import annotations

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger("saintview.orthanc")


class OrthancClient:
    def __init__(self) -> None:
        s = get_settings()
        self._client = httpx.Client(
            base_url=s.orthanc_url,
            auth=(s.orthanc_user, s.orthanc_password),
            timeout=30,
        )

    def alive(self) -> bool:
        try:
            return self._client.get("/system").status_code == 200
        except httpx.HTTPError:
            return False

    def upload_dicom(self, data: bytes) -> dict:
        """단일 DICOM 인스턴스 업로드(Orthanc REST — 하네스용)."""
        r = self._client.post("/instances", content=data)
        r.raise_for_status()
        return r.json()

    def qido_studies(self, **params) -> list[dict]:
        r = self._client.get("/dicom-web/studies", params=params)
        r.raise_for_status()
        return r.json()

    def study_metadata(self, orthanc_study_id: str) -> dict:
        r = self._client.get(f"/studies/{orthanc_study_id}")
        r.raise_for_status()
        return r.json()

    def list_changes(self, since: int = 0, limit: int = 100) -> dict:
        """Orthanc 변경 피드 — 신규 검사 동기화(폴링)."""
        r = self._client.get("/changes", params={"since": since, "limit": limit})
        r.raise_for_status()
        return r.json()

    def study_instances(self, orthanc_study_id: str) -> list[dict]:
        """검사 인스턴스 목록 — 키이미지 선택 UI용(F-16)."""
        r = self._client.get(f"/studies/{orthanc_study_id}/instances")
        r.raise_for_status()
        out = []
        for inst in r.json():
            tags = inst.get("MainDicomTags", {})
            out.append({
                "orthanc_id": inst["ID"],
                "sop_uid": tags.get("SOPInstanceUID", ""),
                "instance_number": int(tags.get("InstanceNumber") or 0),
            })
        out.sort(key=lambda x: x["instance_number"])
        return out

    def instance_meta(self, orthanc_instance_id: str) -> dict:
        """SOPClassUID·SeriesUID 등 — KOS 참조 무결성용."""
        r = self._client.get(f"/instances/{orthanc_instance_id}/tags?simplify")
        r.raise_for_status()
        t = r.json()
        return {
            "sop_class_uid": t.get("SOPClassUID", ""),
            "series_uid": t.get("SeriesInstanceUID", ""),
        }

    def instance_preview_png(self, orthanc_instance_id: str) -> bytes | None:
        try:
            r = self._client.get(
                f"/instances/{orthanc_instance_id}/preview", headers={"Accept": "image/png"}
            )
            r.raise_for_status()
            return r.content
        except httpx.HTTPError:
            return None

    def study_preview_png(self, orthanc_study_id: str) -> bytes | None:
        """검사 대표(중간) 인스턴스의 렌더링 PNG — vision 분석용(F-11).

        ⚠ 번인 PHI 마스킹(설계 §8.1)은 P2 — 현재는 ai.policy.vision 토글로 opt-in.
        """
        try:
            r = self._client.get(f"/studies/{orthanc_study_id}/instances")
            r.raise_for_status()
            instances = r.json()
            if not instances:
                return None
            mid = instances[len(instances) // 2]["ID"]
            r = self._client.get(f"/instances/{mid}/preview", headers={"Accept": "image/png"})
            r.raise_for_status()
            return r.content
        except httpx.HTTPError:
            return None

    def close(self) -> None:
        self._client.close()


def sync_new_studies(db, client: OrthancClient, since: int = 0) -> tuple[int, int]:
    """Orthanc 변경 피드 → studies 테이블 동기화 + AI 작업 큐 등록.

    반환: (등록 검사 수, 마지막 change seq)
    """
    from app.config import get_settings
    from app.services.study_service import queue_ai_job, register_study

    changes = client.list_changes(since=since)
    registered = 0
    for ch in changes.get("Changes", []):
        if ch.get("ChangeType") != "StableStudy":
            continue
        meta = client.study_metadata(ch["ID"])
        tags = meta.get("MainDicomTags", {})
        ptags = meta.get("PatientMainDicomTags", {})
        study = register_study(
            db,
            study_uid=tags.get("StudyInstanceUID", ""),
            patient_key=ptags.get("PatientID", "UNKNOWN"),
            patient_name=ptags.get("PatientName", ""),
            birth_date=ptags.get("PatientBirthDate", ""),
            sex=ptags.get("PatientSex", ""),
            accession_no=tags.get("AccessionNumber", ""),
            study_date=tags.get("StudyDate", ""),
            study_time=tags.get("StudyTime", ""),
            modality=tags.get("ModalitiesInStudy", "").split("\\")[0]
            if tags.get("ModalitiesInStudy")
            else "",
            study_desc=tags.get("StudyDescription", ""),
            orthanc_id=ch["ID"],
        )
        if study.status == "received" and get_settings().ai_auto_generate:
            queue_ai_job(db, study)
        registered += 1
    return registered, changes.get("Last", since)
