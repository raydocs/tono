#!/usr/bin/env python3
"""Copies the iOS orb's orb-only material into docs/agent-reports/archive/2026-10-19-ios/ of the
archive worktree, byte for byte, and writes the inventory. Files over 20 MB are skipped and listed;
files byte-identical to a file tracked in the iOS checkout are listed with that path, not copied.
Usage: make_ios_archive.py <orb .amp/in> <repo checkout> <destination dir>"""
import hashlib, json, os, shutil, subprocess, sys

SRC, REPO, DEST = (os.path.abspath(a) for a in sys.argv[1:4])
LIMIT = 20 * 1000 * 1000

# Actions artifact copies: run id, head, artifact id, expiry (read-only `gh api` on 2026-10-19).
RUNS = {
    "ci-r11f": ("39184374749", "c2f8762", "12159295214", "2026-11-02", "round 11 review baseline, green"),
    "ci-r12a": ("39192116052", "aae2681", "12162950239", "2026-11-02", "round 12, red 30/33"),
    "ci-r12b": ("39198831560", "880012a", "12164718334", "2026-11-02", "round 12, red 32/33"),
    "ci-r12c": ("39204638991", "b709be7", "12167153324", "2026-11-02", "round 12, green 33/33, not frozen"),
}
COPY_RUNS = ["ci-r11f", "ci-r12a", "ci-r12b", "ci-r12c"]
# Older Actions copies: listed with hashes, not copied (originals on GitHub until expiry).
LIST_ONLY_PREFIXES = ("shots-", "ci-r11a", "ci-r11c", "ci-r11d", "ci-r11e")
# Run IDs of the listed-only directories (shots-<head> and ci-r11a/c/d/e), read-only `gh api`.
LIST_RUNS = {
    "ci-r11a": "39167318732", "ci-r11c": "39171778053", "ci-r11d": "39175793888", "ci-r11e": "39179522723",
    "shots-1a75705": "39118209252", "shots-1ad59e8": "39066752836", "shots-1b7e983": "39099937341",
    "shots-217eb1e": "39130734441", "shots-278c8c3": "39054122334", "shots-2bb5052": "39076577038",
    "shots-2f35044": "39088664883", "shots-35cdff4": "39091191911", "shots-3861d8d": "39108037311",
    "shots-436f367": "39156608142", "shots-47fd3a6": "39069190140", "shots-5586651": "39127157474",
    "shots-5662631": "39136687684", "shots-63066f0": "39078716807", "shots-7c52c6a": "39147800209",
    "shots-90822de": "39160461314", "shots-9a097b6": "39071414305", "shots-a6aba1b": "39152384717",
    "shots-b36d07d": "39140462842", "shots-d532218": "39085570631", "shots-e0f5586": "39057008451",
    "shots-ea131b9": "39097318071", "shots-f4553dc": "39111212441", "shots-f8b589f": "39074124929",
    "shots-fc9c812": "39114598985",
}
# Files inside listed-only directories that are not in the artifact: `gh run view --log-failed`
# output and a crop made in the orb. They are copied like any orb file.
ORB_EXTRA = {"ci-r11a/failed.log", "ci-r11c/failed.log", "ci-r11c/ax5.png"}
# Not material: toolchains, a Python venv, third-party sources, generated build output, inputs
# of the Android package (merged separately), scratch output of this script.
EXCLUDE = {
    "tools": "toolchains (Swift, Go, XcodeGen, sing-box binary), downloaded, re-obtainable",
    "pyenv": "Python virtualenv",
    "src": "third-party source checkouts (sing-box, apple), re-obtainable from upstream",
    "stubcheck/mod": "generated Swift module (build output)",
    "stubcheck/flat": "generated flattened copies of tracked sources",
    "stubcheck/flat2": "generated flattened copies of tracked sources",
    "archive-tools": "this script (a copy is in the archive)",
    "sbwork/sing-box-1.15.0-alpha.12-linux-amd64": "third-party sing-box release (binary, .so, LICENSE), re-obtainable",
    "xcodegen-out": "generated Xcode project (XcodeGen output of tracked project.yml)",
}
ANDROID_INPUT = "archive-android-2026-10-19"


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


tracked = {}
for rel in subprocess.run(["git", "-C", REPO, "ls-files", "-z"], capture_output=True).stdout.decode().split("\0"):
    p = os.path.join(REPO, rel)
    if rel and os.path.isfile(p) and not os.path.islink(p):
        tracked.setdefault(sha(p), rel)

copied, skipped, in_repo, listed, excluded = [], [], [], [], []


def take(src_abs, rel_dest, category, source):
    size = os.path.getsize(src_abs)
    digest = sha(src_abs)
    if size > LIMIT:
        skipped.append((rel_dest, size, digest, "over 20 MB", source))
        return
    if size > 0 and digest in tracked:
        in_repo.append((rel_dest, size, digest, tracked[digest]))
        return
    out = os.path.join(DEST, rel_dest)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    shutil.copy2(src_abs, out)
    copied.append((rel_dest, size, digest, category, source))


def walk(root):
    for dp, dns, fns in os.walk(root):
        dns.sort()
        for fn in sorted(fns):
            p = os.path.join(dp, fn)
            if not os.path.islink(p):
                yield p


for name in sorted(os.listdir(SRC)):
    path = os.path.join(SRC, name)
    rel = name
    if name in EXCLUDE:
        excluded.append((name, EXCLUDE[name]))
        continue
    if name.startswith(ANDROID_INPUT):
        continue
    if name in COPY_RUNS:
        run, head, art, exp, what = RUNS[name]
        for p in walk(path):
            take(p, os.path.join("actions-copies", f"{name}-run{run}-{head}", os.path.relpath(p, path)),
                 "actions-copy", f"run {run} @ {head}, artifact ios-preview-screenshots ({what})")
        continue
    if name.startswith(LIST_ONLY_PREFIXES):
        for p in walk(path):
            r = os.path.relpath(p, SRC)
            if r in ORB_EXTRA:
                take(p, os.path.join("orb-in", r), "orb", ".amp/in/" + r)
            else:
                listed.append((r, os.path.getsize(p), sha(p), LIST_RUNS[name]))
        continue
    if os.path.isdir(path):
        for p in walk(path):
            r = os.path.relpath(p, SRC)
            if any(r == k or r.startswith(k + "/") for k in EXCLUDE):
                continue
            take(p, os.path.join("orb-in", r), "orb", ".amp/in/" + r)
    elif os.path.isfile(path) and not os.path.islink(path):
        take(path, os.path.join("orb-in", rel), "orb", ".amp/in/" + rel)
for r in sorted(EXCLUDE):
    if "/" in r and os.path.exists(os.path.join(SRC, r)):
        excluded.append((r, EXCLUDE[r]))

# Ignored files at the checkout root and the session state.
for rel in ["SESSION_STATE.md", "tono-android-ui-overview.png", "tono-mobile-handoff.tgz"]:
    p = os.path.join(REPO, rel)
    if os.path.isfile(p):
        take(p, os.path.join("checkout-ignored", rel), "orb", "checkout root (ignored): " + rel)

json.dump({"copied": copied, "skipped": skipped, "in_repo": in_repo, "listed": listed, "excluded": excluded},
          open(os.path.join(os.path.dirname(__file__), "inventory.json"), "w"), indent=1)
print(f"copied {len(copied)} files {sum(c[1] for c in copied)} bytes; skipped {len(skipped)}; "
      f"identical to tracked {len(in_repo)}; listed-only {len(listed)} files {sum(l[1] for l in listed)} bytes; excluded {len(excluded)}")
