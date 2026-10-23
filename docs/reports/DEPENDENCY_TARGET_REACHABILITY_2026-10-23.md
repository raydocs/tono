# glib 告警的锁定依赖与目标平台核对 · 2026-10-23

## 结论

GitHub 当前两个未关闭告警（#1、#5）来自两个 Cargo.lock 中的 **同一 glib 0.18.5 / GHSA-wrw7-89jp-8q8g**，不是两个已复现的 Windows 客户缺陷。
对基线 `57dc80e73a5f1fc4eff18bf5b5b70d3b98da175b` 的锁文件和精确 crate 发布归档进行核对后，所有从非 GTK 包进入该 GTK/glib 链的直接依赖，都声明在 Linux/BSD 的 `target_os` 条件下；这些条件不匹配 Windows 或 macOS。

这是**锁定源依赖的静态可达性证据**，不是目标 Cargo resolver 输出、Windows 二进制/SBOM 或真实运行证明。告警仍保持 open，不宣称已经修复/消失，也不以此授予发布资格。
不要为把告警数改成零而手改锁文件、强塞 glib 0.20 或删除跨平台锁条目：上游框架目前锁定 GTK/glib 0.18 组合，跨 minor 迁移不是可独立替换的补丁。

## 告警与源范围

- 上游说明：[RustSec RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)、[GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g)、[gtk-rs 修复 PR #1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343)。
- 上游问题是 `glib::VariantStrIter` 的 FFI out-pointer 以不可变引用传入，迭代器可触发未定义行为/崩溃；告警范围为 `>=0.15.0,<0.20.0`，标注首个修复版本为 0.20.0。
- 本次 GitHub API 只读取告警，没有 dismiss、忽略规则或安全政策变更。没有运行漏洞利用。
- 两份锁文件均解析到 glib 0.18.5；App 锁定 Tauri 2.12.1，独立 plugin 锁定 Tauri 2.12.2。该差异不是本次制造，也不未经验证统一锁文件。

| 锁文件 | 核对内容的 SHA-256 |
|---|---|
| `apps/windows/app/Cargo.lock` | `2facc98ea69a383b9f4b867009750bdb2403b6cd6f19c0e7d0c996546e67b089` |
| `apps/windows/crates/tono-plugin-core/Cargo.lock` | `5792c8d83d89275f48b012162fa577529211d88ce3eaf84f439ca9a6473e0e26` |

## 完整的外部入口边界

先从两份锁文件列出 glib 的直接消费者，再归入 GTK 家族（atk/cairo/gdk/gio/gtk/pango/webkit/javascriptcore/soup/libappindicator）。
下表覆盖锁文件中**所有非该家族包 → 该家族包**的依赖边。读取来源为 crates.io 精确版本 `.crate` 内的规范化 Cargo.toml；每份归档先按 Cargo.lock 的 checksum 校验，再读取文件，不安装或执行 crate。

| 包/锁定版本 | GTK 链入口 | 目标条件 | 归档 SHA-256（已与 lock 校验） |
|---|---|---|---|
| [muda 0.20.0](https://static.crates.io/crates/muda/muda-0.20.0.crate) | `gtk` | Linux/DragonFly/FreeBSD/NetBSD/OpenBSD | `cca139e57da4383727f189e43e66e84fa372347027fc996f9f1a007ec0a37996` |
| [tao 0.37.1](https://static.crates.io/crates/tao/tao-0.37.1.crate) | `gtk` | Linux/DragonFly/FreeBSD/NetBSD/OpenBSD | `f37f381f4e048e6cdf038b5705f8cf14ad108279d46eb968140a7b291aba9400` |
| [tauri 2.12.1](https://static.crates.io/crates/tauri/tauri-2.12.1.crate) | `gtk, webkit2gtk` | Linux/DragonFly/FreeBSD/NetBSD/OpenBSD | `ed99ee9694a2deb776d91cae48ac7411ddfc89ecae2f9b5041111d8c88f2ace9` |
| [tauri-runtime 2.12.1](https://static.crates.io/crates/tauri-runtime/tauri-runtime-2.12.1.crate) | `gtk, webkit2gtk` | Linux/DragonFly/FreeBSD/NetBSD/OpenBSD | `c2a57a2a9b8c8b7fc00d35b510fe808ded7f9f1b44fc1cdda6aee38632ea5413` |
| [tauri-runtime-wry 2.12.1](https://static.crates.io/crates/tauri-runtime-wry/tauri-runtime-wry-2.12.1.crate) | `gtk, webkit2gtk` | Linux/DragonFly/FreeBSD/NetBSD/OpenBSD | `7f9e7e0c9f80a5130773cfabb6df4dc924518fb1b2c923726966804634b57d22` |
| [tray-icon 0.25.1](https://static.crates.io/crates/tray-icon/tray-icon-0.25.1.crate) | `gtk, libappindicator` | Linux/DragonFly/FreeBSD/NetBSD/OpenBSD | `b2b9c52859a94554803ccd4a24b98f74148ebc73b90676d783f3490b1bff9d72` |
| [wry 0.57.0](https://static.crates.io/crates/wry/wry-0.57.0.crate) | `gdkx11, gtk, javascriptcore-rs, soup3, webkit2gtk` | Linux/DragonFly/FreeBSD/NetBSD/OpenBSD | `a819957a01b3119af85e638a38d242af76dbc87d130dca67bfd0441072e21ff0` |
| [tauri 2.12.2](https://static.crates.io/crates/tauri/tauri-2.12.2.crate) | `gtk, webkit2gtk` | Linux/DragonFly/FreeBSD/NetBSD/OpenBSD | `d061d042ccd2df9c9f1508c1e63d835278c0a4c8801eb41764080e51f2eaaf34` |

tray-icon 另有同目标条件的 GTK dev-dependency；没有用它冒充 Windows 的 runtime dependency。此核对不覆盖将来变更的 features、target、锁文件或手工 `cfg` 覆盖。

## 验证与后续

- 已执行：GitHub 告警/上游说明只读查询，两个锁文件 TOML 解析，GTK 入口枚举，8 份精确归档 SHA-256 校验与目标依赖读取。
- 未执行：本地 native Cargo、hosted `cargo tree/metadata --target x86_64-pc-windows-msvc`、Linux 构建/漏洞复现、产物 SBOM 和二进制分析、signed-build/真机/发布。
- 后续依赖刷新应在托管 Windows 主机保存真实 target 解析图，并与构建 features 对齐；若新增 Linux Tauri 产品，必须重新评估并迁移到上游修复的 GTK/GLib 组合，不沿用本结论。
- 本轮不改变 Cargo.toml/Cargo.lock、平台功能或 CI。Windows/macOS/Android 发布前原有原生、设备和 owner 门禁照旧。
- 原始响应和解析收据保存在执行机 `/tmp/tono-product-audit-20261023/glib/`；上面的源码、版本、来源和摘要支持重新核对，不把临时路径当公共发布证据。
