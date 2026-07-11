"""Local Server 모드 — 서버(Orthanc/Postgres)와 완전 분리된 로컬 PACS 서비스.

루트 = server.network.local_share_dir (예: C:\\PACS\\share). 하위 구조(최초 사용 시 자동 생성):
  DB\\local.db  — sqlite3 표준 라이브러리로 독립 관리(서버 SQLAlchemy 세션과 무관,
                  루트 경로가 바뀌면 그 경로의 DB를 사용)
  Image\\       — DICOM 원본 배치: Image\\{PatientID}\\{StudyDate}_{Modality}\\{SOP}.dcm
  Temp\\        — 업로드 임시(처리 후 정리)

보안: iid/id 는 local.db 조회로만 경로를 해석한다(사용자 입력 경로 사용 금지 — traversal 원천 차단).
"""
from __future__ import annotations

import io
import os
import sqlite3
import uuid
from pathlib import Path

import numpy as np
import pydicom
from pydicom.uid import ImplicitVRLittleEndian, generate_uid

# ── 상수 ──────────────────────────────────────────────────────────────────
_DB_SUBDIR = "DB"
_IMAGE_SUBDIR = "Image"
_TEMP_SUBDIR = "Temp"
_DB_NAME = "local.db"
_CHUNK = 1024 * 1024  # 업로드 스트리밍 단위(1MB) — 대용량 안전

_SCHEMA = """
CREATE TABLE IF NOT EXISTS studies (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_key  TEXT NOT NULL,
    patient_name TEXT NOT NULL DEFAULT '',
    sex          TEXT NOT NULL DEFAULT '',
    birth_date   TEXT NOT NULL DEFAULT '',
    study_uid    TEXT NOT NULL,
    study_date   TEXT NOT NULL DEFAULT '',
    modality     TEXT NOT NULL DEFAULT '',
    study_desc   TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_studies_uid ON studies(study_uid);
CREATE TABLE IF NOT EXISTS series (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    study_id      INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    series_uid    TEXT NOT NULL,
    series_number INTEGER NOT NULL DEFAULT 0,
    series_desc   TEXT NOT NULL DEFAULT '',
    modality      TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_series_uid ON series(series_uid);
CREATE TABLE IF NOT EXISTS instances (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id       INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    sop_uid         TEXT NOT NULL,
    instance_number INTEGER NOT NULL DEFAULT 0,
    rows            INTEGER NOT NULL DEFAULT 0,
    cols            INTEGER NOT NULL DEFAULT 0,
    rel_path        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_instances_sop ON instances(sop_uid);
"""


class LocalPacsNotConfigured(Exception):
    """local_share_dir 미설정 — API 계층에서 400으로 변환."""


# ── 루트/구조 ─────────────────────────────────────────────────────────────
def resolve_root(raw: str) -> Path:
    """설정값 → 루트 Path. 빈 값이면 LocalPacsNotConfigured."""
    raw = (raw or "").strip()
    if not raw:
        raise LocalPacsNotConfigured(
            "Local Server 루트가 설정되지 않았습니다 — 설정>서버 네트워크>local_share_dir"
        )
    return Path(raw).resolve()


def init_dirs(root: Path) -> dict:
    """DB/Image/Temp 폴더 구조 생성(idempotent)."""
    dirs = {}
    for sub in (_DB_SUBDIR, _IMAGE_SUBDIR, _TEMP_SUBDIR):
        p = root / sub
        p.mkdir(parents=True, exist_ok=True)
        dirs[sub] = str(p)
    _connect(root).close()  # 스키마도 함께 준비
    return {"ok": True, "root": str(root), "dirs": dirs}


def _connect(root: Path) -> sqlite3.Connection:
    """루트별 local.db 연결 + idempotent 스키마 생성. 호출자가 close 책임."""
    db_dir = root / _DB_SUBDIR
    db_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_dir / _DB_NAME)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(_SCHEMA)
    return conn


