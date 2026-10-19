Tono iOS design preview, captured by apps/ios/tools/preview-screenshots.sh on a GitHub-hosted runner.
Commit: c2f8762977360d8f2c953bf787651b8c5ad825df  Run: 39184374749
The Debug simulator build of Tono.app was installed (install.txt) and launched once per capture
(launches.txt: bundle id and process id) on the simulator in device.txt.
Every screen runs with -TonoPreview: fixture lines and probe results, NO account, NO tunnel, no
network. The yellow badge on each capture says so. -TonoReduceMotion / -TonoReduceTransparency
feed the same code path as the iOS settings (simctl cannot toggle them). perf.txt is host CPU/RSS
of the simulator process on a Mac runner, not iPhone performance. These images show layout, copy and motion only;
they are not evidence of sign-in, connectivity or routing.
*-17-widgets*: the widget / Live Activity SwiftUI views rendered INSIDE the app with fixture
readings (each tagged Preview); not the system Home Screen. en-17c shows the Control Center
switch's custom symbols in the app, not the system Control Center. sheet-zoom.mp4: sheets
opened by the preview itself (no taps), to show the zoom out of each control. live-activity-island-*.png (from the
UI tests): a real ActivityKit Live Activity in the simulator's Dynamic Island, started by the
preview with fixture content and tagged Preview. Not captured anywhere: the Control Center
control (iOS 18) and Lock Screen widgets placed by a user; no haptics (a simulator has none).
