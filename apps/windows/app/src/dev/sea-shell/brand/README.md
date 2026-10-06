# Tono 0.0.75 brand proposal — unapproved, unwired

This directory is **dev-only**. It does not change the application/installer/tray icon, navbar or startup screen. Owner approval of the sheet is required before wiring. Native NSIS/WebView, DPI and installation are not verified by this artwork.

## Review

From `apps/windows/app`, reuse the shell preview:

```sh
pnpm exec vite --config vite.shell-preview.config.mts --port 3015
```

Open `http://127.0.0.1:3015/brand-sheet.html`. It shows the application icon at **16,24,32,48,256 CSS pixels on both grounds** (1× at DPR1), lockup, splash, two illustrative installer placements and the unapproved PR7 tray sheet. Installer progress is explicitly illustrative, not an installation.

- `icons/tono-{16,24,32,48,64,128,256}.svg`: independently pixel-aligned geometry; 16px reflection spacing is optically adjusted. Transparent exterior; dark indigo tile, warm sun/horizon.
- Matching PNGs: rasterised from the SVG documents with EgoTaskSpace23/Chromium at DPR1, exact viewBox crops and transparent browser ground. They are artwork, not Windows UI screenshots.
- `tono-draft.ico`: seven original PNG entries, 32-bit RGBA, including256. PNG bytes are unchanged by packing. Windows native decoding is not claimed.
- `installer-header.{svg,png,bmp}` and `installer-sidebar.{svg,png,bmp}`:150×57 and164×314; BMP24-bit, no production path changed.
- `mark.svg`, `lockup.svg`, `splash.svg`: draft mark/text/first-paint composition. Splash ground is `#0B0A12` with one thin horizon.

The bitmap dimensions are the recommended sizes in the [official NSIS Modern UI2 documentation](https://nsis.sourceforge.io/Docs/Modern%20UI%202/Readme.html#interface). That documentation also warns that custom DPI and CJK layouts change control size; the mock does not prove native fit.

## Format check

```sh
node --test scripts/sea-brand-assets.test.mjs
```

The single regression checks ICO directory bounds, PNG sizes/original bytes, SVG dimensions, BMP headers/depth and unchanged production installer icon. It is also included in `pnpm test:dev-control` for hosted Windows CI. It is not a visual, signature, installation or hardware check.

SVG sources are authoritative. To regenerate PNGs, render the actual SVG at DPR1 and crop its exact bounds, not a scaled sheet. Repack ICO without resizing/re-encoding the PNG entries; convert installer PNGs to RGB BMP24-bit without changing dimensions. Reinspect the sheet after any artwork change, then request approval again.
