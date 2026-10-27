import SwiftUI
import TonoKit

/// Email → code, the same passwordless flow as the desktop and Android apps. The six-digit code
/// submits itself; iOS offers it from Mail via the one-time-code content type.
struct SignInView: View {
    @EnvironmentObject private var model: AppModel
    @State private var email = ""
    @State private var code = ""
    @FocusState private var focus: Field?
    @Environment(\.dynamicTypeSize) private var typeSize
    private enum Field { case email, code }

    var body: some View {
        ZStack {
            TonoColor.night.ignoresSafeArea()
            // At accessibility sizes the intro scrolls up into the sky, where its subtitle crossed the
            // bright crescent (AX5 sweep, round 12: 2.8:1 against the local background); no moon there.
            SeaScene(sky: .night, horizon: 0.44, moon: !typeSize.isAccessibilitySize)
            if typeSize.isAccessibilitySize {
                BottomScroll { VStack(alignment: .leading, spacing: 16) { intro; form } }
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    intro
                    Spacer(minLength: 16)
                    form
                }
            }
        }
        .onAppear { email = model.login.email }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 6) {
            TonoMark(size: 48).padding(.bottom, 12)
            Text(L.t("signin_title")).tonoFont(30, .regular, relativeTo: .largeTitle).foregroundStyle(TonoColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(L.t("signin_intro")).tonoFont(17, relativeTo: .body).lineSpacing(3).foregroundStyle(TonoColor.textSecondary)
        }
        .padding(.horizontal, 28).padding(.top, 28)
    }

    private var codeStep: Bool { model.login.challengeID != nil }

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !codeStep {
                TonoField(title: L.t("signin_email"), text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.send)
                    .focused($focus, equals: .email)
                    .onSubmit(send)
                    .disabled(model.login.busy)
                    .onChange(of: email) { if $0.count > 254 { email = String($0.prefix(254)) } }
                PrimaryButton(title: L.t(model.login.busy ? "signin_sending" : "signin_send"),
                              enabled: !model.login.busy && !email.trimmingCharacters(in: .whitespaces).isEmpty, action: send)
            } else {
                // Open registration mails every address; otherwise only accounts and invitations get
                // a code, and the copy must not say which this address is.
                Text(L.t(model.login.mail?.publicSignup == true ? "signin_code_requested" : "signin_code_sent", model.login.email))
                    .tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textSecondary)
                    .task(id: model.login.challengeID) {
                        await model.refreshMailStatus()
                        try? await Task.sleep(nanoseconds: 60_000_000_000)
                        guard !Task.isCancelled else { return }
                        await model.refreshMailStatus()
                    }
                if model.login.mail?.deliveryDegraded == true {
                    Text(L.t("signin_mail_degraded")).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.warning)
                }
                TonoField(title: L.t("signin_code"), text: $code, large: true)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .focused($focus, equals: .code)
                    .disabled(model.login.busy)
                    .onChange(of: code) { value in
                        let digits = String(value.filter(\.isNumber).prefix(6))
                        if digits != value { code = digits }
                        if digits.count == 6 && !model.login.busy { verify() }
                    }
                PrimaryButton(title: L.t(model.login.busy ? "signin_verifying" : "signin_verify"),
                              enabled: !model.login.busy && code.count == 6, action: verify)
                Button(L.t("signin_change")) { code = ""; model.changeEmail(); focus = .email }
                    .tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textSecondary)
                    .frame(maxWidth: .infinity).frame(minHeight: 44)
            }
            if model.reason == "SESSION_ENDED", model.login.errorCode == nil {
                Text(PhaseText.reason("SESSION_ENDED")).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.warning)
            }
            if let error = model.login.errorCode {
                Text(PhaseText.signInError(error)).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.error)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            Text(L.t("signin_privacy")).tonoFont(11, relativeTo: .caption2).foregroundStyle(TonoColor.textTertiary)
        }
        .padding(22)
        .background {
            Color.clear.glassSurface(UnevenSheetShape(radius: 32)).ignoresSafeArea(edges: .bottom)
        }
        .animation(TonoMotion.state, value: codeStep)
        .onChange(of: codeStep) { focus = $0 ? .code : .email }
    }

    private func send() {
        guard !model.login.busy else { return }
        Task { await model.sendCode(email) }
    }

    private func verify() {
        let c = code
        Task { await model.verify(c) }
    }
}
