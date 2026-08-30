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
  print "                    [--lifecycle-token <token>]" >&2
  print "" >&2
  print "  Without --publish: builds, notarises, verifies the gate, signs the" >&2
  print "  archive, validates the feed entry, and stops. Nothing leaves this" >&2
  print "  machine." >&2
  print "" >&2
  print "  With --publish: also creates the GitHub release, uploads the archive," >&2
  print "  writes the feed entry, and tells you to deploy the Worker. Deploying is" >&2
  print "  left to you because it publishes the whole public/ directory, and a" >&2
  print "  stale file in there has already nearly shipped a broken build." >&2
  print "" >&2
  print "  --lifecycle-token is required to publish. It is printed by" >&2
  print "  test-helper-install-lifecycle.sh and names the bundle that script" >&2
  print "  installed from, so publishing reuses that exact bundle rather than" >&2
  print "  building a new one nothing has been installed from. The token is a" >&2
  print "  reminder with a bundle attached rather than an attestation: it is a" >&2
  print "  digest of the artifact, so anyone holding the artifact can compute" >&2
  print "  it. It stops a lifecycle run that was forgotten, not one that was" >&2
  print "  deliberately skipped." >&2
}

repo_root=${script_path:h:h:h}
short_version=""
build=""
publish=no
notes=""
lifecycle_token=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --version) short_version=${2:-}; shift 2 ;;
    --build) build=${2:-}; shift 2 ;;
    --notes) notes=${2:-}; shift 2 ;;
    --publish) publish=yes; shift ;;
    --lifecycle-token) lifecycle_token=${2:-}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

[[ -n $short_version && -n $build ]] || { usage; exit 2 }
[[ $short_version =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]] || { print -r -- "--version must be x.y.z" >&2; exit 2 }
[[ $build =~ '^[0-9]+$' ]] || { print -r -- "--build must be a number" >&2; exit 2 }
[[ -z $lifecycle_token || $lifecycle_token =~ '^install-lifecycle:[0-9a-f]{16}$' ]] \
  || { print -r -- "--lifecycle-token is the token test-helper-install-lifecycle.sh printed" >&2; exit 2 }
# Refused here rather than after a build and a notarisation: the install
# lifecycle is the only gate that runs the privileged install end to end, and it
# needs root on a machine with no live session, so it cannot be run from inside
# this script. Requiring its token is how the release stops depending on whether
# somebody remembered.
if [[ $publish == yes && -z $lifecycle_token ]]; then
  print -r -- "release-macos: publishing requires --lifecycle-token." >&2
  print -r -- "  Build first without --publish, then, with Tono disconnected and quit:" >&2
  print -r -- "    sudo tooling/scripts/test-helper-install-lifecycle.sh --app <artifacts>/<bundle>.app" >&2
  print -r -- "  and pass the token it prints back here." >&2
  exit 2
fi
[[ -z $notes ]] && notes="$repo_root/apps/macos/release-notes/build$build.md"
[[ -f $notes ]] || { print "release notes not found: $notes" >&2; exit 2 }

export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
tag="tono-macos-$short_version-build$build"
# The publisher checks that the enclosure URL's filename matches the archive, so
# the archive is named for the release from the start rather than renamed later.
archive_name="Tono-$short_version-build$build-arm64.zip"
release_repo=${TONO_RELEASE_REPO:-raydocs/tono}
# The archive is served from the control plane's bucket, not from the GitHub
# release that carries it: an asset there is anonymously downloadable only while
# the repository is public, and github.com is not dependably reachable from where
# most of these users are. Sparkle verifies the bytes, so the address is free to
# move. The GitHub release still exists and still holds the same file; it is the
# audit copy, not the one users fetch.
enclosure="https://releases.afk.ccwu.cc/download/$archive_name"
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
source_commit=$(git -C "$repo_root" rev-parse HEAD) \
  || fail "could not resolve the source commit"

out="$repo_root/artifacts"
base="Tono-macOS-$short_version-build$build"
app="$out/$base.app"
zip="$out/$base.zip"
# Written when a build succeeds and read when a bundle is reused, so a bundle
# left over from another commit cannot be published under this one's tag.
built_from="$out/.$base.commit"

# The digest test-helper-install-lifecycle.sh prints its token from. The two
# recipes must stay identical: they are what binds "the install lifecycle
# passed" to a particular bundle rather than to what an operator remembers
# running it against. Hashed from inside the bundle so the same app answers the
# same wherever it was copied to, and whole lines are sorted rather than the file
# list, because paths inside a framework carry spaces and `sort -z` is not
# everywhere.
bundle_token() {
  local listing digest
  listing=$( cd "$1" 2>/dev/null \
             && LC_ALL=C /usr/bin/find . -type f -exec /usr/bin/shasum -a 256 {} + 2>/dev/null \
             | LC_ALL=C /usr/bin/sort )
  [[ -n $listing ]] || return 1
  digest=$(print -r -- "$listing" | /usr/bin/shasum -a 256)
  digest=${digest%% *}
  [[ -n $digest ]] || return 1
  print -r -- "install-lifecycle:${digest[1,16]}"
}

