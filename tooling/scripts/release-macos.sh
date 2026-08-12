#!/bin/zsh
set -uo pipefail

# One command for a macOS release, run on the machine that holds the signing
# identity.
#
# Deliberately not CI. `macos-release.yml` needs eight secrets — the Developer ID
# certificate, the notarisation key, and the Sparkle private key among them — and
# this repository is a public fork, where anyone with push access can read a
# secret by editing a workflow. Signing identity, notarisation, and update
# authority are the three things worth least in exchange for a green checkmark.
#
# The pieces all existed and were assembled by hand for thirteen builds, which is
# why thirteen builds were hand-delivered: six parameters to compose, an archive
# to rename so a filename check would pass, and a signature to paste. None of that
# is decision-making, so none of it should be manual.
#
# Nothing is published without --publish. The default run builds, notarises,
# gates, signs, and shows exactly what it would do.

# Captured before any function: inside a zsh function `$0` is the function's own
# name, which prints an instruction to run a shell builtin.
script_path=${0:A}

usage() {
  print "usage: $script_path --version <x.y.z> --build <n> [--publish] [--notes <file>]" >&2
  print "" >&2
  print "  Without --publish: builds, notarises, verifies the gate, signs the" >&2
  print "  archive, validates the feed entry, and stops. Nothing leaves this" >&2
  print "  machine." >&2
  print "" >&2
  print "  With --publish: also creates the GitHub release, uploads the archive," >&2
  print "  writes the feed entry, and tells you to deploy the Worker. Deploying is" >&2
  print "  left to you because it publishes the whole public/ directory, and a" >&2
  print "  stale file in there has already nearly shipped a broken build." >&2
}

repo_root=${script_path:h:h:h}
short_version=""
build=""
publish=no
notes=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --version) short_version=${2:-}; shift 2 ;;
    --build) build=${2:-}; shift 2 ;;
    --notes) notes=${2:-}; shift 2 ;;
    --publish) publish=yes; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

[[ -n $short_version && -n $build ]] || { usage; exit 2 }
[[ $short_version =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]] || { print -r -- "--version must be x.y.z" >&2; exit 2 }
[[ $build =~ '^[0-9]+$' ]] || { print -r -- "--build must be a number" >&2; exit 2 }
[[ -z $notes ]] && notes="$repo_root/apps/macos/release-notes/build$build.md"
[[ -f $notes ]] || { print "release notes not found: $notes" >&2; exit 2 }

export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
tag="tono-$short_version-build$build"
# The publisher checks that the enclosure URL's filename matches the archive, so
# the archive is named for the release from the start rather than renamed later.
archive_name="Tono-$short_version-build$build-arm64.zip"
release_repo=${TONO_RELEASE_REPO:-raydocs/tono}
enclosure="https://github.com/$release_repo/releases/download/$tag/$archive_name"
link="https://github.com/$release_repo/releases/tag/$tag"

step() { print "\n── $1" }
fail() { print "release-macos: $1" >&2; exit 1 }

step "checking the tree describes this release"
# Cheap pre-build check only: does the project mention this version at all. The
# project has several targets, so there is no single declared value to compare
# against — reading "the" version out of it picked the test target's build number
# of 1 and would have failed every release. The authoritative check is on the
# built app below.
project="$repo_root/apps/macos/LiquidClash.xcodeproj/project.pbxproj"
/usr/bin/grep -q "MARKETING_VERSION = $short_version;" "$project" \
  || fail "no target in the project declares MARKETING_VERSION $short_version"
/usr/bin/grep -q "CURRENT_PROJECT_VERSION = $build;" "$project" \
  || fail "no target in the project declares CURRENT_PROJECT_VERSION $build"

if [[ -n $(git -C "$repo_root" status --porcelain) ]]; then
  fail "the tree is dirty; a release should be reproducible from a commit"
fi

step "building and notarising"
out="$repo_root/artifacts"
base="Tono-macOS-$short_version-build$build"
# The flow this script documents is "run it, look at what it would do, run it
# again with --publish". That could never complete: the packaging step refuses to
# overwrite an existing artifact, so the second run always failed on the output the
# first one left behind, reported as "the build or notarisation failed".
#
# Only this version's own outputs are removed, and only ones that are files or
# directories directly under artifacts/ — never a symlink, and never anything whose
# name this run did not compose. Rebuilding is safe because the tree is verified
# clean above, so the inputs cannot have moved between the two runs.
for stale in "$out/$base.app" "$out/$base.zip" "$out/$archive_name"; do
  if [[ -L $stale ]]; then
    fail "refusing to remove $stale: it is a symlink, not an artifact this script wrote"
  fi
  if [[ -e $stale ]]; then
    print "  replacing previous artifact ${stale:t}"
    /bin/rm -rf -- "$stale" || fail "could not remove the previous ${stale:t}"
  fi
