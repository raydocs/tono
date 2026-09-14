# Native self-hosted runner onboarding

Supports [G1/G3 execution policy](../../docs/BUILD_AND_TEST.md). Register both
machines directly to **private `raydocs/tono`**. The former `tono-build` control
repository has Actions disabled and is archived; do not register there.

## 1. Same private repository, explicit execution boundaries

Runner registration: [Tono Settings → Actions → Runners](https://github.com/raydocs/tono/settings/actions/runners).
The manual read-only workflow is
[`.github/workflows/native-runner-connectivity.yml`](../../.github/workflows/native-runner-connectivity.yml).
It becomes dispatchable after this change reaches the default branch; do not
claim a feature-branch file is already available on main.

Keep collaborator access restricted and review workflow changes. Private
visibility is not a sandbox. The existing hosted CI and protected release paths
remain unchanged; this workflow does not compile, install or mutate networking.
No machines have been registered or qualified by this repository change.

## 2. Mac Studio (commands run on the Studio, not MacBook)

1. Use a dedicated ordinary build account without production/signing keys.
2. In **`raydocs/tono`** open Settings → Actions → Runners →
   New self-hosted runner. Select macOS and the actual architecture (`uname -m`;
   choose ARM64 only if the machine reports arm64).
3. Follow GitHub's current download and checksum-verification instructions in
   a persistent directory such as `~/actions-runner-tono`, not `/tmp` or a
   source worktree. Do not hardcode an old runner version from a handoff.
4. Run the displayed `config.sh` command for **`raydocs/tono`**, not the retired
   controller. At the prompts choose name **`tono-macstudio`** and extra label
   **`tono-build-macos`**;
   keep the default OS/architecture labels and `_work` work folder.
5. Start `./run.sh` in the foreground first. Confirm “Listening for Jobs” and
   **Idle** in the repository runner page. This is connectivity, not build proof.
6. After a successful smoke, optionally install the official macOS service
   under that build account using the service instructions. Do not run the
   worker as root or assume service mode can drive an interactive GUI test.

## 3. Windows machine

1. Use a dedicated least-privilege build account; inspect OS architecture first.
2. From **`raydocs/tono`**'s New self-hosted runner page, choose
   Windows and the matching architecture. Use the displayed current download
   and checksum steps in a persistent directory such as `C:\actions-runner`.
3. Run the displayed `config.cmd` command. Name: **`tono-windows`**. Extra label:
   **`tono-build-windows`**. Keep default labels and `_work`.
4. For first verification decline service installation and start `run.cmd`
   in that dedicated account's PowerShell. Confirm **Idle** and run the smoke.
5. If service mode is later needed, follow GitHub's Windows service setup
   (configuration needs an elevated shell), with an explicitly chosen build
   account. Do not accept a privileged service account blindly. GUI acceptance
   still needs a separate interactive desktop and approved test setup.

The generated registration token is time-limited. Run it directly on the target
machine; do not paste it into chat, Git, screenshots or a shared transcript.
No SSH passwords, PATs, signing keys, public inbound ports or router changes
are required just to follow GitHub's registration UI. Network policy must
allow the runner's outbound GitHub connections; diagnose rather than disable
the firewall if registration fails.

## 4. First job and what it proves

In **`raydocs/tono`**, Actions → Native runner connectivity →
Run workflow, branch `main`, choose `macos` or `windows`. Run each separately.
The workflow has no checkout, dependency install, compiler invocation,
privileged operation, artifact upload or network test. It reports OS,
architecture, free disk and whether tool executables can be found.

Green means the selected worker accepted the reviewed read-only job. It does
**not** mean tools, SDK versions, signing, source builds, native tests or releases
are qualified. Missing tools are reported, not installed automatically.

Next: privately record the two runner names, OS/architecture and run IDs. Review
actual tool versions and add the pinned-source native-build lane described in
[BUILD_AND_TEST](../../docs/BUILD_AND_TEST.md). No native-build workflow is
implemented by this connectivity check.

## Official instructions

- [Adding a self-hosted runner](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)
- [Running the runner as a service](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application)
- [Self-hosted runner security](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners)
