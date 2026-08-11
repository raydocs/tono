# Tono 0.0.56

- Connecting is faster. The app was resolving eleven addresses, arming roughly a hundred and twenty firewall exceptions, and health-checking twenty routes before it would report connected — all for rules the routing engine never reached, because WeChat is matched by application ahead of them.
- Chinese sites on the direct list now use QUIC instead of falling back after a failed handshake, which mainly helps video.
