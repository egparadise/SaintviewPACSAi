"""Exam Control API — 관리자용 검사 QC 화면(/api/examctl).

접근 가드: 시스템 관리자=전체 병원, 병원 소속 사용자=자기 병원 검사만.
권한(유효 권한 effective_perms 체계): 삭제/복구=study.delete, Unassign=study.unmatch,
Assign=study.match. 타 병원으로의 Assign 은 시스템 관리자만. 전 작업 감사 로그.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import current_user, require_effective
from app.db import get_db
from app.models import AuditLog, Instance, Series, Study
from app.services import examctl_service as svc

router = APIRouter(prefix="/api/examctl", tags=["examctl"])


def _is_system_admin(user: dict) -> bool:
    return user.get("role") == "admin" and not user.get("hid")


def _require_study_access(user: dict, study: Study) -> None:
    """시스템 관리자=전체, 병원 소속=자기 병원 검사만."""
    if _is_system_admin(user):
        return
    if user.get("hid") and study.hospital_id == user.get("hid"):
        return
    raise HTTPException(status_code=403, detail="이 병원의 검사에 접근할 권한이 없습니다")


class SelectionBody(BaseModel):
    series_uids: list[str] = []
    sop_uids: list[str] = []


class AssignBody(SelectionBody):
    target_study_id: int


def _resolve_selection(
    db: Session, user: dict, body: SelectionBody
) -> tuple[list[Series], list[Instance], list[Study]]:
    """선택 uid → DB 행 + 영향 검사(병원 가드 통과) 해석."""
    if not body.series_uids and not body.sop_uids:
        raise HTTPException(status_code=400, detail="대상 시리즈/이미지를 선택하세요")
    series, instances = svc.load_selection(db, body.series_uids, body.sop_uids)
    if not series and not instances:
        raise HTTPException(status_code=404, detail="대상을 찾을 수 없습니다")
    studies = svc.affected_studies(db, series, instances)
    for st in studies:
        _require_study_access(user, st)
    return series, instances, studies


def _audit(db: Session, user: dict, action: str, body: SelectionBody, extra: dict) -> None:
    db.add(AuditLog(
        account_id=user.get("uid"),
        action=action,
        target_type="study",
        target_id="",
        detail={
            "by": user.get("sub", ""),
            "series": body.series_uids[:20],
            "images": body.sop_uids[:20],
            "n_series": len(body.series_uids),
            "n_images": len(body.sop_uids),
            **extra,
        },
    ))


def _scoped_hid(db: Session, user: dict, selected: int) -> int | None:
    from app.api.worklist import _scoped_hospital

    return _scoped_hospital(db, user, selected)


# ════════════════════════════════ 조회 ════════════════════════════════
@router.get("/studies")
def list_studies(
    hid: int = Query(0, description="병원 스코프(시스템 관리자용, 0=전체)"),
    q: str = Query("", description="환자 ID/이름 검색"),
    limit: int = Query(100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
):
    """검사 목록 — worklist 검색 재사용(소프트 삭제는 시리즈/이미지 단위라 검사는 유지)."""
    from app.services.study_service import WorklistFilter, search_worklist

    items, total = search_worklist(db, WorklistFilter(
        patient_query=q,
        hospital_id=_scoped_hid(db, user, hid),
        limit=limit,
        offset=offset,
    ))
    return {"items": items, "total": total}


@router.get("/studies/{study_id}/tree")
def study_tree(
    study_id: int, db: Session = Depends(get_db), user: dict = Depends(current_user)
):
    """시리즈→이미지 트리 — Exam Control 은 deleted 포함(플래그) 표시."""
    study = db.get(Study, study_id)
    if not study:
        raise HTTPException(status_code=404, detail="검사를 찾을 수 없습니다")
    _require_study_access(user, study)
    return svc.study_tree(db, study)


@router.get("/trash")
def trash(
    hid: int = Query(0, description="병원 스코프(시스템 관리자용, 0=전체)"),
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
):
    """휴지통 — 소프트 삭제된 시리즈/이미지 목록(Recovery 대상)."""
    return {"items": svc.trash_items(db, _scoped_hid(db, user, hid))}


# ════════════════════════════════ 삭제 / 복구 ════════════════════════════════
@router.post("/delete")
def delete_items(
    body: SelectionBody,
    db: Session = Depends(get_db),
    user: dict = Depends(require_effective("study.delete")),
):
    """소프트 삭제(휴지통) — 시리즈 삭제는 하위 이미지 포함. Orthanc 원본은 불변."""
    series, instances, studies = _resolve_selection(db, user, body)
    d_series, d_images = svc.soft_delete(db, series, instances)
    for st in studies:
        svc.sync_counts(db, st)
    _audit(db, user, "examctl_delete", body,
           {"deleted_series": d_series, "deleted_images": d_images})
    db.commit()
    return {"deleted_series": d_series, "deleted_images": d_images}


@router.post("/restore")
def restore_items(
    body: SelectionBody,
    db: Session = Depends(get_db),
    user: dict = Depends(require_effective("study.delete")),
):
    """복구(Recovery) — 휴지통에서 되살린다(이미지 복구는 부모 시리즈도 복구)."""
    series, instances, studies = _resolve_selection(db, user, body)
    r_series, r_images = svc.restore(db, series, instances)
    for st in studies:
        svc.sync_counts(db, st)
    _audit(db, user, "examctl_restore", body,
           {"restored_series": r_series, "restored_images": r_images})
    db.commit()
    return {"restored_series": r_series, "restored_images": r_images}


# ════════════════════════════════ Unassign / Assign ════════════════════════════════
@router.post("/unassign")
def unassign_items(
    body: SelectionBody,
    db: Session = Depends(get_db),
    user: dict = Depends(require_effective("study.unmatch")),
):
    """선택 항목을 현재 검사에서 분리 — 병원별 미배정(UNASSIGNED) 버킷 검사로 이동."""
    series, instances, studies = _resolve_selection(db, user, body)
    moved, bucket_id, buckets = svc.unassign_items(db, series, instances)
    for st in studies + buckets:
        svc.sync_counts(db, st)
    _audit(db, user, "examctl_unassign", body, {"moved": moved, "bucket_study_id": bucket_id})
    db.commit()
    return {"moved": moved, "bucket_study_id": bucket_id}


@router.post("/assign")
def assign_items(
    body: AssignBody,
    db: Session = Depends(get_db),
    user: dict = Depends(require_effective("study.match")),
):
    """선택 항목(미배정 포함)을 대상 검사로 이동(재귀속) — 앱 DB 계층만, DICOM 태그 불변."""
    target = db.get(Study, body.target_study_id)
    if not target:
        raise HTTPException(status_code=404, detail="대상 검사를 찾을 수 없습니다")
    _require_study_access(user, target)
    series, instances, studies = _resolve_selection(db, user, body)
    # 타 병원(소스↔대상 병원 상이) 이동은 시스템 관리자만
    if not _is_system_admin(user):
        for st in studies:
            if st.hospital_id != target.hospital_id:
                raise HTTPException(
                    status_code=403, detail="타 병원으로의 이동은 시스템 관리자만 가능합니다"
                )
    moved = svc.move_items(db, target, series, instances)
    if moved == 0:
        # 자기 자신(이미 대상 검사 소속)으로의 assign 차단 — 이동 항목 0 이면 부작용 없음
        raise HTTPException(
            status_code=400,
            detail="이동할 항목이 없습니다 — 선택 항목이 이미 대상 검사에 속해 있습니다"
            " (자기 자신으로는 이동할 수 없습니다)",
        )
    for st in studies + [target]:
        svc.sync_counts(db, st)
    _audit(db, user, "examctl_assign", body,
           {"moved": moved, "target_study_id": target.id})
    db.commit()
    return {"moved": moved}