if [[ -n $lifecycle_token ]]; then
  step "reusing the bundle the install lifecycle ran against"
  # Rebuilding here would defeat the whole gate: a fresh signature timestamp
  # alone makes a new bundle, and the token names the one the daemon was
  # actually installed from. So a run carrying a token ships that bundle or
  # nothing. Everything below still runs against it — the gate, the staple, the
  # contract, the feed entry — because a token says a bundle was installed once,
  # not that it is fit to ship.
  [[ -d $app && -f $zip ]] \
    || fail "no bundle at $app to publish; run this without --lifecycle-token first, then run the install lifecycle against what it builds"
  [[ -f $built_from ]] \
    || fail "$app carries no build receipt; rebuild it without --lifecycle-token"
  built_commit=$(<"$built_from")
  [[ $built_commit == $source_commit ]] \
    || fail "$app was built from $built_commit, not the checked-out $source_commit"
  print "  $app, built from $source_commit"
else
  step "building and notarising"
  # The flow this script documents is "run it, look at what it would do, run it
  # again with --publish". That could never complete: the packaging step refuses to
  # overwrite an existing artifact, so the second run always failed on the output the
  # first one left behind, reported as "the build or notarisation failed".
  #
  # Only this version's own outputs are removed, and only ones that are files or
  # directories directly under artifacts/ — never a symlink, and never anything whose
  # name this run did not compose. Rebuilding is safe because the tree is verified
  # clean above, so the inputs cannot have moved between the two runs.
  for stale in "$app" "$zip" "$out/$archive_name" "$built_from"; do
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
  [[ -d $app && -f $zip ]] || fail "the build produced no app or archive"
  print -r -- "$source_commit" > "$built_from" || fail "could not record what $app was built from"
fi

step "confirming the built app is the release being made"
# The authoritative check: what the bundle says about itself. Publishing a feed
# entry whose version disagrees with the app it points at makes every client
# either skip the update or install something it did not ask for.
built_version=$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist" 2>/dev/null)
built_build=$(/usr/bin/plutil -extract CFBundleVersion raw -o - "$app/Contents/Info.plist" 2>/dev/null)
[[ $built_version == $short_version && $built_build == $build ]] \
  || fail "the built app is $built_version ($built_build), not $short_version ($build)"
print "  built $built_version ($built_build)"

if [[ -n $lifecycle_token ]]; then
  step "confirming the install lifecycle ran against this bundle"
  # Never printed by this script, only compared. Handing the expected token to
  # the operator would turn the gate back into the suggestion it replaces.
  bundle_named=$(bundle_token "$app") || fail "could not digest $app"
  [[ $lifecycle_token == $bundle_named ]] \
    || fail "--lifecycle-token names a different bundle than $app; run the install lifecycle against this one. A file under $app this user cannot read digests as absent, so an ownership difference left by the sudo lifecycle run reads as a different bundle too."
  print "  $lifecycle_token"
fi

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
# Repackaged, not copied. `package-macos-test.sh` renames the bundle to the
# artifact name so several test builds can sit side by side, and copying its
# archive under a release filename kept that name inside: the archive contained
# `Tono-macOS-0.0.60-build60.app`.
#
# For a release that is wrong twice. A customer who unzips it and drags it in gets
# a second application beside their existing Tono.app rather than replacing it —
# two copies, two helpers. And Sparkle locates the new bundle in an archive by the
# host application's name, so an installed Tono.app would find nothing to update
# from and the update would fail.
staging="$out/.release-$short_version-build$build"
[[ -L $staging ]] && fail "refusing to use $staging: it is a symlink"
/bin/rm -rf -- "$staging"
/bin/mkdir -p "$staging" || fail "could not stage the release archive"
# ditto rather than cp: it preserves the extended attributes and resource forks the
# code signature covers.
/usr/bin/ditto "$app" "$staging/Tono.app" || fail "could not stage Tono.app"
/bin/rm -f -- "$named"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$staging/Tono.app" "$named" \
  || fail "could not build the release archive"
/bin/rm -rf -- "$staging"
# The rename must not have invalidated anything, and the archive must contain the
# bundle under the name Sparkle will look for.
/usr/bin/unzip -tq "$named" >/dev/null || fail "the release archive is not readable"
# Listed into a variable rather than piped through `head`: this script runs with
# `pipefail`, and `head` closing the pipe early kills `unzip` with SIGPIPE, which
# fails the pipeline even when the check itself passed. That reported a correct
# archive as one missing its bundle.
archive_entries=$(/usr/bin/unzip -Z1 "$named") \
  || fail "the release archive could not be listed"
