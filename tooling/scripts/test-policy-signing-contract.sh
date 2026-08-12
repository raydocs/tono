#!/usr/bin/env bash
set -uo pipefail

# bash, not zsh: this runs on the Ubuntu CI runners too, and those do not ship
# zsh. A check that cannot execute where it is wired in is not a check.

# The policy signing contract spans four languages, and each one asserts its own
# constants in its own suite. None of them can notice the other three changing.
#
# Drift here is silent and total. If the public key differs, every signed policy
# reads as untrustworthy, and because an untrustworthy document is refused whole,
# managed direct routing stops on every device the moment a signed policy is
# published. If the context prefix differs, signatures verify nowhere and the same
# thing happens. Neither shows up as an error anyone would look at — it presents as
# "the policy stopped working", which is exactly the failure this whole mechanism
# was built to end.
#
# So the agreement itself is the thing under test, checked from outside all four.

script_path=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/$(basename -- "${BASH_SOURCE[0]}")
repo_root=$(cd -- "$(dirname -- "$script_path")/../.." && pwd)

fail() { printf 'policy-signing-contract: %s\n' "$1" >&2; exit 1; }
checks=0
ok() { printf '  ok: %s\n' "$1"; checks=$((checks + 1)); }

worker="$repo_root/services/control-plane/src/crypto.ts"
wrangler="$repo_root/services/control-plane/wrangler.jsonc"
swift="$repo_root/apps/macos/Tono/Core/ManagedTrafficPolicySignature.swift"
rust="$repo_root/apps/windows/crates/tono-core/src/policy.rs"
publisher="$repo_root/tooling/scripts/publish-traffic-policy.mjs"

for file in "$worker" "$wrangler" "$swift" "$rust" "$publisher"; do
  [[ -f $file ]] || fail "missing $(basename -- "$file"); the contract cannot be checked"
done

# --- the public key: three declarations, one value ---------------------------
# Extracted rather than pattern-matched against a literal in this script: a
# constant here would be a fourth place to forget, and rotating the key would then
# need an edit nobody would think to make.
key_wrangler=$(/usr/bin/sed -n 's/.*"TRAFFIC_POLICY_PUBLIC_KEY": *"\([^"]*\)".*/\1/p' "$wrangler" | /usr/bin/head -1)
key_swift=$(/usr/bin/sed -n 's/.*publicKeyBase64 = "\([^"]*\)".*/\1/p' "$swift" | /usr/bin/head -1)
key_rust=$(/usr/bin/sed -n 's/.*TRAFFIC_POLICY_PUBLIC_KEY: &str = "\([^"]*\)".*/\1/p' "$rust" | /usr/bin/head -1)

[[ -n $key_wrangler ]] || fail "wrangler.jsonc declares no TRAFFIC_POLICY_PUBLIC_KEY"
[[ -n $key_swift ]] || fail "the macOS client declares no publicKeyBase64"
[[ -n $key_rust ]] || fail "the Windows client declares no TRAFFIC_POLICY_PUBLIC_KEY"

[[ "$key_wrangler" == "$key_swift" ]] \
  || fail "macOS trusts $key_swift, the deployment serves $key_wrangler"
[[ "$key_wrangler" == "$key_rust" ]] \
  || fail "Windows trusts $key_rust, the deployment serves $key_wrangler"
ok "all three declare the same signing key"

# A key that is not a key fails the same way a mismatched one does, so shape is
# checked here too rather than trusted to look right.
/usr/bin/env node -e '
const key = Buffer.from(process.argv[1], "base64");
if (key.length !== 32) {
  process.stderr.write(`the signing key decodes to ${key.length} bytes, not 32\n`);
  process.exit(1);
}
require("crypto").webcrypto.subtle
  .importKey("raw", key, { name: "Ed25519" }, false, ["verify"])
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(`the signing key is not a valid Ed25519 point: ${error.message}\n`);
    process.exit(1);
  });
' "$key_wrangler" || fail "the declared signing key is unusable"
ok "the declared key is a valid 32-byte Ed25519 public key"

