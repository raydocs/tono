package com.raydocs.tono.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.routing.RoutingMode

enum class Screen { HOME, SETTINGS, APPS, LICENSES }

/** Everything the UI can ask of the engine. Implemented by MainActivity over the AIDL client. */
interface TonoActions {
    fun connect()
    fun command(op: String, vararg args: Pair<String, Any?>)
    fun explain(host: String): Map<String, Any?>?
}

@Composable
fun TonoRoot(snapshot: EngineSnapshot?, actions: TonoActions) {
    var screen by rememberSaveable { mutableStateOf(Screen.HOME) }
    var linesOpen by rememberSaveable { mutableStateOf(false) }
    var detailsOpen by rememberSaveable { mutableStateOf(false) }
    val s = snapshot
    Box(Modifier.fillMaxSize().background(TonoColors.Night)) {
        when {
            s == null -> SeaScene(SkyState.NIGHT, Modifier.fillMaxSize(), horizon = 0.44f)
            s.phase == Phase.SIGNED_OUT -> {
                LaunchedEffect(Unit) { screen = Screen.HOME; linesOpen = false; detailsOpen = false }
                SignInScreen(
                    s.login,
                    onSend = { actions.command("startEmail", "email" to it) },
                    onVerify = { actions.command("verifyCode", "code" to it) },
                    onChangeEmail = { actions.command("cancelLogin") },
                )
            }
            else -> {
                BackHandler(screen != Screen.HOME) { screen = if (screen == Screen.SETTINGS) Screen.HOME else Screen.SETTINGS }
                AnimatedContent(
                    screen,
                    transitionSpec = {
                        val forward = targetState.ordinal > initialState.ordinal
                        (slideInHorizontally(tween(350)) { if (forward) it / 4 else -it / 4 } + fadeIn(tween(350))) togetherWith
                            (slideOutHorizontally(tween(350)) { if (forward) -it / 4 else it / 4 } + fadeOut(tween(220)))
                    },
                    label = "screen",
                ) { target ->
                    when (target) {
                        Screen.HOME -> HomeScreen(
                            s,
                            onConnect = actions::connect,
                            onDisconnect = { actions.command("disconnect") },
                            onOpenLines = { linesOpen = true; actions.command("refreshCatalog") },
                            onOpenDetails = { detailsOpen = true },
                            onOpenSettings = { screen = Screen.SETTINGS },
                        )
                        Screen.SETTINGS -> SettingsScreen(
                            s,
                            onBack = { screen = Screen.HOME },
                            onMode = { m: RoutingMode -> actions.command("setMode", "mode" to m.name) },
                            onOpenApps = { screen = Screen.APPS },
                            onExplain = actions::explain,
                            onSignOut = { actions.command("signOut") },
                            onOpenLicenses = { screen = Screen.LICENSES },
                        )
                        Screen.LICENSES -> LicensesScreen(onBack = { screen = Screen.SETTINGS })
                        Screen.APPS -> AppsScreen(
                            s.excludedPackages,
                            onBack = { screen = Screen.SETTINGS },
                            onSave = { actions.command("setExcluded", "packages" to it) },
                        )
                    }
                }
                if (detailsOpen && screen == Screen.HOME) {
                    DetailsSheet(
                        s,
                        onRecheck = { actions.command("recheck") },
                        onOpenLines = { detailsOpen = false; linesOpen = true },
                        onOpenSettings = { detailsOpen = false; screen = Screen.SETTINGS },
                        onDismiss = { detailsOpen = false },
                    )
                }
                if (linesOpen && screen == Screen.HOME) {
                    LinesSheet(
                        s,
                        onSelect = { actions.command("selectNode", "name" to it) },
                        onTest = { actions.command("measureLatency") },
                        onDismiss = { linesOpen = false },
                    )
                }
            }
        }
    }
}
