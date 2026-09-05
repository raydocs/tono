# Tono macOS 0.0.72 (build 72)

Release candidate prepared from the reviewed September 5 integration main,
with policy, lifecycle and diagnostics fixes. The matching Windows candidate
is 0.0.72. The build 71 release history is merged without rewriting its tags.
The integrated source retains the newer default-off telemetry consent,
browser Secure DNS checks and admitted residential-route audit context.

## Known limitations

- [#17](https://github.com/raydocs/tono/issues/17): installed-device upgrade,
  browser Secure DNS and real residential traffic acceptance remain incomplete.
  CI does not certify those field scenarios.
- [#26](https://github.com/raydocs/tono/issues/26): the paired Windows release
  still has incomplete protected update-journal lifecycle evidence.
- [#41](https://github.com/raydocs/tono/issues/41): same-main Services CI
  dispatch was blocked by Actions permissions. Prior runs are not a substitute.
- [#4](https://github.com/raydocs/tono/issues/4) and
  [#5](https://github.com/raydocs/tono/issues/5): metering cutover and counter
  generation limitations remain; no production migration is part of this release.
- [#12](https://github.com/raydocs/tono/issues/12): CI path-filter coverage
  remains incomplete.

Developer ID signing, Apple notarization, Sparkle signature verification and
privileged helper installation acceptance must be verified on the actual
archive. None is asserted by these notes. The GitHub workflow only validates
an appcast candidate; publication of the archive and feed is separate.
