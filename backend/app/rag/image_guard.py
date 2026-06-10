"""vision 전송 이미지 가드 (P2, 설계 §8.1) — 번인(burn-in) PHI 휴리스틱 마스킹.

장비 번인 텍스트(환자명·ID·기관)는 관례적으로 영상 상·하단 가장자리에 위치한다.
OCR 기반 정밀 검출 전 단계로, 상·하단 스트립을 검정 마스킹한 뒤 전송한다.
한계: 영상 중앙 번인은 잡지 못한다 — vision은 opt-in이며 이 한계를 설정 화면에 명시.
"""
from __future__ import annotations

import io

TOP_RATIO = 0.10
BOTTOM_RATIO = 0.10


def mask_burn_in(png_bytes: bytes, *, top_ratio: float = TOP_RATIO, bottom_ratio: float = BOTTOM_RATIO) -> bytes:
    """PNG 상·하단 스트립을 검정으로 마스킹해 반환."""
    from PIL import Image, ImageDraw

    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    w, h = img.size
    draw = ImageDraw.Draw(img)
    top_px = int(h * top_ratio)
    bottom_px = int(h * bottom_ratio)
    if top_px > 0:
        draw.rectangle([0, 0, w, top_px], fill=(0, 0, 0))
    if bottom_px > 0:
        draw.rectangle([0, h - bottom_px, w, h], fill=(0, 0, 0))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()
