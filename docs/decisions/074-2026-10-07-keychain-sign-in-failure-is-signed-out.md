## 2026-10-07 · macOS 登录凭据持久化失败选择干净回滚
- Status: provisional
- Chosen: #901 按 AGENTS 更严、不泄漏选择：初始登录凭据写入失败不保留内存 token，不保持登录。先记录不含秘密的持久恢复拒绝，再替换 Keychain 凭据；只在新凭据持久化成功且拒绝记录清除成功后接受会话。失败清内存、尽力删除 prior token、清账户并显示已登出及准确下一步提示；不自动释放网络保护。新进程读拒绝标记或其读取出错都不能恢复旧账户。
- Rejected: 首次登录仅保留内存 token 等后续再写；失败后回退旧账户；为清登录 UI 自动解除 PF/DNS；把恢复记录失败误称为 Keychain 拒绝。
- Why stricter: 2026-10-07 Claude ribboneel 转述 owner「都修复完了发新版」并指定严格回滚。该转述不是 owner 本人直接确认的具体产品选择，因此记录 provisional，owner 可否决。内存凭据不得在持久化失败后绕过账户隔离。
- Applied in: [#1446](https://github.com/raydocs/tono/pull/1446)，Plan: SHIP_PLAN §2 item 10。旋转 token 的已有恢复路径不改。
- Limits: 若磁盘拒绝记录与 Keychain 删除同时失败，无法在本地制造持久拒绝；当前进程仍登出，但旧 token 可能跨重启存在，需修复存储或服务端撤销。真实设备/断电级持久性留 G1/G2，不称源码测试为安装验收。
