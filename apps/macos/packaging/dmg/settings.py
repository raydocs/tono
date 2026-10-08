# dmgbuild settings for the customer disk image. Run only through
# tooling/scripts/make-macos-dmg.sh, which passes -D app=... -D background=...
#
# The window shows Tono.app, an arrow and the Applications folder: Tono runs
# only from /Applications (AppDelegate.canStartRuntimeFromCurrentLocation), so
# a first install must be a drag, not a double-click inside the image.
import os.path

app = defines['app']  # noqa: F821 (dmgbuild injects `defines`)
app_name = os.path.basename(app)

format = 'UDZO'
filesystem = 'HFS+'
files = [app]
symlinks = {'Applications': '/Applications'}

icon = os.path.join(app, 'Contents', 'Resources', 'AppIcon.icns')
if not os.path.exists(icon):
    del icon

background = defines['background']  # noqa: F821
# 660x400 content (background.tiff) plus the title bar.
window_rect = ((200, 140), (660, 428))
default_view = 'icon-view'
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
show_icon_preview = False
include_icon_view_settings = True
icon_size = 128
text_size = 13
arrange_by = None
icon_locations = {
    app_name: (165, 196),
    'Applications': (495, 196),
}
