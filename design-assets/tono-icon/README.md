# Tono Windows icon masters

`03-clean-TO-transparent.png` is the production RGBA master for the Windows
application, installer, taskbar, Start menu, in-app, and tray assets. It contains
only the TO glyph and transparent safety margin—no square tile, outer frame,
bevel, shadow, or green-screen edge spill. The two JPGs are retained as archival
design references and are not runtime inputs.

The masters live outside `apps/windows/app`, so Tauri does not bundle source
artwork or generated previews in the installer.

To regenerate the checked-in runtime assets:

```powershell
python -m pip install -r design-assets/tono-icon/requirements.txt
python apps/windows/app/scripts/generate-tono-icons.py
```

Pillow is pinned because its PNG optimization, resampling, and ICO writer can
change byte output between releases. The script writes production files under
`apps/windows/app/src-tauri/icons` and `apps/windows/app/src/assets/image`.
Intermediate previews are written to the ignored `export/` directory.
