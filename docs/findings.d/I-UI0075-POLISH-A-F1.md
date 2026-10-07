| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| I-UI0075-POLISH-A-F1 | 海景首页过渡同时叠印新旧标题或副标题 | in-PR | [#1426](https://github.com/raydocs/tono/pull/1426) | 低·实测 | 4570901eb 的[原生回归](https://github.com/raydocs/tono/actions/runs/37596390930)通过；root逐看三段0/1六张原图均单字串，[规格作者复判](https://github.com/raydocs/tono/pull/1426#issuecomment-6034801982)接受。7957497e代码续审PASSED（评审未独立看图，视觉证据另列）；尚未合 main，真机/签名候选验证留 G1。 |

- 来源：规格作者 [A 帧评审](https://github.com/raydocs/tono/pull/1426#issuecomment-6034002168)，不是 owner 验收。
- 0527cd5d0 的 CI 全绿但首张原生证据否定了双分支曲线方案：第 0 帧改善，第 1 帧仍有祖先整层动画造成的重影；原图保留，不记为已修。
- 改为单一文字组先淡出、完全透明时无动画替换内容、再淡入；新首页不继承旧整层状态动画。快速取消回到旧文字时恢复可见，降低动态效果直接替换；不延迟连接状态/场景/动作。最终457原生帧已由root与规格作者逐看验证，非 owner 真机验收。
