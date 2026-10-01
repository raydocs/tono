#!/usr/bin/env python3
"""
Swift file syntax and brace/parentheses/bracket balance verification script.
Checks that all braces, parentheses, and brackets are properly balanced,
handling string literals, multiline strings, and single/multiline comments.
"""

import sys
from pathlib import Path


def check_swift_balance(filepath: Path) -> bool:
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    stack = []
    i = 0
    n = len(content)
    line = 1
    col = 1

    in_line_comment = False
    comment_depth = 0
    in_string = False
    in_multiline_string = False

    matching = {")": "(", "}": "{", "]": "["}

    while i < n:
        c = content[i]

        if c == "\n":
            line += 1
            col = 1
            if in_line_comment:
                in_line_comment = False
            i += 1
            continue
        else:
            col += 1

        if in_line_comment:
            i += 1
            continue

        if not in_string and not in_multiline_string:
            if content[i : i + 2] == "/*":
                comment_depth += 1
                i += 2
                continue
            if comment_depth > 0:
                if content[i : i + 2] == "*/":
                    comment_depth -= 1
                    i += 2
                    continue
                i += 1
                continue
            if content[i : i + 2] == "//":
                in_line_comment = True
                i += 2
                continue

        if comment_depth > 0:
            i += 1
            continue

        if in_multiline_string:
            if content[i : i + 3] == '"""' and (i == 0 or content[i - 1] != "\\"):
                in_multiline_string = False
                i += 3
                continue
            i += 1
            continue

        if in_string:
            if c == '"' and (i == 0 or content[i - 1] != "\\"):
                in_string = False
                i += 1
                continue
            i += 1
            continue

        if content[i : i + 3] == '"""':
            in_multiline_string = True
            i += 3
            continue
        if c == '"':
            in_string = True
            i += 1
            continue

        if c in "({[":
            stack.append((c, line, col, filepath))
        elif c in ")}]":
            if not stack:
                print(f"ERROR: Extra closing '{c}' at {filepath}:{line}:{col}")
                return False
            top, top_line, top_col, _ = stack.pop()
            if matching[c] != top:
                print(
                    f"ERROR: Mismatched '{c}' at {filepath}:{line}:{col}, "
                    f"expected closing for '{top}' from line {top_line}:{top_col}"
                )
                return False

        i += 1

    if in_string:
        print(f"ERROR: Unclosed string literal in {filepath}")
        return False
    if in_multiline_string:
        print(f"ERROR: Unclosed multiline string literal in {filepath}")
        return False
    if comment_depth > 0:
        print(f"ERROR: Unclosed multiline comment in {filepath}")
        return False
    if stack:
        for top, top_line, top_col, _ in stack:
            print(f"ERROR: Unclosed '{top}' from {filepath}:{top_line}:{top_col}")
        return False

    print(f"OK: {filepath} is perfectly balanced!")
    return True


def main():
    if len(sys.argv) > 1:
        target_files = [Path(p) for p in sys.argv[1:]]
    else:
        root = Path(__file__).resolve().parent.parent.parent
        target_files = [
            root / "apps/macos/Tono/Services/UnicodeCountryFlag.swift",
            root / "apps/macos/Tono/Views/DataUsageSummaryView.swift",
            root / "apps/macos/TonoTests/UnicodeCountryFlagTests.swift",
            root / "apps/macos/TonoTests/DataUsageSummaryViewTests.swift",
        ]

    success = True
    for filepath in target_files:
        if not filepath.exists():
            print(f"ERROR: File not found: {filepath}")
            success = False
            continue
        if not check_swift_balance(filepath):
            success = False

    if success:
        print("\nAll files verified successfully with exact balance!")
        sys.exit(0)
    else:
        print("\nVerification failed with errors.")
        sys.exit(1)


if __name__ == "__main__":
    main()
