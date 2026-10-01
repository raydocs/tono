#!/usr/bin/env python3
"""Stop hook: SESSION_STATE.md must exist and name the next command or DONE (AGENTS.md "Session state")."""
import json
import os
import re
import subprocess
import sys

REQUIRED = ("## Objective", "## Tool receipts", "## Next")


def source_touched(root):
    """True when the checkout has changes other than SESSION_STATE.md; unknown counts as touched."""
    try:
        out = subprocess.run(
            ["git", "--no-optional-locks", "-C", root, "status", "--porcelain"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return True
    return any(line[3:].strip() != "SESSION_STATE.md" for line in out.splitlines() if line.strip())


def check(root):
    path = os.path.join(root, "SESSION_STATE.md")
    if not os.path.isfile(path):
        return "缺少 SESSION_STATE.md：先在仓库根目录按 AGENTS.md「Session state」一节的小节创建。"
    try:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
    except (OSError, UnicodeDecodeError) as error:
        return "SESSION_STATE.md 无法按 UTF-8 读取：" + str(error)
    lines = [line.rstrip() for line in text.splitlines()]
    missing = [heading for heading in REQUIRED if heading not in lines]
    if missing:
        return "SESSION_STATE.md 缺少小节：" + "、".join(missing) + "。"
    start = lines.index("## Next") + 1
    body = []
    for line in lines[start:]:
        if line.startswith("## "):
            break
        # A bare list marker from the template ("- ", "- [ ]") is not content.
        content = re.sub(r"^\s*[-*]\s*(\[[ xX]\]\s*)?", "", line).strip()
        if content:
            body.append(content)
    if not body:
        return "SESSION_STATE.md 的 ## Next 为空：写下一条要执行的命令，或写 DONE。"
    return None


def main():
    try:
        event = json.load(sys.stdin)
    except (ValueError, OSError, UnicodeDecodeError):
        event = {}
    if not isinstance(event, dict):
        event = {}
    root = os.environ.get("CLAUDE_PROJECT_DIR") or event.get("cwd") or os.getcwd()
    reason = check(root)
    if reason is None:
        print(json.dumps({"ok": True}, ensure_ascii=False))
        return 0
    result = {"ok": False, "reason": reason}
    # Claude Code blocks a stop only on "decision": "block". Block once (never while the agent is
    # already continuing because of this hook), and never a session that has not touched the
    # checkout: AGENTS.md asks for the file before editing source, not for read-only sessions.
    missing_file = not os.path.isfile(os.path.join(root, "SESSION_STATE.md"))
    if not event.get("stop_hook_active") and not (missing_file and not source_touched(root)):
        result["decision"] = "block"
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
