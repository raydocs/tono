#!/usr/bin/env python3
"""Lint the new account-error UI allowlist: no generic raw-code rendering for T6 errors."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
view = (root / "App/Views/HomeView.swift").read_text()
known = view.split("static let knownReasons: Set<String> = [", 1)[1].split("]", 1)[0]
codes = ("PLAN_EXPIRED", "QUOTA_EXHAUSTED", "ACCOUNT_RELEASE_FAILED", "DEVICE_REAUTH_REQUIRED", "USER_DISABLED")
for code in codes:
    assert f'"{code}"' in known, f"{code} would use generic raw-code rendering"
    for locale in ("en", "zh-Hans"):
        strings = (root / f"App/Resources/{locale}.lproj/Localizable.strings").read_text()
        for prefix in ("reason_", "short_"):
            matches = re.findall(r'^"' + prefix + code + r'" = "(.*)";', strings, re.M)
            assert len(matches) == 1, (locale, prefix, code, "missing/duplicate copy")
            assert code not in matches[0] and "%" not in matches[0], (locale, code, "raw code or format placeholder")
print(f"PASS: all {len(codes)} account errors have allowlisted, non-code copy in both locales")