# ── Import ────────────────────────────────────────────────────────────────
# Windows 예약 장치명 — 그대로 폴더/파일명으로 쓰면 생성 실패·오동작(CON, NUL 등)
_WIN_RESERVED = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)


def _sanitize(part: str) -> str:
    """경로 구성요소 정화 — 파일시스템 금지문자·경로조작 문자를 '_'로 치환.

    Windows 예약 장치명(CON, NUL, COM1…)은 '_' 접두로 무력화한다(확장자 앞부분 기준).
    """
    cleaned = "".join(c if c.isalnum() or c in "-._^ " else "_" for c in (part or ""))
    cleaned = cleaned.strip(" .")
    if cleaned.split(".")[0].upper() in _WIN_RESERVED:
        cleaned = f"_{cleaned}"
    return cleaned or "UNKNOWN"


def save_upload_to_temp(root: Path, fileobj) -> Path:
    """업로드 파일을 Temp에 스트리밍 저장(대용량 안전) 후 경로 반환."""
    temp_dir = root / _TEMP_SUBDIR
    temp_dir.mkdir(parents=True, exist_ok=True)
    tmp = temp_dir / f"up_{uuid.uuid4().hex}.tmp"
    with open(tmp, "wb") as out:
        while True:
            chunk = fileobj.read(_CHUNK)
            if not chunk:
                break
            out.write(chunk)
    return tmp


def _has_dicm_signature(path: Path) -> bool:
    try:
        with open(path, "rb") as f:
            f.seek(128)
            return f.read(4) == b"DICM"
    except OSError:
        return False


def _read_dataset(path: Path):
    """파일명 무관 — DICM 시그니처/파싱(force)으로 DICOM 여부 판정.

    반환: (dataset, sop_uid) — 비DICOM이면 (None, None).
    """
    has_sig = _has_dicm_signature(path)
    try:
        ds = pydicom.dcmread(str(path), force=True, stop_before_pixels=True)
    except Exception:  # noqa: BLE001 — 파싱 불가 = 비DICOM으로 스킵
        return None, None
    sop = str(getattr(ds, "SOPInstanceUID", "") or "").strip()
    if not sop:
        if not has_sig:
            return None, None  # 시그니처도 SOP UID도 없음 → 비DICOM
        sop = generate_uid()  # DICM 시그니처는 있으나 SOP 결측 → 생성 폴백
    return ds, sop


def _unique_target(dir_: Path, sop: str) -> Path:
    """{SOP}.dcm 배치 경로 — 충돌 시 _1, _2 … 접미사."""
    base = _sanitize(sop)
    target = dir_ / f"{base}.dcm"
    n = 1
    while target.exists():
        target = dir_ / f"{base}_{n}.dcm"
        n += 1
    return target


