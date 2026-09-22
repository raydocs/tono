import AppKit
import SwiftUI

struct SupportHealthSection: View {
    @Environment(AppState.self) private var appState
    @Environment(AccountSession.self) private var account: AccountSession?
    @State private var check: LocalHealthCheck?
    @State private var checking = false
    @State private var changedDuringCheck = false
    @State private var showingReport = false

    var body: some View {
        SupportCard(icon: "stethoscope", title: String(localized: "Local health check")) {
            Text("Read-only checks. No connection, network reset, repair, or upload happens here.")
                .font(.system(size: 12)).foregroundStyle(.secondary)
            Button(checking ? String(localized: "Checking…") : String(localized: "Check this Mac")) {
                guard !checking else { return }
                checking = true
                changedDuringCheck = false
                Task {
                    check = await appState.collectLocalHealth(account: account)
                    changedDuringCheck = check == nil
                    checking = false
                }
            }
            .disabled(checking)
            .accessibilityIdentifier("localHealthCheck")
            if changedDuringCheck {
                Text("The account or connection changed during the check. Check again for a consistent snapshot.")
                    .font(.system(size: 12)).foregroundStyle(.orange)
            }
            if let check, check.owner == account?.user?.id,
               check.accountRevision == account?.accountReadRevision {
                LocalHealthResults(check: check)
                DisclosureGroup(String(localized: "Build and runtime identity")) {
                    BuildIdentityDetails(check: check)
                }
                Button("Preview support report") {
                    account?.previewSupportReport(check)
                    showingReport = account?.supportReportDraft != nil
                }
                .disabled(account?.isReady != true || check.generation != appState.connectionCoordinator.protectionOperationGeneration)
                Text("Sending requires a separate confirmation and a signed-in account. Raw-log upload and remote diagnostics settings are not changed.")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }
        .sheet(isPresented: $showingReport, onDismiss: { account?.discardSupportReport() }) {
            if let account, let draft = account.supportReportDraft {
                SupportReportConfirmationView(
                    draft: draft, receipt: account.supportReportReceipt,
                    sending: account.uploadingSupportReportID != nil,
                    error: account.supportReportError,
                    canSend: draft.health.generation == appState.connectionCoordinator.protectionOperationGeneration,
                    confirm: {
                        Task {
                            await account.confirmSupportReport(
                                id: draft.id, generation: appState.connectionCoordinator.protectionOperationGeneration
                            )
                        }
                    }, close: { showingReport = false }
                )
            } else {
                VStack(spacing: 16) {
                    Text("The account changed. Close this preview and check again.")
                    Button("Close") { showingReport = false }
                }.padding(24)
            }
        }
    }
}

struct LocalHealthResults: View {
    let check: LocalHealthCheck
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(check.observedAt, format: .dateTime.hour().minute().second())
                .font(.system(size: 11)).foregroundStyle(.secondary)
            Text("Connection snapshot: \(check.request.report.uiState)")
                .font(.system(size: 11, design: .monospaced))
            if let category = check.request.report.error {
                Text("Last failure category: \(category)")
                    .font(.system(size: 11, design: .monospaced))
            }
            ForEach(check.findings) { finding in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: finding.status == .observed ? "checkmark.circle" : finding.status == .attention ? "exclamationmark.circle" : "questionmark.circle")
                        .foregroundStyle(finding.status == .attention ? Color.orange : Color.secondary)
                        .accessibilityLabel(finding.status == .observed ? String(localized: "Observed") : finding.status == .attention ? String(localized: "Needs attention") : String(localized: "Unknown"))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(finding.title).font(.system(size: 12, weight: .semibold))
                        Text(finding.detail).font(.system(size: 11)).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

struct BuildIdentityDetails: View {
    let check: LocalHealthCheck
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Debug or Release is a build configuration, not proof of a signed customer release. Source metadata describes the build checkout; matching versions do not attest running binaries.")
                .font(.system(size: 11)).foregroundStyle(.secondary)
            Text(check.localIdentity).font(.system(size: 11, design: .monospaced))
                .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }.padding(.top, 8)
    }
}

struct SupportReportConfirmationView: View {
    let draft: SupportReportDraft
    let receipt: SupportReportReceipt?
    let sending: Bool
    let error: String?
    let canSend: Bool
    let confirm: () -> Void
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Preview support report").font(.title2.bold())
            Text("Only the JSON below will be sent to Tono support under the account that collected it. It contains no raw logs, tokens, IP addresses, process names, or browsing history. Build and attempt details stay local beside the receipt.")
                .font(.system(size: 12)).foregroundStyle(.secondary)
            ScrollView {
                Text(draft.preview).font(.system(size: 11, design: .monospaced))
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            }.frame(minHeight: 180, maxHeight: 260)
            if let receipt {
                Label(receipt.server.referenceCode, systemImage: "checkmark.circle")
                    .font(.headline).textSelection(.enabled)
                Text("Support received this report. Keep the reference code.")
                    .font(.system(size: 12))
                Button("Copy receipt and local identity") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(receipt.copyText, forType: .string)
                }
            } else if !canSend {
                Text("The connection changed. Close this preview and check again before sending.")
                    .foregroundStyle(.orange)
            } else if let error {
                Text(error).font(.system(size: 12)).foregroundStyle(.orange)
            }
            HStack {
                Button("Close", action: close)
                Spacer()
                if receipt == nil {
                    Button(sending ? String(localized: "Sending…") : String(localized: "Send this report"), action: confirm)
                        .buttonStyle(.borderedProminent)
                        .disabled(sending || !canSend)
                        .accessibilityIdentifier("confirmSupportReport")
                }
            }
        }
        .padding(24).frame(width: 620)
    }
}
