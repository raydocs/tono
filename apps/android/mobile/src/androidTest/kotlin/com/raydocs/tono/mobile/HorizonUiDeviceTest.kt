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
import androidx.compose.ui.platform.testTag
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
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
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

    private fun str(id: Int) = context.getString(id)

    private fun show() = compose.setContent {
        CompositionLocalProvider(LocalReduceMotion provides true) {
            TonoTheme {
                TonoRoot(snapshot, object : TonoActions {
                    override fun connect() { calls += "connect" }
                    override fun command(op: String, vararg args: Pair<String, Any?>) { calls += op }
                    override fun explain(host: String): Map<String, Any?>? = null
                })
            }
        }
    }

    private fun set(s: EngineSnapshot) { snapshot = s; compose.waitForIdle() }

    private fun shot(name: String) { compose.waitForIdle(); Thread.sleep(400); device.takeScreenshot(File(out, "$name.png")) }

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
        compose.onNodeWithText(str(R.string.settings_apps_none)).performScrollTo().performClick(); check("apps"); shot("fixture-12-apps")
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
        val stripes: androidx.compose.ui.graphics.drawscope.DrawScope.() -> Unit = {
            val w = 8.dp.toPx()
            var x = 0f
            while (x < size.width) { drawRect(Color.White, Offset(x, 0f), Size(w, size.height)); x += 2 * w }
        }
        compose.setContent {
            Box(Modifier.fillMaxSize().background(Color.Black)) {
                BackdropHost(scene = { Canvas(Modifier.fillMaxSize(), onDraw = stripes) }, modifier = Modifier.fillMaxSize()) {
                    Glass(RoundedCornerShape(28.dp), Modifier.align(Alignment.Center).size(240.dp, 160.dp).testTag("glass")) {}
                    // Control: the platform blur alone, same radius, over the same stripes.
                    Canvas(Modifier.align(Alignment.BottomCenter).padding(bottom = 48.dp).size(240.dp, 120.dp).blur(26.dp, BlurredEdgeTreatment.Rectangle).testTag("control"), onDraw = stripes)
                }
            }
        }
        compose.waitForIdle()
        val image = compose.onRoot().captureToImage().asAndroidBitmap()
        val inset = 24.dp.value * compose.density.density // away from the rim and rounded corners
        fun contrast(r: androidx.compose.ui.geometry.Rect): Double {
            val left = (r.left + inset).toInt(); val top = (r.top + inset).toInt()
            val w = (r.width - 2 * inset).toInt(); val h = (r.height - 2 * inset).toInt()
            val px = IntArray(w * h).also { image.getPixels(it, 0, w, left, top, w, h) }
            val luma = px.map { (0.299 * ((it shr 16) and 0xFF) + 0.587 * ((it shr 8) and 0xFF) + 0.114 * (it and 0xFF)) }
            return luma.max() - luma.min()
        }
        val g = compose.onNodeWithTag("glass").fetchSemanticsNode().boundsInRoot
        val inside = contrast(g)
        val control = contrast(compose.onNodeWithTag("control").fetchSemanticsNode().boundsInRoot)
        val outside = contrast(androidx.compose.ui.geometry.Rect(0f, g.top, g.left - 8, g.bottom))
        File(out, "fixture-16-glass-blur.png").outputStream().use { image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        File(out, "glass-report.txt").writeText(
            ("API ${android.os.Build.VERSION.SDK_INT}: stripe luminance range beside the glass %.1f, behind Tono glass %.1f (%.1f %%), " +
                "under the platform's own blur %.1f (%.1f %%)\n").format(outside, inside, 100 * inside / outside, control, 100 * control / outside),
        )
        assertTrue("stripes visible beside the glass ($outside)", outside > 200)
        // Glass never shows more of what is behind it than the platform's own blur would.
        assertTrue("glass ($inside) diffuses at least as much as the platform blur ($control)", inside <= control + 0.05 * outside)
        // Where the platform blur renders fully (hardware GPU), the stripes must vanish behind glass too.
        // The CI emulator's software renderer only partly applies RenderEffect blur; the report says so.
        if (control < 0.15 * outside) assertTrue("glass blurs the stripes: $inside of $outside", inside < 0.15 * outside)
    }

    /** Shown before Android's VPN dialog whenever consent is missing; Continue is what opens it. */
    @Test fun u5_consentExplainedBeforeTheSystemDialog() {
        compose.enableAccessibilityChecks()
        var continued = 0
        var dismissed = 0
        compose.setContent {
            TonoTheme {
                Box(Modifier.fillMaxSize().background(com.raydocs.tono.mobile.ui.TonoColors.Smoke)) {
                    Box(Modifier.statusBarsPadding().padding(top = 24.dp)) { ConsentContent(onContinue = { continued++ }, onDismiss = { dismissed++ }) }
                }
            }
        }
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
        val order = listOf(
            at(str(R.string.settings_title)), at(str(R.string.state_degraded)), at(str(R.string.action_disconnect)),
            at("Tokyo"), at(str(R.string.details)),
        )
        assertEquals("reading order follows the screen: $seen", order.sorted(), order)
    }

    /** Window → screen offset for UiDevice coordinates. */
    private fun windowTop(): Int {
        val loc = IntArray(2)
        instrumentation.runOnMainSync { compose.activity.window.decorView.getLocationOnScreen(loc) }
        return loc[1]
    }
}
