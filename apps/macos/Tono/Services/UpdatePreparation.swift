import Foundation

/// Owner-driven preparation, separate from Sparkle's decision to continue.
/// Completing a cancelled Task is not proof that Core/DNS cleanup succeeded.
@MainActor
enum UpdatePreparation {
    nonisolated static func protectionMatches(
        keepKillSwitchArmed: Bool, armed: Bool, wanted: Bool, live: Bool
    ) -> Bool {
        keepKillSwitchArmed ? (armed && wanted && live) : (!armed && !wanted && !live)
    }

    static func run(
        _ prepared: UpdateHandoffJournal,
        at location: URL? = nil,
        quiesce: () async throws -> Void
    ) async throws -> UpdateHandoffJournal {
        let url = location ?? UpdateHandoffStore.fileURL
        // Preserve an earlier failed/corrupt attempt before creating a new one.
        // A persistence error here must leave that earlier evidence untouched.
        try UpdateHandoffStore.writePrepared(prepared, at: url)
        var journal = prepared
        var stage = "journalPersistence"
        do {
            journal = journal.advancing(to: .connectionQuiescing)
            try UpdateHandoffStore.write(journal, at: url)
            stage = "runtimeQuiescence"
            try await quiesce()
            stage = "journalPersistence"
            journal = journal.advancing(to: .cleanShutdownCompleted)
            try UpdateHandoffStore.write(journal, at: url)
            if journal.keepKillSwitchArmed {
                journal = journal.advancing(to: .protectedHandoffRecorded)
                try UpdateHandoffStore.write(journal, at: url)
            }
            return journal
        } catch {
            let failure = journal.advancing(
                to: .failed,
                errorCode: "TONO_UPDATE_PREPARATION_FAILED",
                errorStage: stage
            )
            // Failure to persist Failed is also fatal. Never continue installing
            // just because diagnostics could not be written.
            try UpdateHandoffStore.write(failure, at: url)
            throw error
        }
    }
}
