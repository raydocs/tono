import SwiftUI
import TonoKit

/// Email → code, the same passwordless flow as the desktop and Android apps. The six-digit code
/// submits itself; iOS offers it from Mail via the one-time-code content type.
struct SignInView: View {
    @EnvironmentObject private var model: AppModel
    @State private var email = ""
    @State private var code = ""
    @FocusState private var focus: Field?
    private enum Field { case email, code }

    var body: some View {
        ZStack {
            TonoColor.night.ignoresSafeArea()
            SeaScene(sky: .night, horizon: 0.44)
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 6) {
                    TonoMark(size: 44).padding(.bottom, 12)
                    Text(L.t("signin_title")).font(.system(size: 30, weight: .regular)).foregroundStyle(TonoColor.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    Text(L.t("signin_intro")).font(.system(size: 17)).lineSpacing(3).foregroundStyle(TonoColor.textSecondary)
                }
                .padding(.horizontal, 28).padding(.top, 28)
                Spacer(minLength: 16)
                form
            }
        }
        .onAppear { email = model.login.email }
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
                Text(L.t("signin_code_sent", model.login.email)).font(.system(size: 14)).foregroundStyle(TonoColor.textSecondary)
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
                    .font(.system(size: 15)).foregroundStyle(TonoColor.textSecondary)
                    .frame(maxWidth: .infinity).frame(minHeight: 44)
            }
            if model.reason == "SESSION_ENDED", model.login.errorCode == nil {
                Text(PhaseText.reason("SESSION_ENDED")).font(.system(size: 14)).foregroundStyle(TonoColor.warning)
            }
            if let error = model.login.errorCode {
                Text(PhaseText.signInError(error)).font(.system(size: 14)).foregroundStyle(TonoColor.error)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            Text(L.t("signin_privacy")).font(.system(size: 11)).foregroundStyle(TonoColor.textTertiary)
        }
        .padding(22)
        .background(
            UnevenSheetShape(radius: 30)
                .fill(LinearGradient(colors: [TonoColor.smoke.opacity(0.92), TonoColor.nightDeep], startPoint: .top, endPoint: .bottom))
                .overlay(UnevenSheetShape(radius: 30).stroke(TonoColor.hairline, lineWidth: 1))
                .ignoresSafeArea(edges: .bottom)
        )
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
