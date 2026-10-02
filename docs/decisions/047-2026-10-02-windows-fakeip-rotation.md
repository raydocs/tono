## 2026-10-02 · Windows：替换 sing-box 进程后旧 fake-IP 怎么处理

- Status: provisional
- Chosen: 池改为 `198.18.128.0/17`，分成八个 /20 槽位；App 每编译一份文档取下一个槽位，计数写在 App 数据目录里（重启后接着数）。模板拒绝目的地址在池内的纯 IP 连接（`no_drop`，同时拒绝旧池 `198.18.16.0/20`）。[#1258](https://github.com/raydocs/tono/issues/1258) 列的另外两个选项不选：打开 `cache_file` 的 `store_fakeip` 会把访问过的域名写到磁盘，Service 和 macOS helper 的准入也都要求 `cache_file.enabled == false`；在公布 Connected 之前就应用 DIRECT 会让 Connect 最多多等 20 秒的 DIRECT 解析。第一版把原来的 /20 切成四个 /22，评审指出每个进程的地址数从 4093 降到 1021、回绕更早，所以改成换一个更大的池、每个槽位仍是 /20。
- Why stricter: 不落盘域名（落盘的只有一个计数），不放宽任何准入。旧地址由「连到另一个域名」变成「被拒绝」，没有新增可达的目的地；拒绝规则排在 home、DIRECT 和出口规则之前，目的地是域名的连接不匹配它。每个进程的地址数不变。
- Not covered: Service 自己用同一份文档重启进程的路径（看门狗重启、期望状态恢复、替换失败后的还原和重试）不经过 App 编译，槽位不变，问题照旧（WIN-SINGBOX-FAKEIP-SERVICE-RESTART，未关）。八份文档之内槽位会复用。计数存不下去时起点取自时钟，可能与正在运行的进程同槽。
- Applied in: [#1333](https://github.com/raydocs/tono/pull/1333)（Windows），[#1334](https://github.com/raydocs/tono/pull/1334)（macOS：`/core/sync` 重启同理，计数存在 App 的 UserDefaults；只有「完整 reload 且渲染结果就是已安装的那份文档」保持原字节、不重启 Core，其余每次写文档都取下一个不是已安装文档所在的槽位；「已安装」是 App 的记录，应答丢失时可能是旧的，MAC-SYNC-REPLY-LOST-DIGEST 未关）。
