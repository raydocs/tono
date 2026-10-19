#!/usr/bin/env python3
"""Pattern scan for credentials in text files under the given roots. Prints file:line:pattern and a
masked excerpt (never the full match). Binary files (NUL in the first 8 KiB) are counted, not read."""
import os, re, sys
P = {
    "github token": r"\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})",
    "aws key id": r"\bAKIA[0-9A-Z]{16}\b",
    "openai/anthropic key": r"\bsk-(ant-)?[A-Za-z0-9_-]{24,}",
    "slack token": r"\bxox[abprs]-[A-Za-z0-9-]{10,}",
    "google api key": r"\bAIza[0-9A-Za-z_-]{35}\b",
    "private key": r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    "jwt": r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",
    "bearer": r"(?i)\bbearer\s+[A-Za-z0-9._~+/-]{20,}",
    "authorization header": r"(?i)authorization:\s*(?!\*\*\*)\S{8,}",
    "assignment": r"(?i)\b(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*[\"']?(?!\*\*\*|false|true|null|none|\$|<|\{)[A-Za-z0-9/+_.=-]{12,}",
    "cloudflare token": r"(?i)\bCF_API_TOKEN\s*[:=]\s*\S+",
    "email": r"\b[A-Za-z0-9._%+-]+@(?!example\.(com|org|net)\b)[A-Za-z0-9.-]+\.(com|net|org|io|dev|cn|me|app)\b",
}
R = {k: re.compile(v) for k, v in P.items()}
binary = text = 0
for root in sys.argv[1:]:
    for dp, _, fns in os.walk(root):
        for fn in fns:
            p = os.path.join(dp, fn)
            with open(p, "rb") as f:
                head = f.read(8192)
            if b"\0" in head:
                binary += 1
                continue
            text += 1
            with open(p, "r", errors="replace") as f:
                for i, line in enumerate(f, 1):
                    for k, r in R.items():
                        m = r.search(line)
                        if m:
                            s = m.group(0)
                            print(f"{p}:{i}: {k}: {s[:6]}…{s[-3:] if len(s) > 12 else ''} (len {len(s)})")
print(f"scanned {text} text files; {binary} binary files not content-scanned", file=sys.stderr)
