"""GSPS(Grayscale Softcopy Presentation State) 생성 — 주석·W/L 표준 저장.

뷰어의 주석(정규화 0~1 좌표)과 현재 W/L을 GSPS 객체로 만들어 동일 Study에 귀속하면
타 PACS 뷰어에서도 같은 표시 상태를 재현할 수 있다(상호운용성).
좌표 단위는 DISPLAY(표시영역 비율 0~1) — 뷰어 정규화 좌표와 1:1.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone

from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

GSPS_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.11.1"
LAYER = "SAINTVIEW"


def _ref_image(sop_uid: str, sop_class: str = "") -> Dataset:
    d = Dataset()
    d.ReferencedSOPClassUID = sop_class or "1.2.840.10008.5.1.4.1.1.1"  # CR 폴백
    d.ReferencedSOPInstanceUID = sop_uid
    return d


def _graphic(points: list[list[float]], gtype: str, *, closed: bool = False) -> Dataset:
    pts = list(points)
    if closed and pts and pts[0] != pts[-1]:
        pts.append(pts[0])
    g = Dataset()
    g.GraphicAnnotationUnits = "DISPLAY"
    g.GraphicDimensions = 2
    g.NumberOfGraphicPoints = len(pts)
    g.GraphicData = [float(v) for p in pts for v in p]
    g.GraphicType = gtype
    g.GraphicFilled = "N"
    return g


def _text(anchor: list[float], text: str) -> Dataset:
    t = Dataset()
    t.AnchorPointAnnotationUnits = "DISPLAY"
    t.UnformattedTextValue = text[:1024]
    t.AnchorPoint = [float(anchor[0]), float(anchor[1])]
    t.AnchorPointVisibility = "Y"
    return t


def _rect_points(p1: list[float], p2: list[float]) -> list[list[float]]:
    (x1, y1), (x2, y2) = p1, p2
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


def annotation_to_graphics(anno: dict) -> tuple[list[Dataset], list[Dataset]]:
    """주석 1건 → (GraphicObject 목록, TextObject 목록)."""
    kind = anno.get("kind", "line")
    pts = anno.get("points") or []
    graphics: list[Dataset] = []
    texts: list[Dataset] = []
    label = anno.get("text", "")
    if anno.get("value") is not None:
        label = f"{label} {anno['value']}{anno.get('unit', '')}".strip()
    if anno.get("source") == "ai":
        label = f"[AI] {label}".strip()

    if kind in ("length", "line", "arrow", "ctr") and len(pts) >= 2:
        graphics.append(_graphic(pts[:2], "POLYLINE"))
    elif kind == "angle" and len(pts) >= 3:
        graphics.append(_graphic(pts[:3], "POLYLINE"))
    elif kind == "rect" and len(pts) >= 2:
        graphics.append(_graphic(_rect_points(pts[0], pts[1]), "POLYLINE", closed=True))
    elif kind == "ellipse" and len(pts) >= 2:
        # GSPS ELLIPSE: 장축 양끝 2점 + 단축 양끝 2점
        (x1, y1), (x2, y2) = pts[0], pts[1]
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        graphics.append(_graphic([[x1, cy], [x2, cy], [cx, y1], [cx, y2]], "ELLIPSE"))
    elif kind == "text" and len(pts) >= 1:
        pass  # 텍스트만
    else:
        return [], []

    if label and pts:
        texts.append(_text(pts[0], label))
    return graphics, texts


def build_gsps_dataset(
    *,
    study,
    patient,
    images: list[dict],          # [{sop_uid, series_uid, rows, cols, sop_class?}]
    annotations: list[dict],     # 07 A.4 주석 dict (points 0~1)
    wc: float | None = None,
    ww: float | None = None,
    label: str = "SAINTVIEW",
    creator: str = "",
) -> Dataset:
    now = datetime.now(timezone.utc)

    fm = FileMetaDataset()
    fm.MediaStorageSOPClassUID = GSPS_SOP_CLASS
    fm.MediaStorageSOPInstanceUID = generate_uid()
    fm.TransferSyntaxUID = ExplicitVRLittleEndian

    ds = Dataset()
    ds.file_meta = fm
    ds.SpecificCharacterSet = "ISO_IR 192"
    ds.SOPClassUID = GSPS_SOP_CLASS
    ds.SOPInstanceUID = fm.MediaStorageSOPInstanceUID
    ds.Modality = "PR"
    ds.Manufacturer = "Saintview PACS AI"

    ds.PatientID = patient.patient_key if patient else ""
    ds.PatientName = patient.name_masked if patient else ""
    ds.PatientBirthDate = patient.birth_date if patient else ""
    ds.PatientSex = patient.sex if patient else ""
    ds.StudyInstanceUID = study.study_uid
    ds.AccessionNumber = study.accession_no or ""
    ds.StudyDate = study.study_date or ""
    ds.StudyTime = study.study_time or ""
    ds.StudyID = ""
    ds.ReferringPhysicianName = ""
    ds.SeriesInstanceUID = generate_uid()
    ds.SeriesNumber = 901
    ds.InstanceNumber = 1
    ds.SeriesDescription = "Saintview Presentation State"

    ds.ContentLabel = (label[:16] or "SAINTVIEW").upper()
    ds.ContentDescription = f"Saintview annotations by {creator}"[:64]
    ds.PresentationCreationDate = now.strftime("%Y%m%d")
    ds.PresentationCreationTime = now.strftime("%H%M%S")
    ds.ContentCreatorName = creator or "Saintview"

    # 참조 시리즈/이미지
    by_series: dict[str, list[dict]] = {}
    for im in images:
        by_series.setdefault(im.get("series_uid", ""), []).append(im)
    ref_series = []
    for suid, ims in by_series.items():
        s = Dataset()
        s.SeriesInstanceUID = suid
        s.ReferencedImageSequence = [_ref_image(im["sop_uid"], im.get("sop_class", "")) for im in ims]
        ref_series.append(s)
    ds.ReferencedSeriesSequence = ref_series

    # 표시 영역 (필수 모듈) — 전체 이미지 SCALE TO FIT
    areas = []
    for im in images:
        a = Dataset()
        a.ReferencedImageSequence = [_ref_image(im["sop_uid"], im.get("sop_class", ""))]
        a.DisplayedAreaTopLeftHandCorner = [1, 1]
        a.DisplayedAreaBottomRightHandCorner = [int(im.get("cols") or 1), int(im.get("rows") or 1)]
        a.PresentationSizeMode = "SCALE TO FIT"
        areas.append(a)
    ds.DisplayedAreaSelectionSequence = areas

    # W/L (Softcopy VOI LUT)
    if wc is not None and ww is not None:
        v = Dataset()
        v.WindowCenter = float(wc)
        v.WindowWidth = float(ww)
        ds.SoftcopyVOILUTSequence = [v]

    # 주석 레이어
    layer = Dataset()
    layer.GraphicLayer = LAYER
    layer.GraphicLayerOrder = 1
    layer.GraphicLayerDescription = "Saintview annotations"
    ds.GraphicLayerSequence = [layer]

    anno_items = []
    sop_class_of = {im["sop_uid"]: im.get("sop_class", "") for im in images}
    for anno in annotations:
        graphics, texts = annotation_to_graphics(anno)
        if not graphics and not texts:
            continue
        item = Dataset()
        item.GraphicLayer = LAYER
        sop = anno.get("sop_uid", "")
        item.ReferencedImageSequence = [_ref_image(sop, sop_class_of.get(sop, ""))]
        if graphics:
            item.GraphicObjectSequence = graphics
        if texts:
            item.TextObjectSequence = texts
        anno_items.append(item)
    if anno_items:
        ds.GraphicAnnotationSequence = anno_items
    return ds


def gsps_bytes(ds: Dataset) -> bytes:
    buf = io.BytesIO()
    ds.save_as(buf, write_like_original=False)
    return buf.getvalue()
