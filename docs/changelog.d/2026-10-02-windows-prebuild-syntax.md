## 2026-10-02 · Windows 候选打包脚本语法修复
- 归属：G1 候选构建（Windows）；`apps/windows/app/scripts/prebuild.mjs`。
- 来源：main `bef884fc` → 本 PR；破坏来自 `d22c8a4d`（#1159）。
- 缺陷修复：#1159 把 `writeSingBoxDigestPin` 插进 `writeCoreDigestPin` 中间，复制 `core-identity.json` 的几行落到函数外，`prebuild.mjs` 无法解析；Windows 候选构建 [run 36933892995](https://github.com/raydocs/tono/actions/runs/36933892995) 在 “Prepare the exact stable Mihomo and Windows resources” 报 `SyntaxError: Unexpected token '}'`。改后 identity 复制回到 `writeCoreDigestPin` 末尾，与 #1159 之前一致；sing-box 摘要函数单独成函数。
- 新增/优化：无。
- 工程与测试修正：`windows-packaging.test.mjs` 加一条 `node --check prebuild.mjs`（在 `pnpm test:dev-control` 里跑），旧代码红、修后绿；该文件 37/37 通过（本机 node）。Windows CI 此前不执行 prebuild，所以没拦住。
- 候选：仅源码，合入后重新派发 Windows 候选。
