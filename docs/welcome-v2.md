# Tono Welcome v2 — first-run intro and sign-in ground

Design record for the third UI batch (2026-09-07). Both clients implement the
same composition from the same numbers; nothing here changes auth, routing,
Kill Switch or the passwordless flow in [desktop-clarity.md](desktop-clarity.md).

## Why

Three references were reviewed on real screens: Lody's intro (one sentence per
screen, one action, illustrations that never compete with text), ego lite's
onboarding (a layered gradient as the only "art", a trust line above the
decisive button, the button doubling as the progress indicator) and the
threeui gallery (reviewed and rejected: shader backgrounds and node figures read
as decoration, not as Tono). Tono has no illustration assets and Clarity removed live blur and
perpetual animation for good reasons, so v2 borrows the composition and the
restraint, not the shaders.

## 1. Ground

One solid color with a faint sheen, taken from the TO icon's tile. The brand
ramp (indigo → violet → peach) never becomes a background: it belongs to the
mark and, in v2, to the final "开始使用" text.
This follows Clarity's rule that the gradient stays in the logo. No backdrop
sampling, no animation.

| Role | Light | Dark |
| --- | --- | --- |
| Ground | `#F3EDE2` cream | `#12122A` night |
| Sheen 1 (top-left highlight) | radial, centre (0.30, 0.00), size 1.4 × 1.1, `#FFFFFF` 0.70 → transparent at 70% | radial, centre (0.70, 1.00), size 1.6 × 1.1, `#7B5CFF` 0.22 → transparent |
| Sheen 2 (bottom warmth) | radial, centre (0.60, 1.10), size 1.6 × 0.8, `#D6C8B2` 0.55 → transparent at 70% | radial, centre (0.85, 0.90), size 1.2 × 0.8, `#FFB07A` 0.10 → transparent |
| Headline ink | `#1B1F4B` | `#F3F1F7` |
| Body / secondary | `#5A5E7A` | `#B9B7CC` |
| Card | `#FFFFFF` | `#1B1C36` |
| Action fill (unchanged Clarity control color) | `#3658C9` + white | same |

Reduce Transparency / Increase Contrast: drop both sheens, keep the solid
ground. Tokens: `TonoBrand.welcomeGround` / `--tono-welcome-ground`, plus
`welcomeInk`, `welcomeMuted`; the ramp uses the existing `accent`,
`accentSoft`, `accentWarm`.

## 2. Hero: the icon tile

The hero is the product's own mark: the TO icon tile (cream tile, gradient
mark), rendered large as a physical object. No constellation, no invented
figure; the icon is already the most crafted asset Tono has and it is
on-brand by definition. Assets: `design-assets/tono-icon/export/
welcome-hero-1024.png` (macOS asset catalog, 1x/2x from it) and
`welcome-hero-512.png` (Windows, imported into `src/assets/`).

| Placement | Size | Position |
| --- | --- | --- |
| Intro, wide | 34% of window width, max 320 pt/px | right column, vertically centred on the window |
| Intro, narrow (< 800) | 32% of width, max 180 | centred above the text |
| Sign-in story | 22% of story width, max 180 | lower-left of the story column, under the body text |

Rendering: the PNG has its own tile; draw it with corner radius 22% of its
size clipped, plus two shadows so it sits on the ground:

| Theme | Shadow 1 | Shadow 2 | Ground contact |
| --- | --- | --- | --- |
| Light | `#2B2FB8` at 0.35, offset y 30, blur 60, spread −20 | `#1B1F4B` at 0.35, offset y 18, blur 30, spread −18 | ellipse under the tile (width 84%, height 10%, `#1B1F4B` 0.22 → transparent), blur 6 |
| Dark | `#7B5CFF` at 0.45, offset y 40, blur 80, spread −20 | 1 px inner hairline `#FFFFFF` at 0.06 | none |

Motion: on first appearance the tile rises 12 pt/px and fades in over
400 ms (ease-out) once; Reduce Motion: appears in place. It never floats,
rotates or follows the pointer.

## 3. Intro (first launch only)

Shown before sign-in when the user has never signed in on this install and
has not seen it (`introSeen` flag; macOS `AppStorage`, Windows
`localStorage`). One screen; Esc leaves it too. Never shown again after "开始使用".

Composition on the §1 ground: the title "欢迎使用 Tono" (34 pt / 36 px,
semibold), the three promises below as a list, then one solid primary
button "开始使用 →" (the sign-in action surface: `GateProminentButtonStyle` /
`.tono-action`, 44 pt/px tall, max 320). The copy column is at most 460 wide,
vertically centred; the hero tile sits to the right (wide) or above the text
(narrow, < 800 px). No steps, dots, Skip or Continue.

| Promise | Headline (zh) | Body (zh) | Headline (en) | Body (en) |
| --- | --- | --- | --- | --- |
| 1 | 连上，就受保护。 | 打开 Tono，点一下，所有流量都走受保护线路。 | Connected means protected. | Open Tono, click once, and all your traffic takes the protected route. |
| 2 | 断网，也不裸奔。 | 线路出问题时，Tono 会先切断，不让流量漏出去。 | Offline, never exposed. | If the route fails, Tono cuts off first so nothing leaks out. |
| 3 | 线路，Tono 替你选。 | 没有设置要调。想换地区，选一个节点就好。 | Routes are Tono's job. | Nothing to configure. To change region, pick a node. |

Each promise: a 16 pt/px semibold headline in ink over a 14 pt/px body in
secondary, with a 2 pt/px accent rule at 35% on the left.

Copy rules: 你 not 您, full-width punctuation, no product jargon (no TUN,
mihomo, Reality, DNS). English uses Click on macOS, not Tap.

## 4. Sign-in changes

Story side: §1 ground + the hero tile lower-left under the body text (§2);
keep the existing brand mark, eyebrow and two-line headline.

Form side, above the primary button, one trust line with a lock glyph:

- zh: 邮箱只用于登录。流量日志不会上传，除非你在设置里打开。
- en: Your email is only used to sign in. Traffic logs are never uploaded unless you turn that on in Settings.

Verify against the real defaults before shipping the line: network log upload
must default to off on that platform, or the sentence must change to stay
true.

Primary button becomes a progress pill: idle "发送验证码" → sending (fill
sweeps left to right, indeterminate, 1.2 s ease-in-out loop; Reduce Motion:
no sweep, text only) → "已发送到邮箱" for 1.5 s → the code step. Same solid
action fill (`#3658C9` + white) as Clarity; the sweep is `#FFFFFF` at 0.18.

Narrow windows (< 800 px): the story compresses above the form as today; the
hero tile shrinks to 22% of the width and sits above the headline.

## 5. Not in scope

No 3D, no shaders, no pointer-following effects, no perpetual animation, no
new runtime dependency, no change to the OTP flow or to Kill Switch behavior.
