"""PostToolUse: 편집된 .py 파일을 py_compile로 검증. 실패 시 차단(exit 2)."""
import json
import py_compile
import sys


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    path = (payload.get("tool_input") or {}).get("file_path", "")
    if not path.endswith(".py"):
        return 0
    try:
        py_compile.compile(path, doraise=True)
    except py_compile.PyCompileError as e:
        print(f"[post_edit_check] 컴파일 실패: {e}", file=sys.stderr)
        return 2
    except FileNotFoundError:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
