# Tono 0.0.53

- WeChat now routes direct as a whole application instead of by enumerated addresses. Its message channel resolves through its own DNS and dials rotating raw addresses across several ranges, so an address list could only ever cover its CDN traffic — which is why messages and images stalled for users far from the exit.
- Everything Tono does not route direct still goes through the tunnel, and still fails closed if the tunnel drops.
- Fixes two faults in 0.0.51/0.0.52 that left those builds unable to start protection at all: the privileged helper was not replaced when its request contract changed, and one firewall rule was written in a form the packet filter rejects.
