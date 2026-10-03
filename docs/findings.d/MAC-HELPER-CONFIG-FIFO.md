| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HELPER-CONFIG-FIFO | `atomicCopy`（及同形的 `UpdatePackage.openInput`）对用户可写路径先 `open` 后 fstat：同 UID 进程把 config.json 或更新包路径换成无写端的 FIFO，open 永久阻塞 helper 唯一的请求线程，看门狗随之停摆，PF 保持武装且 `/core/stop` 无人应答 | fixed(ed6dee0d) | [#763](https://github.com/raydocs/tono/pull/763) | 中·推导（读码；未实机） | 需要同 UID 进程换文件（越权用户不可写这些路径）；`--staging-self-test` 的 FIFO 用例在缺失修复时表现为挂起而非失败；`openInput` 的加旗无独立用例，与 `atomicCopy` 同判同修 |

修复（分支 `glm/mac-helper-recovery`）：`atomicCopy` 源 open 与 `openInput` 逐段 `openat` 加 `O_NONBLOCK`——无写端 FIFO 立即返回，
既有的 fstat S_IFREG 检查拒掉它；正则文件读不受影响（与 `KillSwitchPF.secureRead` 既有做法一致）。
核对过的其余 `open(`：账本/DNS 状态/PF 状态/PrivilegedHelperTools 二进制均在 root 专属目录，用户不可置换；main.swift 的 Info.plist 读与
`KillSwitchPF.secureRead` 已带 `O_NONBLOCK`。均为写侧或 root 专属路径的 `open`（O_CREAT|O_EXCL 临时文件）不涉及阻塞语义。
