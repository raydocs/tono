| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DNS-DOH-CAPTURE-DELETE | Deleting a restored DoH capture can refuse DNS restoration and WFP release on a sharing violation | fixed(41995d1a) | Branch `hunt/sol-r3dns-doh-retirement` (this PR) | 中·已确认（P1，源码路径；Windows regression added） | Windows sharing-lock regression and device DNS/WFP await CI/hardware; a simultaneous retirement-marker write failure remains an error |

`restore_encrypted_dns` restores `EnableAutoDoh`, then propagated deletion failure from `protected-secure-dns.json` before the interface-policy leg. `restore_interface_doh` similarly propagated deletion failure after restoring the saved flags. The facade classified each as unresolved resolver policy and refused WFP release even though the OS settings had been restored. This is distinct from `protected-dns.json` retirement in #769/#827.

A capture whose delete fails now receives a durable sibling `restored.json` record. Subsequent restores skip its already-restored, possibly stale originals. The next suppression saves the current settings and must remove this record before changing DoH, including when the current global value is zero or the interface set is empty. If both deletion and writing its retirement record fail, the operation still reports the error; suppress never mutates using an ambiguous generation.
