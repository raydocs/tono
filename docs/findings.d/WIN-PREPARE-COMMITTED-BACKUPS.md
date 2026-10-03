| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-PREPARE-COMMITTED-BACKUPS | A later Prepare overwrites committed recovery evidence before retained external backups are cleaned, stranding a failed cleanup retry | fixed(0b1521be) | This PR | 低·推导 (P2) | Native regression authored; Windows CI pending; ARP-version retry is separate |

After a transient committed-cleanup failure, an ordinary user can start a later update before reboot. The committed attempt is not pending, so Prepare previously saved its replacement immediately. The old ONSTART executor then fails its private-attempt binding, and the next Install replaces that task. Old `.rollback` bytes still differ from the installed target and correctly refuse later publication. This is the missing preparation boundary beside `WIN-COMMITTED-CLEANUP-RETRY` (#1017).

Before saving a new reservation, read and bind the previous committed plan. If external recovery scratch remains, use the existing every-member New proof before removing any of it. A sharing error or unproven target preserves the old durable attempt and fails before staging or Core stop. When all scratch is absent, a legitimate manual replacement's changed bytes do not block a new reservation. No protection policy or version metadata is rewritten.
