package com.raydocs.tono.mobile

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.text.TextLayoutResult
import kotlin.math.roundToInt

/**
 * Shared accessibility contract (JVM and device; the androidTest copy differs only in package).
 * [violations]: every actionable node is laid out at least 48×48 dp (stricter than the platform's
 * touch expansion, which would accept a smaller visible control) and announces something.
 * [truncatedText]: no text is ellipsized or clipped by its own layout.
 * Both return human-readable violations, empty when the screen passes.
 */
object A11yContract {
    fun violations(rule: ComposeTestRule, screen: String, report: MutableList<String>? = null): List<String> {
        val out = mutableListOf<String>()
        fun dp(r: Rect) = with(rule.density) { r.width.toDp().value to r.height.toDp().value }
        fun visit(n: SemanticsNode) {
            val cfg = n.config
            if (cfg.getOrNull(SemanticsActions.OnClick) != null && cfg.getOrNull(SemanticsProperties.Disabled) == null) {
                val label = buildString {
                    cfg.getOrNull(SemanticsProperties.ContentDescription)?.let { append(it.joinToString(" ")) }
                    cfg.getOrNull(SemanticsProperties.Text)?.let { append(it.joinToString(" ") { t -> t.text }) }
                    cfg.getOrNull(SemanticsProperties.EditableText)?.let { append(it.text) }
                    cfg.getOrNull(SemanticsActions.OnClick)?.label?.let { append(it) }
                }.trim()
                val name = label.ifEmpty { "node#${n.id}" }
                // Layout size is what the user sees; window bounds are clipped for a row scrolled half
                // out of view, so the touch check only applies to rows that are fully on screen.
                val (lw, lh) = with(rule.density) { n.size.width.toDp().value to n.size.height.toDp().value }
                val clipped = n.boundsInRoot.width.roundToInt() < n.size.width || n.boundsInRoot.height.roundToInt() < n.size.height
                val (w, h) = dp(n.touchBoundsInRoot)
                report?.add("$screen \"$name\" visible ${"%.0f".format(lw)}×${"%.0f".format(lh)} dp" + if (clipped) " (partly scrolled out)" else ", touch ${"%.0f".format(w)}×${"%.0f".format(h)} dp")
                if (lw < 47.5f || lh < 47.5f) out += "$screen: \"$name\" visible control ${"%.0f".format(lw)}×${"%.0f".format(lh)} dp < 48"
                if (!clipped && (w < 47.5f || h < 47.5f)) out += "$screen: \"$name\" touch target ${"%.0f".format(w)}×${"%.0f".format(h)} dp < 48"
                if (label.isEmpty() && cfg.getOrNull(SemanticsProperties.Role) != null) out += "$screen: actionable node#${n.id} has no label"
            }
            n.children.forEach(::visit)
        }
        roots(rule, merged = true).forEach(::visit)
        return out
    }

    fun truncatedText(rule: ComposeTestRule, screen: String): List<String> {
        val out = mutableListOf<String>()
        fun visit(n: SemanticsNode) {
            n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.let { get ->
                val results = mutableListOf<TextLayoutResult>()
                if (get(results)) results.forEach { r ->
                    // Width is not checked: a wrapped paragraph is always laid out at the full constraint width.
                    if ((0 until r.lineCount).any(r::isLineEllipsized) || r.multiParagraph.didExceedMaxLines || r.didOverflowHeight) {
                        out += "$screen: \"${r.layoutInput.text}\" is cut off"
                    }
                }
            }
            n.children.forEach(::visit)
        }
        roots(rule, merged = false).forEach(::visit)
        return out
    }

    /** Every window's root: an open bottom sheet is a separate dialog window above Home. */
    private fun roots(rule: ComposeTestRule, merged: Boolean) =
        rule.onAllNodes(isRoot(), useUnmergedTree = !merged).fetchSemanticsNodes()
}
