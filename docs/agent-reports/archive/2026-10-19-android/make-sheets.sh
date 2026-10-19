#!/usr/bin/env bash
# usage: make-sheets.sh <evidence dir> <out dir>
set -euo pipefail
E="$1"; O="$2"; mkdir -p "$O"
label() { magick "$1" -resize "${W:-360}x" -gravity south -background '#111' -fill '#eee' -splice 0x34 -pointsize 18 -annotate +0+6 "$2" miff:-; }
sheet() { local out="$1"; shift; local args=(); while [ $# -gt 1 ]; do [ -f "$E/$1" ] && args+=("$(mktemp --suffix=.miff)") && label "$E/$1" "$2" > "${args[-1]}"; shift 2; done; [ ${#args[@]} -gt 0 ] || return 0; magick "${args[@]}" +append "$O/$out"; rm -f "${args[@]}"; }
sheet real-flow.png real-01-signin.png "real: sign-in" real-03-system-vpn-consent.png "real: Android VPN dialog" real-05-connect-without-account-stays-signed-out.png "real: no account, no VPN" real-11-system-light-theme.png "real: system light theme" real-12-system-dark-theme.png "real: system dark theme"
sheet real-surfaces.png real-08b-quick-settings-full.png "real: QS tile (Sign in)" real-09-tile-opens-sign-in.png "real: tile opens app" real-10-widget.png "real: widget (signed out)" real-10b-widget-opens-sign-in.png "real: widget tap opens app" real-06-motion.png "real: animations on" real-07-remove-animations.png "real: Remove animations"
sheet fixture-states.png fixture-01-idle.png "fixture: idle" fixture-02-connecting.png "fixture: connecting" fixture-03-connected.png "fixture: connected" fixture-04-degraded.png "fixture: partly working" fixture-05-failed.png "fixture: failed"
sheet fixture-sheets.png fixture-06-details-sheet.png "fixture: Details" fixture-09-details-by-swipe.png "fixture: swipe up" fixture-10-lines-sheet.png "fixture: Lines" fixture-11-settings.png "fixture: Settings" fixture-20-consent-explainer.png "fixture: before VPN dialog"
sheet fixture-a11y.png fixture-13-font-2.0-home.png "fixture: font 200%" fixture-14-font-2.0-details.png "fixture: font 200% Details" fixture-15-font-2.0-settings.png "fixture: font 200% Settings" fixture-16-glass-blur.png "fixture: glass blur test"
sheet fixture-surfaces.png fixture-17-widget-states.png "fixture: widget states" fixture-18-notification-connected.png "fixture: notification" fixture-19-notification-stopped.png "fixture: stopped + Retry"
sheet fixture-zh.png fixture-21-zh-idle.png "fixture: zh idle" fixture-22-zh-degraded.png "fixture: zh partly working" fixture-23-zh-details.png "fixture: zh Details" fixture-24-zh-settings.png "fixture: zh Settings"
sheet local-tunnel.png local-01-signin.png "local servers: sign-in" local-02-home.png "local servers: signed in" local-02b-consent.png "local servers: Tono's consent sheet" local-03-connected.png "local servers: real TUN, Connected" local-04-details.png "local servers: Details" local-05-disconnected.png "local servers: disconnected"
sheet local-engine-death.png local-03-connected.png "local: Connected (before)" local-04b-engine-lost.png "local: :vpn killed → Status unknown" local-04c-reconnected.png "local: restarted engine, fresh Connected"
W=720 sheet local-landscape.png local-06-landscape-code-keyboard.png "real app, local servers: landscape code + keyboard" local-07-landscape-home.png "real app: landscape Home" local-07b-landscape-details.png "real app: landscape Details" local-07c-landscape-270-home.png "real app: landscape 270° Home" local-07d-landscape-270-details.png "real app: landscape 270° Details" local-08-landscape-consent.png "real app: landscape consent sheet"
sheet local-consent-turn.png local-08-landscape-consent.png "real app: consent sheet (landscape)" local-09-portrait-consent-kept.png "real app: kept after turning back"
sheet local-real-states.png local-10-real-idle.png "real app: idle" local-11-real-connecting.png "real app: connecting" local-12-real-connected.png "real app: Connected" local-13-real-partly-working.png "real app: Home exit down" local-14-real-failed.png "real app: catalog unavailable"
sheet local-real-font.png local-15-real-font-2.0-signin.png "real app 200%: sign-in" local-16-real-font-2.0-home.png "real app 200%: Home" local-17-real-font-2.0-details.png "real app 200%: Details" local-18-real-font-2.0-settings.png "real app 200%: Settings"
sheet local-real-font-live.png local-16b-real-font-2.0-connected.png "real app 200%: Connected" local-16c-real-font-2.0-partly-working.png "real app 200%: partly working" local-16d-real-font-2.0-failed.png "real app 200%: failed"
W=540 sheet local-no-app-death.png local-19-no-app-shade-connected.png "no app open: shade, Connected (before)" local-20-no-app-shade-after-death.png "no app open: :vpn killed, shade after"
sheet fixture-adapt.png fixture-25-keyboard-focus.png "fixture: keyboard focus" fixture-26-small-phone-home.png "fixture: 360x640 dp" fixture-26-small-phone-details.png "fixture: 360x640 Details"
if [ -f "$E/fixture-motion.mp4" ]; then
  cp "$E/fixture-motion.mp4" "$O/fixture-motion.mp4"
  ffmpeg -loglevel error -y -i "$E/fixture-motion.mp4" -vf "fps=8,scale=320:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" "$O/fixture-motion.gif"
fi
if [ -f "$E/local-real-motion.mp4" ]; then
  cp "$E/local-real-motion.mp4" "$O/local-real-motion.mp4"
  ffmpeg -loglevel error -y -i "$E/local-real-motion.mp4" -vf "fps=6,scale=270:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" "$O/local-real-motion.gif"
fi
if [ -d "$E/frames" ]; then
  ffmpeg -loglevel error -y -framerate 62.5 -i "$E/frames/frame-%04d.jpg" -c:v libx264 -pix_fmt yuv420p -crf 20 "$O/motion-60fps.mp4"
  ffmpeg -loglevel error -y -framerate 62.5 -i "$E/frames/frame-%04d.jpg" -vf "fps=20,scale=270:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" "$O/motion-60fps.gif"
fi
ls -la "$O"
