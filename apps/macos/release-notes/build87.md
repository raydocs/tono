# Tono 0.0.86 (build 87)

Requires Apple Silicon and macOS 26.3+.

## Changes since build 86

- **Signed TCP direct IPs** (#1856): The signed `traffic-policy` can now carry `tcpDirectAddresses` (non-DNS IPv4 TCP destinations) and v5 `tcpEndpoints`. These addresses are sent direct and admitted by the helper's fail-closed filter, so a policy update can add or change them without a client rebuild. The helper protocol version moves with this build.
