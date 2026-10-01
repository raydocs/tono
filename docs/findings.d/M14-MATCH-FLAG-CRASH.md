| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| M14-MATCH-FLAG-CRASH | Developer-profile import of MATCH,no-resolve removes the policy slot and traps at parts[1] | in-PR | [#818](https://github.com/raydocs/tono/pull/818) | 低·已确认 | P3; developer profile only; XCTest requires macOS CI |

`RulesView.importRules` → `ConfigParser.parseClashYAMLRules` → `RuleItem.from` checked the component count before removing the optional flag. Check the remaining components before indexing. The regression imports the malformed rule followed by a valid reject rule; only the valid rule survives. No network or visual behavior changes.
