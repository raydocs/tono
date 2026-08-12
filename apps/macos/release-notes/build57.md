# Tono 0.0.57

- Claude Code now uses the same network path as its own API calls for everything it contacts. Its launcher is named after its version rather than the application, so a rule meant to route it never matched, and anything outside the assistant domain list — including its telemetry uploads — left through the datacenter exit instead.
- WeChat's direct path can now fall back to the tunnel. A destination unreachable from where you are used to stall with nothing to retry through.
