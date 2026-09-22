import Foundation

extension AccountSession {
    func discardSupportReport() {
        supportReportDraft?.lease.revoke()
        supportReportDraft = nil
        supportReportReceipt = nil
        supportReportError = nil
        uploadingSupportReportID = nil
    }

    /// Preview creation grants no network permission. Raw-log and remote-action
    /// switches are deliberately neither read nor changed by this one-shot flow.
    func previewSupportReport(_ health: LocalHealthCheck) {
        discardSupportReport()
        guard isReady, let owner = user?.id, health.owner == owner,
              health.accountRevision == accountReadRevision,
              let preview = try? health.request.preview() else { return }
        supportReportDraft = SupportReportDraft(
            health: health, preview: preview, lease: SupportReportLease()
        )
    }

    func confirmSupportReport(id: UUID, generation: UInt64) async {
        guard let draft = supportReportDraft, draft.id == id,
              uploadingSupportReportID == nil, supportReportReceipt == nil,
              isReady, draft.health.owner == user?.id,
              draft.health.accountRevision == accountReadRevision,
              draft.health.generation == generation,
              draft.lease.isCurrent() else { return }
        uploadingSupportReportID = id
        supportReportError = nil
        defer {
            if uploadingSupportReportID == id { uploadingSupportReportID = nil }
        }
        do {
            let lease = draft.lease
            let receipt = try await api.uploadSupportReport(draft.health.request) {
                lease.isCurrent()
            }
            guard draft.lease.isCurrent(), supportReportDraft?.id == id,
                  draft.health.accountRevision == accountReadRevision,
                  draft.health.owner == user?.id else { return }
            supportReportReceipt = SupportReportReceipt(
                draftID: id, server: receipt, localIdentity: draft.health.localIdentity
            )
        } catch {
            guard draft.lease.isCurrent(), supportReportDraft?.id == id else { return }
            // No receipt is not proof that the server did not store the POST.
            // Never fabricate a code, expose a transport body, or silently resend.
            supportReportError = String(localized: "No support receipt was received. The server may have stored the report. Try again only if you want to send this same preview again.")
        }
    }
}
