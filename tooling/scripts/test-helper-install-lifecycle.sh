#!/bin/zsh
set -uo pipefail

# Installs the privileged daemon for real, checks what landed, and puts the
# previous install back.
#
# This coverage was missing because it cannot be automated in CI: the install
# refuses anything without a Developer ID signature, and giving a public
# repository's runners a signing key trades a real credential for a convenience.
# It runs here instead, against the signed bundle a release already produces, at
# the moment it matters — before shipping.
#
# The script it executes is not a copy. `HelperInstallScriptTests` emits the
# production string from `HelperManager.installScript`, so root runs byte-for-byte
# what an install would run. A hand-maintained duplicate would drift, and drift
# is exactly the failure being guarded against.
#
# It refuses to touch a machine with a live session, and it restores whatever was
# installed before — including whether the daemon was loaded.

# Captured before any function runs: inside a zsh function `$0` is the function's
# own name, which printed `sudo usage --app …` and told the reader to run a shell
# builtin.
script_path=${0:A}

usage() {
  print "usage: sudo $script_path --app /path/to/signed/Tono.app [--script emitted.sh] [--expect-version x.y.z]" >&2
  print "  the bundle must carry a Developer ID signature; the install verifies it" >&2
  print "  --script skips emitting, which needs xcodebuild and so needs to run as you." >&2
  print "  Emit it first, as yourself, from the repository root:" >&2
  print "    TEST_RUNNER_TONO_EMIT_INSTALL_SCRIPT=/tmp/i.sh \\" >&2
  print "    TEST_RUNNER_TONO_EMIT_INSTALL_APP=<app> \\" >&2
  print "    TEST_RUNNER_TONO_EMIT_INSTALL_UID=\$(id -u) \\" >&2
  print "    xcodebuild test -project apps/macos/LiquidClash.xcodeproj -scheme LiquidClash \\" >&2
  print "      -destination 'platform=macOS,arch=arm64' \\" >&2
  print "      -only-testing:TonoTests/HelperInstallScriptTests/testEmitInstallScriptWhenRequested" >&2
  print "  The TEST_RUNNER_ prefix is required: xcodebuild forwards only prefixed" >&2
  print "  variables into the test host, and without it the emit test skips while" >&2
  print "  reporting success." >&2
}

app=""
prebuilt_script=""
expect_version=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --app) app=${2:-}; shift 2 ;;
    # Emitting the script runs xcodebuild, which as root cannot read a project
    # under a TCC-protected directory such as ~/Downloads — it fails with an
    # unhelpful "can't open input file". Emit it as yourself, hand the path in,
    # and root only does the part that needs root.
    --script) prebuilt_script=${2:-}; shift 2 ;;
    # Same reason as --script: reading the source of truth for the expected
    # contract needs to reach the repository, and a root shell cannot do that
    # under a TCC-protected directory. Pass it when running from elsewhere.
    --expect-version) expect_version=${2:-}; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done
[[ -n $app && -d $app ]] || { usage; exit 2 }

if [[ $EUID -ne 0 ]]; then
  print "this installs a launchd daemon, so it needs root" >&2
  usage
  exit 1
fi

# The uid the daemon will trust. Under sudo the caller is root, and the install
# refuses to bind the daemon to root, so take the invoking user.
trusted_uid=${SUDO_UID:-}
if [[ -z $trusted_uid || $trusted_uid -eq 0 ]]; then
  print "cannot determine a non-root invoking user; run through sudo" >&2
  exit 1
fi

# Replacing the daemon under a live session would sever it, and a half-replaced
# install is the worst state to leave a machine in.
# `-x` matches the process name; `-f` matched any command line mentioning the
# core, including this script's own, so the guard fired on itself.
if /usr/bin/pgrep -x tono-mihomo > /dev/null 2>&1; then
  print "a Tono core is running; disconnect before running this" >&2
  exit 1
fi
if /sbin/ifconfig utun199 > /dev/null 2>&1; then
  print "the protected tunnel is up; disconnect before running this" >&2
  exit 1
fi
if /usr/bin/pgrep -x Tono > /dev/null 2>&1; then
  print "quit Tono first: it reinstalls the daemon on demand and would race this" >&2
  exit 1
fi

