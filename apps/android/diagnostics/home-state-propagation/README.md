# State publication diagnostic (not acceptance)

Cloud-only command, from `apps/android`:

```sh
./gradlew --no-daemon --stacktrace --init-script diagnostics/home-state-propagation/probe.init.gradle :mobile:testDebugUnitTest --tests '*HomeStatePropagationProbe'
```

The init script adds these four **diagnostic** tests only to this invocation. It does not
change product code, assertions, the normal source/test inventory or the APK. Each variant
holds the same two-frame clock and safety assertions; only entry point and explicit Snapshot
publication vary. Failures are retained as observations, not retried or counted as acceptance.
The default source directory excludes this probe; the real 118-case suite is unchanged.
`PROPAGATION` records apply notifications, entry composition and actual primary state semantics.
It cannot prove pixels, real-time FPS or physical-device behavior.
