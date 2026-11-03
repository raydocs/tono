# Live node pins

`config/fleet/live-node-pins.json` records the Reality SNI (`target` and `serverNames`) and the TCP profile already applied on Tokyo · Sakura, Tokyo · Fuji, JP-VLESS-Reality, and Buffalo · Erie.

The same fronts are keyed by catalog name and public IPv4 in `tooling/scripts/reality-fronts.json` `nodeTargets`. `serverNames` is that host and nothing else. The kernel values are the `DESIRED` block in `tooling/scripts/remote/tune-tono-tcp.sh`. `tooling/scripts/check-node-in-fleet.py` `TCP_PROFILE` is the subset it reads back (congestion control, qdisc, slow start, MTU probing, fast open, and the 16 MiB max buffers).

A redeploy or reprovision has to keep these values. Changing a pin starts in this file and in `reality-fronts.json`, after a measurement from inside the market. This record does not SSH, sysctl, republish a catalog, or deploy the control plane.