label=com.raydocs.tono.core-helper
helper_path=/Library/PrivilegedHelperTools/tono-core-helper
mihomo_path=/Library/PrivilegedHelperTools/tono-mihomo
uid_path=/Library/PrivilegedHelperTools/tono.allowed-uid
plist_path=/Library/LaunchDaemons/$label.plist
socket_path=/var/run/tono-core/service.sock

backup=$(mktemp -d /var/root/tono-install-lifecycle.XXXXXX)
was_loaded=no
/bin/launchctl print system/$label > /dev/null 2>&1 && was_loaded=yes

# Restoring is the part that must not be sloppy: getting it wrong leaves the
# machine with a daemon its installed app does not expect, and the first version
# of this did exactly that. `cp` onto a running executable fails with ETXTBSY on
# macOS, and with no error check it failed silently and reported success — the
# production install writes `.new` and renames for precisely this reason, and
# copying that pattern was not optional. Renaming also keeps the swap atomic, so
# an interrupted restore cannot leave a partial binary behind.
# Restoring is the part that must not be sloppy: getting it wrong leaves the
# machine with a daemon its installed app does not expect, and two earlier
# versions of this did exactly that.
#
# First it used `cp` straight onto the running executable, which fails with
# ETXTBSY on macOS and, with no error check, failed silently while reporting
# success. Then it packed "path:name" pairs into a loop and half the iterations
# never reached the branch that restores — which is why this is now four explicit
# calls with no string packing to reason about. The production install writes
# `.new` and renames for the same ETXTBSY reason, and copying that was not
# optional.
restore_one() {
  local target=$1
  local saved=$2
  if [[ -f $saved ]]; then
    if ! /bin/cp -p "$saved" "$target.restore"; then
      print "  could not stage a restore for $target" >&2
      return 1
    fi
    if ! /bin/mv -f "$target.restore" "$target"; then
      print "  could not move the restore into place for $target" >&2
      /bin/rm -f "$target.restore"
      return 1
    fi
    return 0
  fi
  # Nothing was there before, so nothing should be there now.
  /bin/rm -f "$target" || return 1
  return 0
}

restore() {
  print "restoring the previous install"
  local trouble=no
  /bin/launchctl bootout system/$label > /dev/null 2>&1
  restore_one "$helper_path" "$backup/helper" || trouble=yes
  restore_one "$mihomo_path" "$backup/mihomo" || trouble=yes
  restore_one "$uid_path"    "$backup/uid"    || trouble=yes
  restore_one "$plist_path"  "$backup/plist"  || trouble=yes
  if [[ $was_loaded == yes && -f $plist_path ]]; then
    /bin/launchctl bootstrap system "$plist_path" > /dev/null 2>&1
  fi
  # Report what is installed, not that restoring was attempted. The silent
  # failure was invisible because the message described the intention.
  if [[ -x $helper_path ]]; then
    print "  installed contract is now $("$helper_path" --version 2>/dev/null)"
  else
    print "  no daemon is installed"
  fi
  if [[ $trouble == yes ]]; then
    print "  RESTORE INCOMPLETE — reinstall from the app before connecting" >&2
  fi
  /bin/rm -rf "$backup"
}

trap restore EXIT

[[ -f $helper_path ]] && /bin/cp -p "$helper_path" "$backup/helper"
[[ -f $mihomo_path ]] && /bin/cp -p "$mihomo_path" "$backup/mihomo"
[[ -f $uid_path ]] && /bin/cp -p "$uid_path" "$backup/uid"
[[ -f $plist_path ]] && /bin/cp -p "$plist_path" "$backup/plist"

typeset -a failures
check() {
  if [[ $2 == ok ]]; then
    print "  ok       $1"
  else
    failures+=("$1")
    print "  FAILED   $1${3:+ — $3}"
  fi
}
expect() {
  local name=$1; shift
  if "$@" > /dev/null 2>&1; then check "$name" ok; else check "$name" bad; fi
}
refute() {
  local name=$1; shift
  if "$@" > /dev/null 2>&1; then check "$name" bad "expected a refusal"; else check "$name" ok; fi
}

# A name for the exact bundle this ran against. `release-macos.sh --publish`
# computes the same digest over the app it is about to ship and refuses a token
# that names a different one, so the conclusion travels with the bundle instead
# of with whoever remembers running this — the two recipes must stay identical.
#
# Hashed from inside the bundle, so the same app answers the same wherever it was
# copied to. Whole lines are sorted rather than the file list, because paths
# inside a framework carry spaces and `sort -z` is not everywhere.
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