[[ ${archive_entries%%$'\n'*} == "Tono.app/" ]] \
  || fail "the release archive does not begin with Tono.app/ but with ${archive_entries%%$'\n'*}"
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
  print "  source commit:  $source_commit"
  print "  would enclose:  $enclosure"
  print "\n  Publishing needs the install lifecycle to have run against this exact"
  print "  bundle. With Tono disconnected and quit:"
  print "    sudo tooling/scripts/test-helper-install-lifecycle.sh --app $app"
  print "  It installs the daemon, checks what landed, puts the previous one back,"
  print "  and prints a token naming this bundle. Then:"
  print "    $script_path --version $short_version --build $build --publish \\"
  print "      --lifecycle-token <the token it printed>"
  exit 0
fi

step "uploading the archive to the release bucket"
# Before the release exists, so a published feed entry can never point at an
# object that was never uploaded.
( cd "$repo_root/services/control-plane" \
  && /usr/bin/env npx wrangler r2 object put "tono-releases/$archive_name" \
       --file "$named" --remote --content-type application/zip >/dev/null ) \
  || fail "uploading $archive_name to the release bucket failed"
served_length=$(/usr/bin/curl -sIL "$enclosure" \
  | /usr/bin/awk 'tolower($1) == "content-length:" { print $2 }' | /usr/bin/tr -d '\r' | /usr/bin/tail -1)
local_length=$(/usr/bin/stat -f%z "$named")
[[ $served_length == $local_length ]] \
  || fail "the bucket serves $served_length bytes for $archive_name but the archive is $local_length"
print "  $enclosure serves $served_length bytes"

step "creating the GitHub release"
source_branch=$(git -C "$repo_root" symbolic-ref --quiet --short HEAD 2>/dev/null) \
  || fail "publishing requires the checked-out release/macos branch, not a detached HEAD"
[[ $source_branch == release/macos ]] \
  || fail "publishing is restricted to release/macos; current branch is $source_branch"
/usr/bin/git -C "$repo_root" fetch --quiet origin release/macos \
  || fail "could not refresh origin/release/macos"
remote_release_commit=$(/usr/bin/git -C "$repo_root" rev-parse origin/release/macos) \
  || fail "could not resolve origin/release/macos"
[[ $source_commit == $remote_release_commit ]] \
  || fail "release/macos is not pushed exactly: local $source_commit, remote $remote_release_commit"
/usr/bin/env gh release view "$tag" --repo "$release_repo" >/dev/null 2>&1 \
  && fail "$tag already exists; releases are immutable by intent"
/usr/bin/env gh release create "$tag" --repo "$release_repo" --prerelease \
  --target "$source_commit" \
  --title "Tono macOS $short_version Build $build" --notes-file "$notes" "$named" \
  || fail "creating the release failed"
# `gh release create` is expected to publish, but 0.0.66 came out of it as a
# draft and only a hand check caught it — a draft has no tag, reaches nobody, and
# the script said "published" anyway. Read the state back rather than trust it.
release_state=$(/usr/bin/env gh release view "$tag" --repo "$release_repo" \
  --json isDraft --jq .isDraft 2>/dev/null) \
  || fail "could not read back the release just created"
if [[ $release_state == true ]]; then
  print "  the release was created as a draft; publishing it"
  /usr/bin/env gh release edit "$tag" --repo "$release_repo" --draft=false --prerelease \
    >/dev/null || fail "the release is a draft and could not be published"
  [[ $(/usr/bin/env gh release view "$tag" --repo "$release_repo" --json isDraft --jq .isDraft) == false ]] \
    || fail "the release is still a draft after publishing it"
fi

released_commit=$(/usr/bin/env gh api \
  "repos/$release_repo/commits/$tag" --jq .sha 2>/dev/null) \
  || fail "could not resolve the published tag"
[[ $released_commit == $source_commit ]] \
  || fail "published tag resolved to $released_commit, expected $source_commit"
print "  tag resolves to source commit $source_commit"

step "writing the feed entry"
/usr/bin/env node "$repo_root/tooling/scripts/publish-macos-appcast.mjs" "${validate_args[@]}" \
  || fail "writing the feed entry failed"
/bin/rm -f "$sig_file"

# The download page customers are sent to used to be edited by hand, so it kept
# naming the build before this one. It is regenerated from the feed just written
# above, so it can no longer disagree with what Sparkle serves.
step "regenerating the release centre"
/usr/bin/git -C "$repo_root" fetch --quiet origin windows-updates \
  || fail "could not refresh origin/windows-updates, which the release centre reads"
/usr/bin/env node "$repo_root/tooling/scripts/generate-release-center.mjs" --repo-root "$repo_root" \
  || fail "regenerating the release centre failed"

print "\n── published"
print "  The feed and the release centre are written but not live: both are static"
print "  assets of the Worker."
print "  Deploy it yourself, after checking what else is in that directory —"
print "  publishing it once nearly shipped build 42, whose helper could not be"
print "  repaired on any machine:"
print "    git -C $repo_root diff --stat services/control-plane/public/"
print "    cd services/control-plane && npm run deploy"
print ""
print "  Windows releases need one manual step this script does for macOS —"
print "  putting the installer where users download it, which CI cannot do"
print "  because it holds no Cloudflare credentials:"
print "    node tooling/scripts/upload-release-asset.mjs --tag v<version>"
print "  Promotion refuses to advance the channel until that object is served."
