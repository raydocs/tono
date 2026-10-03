| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DIRECT-STALE-SKIP | A predecessor's detached optional DIRECT discovery failure clears a successor's active overlay and physical-interface evidence | fixed(6758431f) | hunt/sol-r4wapp-direct-skip-generation | 低·已确认（P2） | Exact production skip-function regression failed then passed on Linux; native Tauri/network monitoring and installed-device acceptance await CI/hardware. |

Baseline `6a9994ca`: `connection/direct.rs:1559` logs and clears the current state without checking the discovery's connection generation. Discovery can wait up to 20 seconds before the first freshness check, while Disconnect and a successor Connect proceed. A late failure then removes `applied_direct_interface`, bypassing the DIRECT-uplink branch in `monitor.rs:1326-1336`, and attributes the old failure to the current audit owner.

Every skip call now passes its captured generation. The skip checks that generation under the state mutex before auditing or updating overlay evidence; current-session skip behavior stays the same.
