## 2026-10-02 · macOS：用户关掉保护快照后，断网类事件还要不要上传

- Status: provisional
- Chosen: 不上传。快照开关关闭时，断网类事件（`TONO_NETWORK_LOSS`、`TONO_FAIL_OPEN`、`TONO_KILL_SWITCH_STUCK`、`TONO_RESTORE_NETWORK`、`TONO_CRASH_WHILE_PROTECTED`）不入队，已有队列不发送，关闭的那一刻清空本机队列。开关默认开启、v3 只对没做过选择的安装重新打开一次，这两点不变（[决策 002](002-2026-09-30-diagnostics-default-on.md)）。不选：#725 原来的做法——关闭后这类事件仍然上传。
- Why stricter: 设置里的说明写的是「关闭后停止这些上传」，关闭之后还有任何上传都和这句话不符。所有者批准的是把失败上报打开（2026-10-02，会话内），没有单独批准「明确关闭后仍上传」。代价：关掉开关的用户断网时，运维看不到这台机器的断网事件。
- Applied in: `feat/macos-diagnostics-default-on-20261002` 的 PR（取代 [#725](https://github.com/raydocs/tono/pull/725)）。