done
# Output is kept and shown on failure. Swallowing it turned "refusing to
# overwrite an existing artifact" into "the build or notarisation failed", which
# describes the outcome and hides the one thing the operator needs to act on.
build_log=$(/usr/bin/mktemp -t tono-release-build)
if ! TONO_MACOS_NOTARIZE=1 TONO_MACOS_NOTARY_PROFILE=${TONO_MACOS_NOTARY_PROFILE:-tono-notary} \
     "$repo_root/tooling/scripts/package-macos-test.sh" "$out" "$base" > "$build_log" 2>&1; then
  print "release-macos: the build or notarisation failed:" >&2
  /usr/bin/tail -12 "$build_log" | /usr/bin/sed 's/^/  /' >&2
  /bin/rm -f "$build_log"
  exit 1
fi
/bin/rm -f "$build_log"
app="$out/$base.app"
zip="$out/$base.zip"
[[ -d $app && -f $zip ]] || fail "the build produced no app or archive"

step "confirming the built app is the release being made"
# The authoritative check: what the bundle says about itself. Publishing a feed
# entry whose version disagrees with the app it points at makes every client
# either skip the update or install something it did not ask for.
built_version=$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist" 2>/dev/null)
built_build=$(/usr/bin/plutil -extract CFBundleVersion raw -o - "$app/Contents/Info.plist" 2>/dev/null)
[[ $built_version == $short_version && $built_build == $build ]] \
  || fail "the built app is $built_version ($built_build), not $short_version ($build)"
print "  built $built_version ($built_build)"

step "verifying the release gate"
gate_ok=$("$repo_root/tooling/scripts/verify-release-gate.sh" "$app" 2>&1 | /usr/bin/grep -cE '^  ok:')
(( gate_ok >= 6 )) || fail "the release gate reported only $gate_ok checks"
/usr/bin/xcrun stapler validate "$app" >/dev/null 2>&1 || fail "the notarisation ticket is not stapled"
/usr/sbin/spctl -a -t exec "$app" >/dev/null 2>&1 || fail "Gatekeeper does not accept the app"
print "  gate $gate_ok/6, stapled, accepted by Gatekeeper"

step "confirming the app carries the contract the tree declares"
declared_contract=$(/usr/bin/sed -n 's/.*static let current = "\([^"]*\)".*/\1/p' \
  "$repo_root/apps/macos/Tono/Core/HelperProtocolVersion.swift")
shipped_contract=$("$app/Contents/Resources/liquidclash-helper" --version 2>/dev/null | /usr/bin/tr -d '[:space:]')
[[ $shipped_contract == $declared_contract ]] \
  || fail "the bundled helper reports $shipped_contract, the tree declares $declared_contract"
print "  helper contract $shipped_contract"

step "signing the archive for the update feed"
sign_update=$(/usr/bin/find "$HOME/Library/Developer/Xcode/DerivedData" \
  -name sign_update -type f 2>/dev/null | /usr/bin/head -1)
[[ -n $sign_update ]] || fail "Sparkle's sign_update was not found; build once in Xcode to fetch it"
named="$out/$archive_name"
/bin/cp "$zip" "$named"
signature=$("$sign_update" "$named" 2>/dev/null \
  | /usr/bin/sed -n 's/.*sparkle:edSignature="\([^"]*\)".*/\1/p')
[[ -n $signature ]] || fail "signing the archive produced no signature"
print "  signed as $archive_name"

step "validating the feed entry"
sig_file="$out/.$archive_name.sig"
printf '%s' "$signature" > "$sig_file"
/bin/chmod 600 "$sig_file"
validate_args=(
  --app "$app" --zip "$named"
  --version "$build" --short-version "$short_version"
  --url "$enclosure" --link "$link" --notes-file "$notes"
  --signature-file "$sig_file"
)
/usr/bin/env node "$repo_root/tooling/scripts/publish-macos-appcast.mjs" \
  "${validate_args[@]}" --dry-run || fail "the feed entry was rejected"

if [[ $publish != yes ]]; then
  print "\n── not published (no --publish)"
  print "  archive: $named"
  print "  would tag:      $tag"
  print "  would enclose:  $enclosure"
  print "\n  Before publishing, run the install lifecycle against this exact bundle:"
  print "    sudo tooling/scripts/test-helper-install-lifecycle.sh --app $app"
  print "  It installs the daemon, checks what landed, and puts the previous one back."
  exit 0
fi

step "creating the GitHub release"
/usr/bin/env gh release view "$tag" --repo "$release_repo" >/dev/null 2>&1 \
  && fail "$tag already exists; releases are immutable by intent"
/usr/bin/env gh release create "$tag" --repo "$release_repo" --prerelease \
  --title "Tono $short_version Build $build" --notes-file "$notes" "$named" \
  || fail "creating the release failed"

step "writing the feed entry"
/usr/bin/env node "$repo_root/tooling/scripts/publish-macos-appcast.mjs" "${validate_args[@]}" \
  || fail "writing the feed entry failed"
/bin/rm -f "$sig_file"

print "\n── published"
print "  The feed is written but not live: it is a static asset of the Worker."
print "  Deploy it yourself, after checking what else is in that directory —"
print "  publishing it once nearly shipped build 42, whose helper could not be"
print "  repaired on any machine:"
print "    git -C $repo_root diff --stat services/control-plane/public/"
print "    cd services/control-plane && npx wrangler deploy"
