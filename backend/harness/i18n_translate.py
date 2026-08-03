"""다국어 카탈로그 생성 — 코드에서 `tr("...")` 로 감싼 한국어를 뽑아 9개 언어로 번역한다.

왜 개발용 스크립트인가
    화면 문자열은 런타임 데이터가 아니라 **빌드 산출물**이다. 한 번 만들어 두면
    `frontend/src/lib/i18n.messages.json` 에 저장되고, 이후에는 API 호출이 없다.

⚠ 실제 Claude API 를 호출한다(비용 발생). 사용자가 명시적으로 승인했을 때만 실행할 것.
   PHI 는 포함되지 않는다 — UI 라벨·버튼·설명문뿐이라 비식별화 게이트 대상이 아니다.

사용법
    py -3.11 harness/i18n_translate.py            # 전체(누락분만)
    py -3.11 harness/i18n_translate.py --langs en # 특정 언어만
    py -3.11 harness/i18n_translate.py --dry      # 대상 건수만 세기
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "frontend" / "src"
OUT = SRC / "lib" / "i18n.messages.json"

LANGS = {
    "en": "English",
    "ru": "Russian (Русский)",
    "zh": "Simplified Chinese (简体中文)",
    "ja": "Japanese (日本語)",
    "es": "Spanish (Español)",
    "de": "German (Deutsch)",
    "fr": "French (Français)",
    "vi": "Vietnamese (Tiếng Việt)",
    "ar": "Arabic (العربية)",
}

# tr("...") — 이스케이프된 따옴표를 포함한 문자열 리터럴
TR = re.compile(r'\btr\(\s*"((?:[^"\\]|\\.)*)"\s*\)')


def collect_keys() -> list[str]:
    """소스에서 번역 대상 한국어 원문(키)을 모은다."""
    keys: set[str] = set()
    for f in SRC.rglob("*.tsx"):
        text = f.read_text(encoding="utf-8")
        for m in TR.finditer(text):
            try:
                keys.add(json.loads('"' + m.group(1) + '"'))
            except Exception:
                continue  # 이스케이프가 특이한 리터럴은 건너뛴다(번역 없이 원문 표시)
    return sorted(k for k in keys if k.strip())


SYSTEM = """You translate UI strings for a medical imaging workstation (PACS / radiology reading software).

Rules:
- Translate from Korean into {lang}. Output the translation only.
- Use the standard radiology/PACS terminology of the target language
  (Study, Series, Modality, Window/Level, Hanging Protocol, Worklist, ...).
- Keep placeholders, markup and symbols EXACTLY as they appear:
  {{...}}, <b>, </b>, <br />, &nbsp;, %, ×, →, ·, ⚠, emoji, numbers, units.
- Keep product and technical names untranslated:
  SaintView, I-View, T-View, DICOM, Orthanc, PACS, HL7, MWL, MPPS, W/L, HU, ROI,
  CT, MR, CR, DX, MG, US, XA, NM, PT, OT, AE Title, SOP, UID, ZIP, ISO, USB, CD, PDF.
- Keep the string roughly as short as the Korean — these are buttons, labels and tooltips.
- If the Korean is already English or a symbol, return it unchanged.
"""


def translate_batch(client, model: str, lang: str, items: list[str]) -> list[str]:
    """한 배치를 번역. 입력과 같은 길이의 리스트를 돌려준다(어긋나면 원문 유지)."""
    numbered = "\n".join(f"{i + 1}. {s}" for i, s in enumerate(items))
    msg = client.messages.create(
        model=model,
        max_tokens=8000,
        system=[{"type": "text", "text": SYSTEM.format(lang=LANGS[lang]),
                 "cache_control": {"type": "ephemeral"}}],
        messages=[{
            "role": "user",
            "content": (
                "Translate each numbered line. Answer with the same numbering, "
                "one translation per line, nothing else.\n\n" + numbered
            ),
        }],
    )
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    out = list(items)  # 실패 시 원문 유지
    for line in text.splitlines():
        m = re.match(r"\s*(\d+)\s*[.)]\s*(.+)$", line)
        if not m:
            continue
        i = int(m.group(1)) - 1
        if 0 <= i < len(out):
            out[i] = m.group(2).strip()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--langs", default="", help="쉼표 구분(기본: 전부)")
    ap.add_argument("--batch", type=int, default=60, help="한 요청에 보낼 문구 수")
    ap.add_argument("--dry", action="store_true", help="대상만 세고 종료")
    a = ap.parse_args()

    keys = collect_keys()
    cat: dict[str, dict[str, str]] = {}
    if OUT.exists():
        cat = json.loads(OUT.read_text(encoding="utf-8"))

    langs = [x for x in (a.langs.split(",") if a.langs else list(LANGS)) if x in LANGS]
    todo = {lg: [k for k in keys if not cat.get(k, {}).get(lg)] for lg in langs}
    total = sum(len(v) for v in todo.values())
    print(f"키 {len(keys)}개 · 언어 {len(langs)}개 · 번역 대상 {total}건")
    for lg in langs:
        print(f"  {lg}: {len(todo[lg])}건")
    if a.dry or not total:
        return 0

    sys.path.insert(0, str(ROOT / "backend"))
    from anthropic import Anthropic  # noqa: E402

    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        env = ROOT / "backend" / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith("ANTHROPIC_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"')
    if not key:
        print("ANTHROPIC_API_KEY 없음 — backend/.env 또는 환경변수로 지정하세요")
        return 2

    client = Anthropic(api_key=key)
    model = os.getenv("SAINTVIEW_I18N_MODEL", "claude-opus-4-8")

    done = 0
    for lg in langs:
        items = todo[lg]
        for i in range(0, len(items), a.batch):
            chunk = items[i:i + a.batch]
            try:
                res = translate_batch(client, model, lg, chunk)
            except Exception as e:  # 배치 실패는 그 배치만 건너뛴다(원문 유지)
                print(f"  ! {lg} 배치 {i} 실패: {type(e).__name__}: {e}")
                continue
            for ko, tx in zip(chunk, res):
                cat.setdefault(ko, {})[lg] = tx
            done += len(chunk)
            OUT.write_text(json.dumps(cat, ensure_ascii=False, indent=0), encoding="utf-8")
            print(f"  {lg} {min(i + a.batch, len(items))}/{len(items)}  (누적 {done}/{total})", flush=True)

    print(f"완료 — {OUT.relative_to(ROOT)} 에 {len(cat)}개 키 저장")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