# --- the signed byte layout: four declarations, one value --------------------
# Compared as escaped source text. The prefix ends in a newline, which a shell
# capture would strip, and stripping it is precisely the drift being looked for.
context_worker=$(/usr/bin/sed -n "s/.*TRAFFIC_POLICY_SIGNATURE_CONTEXT = '\([^']*\)'.*/\1/p" "$worker" | /usr/bin/head -1)
context_publisher=$(/usr/bin/sed -n "s/.*SIGNATURE_CONTEXT = '\([^']*\)'.*/\1/p" "$publisher" | /usr/bin/head -1)
context_swift=$(/usr/bin/sed -n 's/.*static let context = "\([^"]*\)".*/\1/p' "$swift" | /usr/bin/head -1)
context_rust=$(/usr/bin/sed -n 's/.*TRAFFIC_POLICY_SIGNATURE_CONTEXT: &str = "\([^"]*\)".*/\1/p' "$rust" | /usr/bin/head -1)

# Swift and Rust escape the newline once for their own source; the two JavaScript
# files write the same escape in a single-quoted string. All four should read
# identically after extraction.
#
# Every right-hand side below is quoted. Unquoted, `[[ == ]]` treats it as a glob
# pattern in which a backslash escapes the next character, so the `\n` this check
# exists to protect would match a literal `n` and the check would pass on drift.
expected='tono-traffic-policy-v1\n'
for pair in "control plane:$context_worker" "publisher:$context_publisher" \
            "macOS:$context_swift" "Windows:$context_rust"; do
  where=${pair%%:*}
  value=${pair#*:}
  [[ -n $value ]] || fail "$where declares no signature context"
  [[ "$value" == "$expected" ]] \
    || fail "$where signs over '$value', the contract is '$expected'"
done
ok "all four sign over the same byte prefix"

# --- the protected list is not relaxable ------------------------------------
# Compared as sets, extracted from the three declarations themselves.
#
# An earlier version of this check grepped each file for the hostname anywhere in
# it, and passed while `anthropic.com` was deleted from the Windows constant — the
# string still occurred in that file's own tests. A check that can be satisfied by
# something other than the thing it checks is worse than no check, because it
# reports safety. So each list is read out of its declaration and compared exactly,
# which also catches an entry added on one side and forgotten on the others.
extract() { /usr/bin/env node -e '
const { readFileSync } = require("fs");
const [file, pattern] = process.argv.slice(1);
const match = readFileSync(file, "utf8").match(new RegExp(pattern, "s"));
if (!match) { process.stderr.write("declaration not found\n"); process.exit(1); }
const hosts = [...match[1].matchAll(/["\x27]([a-z0-9.-]+\.[a-z]+)["\x27]/g)].map((m) => m[1]);
if (!hosts.length) { process.stderr.write("declaration contains no hosts\n"); process.exit(1); }
process.stdout.write([...new Set(hosts)].sort().join(" "));
' "$1" "$2"; }

protected_swift=$(extract "$repo_root/apps/macos/Tono/Core/ConfigPipeline.swift" \
  'managedDirectProtectedSuffixes = \[(.*?)\]') \
  || fail "the macOS protected list could not be read"
protected_rust=$(extract "$rust" 'PROTECTED_FROM_DIRECT: \[&str; \d+\] = \[(.*?)\]') \
  || fail "the Windows protected list could not be read"
protected_worker=$(extract "$repo_root/services/control-plane/src/index.ts" \
  'const protectedSuffixes = \[(.*?)\]') \
  || fail "the control plane's protected list could not be read"

expected_protected="anthropic.com claude.ai tono.app tono.com"
[[ "$protected_worker" == "$expected_protected" ]] \
  || fail "the control plane protects [$protected_worker], the contract is [$expected_protected]"
[[ "$protected_swift" == "$expected_protected" ]] \
  || fail "macOS protects [$protected_swift], the control plane protects [$protected_worker]"
[[ "$protected_rust" == "$expected_protected" ]] \
  || fail "Windows protects [$protected_rust], the control plane protects [$protected_worker]"
ok "all three protect exactly [$expected_protected] from any signed policy"

printf 'policy signing contract: %s/4 checks passed\n' "$checks"
