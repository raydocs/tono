set -euxo pipefail
APP=com.raydocs.tono.mobile.test
# A retry keeps the first attempt's evidence next to the second's.
if [ -d evidence ]; then mv evidence "evidence-attempt-$(date +%s)"; fi
mkdir -p evidence
adb shell getprop ro.build.fingerprint | tee evidence/device.txt
adb shell getprop ro.product.cpu.abi | tee -a evidence/device.txt
adb shell wm size | tee -a evidence/device.txt
adb shell wm density | tee -a evidence/device.txt
adb shell settings put system screen_off_timeout 1800000
adb shell svc power stayon true
adb shell input keyevent 82 || true
# Let the launcher finish its first-boot work; on swiftshader it can otherwise raise an ANR
# dialog over the app. The test answers only foreign ANR dialogs and logs each one.
sleep 60
adb shell input keyevent 3
# No -g: runtime permissions and VPN consent stay as on a fresh install.
adb install -r apk/*-test-*.apk
adb install -r apk/instrumentation.apk
# One instrumentation call per test, pulling evidence after each, so an emulator crash
# (seen on hosted runners) costs one test's evidence rather than all of it.
set +e
failed=""
# Streamed from the host, so an emulator that dies mid-run still leaves its last log lines.
adb logcat -v threadtime > evidence/logcat-live.txt 2>&1 &
logcat=$!
case "$SHARD" in
  system) tests="DeviceEvidenceTest#a1_realSignInScreenAndLocalValidation DeviceEvidenceTest#a2_realSystemVpnConsentDialog
  DeviceEvidenceTest#a3_realEngineRefusesToConnectWithoutAccount DeviceEvidenceTest#a4_realCoreOnThisAbiAcceptsTheGeneratedConfig
  DeviceEvidenceTest#a5_realAppHonoursRemoveAnimations DeviceEvidenceTest#a6_realAppUnderSystemLightAndDarkTheme
  SystemSurfacesDeviceTest#s1_realQuickSettingsTileShowsSharedStatusAndOpensTheApp
  SystemSurfacesDeviceTest#s2_realWidgetInAndroidsWidgetHost SystemSurfacesDeviceTest#s3_fixtureWidgetAndNotificationStates
  DeviceEvidenceTest#b1_fixtureStatesRenderedOnDevice DeviceEvidenceTest#b2_fixtureMotionRecordedOnDevice
  DeviceEvidenceTest#b3_fixtureAtLargeFontScale LocalTunnelDeviceTest#t1_realTunnelThroughLocalFixtureServers" ;;
  ui) tests="HorizonUiDeviceTest#u1_accessibilityContractAndAtfOnEveryScreen HorizonUiDeviceTest#u2_primaryControlActsThroughRealTaps
  HorizonUiDeviceTest#u3_swipeUpOnTheDockOpensDetails HorizonUiDeviceTest#u4_glassBlursTheSceneBehindIt
  HorizonUiDeviceTest#u5_consentExplainedBeforeTheSystemDialog HorizonUiDeviceTest#u6_screenReaderOrderAndLabelsOnHome
  HorizonUiDeviceTest#u7_simplifiedChineseCopyFitsEveryScreen HorizonUiDeviceTest#u8_motionFrameByFrameAt60fps
  HorizonUiDeviceTest#u9_keyboardFocusIsVisibleAndAccessibilityActionsWork
  LargeTextDeviceTest#l1_largestSystemTextIsNeverCutOff SmallScreenDeviceTest#l2_smallPhoneKeepsEverythingReadableAndReachable
  LandscapeDeviceTest#l3_landscapeKeepsEverythingReadableAndReachable" ;;
  *) echo "unknown shard $SHARD"; exit 1 ;;
esac
echo "shard $SHARD" > evidence/shard.txt
for c in $tests; do
  t="${c#*#}"
  rec=""
  if [ "$t" = b2_fixtureMotionRecordedOnDevice ]; then
    # Recorded from the host: a screenrecord started inside the test kept the run open.
    adb shell screenrecord --time-limit 25 --bit-rate 8000000 /sdcard/Download/tono-fixture-motion.mp4 &
    rec=$!
  fi
  # The tunnel test is judged again from the stand-in exits' own logs, from this point on.
  [ "$t" = t1_realTunnelThroughLocalFixtureServers ] && from=$(stat -c %s "$LOCAL_TUNNEL/sing-box.log")
  timeout 900 adb shell am instrument -w -r -e class "com.raydocs.tono.mobile.$c" \
    $APP.test/androidx.test.runner.AndroidJUnitRunner > "evidence/instrument-$t.txt"
  [ -n "$rec" ] && timeout 60 tail --pid="$rec" -f /dev/null
  grep -q '^OK (' "evidence/instrument-$t.txt" && echo "PASS $t" >> evidence/summary.txt || { echo "FAIL $t" >> evidence/summary.txt; failed="$failed $t"; }
  timeout 120 adb pull /sdcard/Android/data/$APP/files/evidence/. evidence/
  [ "$t" = b2_fixtureMotionRecordedOnDevice ] && timeout 120 adb pull /sdcard/Download/tono-fixture-motion.mp4 evidence/fixture-motion.mp4
  if [ "$t" = t1_realTunnelThroughLocalFixtureServers ]; then
    mkdir -p evidence/local-tunnel
    tail -c +$((from + 1)) "$LOCAL_TUNNEL/sing-box.log" > evidence/local-tunnel/exits.log
    cp "$LOCAL_TUNNEL/control-plane.log" evidence/local-tunnel/
    if python3 apps/android/scripts/local-tunnel/fixture-servers.py check evidence/local-tunnel/exits.log \
        evidence/local-tunnel-requests.txt > evidence/local-tunnel-routing.txt; then
      echo "PASS t1-routing-matches-exit-logs" >> evidence/summary.txt
    else
      echo "FAIL t1-routing-matches-exit-logs" >> evidence/summary.txt; failed="$failed t1-routing"
    fi
    cat evidence/local-tunnel-routing.txt
  fi
  # A dead emulator fails every later test with no output; say so once and stop, so the
  # fresh-emulator retry starts sooner. Every test must still pass in a single session.
  if [ "$(timeout 30 adb get-state 2>/dev/null)" != device ]; then
    echo "DEVICE-OFFLINE after $t; later tests not run in this attempt" >> evidence/summary.txt
    failed="$failed device-offline"
    break
  fi
  # Isolation: a shade a test left open would cover the next test's app.
  timeout 30 adb shell cmd statusbar collapse
done
kill $logcat
if [ "$SHARD" = system ] && [ "$(timeout 30 adb get-state 2>/dev/null)" = device ]; then
  # Measurements only, on an emulator with a software GPU: not a phone, not a pass/fail gate.
  {
    echo "emulator $(cat evidence/device.txt | tr '\n' ' ')"
    echo "APK size: $(stat -c %s apk/*-test-*.apk) bytes"
    for i in 1 2 3 4 5; do
      adb shell am start -W -S -n $APP/com.raydocs.tono.mobile.ui.MainActivity | grep -E 'TotalTime|WaitTime' | tr '\n' ' '
      echo
      sleep 3
    done
    adb shell dumpsys gfxinfo $APP reset > /dev/null
    sleep 10
    adb shell dumpsys gfxinfo $APP | grep -E 'Total frames|Janky frames|percentile'
    adb shell dumpsys meminfo $APP | grep -E 'TOTAL PSS|TOTAL RSS'
  } > evidence/perf.txt 2>&1
  adb shell am force-stop $APP
fi
# Leave the shared emulator settings as found, whatever a failed test left behind.
adb shell settings put system font_scale 1.0
adb shell settings put global animator_duration_scale 1
adb shell cmd uimode night no
adb shell wm size reset
adb shell wm density reset
adb shell settings put system user_rotation 0
timeout 60 adb logcat -d > evidence/logcat.txt
ls -la evidence
cat evidence/summary.txt
set -e
[ -z "$failed" ]
