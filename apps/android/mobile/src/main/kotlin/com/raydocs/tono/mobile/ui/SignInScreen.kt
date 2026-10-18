package com.raydocs.tono.mobile.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.LoginView

/**
 * Email → code, the same passwordless flow as the desktop app. The code arrives on the user's own
 * email; the app never sees anything but what the user types.
 */
@Composable
fun SignInScreen(login: LoginView, onSend: (String) -> Unit, onVerify: (String) -> Unit, onChangeEmail: () -> Unit) {
    var email by rememberSaveable { mutableStateOf(login.email) }
    var code by rememberSaveable { mutableStateOf("") }
    val codeStep = login.challengeId != null
    BackdropHost(scene = { SeaScene(SkyState.NIGHT, Modifier.fillMaxSize(), horizon = 0.44f) }, modifier = Modifier.fillMaxSize().background(TonoColors.Night)) {
        val card: @Composable (Modifier) -> Unit = { modifier ->
            Glass(RoundedCornerShape(28.dp), modifier.widthIn(max = 560.dp).fillMaxWidth(), tintAlpha = 0.52f) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    AnimatedContent(codeStep, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(220)) }, label = "step") { step ->
                        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            if (!step) {
                                OutlinedTextField(
                                    value = email,
                                    onValueChange = { email = it.take(254) },
                                    label = { Text(stringResource(R.string.signin_email)) },
                                    singleLine = true,
                                    enabled = !login.busy,
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Send, autoCorrectEnabled = false),
                                    keyboardActions = KeyboardActions(onSend = { if (!login.busy) onSend(email) }),
                                    colors = fieldColors(),
                                    modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.EmailAddress },
                                )
                                PrimaryButton(stringResource(if (login.busy) R.string.signin_sending else R.string.signin_send), { onSend(email) }, enabled = !login.busy && email.isNotBlank())
                            } else {
                                Text(stringResource(R.string.signin_code_sent, login.email), style = MaterialTheme.typography.bodyMedium, color = TonoColors.TextSecondary)
                                OutlinedTextField(
                                    value = code,
                                    onValueChange = { v -> code = v.filter(Char::isDigit).take(6); if (code.length == 6 && !login.busy) onVerify(code) },
                                    label = { Text(stringResource(R.string.signin_code)) },
                                    singleLine = true,
                                    enabled = !login.busy,
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                                    keyboardActions = KeyboardActions(onDone = { if (!login.busy) onVerify(code) }),
                                    colors = fieldColors(),
                                    textStyle = MaterialTheme.typography.headlineSmall,
                                    modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.SmsOtpCode },
                                )
                                PrimaryButton(stringResource(if (login.busy) R.string.signin_verifying else R.string.signin_verify), { onVerify(code) }, enabled = !login.busy && code.length == 6)
                                TextButton(onClick = { code = ""; onChangeEmail() }, modifier = Modifier.align(Alignment.CenterHorizontally).heightIn(min = 48.dp)) {
                                    Text(stringResource(R.string.signin_change), color = TonoColors.TextSecondary)
                                }
                            }
                        }
                    }
                    login.errorCode?.let {
                        Text(signInError(it), style = MaterialTheme.typography.bodyMedium, color = TonoColors.Error, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
                    }
                    Text(stringResource(R.string.signin_privacy), style = MaterialTheme.typography.labelSmall, color = TonoColors.TextTertiary)
                }
            }
        }
        BoxWithConstraints(Modifier.fillMaxSize().imePadding()) {
            if (maxWidth > maxHeight) {
                // Landscape: the words beside the card, so neither is cut off; either side scrolls if
                // it still does not fit (large text, the code step).
                Row(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                    Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.CenterStart) {
                        SignInHeader(Modifier.verticalScroll(rememberScrollState()).padding(28.dp))
                    }
                    Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                        Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp)) { card(Modifier) }
                    }
                }
            } else {
                // Portrait: words at the top, the card at the thumb; scrolls instead of clipping.
                val screenHeight = maxHeight
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    Column(Modifier.heightIn(min = screenHeight).fillMaxWidth(), verticalArrangement = Arrangement.SpaceBetween) {
                        SignInHeader(Modifier.statusBarsPadding().padding(horizontal = 28.dp, vertical = 28.dp))
                        card(Modifier.align(Alignment.CenterHorizontally).navigationBarsPadding().padding(12.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun SignInHeader(modifier: Modifier) {
    Column(modifier) {
        Image(painterResource(R.drawable.tono_tile), contentDescription = null, modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(18.dp))
        Text(stringResource(R.string.signin_title), style = MaterialTheme.typography.headlineMedium, color = TonoColors.TextPrimary, modifier = Modifier.semantics { heading() })
        Spacer(Modifier.height(6.dp))
        Text(stringResource(R.string.signin_intro), style = MaterialTheme.typography.bodyLarge, color = TonoColors.TextSecondary)
    }
}

@Composable
fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = TonoColors.Accent,
    unfocusedBorderColor = TonoColors.Hairline,
    focusedLabelColor = TonoColors.Accent,
    cursorColor = TonoColors.Accent,
    focusedContainerColor = TonoColors.NightDeep.copy(alpha = 0.4f),
    unfocusedContainerColor = TonoColors.NightDeep.copy(alpha = 0.4f),
)