def import_temp_file(conn: sqlite3.Connection, root: Path, tmp: Path, ds, sop: str) -> int:
    """Temp의 검증된 DICOM 1건을 Image\\ 배치 + local.db 등록. 반환: study id."""
    pid = _sanitize(str(getattr(ds, "PatientID", "") or "").strip() or "UNKNOWN")
    study_date = str(getattr(ds, "StudyDate", "") or "").strip() or "UNKNOWN"
    modality = str(getattr(ds, "Modality", "") or "").strip() or "UNKNOWN"
    study_uid = str(getattr(ds, "StudyInstanceUID", "") or "").strip() or f"local.{sop}"
    series_uid = str(getattr(ds, "SeriesInstanceUID", "") or "").strip() or f"local.se.{sop}"

    dest_dir = root / _IMAGE_SUBDIR / pid / f"{_sanitize(study_date)}_{_sanitize(modality)}"
    dest_dir.mkdir(parents=True, exist_ok=True)

    # study upsert (study_uid 기준)
    row = conn.execute("SELECT id FROM studies WHERE study_uid=?", (study_uid,)).fetchone()
    if row is None:
        pn = getattr(ds, "PatientName", "")
        cur = conn.execute(
            "INSERT INTO studies(patient_key, patient_name, sex, birth_date, study_uid,"
            " study_date, modality, study_desc) VALUES(?,?,?,?,?,?,?,?)",
            (
                pid,
                str(pn) if pn else "",
                str(getattr(ds, "PatientSex", "") or ""),
                str(getattr(ds, "PatientBirthDate", "") or ""),
                study_uid,
                study_date if study_date != "UNKNOWN" else "",
                modality,
                str(getattr(ds, "StudyDescription", "") or ""),
            ),
        )
        study_id = int(cur.lastrowid)
    else:
        study_id = int(row["id"])

    # series upsert (series_uid 기준)
    row = conn.execute("SELECT id FROM series WHERE series_uid=?", (series_uid,)).fetchone()
    if row is None:
        try:
            series_no = int(getattr(ds, "SeriesNumber", 0) or 0)
        except (TypeError, ValueError):
            series_no = 0
        cur = conn.execute(
            "INSERT INTO series(study_id, series_uid, series_number, series_desc, modality)"
            " VALUES(?,?,?,?,?)",
            (study_id, series_uid, series_no,
             str(getattr(ds, "SeriesDescription", "") or ""), modality),
        )
        series_id = int(cur.lastrowid)
    else:
        series_id = int(row["id"])

    # instance — 동일 SOP 재수입 시 파일 교체(기존 rel_path 재사용)
    existing = conn.execute("SELECT id, rel_path FROM instances WHERE sop_uid=?", (sop,)).fetchone()
    if existing is not None:
        target = root / existing["rel_path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(tmp, target)
        return study_id

    target = _unique_target(dest_dir, sop)
    os.replace(tmp, target)  # Temp→Image 이동(같은 볼륨 — 원자적)
    rel = target.relative_to(root).as_posix()
    try:
        inst_no = int(getattr(ds, "InstanceNumber", 0) or 0)
    except (TypeError, ValueError):
        inst_no = 0
    conn.execute(
        "INSERT INTO instances(series_id, sop_uid, instance_number, rows, cols, rel_path)"
        " VALUES(?,?,?,?,?,?)",
        (series_id, sop, inst_no,
         int(getattr(ds, "Rows", 0) or 0), int(getattr(ds, "Columns", 0) or 0), rel),
    )
    return study_id


def import_files(root: Path, uploads: list) -> dict:
    """multipart files[] → Temp 저장→판정→배치→등록. 반환 {imported, skipped, studies}."""
    init_dirs(root)
    conn = _connect(root)
    imported = 0
    skipped = 0
    touched: list[int] = []
    try:
        for up in uploads:
            tmp = save_upload_to_temp(root, up.file)
            try:
                ds, sop = _read_dataset(tmp)
                if ds is None:
                    skipped += 1  # 비DICOM 스킵 카운트
                    continue
                study_id = import_temp_file(conn, root, tmp, ds, sop)
                imported += 1
                if study_id not in touched:
                    touched.append(study_id)
            finally:
                tmp.unlink(missing_ok=True)  # 배치 성공 시 이미 이동됨 — 잔여만 정리
        conn.commit()
        studies = [_study_row_to_dict(conn, sid) for sid in touched]
    finally:
        conn.close()
    return {"imported": imported, "skipped": skipped, "studies": studies}


# ── 조회 ──────────────────────────────────────────────────────────────────
def _study_row_to_dict(conn: sqlite3.Connection, study_id: int) -> dict:
    row = conn.execute("SELECT * FROM studies WHERE id=?", (study_id,)).fetchone()
    if row is None:
        return {}
    images = conn.execute(
        "SELECT COUNT(*) AS n FROM instances i JOIN series s ON i.series_id=s.id"
        " WHERE s.study_id=?",
        (study_id,),
    ).fetchone()["n"]
    return {
        "id": row["id"],
        "patient_key": row["patient_key"],
        "patient_name": row["patient_name"],
        "sex": row["sex"],
        "study_date": row["study_date"],
        "modality": row["modality"],
        "study_desc": row["study_desc"],
        "images": int(images),
    }


def list_studies(root: Path, q: str = "") -> dict:
    conn = _connect(root)
    try:
        sql = "SELECT id FROM studies"
        params: tuple = ()
        q = (q or "").strip()
        if q:
            like = f"%{q}%"
            sql += (" WHERE patient_name LIKE ? OR patient_key LIKE ?"
                    " OR study_desc LIKE ? OR modality LIKE ?")
            params = (like, like, like, like)
        sql += " ORDER BY study_date DESC, id DESC"
        ids = [r["id"] for r in conn.execute(sql, params).fetchall()]
        return {"items": [_study_row_to_dict(conn, sid) for sid in ids]}
    finally:
        conn.close()


def study_tree(root: Path, study_id: int) -> dict | None:
    conn = _connect(root)
    try:
        if conn.execute("SELECT 1 FROM studies WHERE id=?", (study_id,)).fetchone() is None:
            return None
        series_out = []
        for se in conn.execute(
            "SELECT * FROM series WHERE study_id=? ORDER BY series_number, id", (study_id,)
        ).fetchall():
            instances = [
                {
                    "iid": r["id"],
                    "sop_uid": r["sop_uid"],
                    "instance_number": r["instance_number"],
                    "rows": r["rows"],
                    "cols": r["cols"],
                }
                for r in conn.execute(
                    "SELECT * FROM instances WHERE series_id=? ORDER BY instance_number, id",
                    (se["id"],),
                ).fetchall()
            ]
            series_out.append({
                "series_uid": se["series_uid"],
                "series_number": se["series_number"],
                "series_desc": se["series_desc"],
                "modality": se["modality"],
                "instances": instances,
            })
        return {"series": series_out}
    finally:
        conn.close()


def instance_path(root: Path, iid: int) -> Path | None:
    """iid → 파일 경로. DB의 rel_path 로만 해석하고 루트 이탈을 재검증한다."""
    conn = _connect(root)
    try:
        row = conn.execute("SELECT rel_path FROM instances WHERE id=?", (iid,)).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    target = (root / row["rel_path"]).resolve()
    if root != target and root not in target.parents:
        return None  # 루트 이탈 — DB 오염 시에도 차단
    return target if target.is_file() else None


# ── 렌더링(PNG) ───────────────────────────────────────────────────────────
def render_png(path: Path, wc: float | None = None, ww: float | None = None) -> bytes:
    """DICOM → 8bit PNG. W/L 기본값은 태그(없으면 min-max), wc/ww 쿼리 오버라이드.

    MONOCHROME1 반전·RGB 지원. Pillow 사용(requirements.txt 에 명시 — PNG 인코딩 표준 경로).
    """
    from PIL import Image  # 지연 import — 렌더링 외 경로는 Pillow 불필요

    ds = pydicom.dcmread(str(path), force=True)
    if not getattr(ds, "file_meta", None) or "TransferSyntaxUID" not in ds.file_meta:
        # force 로 읽힌 raw 파일 — 픽셀 해석을 위해 기본 전송구문 지정
        ds.file_meta = getattr(ds, "file_meta", None) or pydicom.dataset.FileMetaDataset()
        ds.file_meta.TransferSyntaxUID = ImplicitVRLittleEndian
    arr = ds.pixel_array

    photometric = str(getattr(ds, "PhotometricInterpretation", "") or "").upper()
    samples = int(getattr(ds, "SamplesPerPixel", 1) or 1)

    # RGB 판정은 SamplesPerPixel(=3) 기준 — 멀티프레임 그레이(ndim==3, 프레임 축)와 혼동 금지.
    # 멀티프레임이면 첫 프레임만 렌더(로컬 확인용 경량 뷰어 계약).
    is_rgb = samples == 3 or (arr.ndim == 3 and arr.shape[-1] == 3 and "MONOCHROME" not in photometric)
    if is_rgb:
        if arr.ndim == 4:  # (frames, rows, cols, 3) → 첫 프레임
            arr = arr[0]
    elif arr.ndim == 3:  # (frames, rows, cols) → 첫 프레임
        arr = arr[0]

    if is_rgb:
        # RGB — W/L 없이 8bit 정규화만
        rgb = arr.astype(np.float32)
        if rgb.max() > 255:
            rgb = rgb / rgb.max() * 255.0
        img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB")
    else:
        data = arr.astype(np.float32)
        # Modality LUT(RescaleSlope/Intercept — CT HU 등) 적용
        slope = float(getattr(ds, "RescaleSlope", 1) or 1)
        intercept = float(getattr(ds, "RescaleIntercept", 0) or 0)
        data = data * slope + intercept
        # W/L 결정: 쿼리 > 태그 > min-max
        if wc is None or ww is None:
            tag_wc, tag_ww = _tag_window(ds)
            if wc is None:
                wc = tag_wc
            if ww is None:
                ww = tag_ww
        if wc is None or ww is None or ww <= 0:
            lo, hi = float(data.min()), float(data.max())
            if hi <= lo:
                hi = lo + 1.0
        else:
            lo, hi = wc - ww / 2.0, wc + ww / 2.0
        norm = np.clip((data - lo) / (hi - lo), 0.0, 1.0)
        if photometric == "MONOCHROME1":
            norm = 1.0 - norm  # MONOCHROME1 — 밝기 반전
        img = Image.fromarray((norm * 255.0).astype(np.uint8), mode="L")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _tag_window(ds) -> tuple[float | None, float | None]:
    """WindowCenter/Width 태그 — 다중값이면 첫 값."""
    def _first(v):
        try:
            if v is None:
                return None
            if isinstance(v, (list, tuple)) or v.__class__.__name__ == "MultiValue":
                v = v[0] if len(v) else None
            return float(v) if v is not None else None
        except (TypeError, ValueError, IndexError):
            return None

    return _first(getattr(ds, "WindowCenter", None)), _first(getattr(ds, "WindowWidth", None))


# ── 삭제 ──────────────────────────────────────────────────────────────────
def delete_study(root: Path, study_id: int) -> dict | None:
    """로컬 검사 삭제 — 파일(인스턴스 전부)+DB 행. 반환: 삭제 요약(None=미존재)."""
    conn = _connect(root)
    try:
        st = conn.execute("SELECT * FROM studies WHERE id=?", (study_id,)).fetchone()
        if st is None:
            return None
        rows = conn.execute(
            "SELECT i.rel_path FROM instances i JOIN series s ON i.series_id=s.id"
            " WHERE s.study_id=?",
            (study_id,),
        ).fetchall()
        removed_files = 0
        for r in rows:
            target = (root / r["rel_path"]).resolve()
            if root != target and root not in target.parents:
                continue  # 루트 밖 경로는 절대 삭제하지 않음
            try:
                target.unlink(missing_ok=True)
                removed_files += 1
                # 빈 상위 폴더 정리(Image 하위 2단계까지 — 실패는 무시)
                for parent in (target.parent, target.parent.parent):
                    if parent != root and root in parent.parents and not any(parent.iterdir()):
                        parent.rmdir()
            except OSError:
                continue  # 파일 삭제 실패해도 DB 정리는 계속(고아 파일은 재삭제 가능)
        # FK CASCADE 는 PRAGMA 의존 — 명시 삭제로 확실히
        conn.execute(
            "DELETE FROM instances WHERE series_id IN (SELECT id FROM series WHERE study_id=?)",
            (study_id,),
        )
        conn.execute("DELETE FROM series WHERE study_id=?", (study_id,))
        conn.execute("DELETE FROM studies WHERE id=?", (study_id,))
        conn.commit()
        return {
            "ok": True,
            "study_id": study_id,
            "patient_key": st["patient_key"],
            "removed_files": removed_files,
        }
    finally:
        conn.close()
