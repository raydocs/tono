## 2026-10-01 · Windows failed consume writes reach selective update cleanup

- 归属：G3；Windows independent update executor transaction boundary.
- 来源：baseline `42fffd3d` → branch `hunt/sol-r4fwa-consume-refusal`; PR pending; source delivery, not yet merged at writing.
- 缺陷修复：#1171 / `R4UPD-WIN-CONSUME-FAILURE-RELEASE`; one failed durable consumption write after successful token capture formerly returned before cleanup, leaving healthy Blocked WFP after Core stopped. The failure now reaches the existing guarded selective finalizer.
- 新增/优化：none. Preserve uncertain disk evidence, high-water, poisoned Store and strict disposition. Clock/expiry policy remains unchanged; no installation authority is granted on failure.
- 工程与测试：one regression injects actual atomic replacement refusal after successful capture, checks deferred refusal, no forward authority, unchanged memory and retained evidence after reopen. Its initial fixture comparison required serialized State bytes because State does not implement PartialEq; that compile correction is not a product finding.
- 验证：Linux decisive regression failed before (0 passed / 1 failed); `CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/windows/service/Cargo.toml --locked --features standalone,client,test --lib update_transaction::tests::` passed 26 tests, including expiry refusal and single-use/lost-ack consumption. Native Windows executor/SCM/WFP and device network behavior cannot run in this VM; CI/hardware remain pending.
- 候选/发布：仅源码，无新候选；no build, deployment, signing or publishing performed.
- 剩余限制：automatic release does not fabricate completed installation or retire possibly consumed evidence. Secondary native cleanup failure remains a separate existing boundary.
