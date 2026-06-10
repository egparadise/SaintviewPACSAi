"""PostToolUse: 평문 시크릿 패턴 경고 (CLAUDE.md 절대 규칙 4). 경고만, 차단 안 함."""
import json
import re
import sys

PATTERNS = [
    re.compile(r"""(password|passwd|secret|api_key|apikey)\s*[:=]\s*['"][^'"]{4,}['"]""", re.I),
    re.compile(r"sk-ant-[A-Za-z0-9_-]{10,}"),
]
ALLOW_HINTS = ("env", "ENV", "getenv", "settings.", "example", "sample", "_dev", "placeholder", "${")


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    ti = payload.get("tool_input") or {}
    path = ti.get("file_path", "")
    content = ti.get("content") or ti.get("new_string") or ""
    if not content or path.endswith((".md", ".lock")):
        return 0
    for line in content.splitlines():
        if any(h in line for h in ALLOW_HINTS):
            continue
        for pat in PATTERNS:
            if pat.search(line):
                print(f"[guard_secrets] 평문 시크릿 의심: {path}: {line.strip()[:80]}", file=sys.stderr)
                return 0  # 경고만
    return 0


if __name__ == "__main__":
    sys.exit(main())
