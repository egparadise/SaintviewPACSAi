"""ORM 모델 — 설계 문서 §5 데이터 모델 1:1 구현.

벡터 컬럼(D-1): PostgreSQL이면 pgvector, SQLite(개발)면 JSON 직렬화 폴백.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import get_settings
from app.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _vector_type():
    settings = get_settings()
    if settings.is_postgres:
        from pgvector.sqlalchemy import Vector

        return Vector(settings.embedding_dim)
    return JSON  # SQLite 폴백: list[float] JSON 저장, 검색은 인메모리(numpy)


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_key: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    # 화면분석 §5.5 Patient ID Prefix → issuer 분리 (P2 대비)
    issuer: Mapped[str] = mapped_column(String(64), default="")
    name_masked: Mapped[str] = mapped_column(String(128), default="")
    birth_date: Mapped[str] = mapped_column(String(8), default="")  # YYYYMMDD
    sex: Mapped[str] = mapped_column(String(8), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    studies: Mapped[list["Study"]] = relationship(back_populates="patient")


class Study(Base):
    __tablename__ = "studies"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), index=True)
    study_uid: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    accession_no: Mapped[str] = mapped_column(String(64), default="", index=True)
    study_date: Mapped[str] = mapped_column(String(8), default="", index=True)
    study_time: Mapped[str] = mapped_column(String(16), default="")
    modality: Mapped[str] = mapped_column(String(16), default="", index=True)
    body_part: Mapped[str] = mapped_column(String(64), default="", index=True)
    study_desc: Mapped[str] = mapped_column(String(256), default="")
    clinical_info: Mapped[str] = mapped_column(Text, default="")
    orthanc_id: Mapped[str] = mapped_column(String(64), default="")
    # 워크플로 상태 (디자인 §1.1 상태 토큰과 1:1)
    status: Mapped[str] = mapped_column(
        String(16), default="received", index=True
    )  # received | draft_ready | reading | finalized
    emergency: Mapped[bool] = mapped_column(Boolean, default=False)  # F-15
    # F-16: 키이미지 선택 [{"sop_uid", "orthanc_id", "instance_number"}]
    key_images: Mapped[list] = mapped_column(JSON, default=list)
    series_count: Mapped[int] = mapped_column(Integer, default=0)
    instance_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    patient: Mapped[Patient] = relationship(back_populates="studies")
    series: Mapped[list["Series"]] = relationship(back_populates="study")
    reports: Mapped[list["Report"]] = relationship(back_populates="study")


class Series(Base):
    __tablename__ = "series"

    id: Mapped[int] = mapped_column(primary_key=True)
    study_id: Mapped[int] = mapped_column(ForeignKey("studies.id"), index=True)
    series_uid: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    modality: Mapped[str] = mapped_column(String(16), default="")
    series_desc: Mapped[str] = mapped_column(String(256), default="")
    instance_count: Mapped[int] = mapped_column(Integer, default=0)

    study: Mapped[Study] = relationship(back_populates="series")


class Report(Base):
    """판독 — 버전 행 보존(초안→수정→확정 모두 행으로 남김, 설계 §5)."""

    __tablename__ = "reports"
    __table_args__ = (UniqueConstraint("study_id", "version", name="uq_report_study_version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    study_id: Mapped[int] = mapped_column(ForeignKey("studies.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(
        String(16), default="draft", index=True
    )  # draft | in_review | finalized | rejected
    sr_json: Mapped[dict] = mapped_column(JSON, default=dict)  # 설계 §6.2 스키마
    narrative_text: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), default="ai")  # 'ai' | username
    reviewed_by: Mapped[str] = mapped_column(String(64), default="")
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ai_model: Mapped[str] = mapped_column(String(64), default="")
    ai_sources: Mapped[dict] = mapped_column(JSON, default=dict)  # 근거 추적(§4.4)
    # F-20: AI 초안 vs 확정 불일치 지표
    diff_metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    study: Mapped[Study] = relationship(back_populates="reports")


class ReportEmbedding(Base):
    __tablename__ = "report_embeddings"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"), index=True)
    chunk_seq: Mapped[int] = mapped_column(Integer, default=0)
    section: Mapped[str] = mapped_column(String(32), default="full")  # full|findings|impression
    embedding = mapped_column(_vector_type())
    chunk_text: Mapped[str] = mapped_column(Text, default="")
    # 검색 1차 필터 축 (화면분석 §5.6: Modality × BodyPart)
    modality: Mapped[str] = mapped_column(String(16), default="", index=True)
    body_part: Mapped[str] = mapped_column(String(64), default="", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    algo: Mapped[str] = mapped_column(String(16), default="argon2")
    role: Mapped[str] = mapped_column(String(16), default="radiologist")  # radiologist | admin
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    target_type: Mapped[str] = mapped_column(String(32), default="")
    target_id: Mapped[str] = mapped_column(String(64), default="")
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)


class AiJob(Base):
    __tablename__ = "ai_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    study_id: Mapped[int] = mapped_column(ForeignKey("studies.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32), default="draft")  # draft | regenerate
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    # queued | running | done | failed
    error: Mapped[str] = mapped_column(Text, default="")
    cost_input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_sec: Mapped[float] = mapped_column(Float, default=0.0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Annotation(Base):
    """주석/계측 (07 A.4) — 이미지 정규화 좌표(0~1) 기반, GSPS 내보내기 원천."""

    __tablename__ = "annotations"

    id: Mapped[int] = mapped_column(primary_key=True)
    study_id: Mapped[int] = mapped_column(ForeignKey("studies.id"), index=True)
    series_uid: Mapped[str] = mapped_column(String(128), default="")
    sop_uid: Mapped[str] = mapped_column(String(128), default="", index=True)
    kind: Mapped[str] = mapped_column(String(32), default="line")  # length|angle|rect|ellipse|arrow|text|ctr...
    points: Mapped[list] = mapped_column(JSON, default=list)  # [[x,y], ...] 0~1 정규화
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(16), default="")  # mm|deg|ratio|mm2|px
    text: Mapped[str] = mapped_column(String(512), default="")
    source: Mapped[str] = mapped_column(String(16), default="user")  # user | ai
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)  # ai일 때
    verified: Mapped[bool] = mapped_column(Boolean, default=False)  # numeric_verify 결과
    created_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Order(Base):
    """오더/예약 (RIS — P2) — MWL 항목 원천 + MPPS 상태 매핑."""

    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_key: Mapped[str] = mapped_column(String(128), index=True)
    patient_name: Mapped[str] = mapped_column(String(128), default="")
    birth_date: Mapped[str] = mapped_column(String(8), default="")
    sex: Mapped[str] = mapped_column(String(8), default="")
    accession_no: Mapped[str] = mapped_column(String(64), default="", index=True)
    modality: Mapped[str] = mapped_column(String(16), default="")
    scheduled_date: Mapped[str] = mapped_column(String(8), default="", index=True)  # YYYYMMDD
    scheduled_time: Mapped[str] = mapped_column(String(6), default="")  # HHMMSS
    procedure_desc: Mapped[str] = mapped_column(String(256), default="")
    station_aet: Mapped[str] = mapped_column(String(32), default="")
    # MPPS 매핑: scheduled(예약) → in_progress(IN PROGRESS) → completed(COMPLETED) | cancelled(DISCONTINUED)
    status: Mapped[str] = mapped_column(String(16), default="scheduled", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class AppSetting(Base):
    """설정 — 화면분석 §5.7 교훈 5: scope 오버라이드(global → source → user)."""

    __tablename__ = "app_setting"
    __table_args__ = (UniqueConstraint("scope", "scope_id", "key", name="uq_setting_scope_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    scope: Mapped[str] = mapped_column(String(16), default="global")  # global | source | user
    scope_id: Mapped[str] = mapped_column(String(64), default="")
    key: Mapped[str] = mapped_column(String(128), index=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