script=$backup/install.sh
if [[ -n $prebuilt_script ]]; then
  [[ -s $prebuilt_script ]] || { print "the supplied script is empty or missing" >&2; exit 2 }
  # Confirm it is the generated article and not something hand-written: the
  # point of this test is that root runs what production runs.
  /usr/bin/grep -q 'identifier "com.raydocs.tono.helper"' "$prebuilt_script" \
    || { print "the supplied script does not carry the helper requirement" >&2; exit 2 }
  /bin/cp "$prebuilt_script" "$script"
  print "using the install script emitted at $prebuilt_script"
else
# xcodebuild as root fails on this machine class — DerivedData, the signing
# keychain and TCC all belong to the console user — so refuse with the two
# commands that work instead of letting it fail three minutes in.
print "xcodebuild cannot emit the install script as root: DerivedData, the" >&2
print "signing keychain and TCC all belong to the console user. Emit it as" >&2
print "yourself first, then pass it with --script:" >&2
print "" >&2
print "  TEST_RUNNER_TONO_EMIT_INSTALL_SCRIPT=/tmp/tono-install.sh \\" >&2
print "  TEST_RUNNER_TONO_EMIT_INSTALL_APP=$app \\" >&2
print "  TEST_RUNNER_TONO_EMIT_INSTALL_UID=$trusted_uid \\" >&2
print "  xcodebuild test -project ${script_path:h:h:h}/apps/macos/LiquidClash.xcodeproj \\" >&2
print "    -scheme LiquidClash -destination 'platform=macOS,arch=arm64' \\" >&2
print "    -only-testing:TonoTests/HelperInstallScriptTests/testEmitInstallScriptWhenRequested" >&2
print "" >&2
print "  sudo $script_path --app $app --script /tmp/tono-install.sh" >&2
exit 2
print "generating the production install script from HelperManager"
# `TEST_RUNNER_` prefixed variables are forwarded to the test host with the
# prefix stripped; unprefixed ones stay in xcodebuild's own environment and never
# reach the test. Without the prefix the emit test hit its `XCTSkip`, xcodebuild
# reported TEST SUCCEEDED — a skip is a pass — and no file was written. This step
# had therefore never once produced a script, which is worse than failing: the
# release notes tell an operator to run this gate before publishing.
if ! TEST_RUNNER_TONO_EMIT_INSTALL_SCRIPT=$script \
     TEST_RUNNER_TONO_EMIT_INSTALL_APP=$app \
     TEST_RUNNER_TONO_EMIT_INSTALL_UID=$trusted_uid \
     DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer} \
     /usr/bin/xcodebuild test \
       -project "${script_path:h:h:h}/apps/macos/LiquidClash.xcodeproj" \
       -scheme LiquidClash \
       -destination 'platform=macOS,arch=arm64' \
       -only-testing:TonoTests/HelperInstallScriptTests/testEmitInstallScriptWhenRequested \
       > "$backup/emit.log" 2>&1; then
  print "could not emit the install script" >&2
  /usr/bin/tail -5 "$backup/emit.log" >&2
  exit 1
fi
fi
[[ -s $script ]] || { print "the emitted script is empty" >&2; exit 1 }

print "running it as root"
if ! /bin/sh "$script" > "$backup/install.log" 2>&1; then
  print "the install script failed" >&2
  /usr/bin/tail -12 "$backup/install.log" >&2
  exit 1
fi

print "checking what landed"
expect "daemon binary installed" test -f "$helper_path"
expect "core binary installed" test -f "$mihomo_path"
expect "launchd job installed" test -f "$plist_path"

owner=$(/usr/bin/stat -f '%Su:%Sg %Lp' "$helper_path" 2>/dev/null)
[[ $owner == "root:wheel 755" ]] \
  && check "daemon is root:wheel 0755" ok \
  || check "daemon is root:wheel 0755" bad "$owner"

uid_mode=$(/usr/bin/stat -f '%Su:%Sg %Lp' "$uid_path" 2>/dev/null)
[[ $uid_mode == "root:wheel 600" ]] \
  && check "trusted-user file is root:wheel 0600" ok \
  || check "trusted-user file is root:wheel 0600" bad "$uid_mode"

