#!/usr/bin/env python3
"""Require Apple acceptance and preserve allowlisted diagnostics, never credentials."""
import json
from pathlib import Path
import subprocess
import sys
import uuid


def decode(text):
    try:
        value = json.loads(text)
        return value if isinstance(value, dict) else {}
    except (ValueError, TypeError):
        return {}


def report(value):
    result = {key: value[key] for key in
              ("id", "status", "statusSummary", "statusCode", "message") if key in value}
    if isinstance(value.get("issues"), list):
        result["issues"] = [{key: issue[key] for key in
                             ("severity", "code", "path", "message", "architecture") if key in issue}
                            for issue in value["issues"] if isinstance(issue, dict)]
    return result


def notarize(archive, profile, destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    command = ["/usr/bin/xcrun", "notarytool"]
    submission = subprocess.run(command + ["submit", archive, "--keychain-profile", profile,
                                "--wait", "--output-format", "json"], capture_output=True, text=True)
    value = decode(submission.stdout)
    summary = report(value)
    summary["submitExitCode"] = submission.returncode
    # Do not persist raw stdout/stderr: transport errors can contain signed URLs.
    summary["structuredResponse"] = bool(value)
    (destination / "submission.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2), flush=True)
    if submission.returncode == 0 and value.get("status") == "Accepted":
        return 0
    try:
        submission_id = str(uuid.UUID(str(value.get("id", ""))))
    except ValueError:
        submission_id = None
    if submission_id:
        log = subprocess.run(command + ["log", submission_id, "--keychain-profile", profile],
                             capture_output=True, text=True)
        detail = report(decode(log.stdout))
        detail["logExitCode"] = log.returncode
        (destination / "issues.json").write_text(json.dumps(detail, indent=2) + "\n")
        print(json.dumps(detail, indent=2), flush=True)
    print("Notarization was not accepted; no stapling or release is allowed.", file=sys.stderr)
    return submission.returncode if submission.returncode > 0 else 65


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: notarize-macos.py ARCHIVE KEYCHAIN_PROFILE DIAGNOSTICS_DIRECTORY")
    sys.exit(notarize(*sys.argv[1:]))
