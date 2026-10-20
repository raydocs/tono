package com.raydocs.tono.mobile

import androidx.activity.ComponentActivity
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionOnScreen
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.raydocs.tono.mobile.ui.BackdropHost
import com.raydocs.tono.mobile.ui.ConsentContent
import com.raydocs.tono.mobile.ui.Glass
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.ui.LocalReduceMotion
import com.raydocs.tono.mobile.ui.TonoActions
import com.raydocs.tono.mobile.ui.TonoRoot
import com.raydocs.tono.mobile.ui.TonoTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.Collections

/**
 * Horizon UI on a real Android system from fixture snapshots (no tunnel exists): the accessibility
 * contract plus Google's Accessibility Test Framework on every screen, the primary control through
 * real taps and the swipe-up gesture through the system input pipeline ([LargeTextDeviceTest] covers
 * the largest text size). Ambient motion is off here so Compose can reach idle; [SystemMotionDeviceTest] covers motion.
 * Screenshots are `fixture-*`.
 */
@RunWith(AndroidJUnit4::class)
class HorizonUiDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private val out = File(context.getExternalFilesDir(null), "evidence").apply { mkdirs() }

    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val calls: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private var snapshot by mutableStateOf<EngineSnapshot>(DeviceFixtures.idle)
    private var motionReduced by mutableStateOf(false)

    private fun str(id: Int) = context.getString(id)

    private fun show(locale: java.util.Locale? = null, reduceMotion: Boolean = true) = compose.setContent {
        val base = androidx.compose.ui.platform.LocalContext.current
        val conf = android.content.res.Configuration(androidx.compose.ui.platform.LocalConfiguration.current).apply { if (locale != null) setLocale(locale) }
        val ctx = if (locale != null) base.createConfigurationContext(conf) else base
        CompositionLocalProvider(
            LocalReduceMotion provides (reduceMotion || motionReduced),
            androidx.compose.ui.platform.LocalContext provides ctx,
            androidx.compose.ui.platform.LocalConfiguration provides conf,
            androidx.compose.ui.platform.LocalResources provides ctx.resources,
        ) {
            TonoTheme {
                FixtureFrame {
                    TonoRoot(snapshot, object : TonoActions {
                        override fun connect() { calls += "connect" }
                        override fun command(op: String, vararg args: Pair<String, Any?>) { calls += op }
                        override fun explain(host: String): Map<String, Any?>? = null
                    })
                }
            }
        }
    }

    private fun set(s: EngineSnapshot) { snapshot = s; compose.waitForIdle() }

    private fun shot(name: String) {
        compose.waitForIdle(); Thread.sleep(400); assertTrue("screenshot $name drawn", Captures.drawn(File(out, "$name.png")))
        if (name.startsWith("fixture-")) assertTrue("$name shows the FIXTURE mark", Captures.fixtureMarked(File(out, "$name.png")))
    }

    private fun back() { device.pressBack(); compose.waitForIdle(); Thread.sleep(300) }

    @Test fun u1_accessibilityContractAndAtfOnEveryScreen() {
        compose.enableAccessibilityChecks() // ATF runs on every Compose interaction below; it throws on errors
        show()
        val report = mutableListOf<String>()
        val found = mutableListOf<String>()
        fun check(screen: String) { compose.waitForIdle(); found += A11yContract.violations(compose, screen, report) }
        for ((name, s) in DeviceFixtures.homeStates + ("signin" to DeviceFixtures.idle.copy(phase = Phase.SIGNED_OUT))) { set(s); check(name) }
        set(DeviceFixtures.degraded())
        compose.onNodeWithTag("details").performClick(); check("details"); back()
        compose.onNodeWithTag("exit").performClick(); check("lines"); shot("fixture-10-lines-sheet"); back()
        compose.onNodeWithContentDescription(str(R.string.settings_title)).performClick(); check("settings"); shot("fixture-11-settings")
        compose.onNodeWithText(str(R.string.system_verify_in_android)).performScrollTo()
        shot("fixture-11b-system-guidance")
        compose.onNodeWithText(str(R.string.settings_apps_none)).performScrollTo().performClick()
        // The list, not its loading spinner: wait for the installed apps to arrive.
        compose.waitUntil(30_000) { compose.onAllNodes(hasTestTag("app-row")).fetchSemanticsNodes().isNotEmpty() }
        check("apps"); shot("fixture-12-apps")
        File(out, "a11y-report.txt").writeText((report + listOf("", "violations: ${found.size}") + found).joinToString("\n"))
        assertEquals(found.joinToString("\n"), 0, found.size)
    }

    @Test fun u2_primaryControlActsThroughRealTaps() {
        show()
        val expected = listOf(
            DeviceFixtures.idle to "connect",
            DeviceFixtures.idle.copy(phase = Phase.NEEDS_PERMISSION) to "connect",
            DeviceFixtures.idle.copy(phase = Phase.PREPARING) to "disconnect",
            DeviceFixtures.idle.copy(phase = Phase.CONNECTING) to "disconnect",
            DeviceFixtures.connected() to "disconnect",
            DeviceFixtures.degraded() to "disconnect",
            DeviceFixtures.failed to "connect",
        )
        val log = mutableListOf<String>()
        for ((s, action) in expected) {
            set(s)
            calls.clear()
            // A real tap: UiDevice injects the touch through the system, at the capsule's centre.
            val b = compose.onNodeWithTag("primary").fetchSemanticsNode().boundsInWindow
            device.click(b.center.x.toInt(), b.center.y.toInt() + windowTop())
            compose.waitForIdle()
            log += "${s.phase} → ${calls.joinToString().ifEmpty { "(nothing)" }}"
            assertEquals("tap in ${s.phase}", listOf(action), calls.toList())
        }
        set(DeviceFixtures.idle.copy(phase = Phase.DISCONNECTING))
        calls.clear()
        // The tag sits on the glass; the button is the clickable inside it.
        compose.onNode(hasAnyAncestor(hasTestTag("primary")) and hasClickAction()).assertIsNotEnabled()
        val b = compose.onNodeWithTag("primary").fetchSemanticsNode().boundsInWindow
        device.click(b.center.x.toInt(), b.center.y.toInt() + windowTop())
        compose.waitForIdle()
        log += "DISCONNECTING → ${calls.joinToString().ifEmpty { "(disabled, nothing)" }}"
        File(out, "interaction-report.txt").writeText(log.joinToString("\n"))
        assertTrue("disconnecting ignores taps", calls.isEmpty())
        // Real device drawing from an explicitly different desired/applied fixture, not a tunnel.
        set(DeviceFixtures.connected().copy(selectedNode = "Los Angeles · Grove"))
        compose.onNodeWithTag("exit").assert(hasAnyDescendant(hasText("Tokyo")))
        shot("fixture-28-connected-applied-not-selected")
    }

    @Test fun u3_swipeUpOnTheDockOpensDetails() {
        show()
        set(DeviceFixtures.connected())
        val b = compose.onNodeWithTag("primary").fetchSemanticsNode().boundsInWindow
        val x = b.center.x.toInt()
        val y = b.center.y.toInt() + windowTop()
        device.swipe(x, y, x, y - 500, 25) // ~125 ms flick starting on the capsule
        compose.waitForIdle()
        Thread.sleep(800)
        compose.onNodeWithText(str(R.string.details_routes)).assertExists()
        shot("fixture-09-details-by-swipe")
        File(out, "interaction-report.txt").appendText("\nswipe up from the capsule → Details open, actions: ${calls.joinToString().ifEmpty { "none" }}\n")
        assertTrue("a swipe is not a tap", calls.isEmpty())
    }

    /**
     * The glass material really blurs what is behind it on this device (RenderEffect, API 31+):
     * Tono's [Glass] over 8 dp black/white stripes, next to a control surface using Compose's own
     * `Modifier.blur` on the same stripes. Without blur the stripes would still show through the 46 %
     * tint at about half their contrast; fully blurred they almost vanish.
     */
    @Test fun u4_glassBlursTheSceneBehindIt() {
        // Opaque, like the real sky: black ground with 8 dp white stripes (period 16 dp).
        val stripes: androidx.compose.ui.graphics.drawscope.DrawScope.() -> Unit = {
            drawRect(Color.Black)
            val w = 8.dp.toPx()
            var x = 0f
            while (x < size.width) { drawRect(Color.White, Offset(x, 0f), Size(w, size.height)); x += 2 * w }
        }
        compose.setContent {
            Box(Modifier.fillMaxSize().background(Color.Black)) {
                BackdropHost(scene = { Canvas(Modifier.fillMaxSize(), onDraw = stripes) }, modifier = Modifier.fillMaxSize()) {
                    Glass(RoundedCornerShape(28.dp), Modifier.align(Alignment.TopCenter).padding(top = 96.dp).size(240.dp, 140.dp).testTag("glass")) {}
                    // Same glass with no blur: tint and rim alone. Dividing by it leaves the blur's own effect.
                    Glass(RoundedCornerShape(28.dp), Modifier.align(Alignment.Center).size(240.dp, 140.dp).testTag("tint"), blur = 0.dp) {}
                    // The platform blur alone, same radius, over the same stripes.
                    Canvas(Modifier.align(Alignment.BottomCenter).padding(bottom = 72.dp).size(240.dp, 140.dp).blur(26.dp, BlurredEdgeTreatment.Rectangle).testTag("control"), onDraw = stripes)
                }
            }
        }
        compose.waitForIdle()
        val image = compose.onRoot().captureToImage().asAndroidBitmap()
        val d = compose.density.density
        val period = Math.round(16 * d) // pixels; stripes start at x = 0 of the screen-wide scene
        /** Amplitude of the stripe pattern (fundamental, or [harmonic]) in [r]'s column-averaged luminance, away from its edges. */
        fun stripeAmplitude(r: androidx.compose.ui.geometry.Rect, harmonic: Int = 1): Double {
            val inset = 24 * d
            val top = (r.top + inset).toInt(); val bottom = (r.bottom - inset).toInt()
            val left = (r.left + inset).toInt()
            val n = ((r.width - 2 * inset).toInt() / period) * period
            check(n >= period) { "window narrower than one stripe period" }
            var re = 0.0; var im = 0.0
            for (i in 0 until n) {
                val x = left + i
                var sum = 0.0
                for (y in top until bottom) { val c = image.getPixel(x, y); sum += 0.299 * ((c shr 16) and 0xFF) + 0.587 * ((c shr 8) and 0xFF) + 0.114 * (c and 0xFF) }
                val v = sum / (bottom - top)
                val a = 2 * Math.PI * harmonic * x / period
                re += v * Math.cos(a); im -= v * Math.sin(a)
            }
            return 2 * Math.hypot(re, im) / n
        }
        fun bounds(tag: String) = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
        val g = bounds("glass")
        val besideRect = androidx.compose.ui.geometry.Rect(-24 * d, g.top, g.left, g.bottom) // bare stripes from the screen edge to the glass
        val beside = stripeAmplitude(besideRect)
        val glass = stripeAmplitude(g)
        val tintOnly = stripeAmplitude(bounds("tint"))
        val control = stripeAmplitude(bounds("control"))
        val glassBlur = glass / tintOnly // what the blur leaves of the stripes under this glass's tint
        val platform = control / beside // what the platform blur leaves of bare stripes
        File(out, "fixture-16-glass-blur.png").outputStream().use { image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        File(out, "glass-report.txt").writeText(
            ("API ${android.os.Build.VERSION.SDK_INT}, stripe amplitude (luminance, 16 dp period): bare %.1f; Tono glass %.1f; same glass without blur %.1f; " +
                "platform blur alone %.1f.\nBlur leaves %.1f %% of the stripes under Tono glass; the platform's own blur leaves %.1f %% of bare stripes. " +
                "A full Gaussian blur at this radius leaves under 0.1 %%.\n3rd/1st harmonic (edge sharpness, square wave 33 %%): bare %.0f %%, Tono glass %.0f %%, platform blur %.0f %%.\n").format(
                beside, glass, tintOnly, control, 100 * glassBlur, 100 * platform,
                100 * stripeAmplitude(besideRect, 3) / beside,
                100 * stripeAmplitude(g, 3) / glass.coerceAtLeast(1e-6), 100 * stripeAmplitude(bounds("control"), 3) / control.coerceAtLeast(1e-6),
            ),
        )
        assertTrue("stripes visible beside the glass ($beside)", beside > 100)
        assertTrue("tint alone keeps the stripes, so the comparison means something ($tintOnly)", tintOnly > 0.2 * beside)
        // Glass never shows more of what is behind it than the platform's own blur would.
        assertTrue("glass blur leaves $glassBlur of the stripes, platform blur $platform", glassBlur <= platform + 0.05)
        // Where the platform blur renders fully (hardware GPU), the stripes must vanish behind glass too.
        if (platform < 0.10) assertTrue("glass blurs the stripes away: $glassBlur", glassBlur < 0.10)
    }

    /** The Simplified Chinese copy (values-zh-rCN) on the same screens: contract, no truncation, captures. */
    @OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
    @Test fun u10_sheetGlassBlursItsBackdropSlice() {
        val stripes: androidx.compose.ui.graphics.drawscope.DrawScope.() -> Unit = {
            drawRect(Color.Black)
            val w = 8.dp.toPx()
            var x = 0f
            while (x < size.width) { drawRect(Color.White, Offset(x, 0f), Size(w, size.height)); x += 2 * w }
        }
        compose.setContent {
            BackdropHost(scene = { Canvas(Modifier.fillMaxSize(), onDraw = stripes) }, modifier = Modifier.fillMaxSize()) {
                androidx.compose.material3.ModalBottomSheet(
                    onDismissRequest = {}, dragHandle = null,
                    sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true),
                    containerColor = Color.Transparent,
                    scrimColor = com.raydocs.tono.mobile.ui.TonoColors.NightDeep.copy(alpha = 0.55f),
                ) {
                    com.raydocs.tono.mobile.ui.SheetGlass {
                        Box(Modifier.size(240.dp, 120.dp).testTag("sheet-glass"))
                    }
                    Glass(RoundedCornerShape(28.dp), Modifier.size(240.dp, 120.dp).testTag("sheet-tint"), blur = 0.dp, tintAlpha = 0.80f) {}
                    Canvas(Modifier.size(240.dp, 120.dp).blur(26.dp, BlurredEdgeTreatment.Rectangle).testTag("sheet-control"), onDraw = stripes)
                }
            }
        }
        compose.waitForIdle()
        val image = instrumentation.uiAutomation.takeScreenshot()
        val d = compose.density.density
        val period = Math.round(16 * d)
        fun amplitude(tag: String): Double {
            val r = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInWindow
            val top = (r.top + 24 * d).toInt(); val bottom = (r.bottom - 24 * d).toInt()
            val left = (r.left + 24 * d).toInt()
            val n = ((r.width - 48 * d).toInt() / period) * period
            check(n >= period)
            var re = 0.0; var im = 0.0
            for (i in 0 until n) {
                val x = left + i
                var sum = 0.0
                for (y in top until bottom) { val c = image.getPixel(x, y); sum += 0.299 * ((c shr 16) and 0xFF) + 0.587 * ((c shr 8) and 0xFF) + 0.114 * (c and 0xFF) }
                val a = 2 * Math.PI * x / period
                re += sum / (bottom - top) * Math.cos(a); im -= sum / (bottom - top) * Math.sin(a)
            }
            return 2 * Math.hypot(re, im) / n
        }
        val glass = amplitude("sheet-glass")
        val tintOnly = amplitude("sheet-tint")
        val platform = amplitude("sheet-control") / (2 * 255 / Math.PI)
        val residual = glass / tintOnly
        File(out, "fixture-29-sheet-glass.png").outputStream().use { image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        File(out, "sheet-glass-report.txt").writeText("API ${android.os.Build.VERSION.SDK_INT}: sheet amplitude $glass; tint-only $tintOnly; sheet residual $residual; platform residual $platform\n")
        assertTrue("the sheet receives a recorded scene, not an opaque fallback: $tintOnly", tintOnly > 10)
        assertTrue("sheet blur leaves $residual of the stripes, platform blur $platform", residual <= platform + 0.05)
        if (platform < 0.10) assertTrue("sheet blurs the stripes away: $residual", residual < 0.10)
    }

    @OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
    @Test fun u11_sheetBackdropOriginMatchesTheScreenAcrossWindows() {
        var sceneOrigin = Offset.Zero
        compose.setContent {
            BackdropHost(scene = {
                Canvas(Modifier.fillMaxSize().onGloballyPositioned { sceneOrigin = it.positionOnScreen() }) {
                    drawRect(Color.Black)
                    val h = 8.dp.toPx()
                    var y = 0f
                    while (y < size.height) { drawRect(Color.White, Offset(0f, y), Size(size.width, h)); y += 2 * h }
                }
            }, modifier = Modifier.fillMaxSize()) {
                androidx.compose.material3.ModalBottomSheet(
                    onDismissRequest = {}, dragHandle = null,
                    sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true),
                    containerColor = Color.Transparent,
                ) {
                    Glass(RoundedCornerShape(28.dp), Modifier.size(240.dp, 240.dp).testTag("origin-slice"), blur = 0.dp, tintAlpha = 0f, rim = 0f) {}
                }
            }
        }
        compose.waitForIdle()
        val image = instrumentation.uiAutomation.takeScreenshot()
        val r = compose.onNodeWithTag("origin-slice").fetchSemanticsNode().boundsInWindow
        val d = compose.density.density
        val h = 8 * d
        var mismatches = 0
        var samples = 0
        for (y in (r.top + 32 * d).toInt() until (r.bottom - 32 * d).toInt()) {
            val row = (y - sceneOrigin.y) / h
            val fraction = row - kotlin.math.floor(row)
            if (fraction < 0.25 || fraction > 0.75) continue
            val white = row.toInt() % 2 == 0
            val c = image.getPixel(r.center.x.toInt(), y)
            val value = (c shr 16) and 0xFF
            if (if (white) value < 180 else value > 15) mismatches++
            samples++
        }
        File(out, "fixture-30-sheet-origin.png").outputStream().use { image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        File(out, "sheet-origin-report.txt").writeText("scene screen origin $sceneOrigin; modal bounds $r; matched ${samples - mismatches}/$samples stripe-centre pixels\n")
        assertTrue("origin test samples the sheet interior", samples > 100)
        assertEquals("modal glass must draw the same screen slice as the scene", 0, mismatches)
    }

    @Test fun u7_simplifiedChineseCopyFitsEveryScreen() {
        val zh = java.util.Locale.SIMPLIFIED_CHINESE
        show(zh)
        val zhContext = context.createConfigurationContext(android.content.res.Configuration(context.resources.configuration).apply { setLocale(zh) })
        val found = mutableListOf<String>()
        fun check(screen: String) { compose.waitForIdle(); found += A11yContract.violations(compose, "zh $screen") + A11yContract.truncatedText(compose, "zh $screen") }
        set(DeviceFixtures.idle); check("idle"); shot("fixture-21-zh-idle")
        set(DeviceFixtures.degraded()); check("degraded"); shot("fixture-22-zh-degraded")
        compose.onNodeWithTag("details").performClick(); check("details"); shot("fixture-23-zh-details")
        assertTrue("country in Chinese inside the Details sheet", compose.onAllNodes(androidx.compose.ui.test.hasText("日本", substring = true)).fetchSemanticsNodes().isNotEmpty())
        back()
        compose.onNodeWithContentDescription(zhContext.getString(R.string.settings_title)).performClick(); check("settings"); shot("fixture-24-zh-settings")
        assertTrue("Chinese copy is on screen", compose.onAllNodes(androidx.compose.ui.test.hasText(zhContext.getString(R.string.settings_title))).fetchSemanticsNodes().isNotEmpty())
        assertEquals(found.joinToString("\n"), 0, found.size)
    }

    /**
     * The motion itself, frame by frame: the test clock advances one 16 ms frame at a time and the
     * device renders each frame, so `frames/` is the designed 60 fps motion regardless of how fast
     * this software GPU is. It shows timing and easing, not real-time smoothness on hardware.
     */
    @Test fun u8_motionFrameByFrameAt60fps() {
        compose.mainClock.autoAdvance = false
        show(reduceMotion = false)
        // Each state is held until its sky has settled (sunset 650 ms, arrival spring ~1.5 s), so the
        // frames show every state at rest as well as the transitions between them.
        val steps = listOf(
            400L to DeviceFixtures.idle,
            600L to DeviceFixtures.idle.copy(phase = Phase.PREPARING),
            800L to DeviceFixtures.idle.copy(phase = Phase.CONNECTING),
            1_800L to DeviceFixtures.connected(),
            500L to DeviceFixtures.idle.copy(phase = Phase.DISCONNECTING),
            1_000L to DeviceFixtures.idle,
            1_200L to DeviceFixtures.failed,
        )
        for (reduced in listOf(false, true)) {
            motionReduced = reduced
            val suffix = if (reduced) "-reduced" else ""
            val dir = File(out, "frames$suffix").apply { mkdirs() }
            val full = File(out, "frames$suffix-full").apply { mkdirs() }
            var frame = 0
            val timeline = StringBuilder()
            for ((ms, s) in steps) {
                snapshot = s
                timeline.append("frame $frame (${frame * 16} ms): input=${s.phase}; reduced=$reduced\n")
                repeat((ms / 16).toInt()) {
                    compose.mainClock.advanceTimeByFrame()
                    val image = captureFrame()
                    // Full original pixels, not a resized/contact-sheet proxy. Keep the existing
                    // JPEG sequence too, so downstream tools need not rename or substitute frames.
                    File(full, "frame-%04d.png".format(frame)).outputStream().use { image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
                    val small = android.graphics.Bitmap.createScaledBitmap(image, image.width / 2, image.height / 2, true)
                    File(dir, "frame-%04d.jpg".format(frame++)).outputStream().use { small.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, it) }
                }
            }
            File(out, "motion-frames$suffix.txt").writeText("$frame frames, 16 ms manual Compose clock; input boundaries are not asserted as rendered-state onset\n$timeline")
            assertTrue("frames rendered ($suffix): $frame", frame > 380)
        }
    }

    /**
     * One capture of the current frame. captureToImage waits at most 2 s for the window to redraw;
     * a software-GPU frame of the animated scene occasionally takes longer (run 39100236753), so the
     * same frame is captured again, up to three times, before the test fails.
     */
    private fun captureFrame(): android.graphics.Bitmap {
        var last: Throwable? = null
        repeat(3) {
            try { return compose.onRoot().captureToImage().asAndroidBitmap() } catch (e: androidx.compose.ui.test.ComposeTimeoutException) { last = e }
        }
        throw AssertionError("frame not drawn after three 2 s waits", last)
    }

    /** Shown before Android's VPN dialog whenever consent is missing; Continue is what opens it. */
    @Test fun u5_consentExplainedBeforeTheSystemDialog() {
        compose.enableAccessibilityChecks()
        var continued = 0
        var dismissed = 0
        // The real sheet over Home, as the app shows it before Android's dialog.
        compose.setContent {
            CompositionLocalProvider(LocalReduceMotion provides true) {
                TonoTheme {
                    FixtureFrame {
                        TonoRoot(DeviceFixtures.idle.copy(phase = Phase.NEEDS_PERMISSION), object : TonoActions {
                            override fun connect() {}
                            override fun command(op: String, vararg args: Pair<String, Any?>) {}
                            override fun explain(host: String): Map<String, Any?>? = null
                        })
                    }
                    com.raydocs.tono.mobile.ui.ConsentSheet(onContinue = { continued++ }, onDismiss = { dismissed++ })
                }
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodes(androidx.compose.ui.test.hasText(str(R.string.consent_continue))).fetchSemanticsNodes().isNotEmpty() }
        val found = A11yContract.violations(compose, "consent") + A11yContract.truncatedText(compose, "consent")
        shot("fixture-20-consent-explainer")
        compose.onNodeWithText(str(R.string.consent_continue)).performClick()
        compose.onNodeWithText(str(R.string.consent_later)).performClick()
        assertEquals(found.joinToString("\n"), 0, found.size)
        assertEquals(1, continued)
        assertEquals(1, dismissed)
    }

    /**
     * What a screen reader walks through, read from Android's accessibility tree (the same nodes
     * TalkBack gets), top to bottom. TalkBack itself is not on the emulator image, so speech and
     * gestures are not exercised; labels, roles and order are.
     */
    @Test fun u6_screenReaderOrderAndLabelsOnHome() {
        show()
        set(DeviceFixtures.degraded())
        Thread.sleep(800)
        val seen = mutableListOf<String>()
        val tree = StringBuilder()
        val unlabelled = mutableListOf<String>()
        fun own(n: android.view.accessibility.AccessibilityNodeInfo) = listOfNotNull(n.contentDescription, n.text).joinToString(" ").trim()
        fun focusable(n: android.view.accessibility.AccessibilityNodeInfo) = n.isVisibleToUser && (n.isClickable || n.isScreenReaderFocusable || n.isFocusable)
        // Like TalkBack: a focusable node without its own label is announced by the labels of its
        // descendants that are not focusable themselves.
        fun spoken(n: android.view.accessibility.AccessibilityNodeInfo, top: Boolean = true): String {
            if (!top && focusable(n)) return ""
            val mine = own(n)
            val kids = (0 until n.childCount).mapNotNull { n.getChild(it) }.map { spoken(it, top = false) }.filter { it.isNotEmpty() }
            return (listOf(mine).filter { it.isNotEmpty() } + kids).joinToString(", ")
        }
        fun walk(n: android.view.accessibility.AccessibilityNodeInfo?, depth: Int) {
            if (n == null) return
            val r = android.graphics.Rect().also(n::getBoundsInScreen)
            tree.append("  ".repeat(depth)).append("${n.className} \"${own(n)}\" click=${n.isClickable} focus=${n.isFocusable} srf=${n.isScreenReaderFocusable} visible=${n.isVisibleToUser} $r\n")
            if (focusable(n)) {
                val label = spoken(n)
                val state = if (android.os.Build.VERSION.SDK_INT >= 30) n.stateDescription?.let { " ($it)" } ?: "" else ""
                if (label.isEmpty()) unlabelled += "${n.className} $r" else seen += label + (if (n.isClickable) " [actionable]" else "") + state
            }
            for (i in 0 until n.childCount) walk(n.getChild(i), depth + 1)
        }
        walk(instrumentation.uiAutomation.rootInActiveWindow, 0)
        File(out, "a11y-tree.txt").writeText(tree.toString())
        File(out, "screen-reader-order.txt").writeText(seen.joinToString("\n"))
        assertTrue("focusable but silent for a screen reader: $unlabelled", unlabelled.isEmpty())
        fun at(text: String) = seen.indexOfFirst { it.contains(text) }.also { assertTrue("\"$text\" is read: $seen", it >= 0) }
        // The state first, then the actions in screen order; Settings now sits in the dock beside Details.
        val order = listOf(
            at(str(R.string.state_degraded)), at(str(R.string.action_disconnect)),
            at("Tokyo"), at(str(R.string.settings_title)), at(str(R.string.details)),
        )
        assertEquals("reading order follows the screen: $seen", order.sorted(), order)
        assertTrue("nothing is announced twice: $seen", seen.none { line -> line.split(", ").let { it.size != it.toSet().size } || Regex("for (\\S+) \\1").containsMatchIn(line) })
    }

    /** Window → screen offset for UiDevice coordinates. */
    /**
     * Without touch: a keyboard (Tab, Enter), a D-pad or switch access moves focus through Home in the
     * order the screen reads it, every stop draws a visible ring, and Enter acts. Then the
     * accessibility action TalkBack sends on a double-tap (ACTION_CLICK on the platform node, not the
     * Compose test API) works on every Home control. Real key events through Android's input system.
     */
    @Test fun u9_keyboardFocusIsVisibleAndAccessibilityActionsWork() {
        show()
        set(DeviceFixtures.connected())
        Thread.sleep(500)
        val automation = instrumentation.uiAutomation
        fun ringBand(tag: String): IntArray {
            val b = compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInWindow
            val top = windowTop()
            val shot = automation.takeScreenshot()
            // The outer 3 dp of the control, where the ring is drawn; the label inside is not compared.
            val inset = (3 * context.resources.displayMetrics.density).toInt()
            val l = b.left.toInt(); val t = b.top.toInt() + top; val r = b.right.toInt(); val btm = b.bottom.toInt() + top
            val px = mutableListOf<Int>()
            for (x in l until r) for (y in t until btm) {
                if (x - l < inset || r - 1 - x < inset || y - t < inset || btm - 1 - y < inset) px += shot.getPixel(x, y)
            }
            return px.toIntArray()
        }
        fun changed(a: IntArray, b: IntArray) = a.indices.count { i ->
            val p = a[i]; val q = b[i]
            Math.abs(android.graphics.Color.red(p) - android.graphics.Color.red(q)) + Math.abs(android.graphics.Color.green(p) - android.graphics.Color.green(q)) +
                Math.abs(android.graphics.Color.blue(p) - android.graphics.Color.blue(q)) > 60
        }.toDouble() / a.size
        val tags = listOf("primary", "exit", "settings", "details")
        val unfocused = tags.associateWith(::ringBand)
        val report = mutableListOf<String>()
        for ((i, tag) in tags.withIndex()) {
            device.pressKeyCode(android.view.KeyEvent.KEYCODE_TAB)
            compose.waitForIdle()
            Thread.sleep(250)
            val focused = compose.onAllNodes(androidx.compose.ui.test.isFocused(), useUnmergedTree = true).fetchSemanticsNodes()
            val holder = focused.firstOrNull()?.let { n ->
                generateSequence<androidx.compose.ui.semantics.SemanticsNode>(n) { it.parent }.firstNotNullOfOrNull { it.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.TestTag) }
            }
            // The software-GPU emulator can show the frame before the ring for a moment: sample
            // until the ring is there or 3 s have passed; the threshold does not change.
            val deadline = android.os.SystemClock.elapsedRealtime() + 3_000
            var ring = changed(unfocused.getValue(tag), ringBand(tag))
            while (ring <= 0.2 && android.os.SystemClock.elapsedRealtime() < deadline) { Thread.sleep(200); ring = changed(unfocused.getValue(tag), ringBand(tag)) }
            report += "Tab ${i + 1} → ${holder ?: "(nothing focused)"}; ring pixels changed on \"$tag\": ${"%.0f".format(ring * 100)} %"
            if (i == 0) shot("fixture-25-keyboard-focus")
            assertEquals("Tab stop ${i + 1}: $report", tag, holder)
            assertTrue("focus on \"$tag\" is visible: $report", ring > 0.2)
        }
        // Back to the capsule (Shift+Tab three times) and act on it with Enter.
        repeat(3) { device.pressKeyCode(android.view.KeyEvent.KEYCODE_TAB, android.view.KeyEvent.META_SHIFT_ON); compose.waitForIdle() }
        calls.clear()
        device.pressKeyCode(android.view.KeyEvent.KEYCODE_ENTER)
        compose.waitForIdle()
        report += "Shift+Tab ×3, Enter → ${calls.joinToString().ifEmpty { "(nothing)" }}"
        assertEquals("Enter on the focused capsule: $report", listOf("disconnect"), calls.toList())

        // TalkBack's double-tap: ACTION_CLICK on the platform accessibility node of each control.
        fun nodeFor(label: String): android.view.accessibility.AccessibilityNodeInfo? {
            fun search(n: android.view.accessibility.AccessibilityNodeInfo?): android.view.accessibility.AccessibilityNodeInfo? {
                if (n == null) return null
                // Like TalkBack: a clickable node is labelled by its own text or by the text of
                // descendants that are not clickable themselves (Compose nests the label's TextView).
                fun spoken(m: android.view.accessibility.AccessibilityNodeInfo, top: Boolean): String =
                    if (!top && m.isClickable) "" else (listOfNotNull(m.contentDescription, m.text) +
                        (0 until m.childCount).mapNotNull { m.getChild(it) }.map { spoken(it, false) }).joinToString(" ")
                if (n.isClickable && spoken(n, true).contains(label)) return n
                return (0 until n.childCount).firstNotNullOfOrNull { search(n.getChild(it)) }
            }
            return search(automation.rootInActiveWindow)
        }
        val actions = listOf(
            str(R.string.action_disconnect) to listOf("disconnect"),
            "Tokyo" to listOf("refreshCatalog"),
        )
        for ((label, expected) in actions) {
            calls.clear()
            val node = nodeFor(label)
            assertTrue("platform node for \"$label\"", node != null)
            assertTrue("ACTION_CLICK accepted on \"$label\"", node!!.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK))
            compose.waitForIdle()
            report += "ACTION_CLICK \"$label\" → ${calls.joinToString().ifEmpty { "(nothing)" }}"
            assertEquals("accessibility click on \"$label\": $report", expected, calls.toList())
            if (label == "Tokyo") { assertTrue("Lines sheet opened", compose.onAllNodesWithText(str(R.string.lines_title)).fetchSemanticsNodes().isNotEmpty()); back() }
        }
        for ((label, opened) in listOf(str(R.string.details) to str(R.string.lane_video), str(R.string.settings_title) to str(R.string.settings_title))) {
            val node = nodeFor(label)
            assertTrue("platform node for \"$label\"", node != null)
            assertTrue("ACTION_CLICK accepted on \"$label\"", node!!.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK))
            compose.waitForIdle()
            Thread.sleep(400)
            // Text, not a content description: on Home "Settings" is only the gear's description.
            val shown = compose.onAllNodesWithText(opened).fetchSemanticsNodes().isNotEmpty()
            report += "ACTION_CLICK \"$label\" → \"$opened\" shown: $shown"
            assertTrue("accessibility click on \"$label\" opens it: $report", shown)
            back()
        }
        File(out, "keyboard-report.txt").writeText(report.joinToString("\n") + "\n")
    }

    private fun windowTop(): Int {
        val loc = IntArray(2)
        instrumentation.runOnMainSync { compose.activity.window.decorView.getLocationOnScreen(loc) }
        return loc[1]
    }
}