recorded_uid=$(/bin/cat "$uid_path" 2>/dev/null | /usr/bin/tr -d '[:space:]')
[[ $recorded_uid == "$trusted_uid" ]] \
  && check "trusted user is the invoking user" ok \
  || check "trusted user is the invoking user" bad "$recorded_uid vs $trusted_uid"

# The identifier that build 42 got wrong, which made every repair fail. Checked
# against what is installed rather than against the source bundle, because the
# copy is what launchd will run.
identifier=$(/usr/bin/codesign -dv "$helper_path" 2>&1 | /usr/bin/sed -n 's/^Identifier=//p')
[[ $identifier == "com.raydocs.tono.helper" ]] \
  && check "installed daemon carries its bundle identifier" ok \
  || check "installed daemon carries its bundle identifier" bad "$identifier"

expect "installed daemon still satisfies the Developer ID requirement" \
  /usr/bin/codesign --verify --strict --all-architectures \
    -R='anchor apple generic and identifier "com.raydocs.tono.helper" and certificate leaf[subject.OU] = "YY57758GS7"' \
    "$helper_path"

if [[ -n $expect_version ]]; then
  expected_version=$expect_version
else
  expected_version=$(/usr/bin/sed -n 's/.*static let current = "\([^"]*\)".*/\1/p' \
    "${script_path:h:h:h}/apps/macos/Tono/Core/HelperProtocolVersion.swift")
fi
reported=$("$helper_path" --version 2>/dev/null | /usr/bin/tr -d '[:space:]')
[[ $reported == "$expected_version" ]] \
  && check "installed daemon reports the expected contract" ok \
  || check "installed daemon reports the expected contract" bad "$reported vs $expected_version"

# launchd accepts the bootstrap asynchronously, so poll rather than assume.
ready=no
for _ in {1..40}; do
  if [[ -S $socket_path ]]; then ready=yes; break; fi
  /bin/sleep 0.25
done
[[ $ready == yes ]] \
  && check "daemon is listening" ok \
  || check "daemon is listening" bad "no socket at $socket_path"

socket_mode=$(/usr/bin/stat -f '%Su:%Sg %Lp' /var/run/tono-core 2>/dev/null)
[[ $socket_mode == "root:wheel 755" ]] \
  && check "socket directory is root-owned" ok \
  || check "socket directory is root-owned" bad "$socket_mode"

# Reinstalling over a running daemon has to converge, not wedge. This is the
# path every upgrade takes.
if ! /bin/sh "$script" > "$backup/reinstall.log" 2>&1; then
  check "reinstall over a running daemon succeeds" bad
else
  ready=no
  for _ in {1..40}; do
    if [[ -S $socket_path ]]; then ready=yes; break; fi
    /bin/sleep 0.25
  done
  [[ $ready == yes ]] \
    && check "reinstall over a running daemon succeeds" ok \
    || check "reinstall over a running daemon succeeds" bad "socket did not come back"
fi

# An unsigned copy must not satisfy the requirement. This is the check that
# stands between the daemon and an arbitrary binary, so it is asserted against a
# real ad-hoc-signed file rather than trusted.
adhoc=$backup/adhoc-helper
/bin/cp "$app/Contents/Resources/liquidclash-helper" "$adhoc"
/usr/bin/codesign --force --sign - --identifier com.raydocs.tono.helper "$adhoc" 2>/dev/null
refute "ad-hoc signature is refused by the install requirement" \
  /usr/bin/codesign --verify --strict --all-architectures \
    -R='anchor apple generic and identifier "com.raydocs.tono.helper" and certificate leaf[subject.OU] = "YY57758GS7"' \
    "$adhoc"

print ""
if (( ${#failures} > 0 )); then
  print "failed: ${(j:, :)failures}"
  exit 1
fi
print "install lifecycle passed"
# Printed only on a pass, and only for the bundle that was actually installed.
token=$(bundle_token "$app") \
  || { print "the lifecycle passed but $app could not be digested" >&2; exit 1 }
print "  bundle token: $token"
print "  the publish that ships this bundle wants it:"
print "    tooling/scripts/release-macos.sh --version <x.y.z> --build <n> \\"
print "      --publish --lifecycle-token $token"
exit 0
