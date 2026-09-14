# G3: random Base64 words must not reject real Sparkle signatures

Found while reviewing Services CI for #172 (push run 34782084206, ops-contract
job 103790811874). The wrong-key regression generated an Ed25519 signature whose
Base64 happened to contain `XXXX`; the publisher's substring placeholder heuristic
rejected it before cryptographic verification. The same heuristic can reject a
correctly signed archive: it is a publisher false refusal, not acceptance of an
invalid update.

A fixed synthetic archive, public key and valid signature containing `FakE` now
reproduce this deterministically through `buildAppcastUpdate`. The unmodified
validator refuses it as a placeholder. The fix reserves text-placeholder diagnosis
for input without the 64-byte Ed25519 Base64 shape. Strict canonical decoding,
length/pattern/reuse checks and verification against the exact archive and embedded
public key are unchanged and remain mandatory.

The new single regression accepts the real fixed signature and rejects that same
signature over a changed archive. Existing malformed/placeholder/wrong-key cases
remain green: the complete publisher test file passes 26/26. The fixture contains
no private key, customer data or production signing material.

The behavior is exercised entirely through pure in-memory helpers. No appcast,
release artifact, version, signing identity or customer channel was modified.
This serves G3 release-tool reliability; it does not close issue #26 or certify
an installed Sparkle update.
