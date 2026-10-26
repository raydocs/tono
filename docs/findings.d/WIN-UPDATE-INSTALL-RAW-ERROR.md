| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-INSTALL-RAW-ERROR | Windows 更新对话框把安装失败的英文原句当成正文，并且任何失败都会拿掉「现在更新」 | in-PR | fix/t7-update-prep | 中·已确认 | 人话在对话框里，原句收进「技术详情」。签名、水位、Service 拒绝仍停住按钮；网络失败可以再试。未在安装机上点过 |

`apps/windows/app/src/components/setting/mods/update-viewer.tsx` 以前调用 `formatTonoActionError` 时没有传入 `t`。
