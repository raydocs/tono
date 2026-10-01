## 2026-09-26 · hy2 on macOS via a separately published SPKI pin

- Status: owner
- Chosen: hy2 must work for every user in 0.0.74, macOS included; fix the pin now (owner).
  Mechanism: each managed hysteria2 block may carry `certificate-public-key-sha256`, the
  standard base64 SHA-256 of the leaf's SubjectPublicKeyInfo, computed by the operator on the
  node and published beside the DER `fingerprint`, which stays mandatory (Windows/mihomo keeps
  using it). macOS passes it to sing-box as `tls.certificate_public_key_sha256`; a block without
  a valid pin stays unavailable. Rejected: deriving SPKI from the DER hash on the client
  (impossible), `insecure: true`, dropping the pin, and shipping macOS without hy2.
- Why: hy2 nodes serve operator-generated self-signed certificates whose private key never
  leaves the node, and the DER pin never relied on a CA, name or validity period, so a key pin
  gives the same MITM protection. Evidence: [product contract](../../tooling/scripts/sing-box/product-contract.md).
- Applied in: `feat/macos-hy2-spki-pin-20260926`. Publishing the pins is a separate ops step.
