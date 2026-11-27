import AppKit
import Foundation
import SwiftUI

private enum UpdateReleaseLinks {
    static let releaseNotesURL = URL(string: "https://releases.afk.ccwu.cc/")!

    static func formattedBytes(_ count: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: max(0, count), countStyle: .file)
    }
}

struct SidebarUpdatePill: View {
    @ObservedObject var updater: AppUpdater
    @Environment(\.seaAccent) private var seaAccent
    @Environment(\.colorScheme) private var colorScheme
    @SeaAppearancePreference private var seaAppearance
    @SeaDisplayPreferences private var display
    @State private var hovered = false

    init(updater: AppUpdater) {
        self.updater = updater
    }

    var body: some View {
        if updater.showsBanner {
            Button {
                updater.presentPanel()
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        statusIndicator
                        pillLabel
                        Spacer(minLength: 4)
                        if case .downloading = updater.phase, let fraction = updater.downloadFraction {
                            Text(verbatim: "\(Int((fraction * 100).rounded()))%")
                                .font(.system(size: 11, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(seaAppearance ? seaAccent : TonoBrand.accent)
                        } else {
                            Image(systemName: "chevron.right")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(seaAppearance ? SeaTheme.tertiary : .secondary)
                                .accessibilityHidden(true)
                        }
                    }

                    if case .downloading = updater.phase {
                        GeometryReader { proxy in
                            let fraction = updater.downloadFraction ?? 0
                            ZStack(alignment: .leading) {
                                Capsule()
                                    .fill(display.reduceTransparency
                                        ? SeaTheme.opaqueTrack
                                        : Color.white.opacity(colorScheme == .dark ? 0.12 : 0.25))
                                Capsule()
                                    .fill(seaAppearance
                                        ? AnyShapeStyle(SeaTheme.primaryGradient)
                                        : AnyShapeStyle(TonoBrand.accent))
                                    .frame(width: min(proxy.size.width, max(fraction > 0 ? 4 : 0, proxy.size.width * fraction)))
                                    .animation(TonoMotion.numeric(reduceMotion: display.reduceMotion), value: fraction)
                            }
                        }
                        .frame(height: 3)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background { pillBackground }
                .overlay { pillBorder }
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(UpdatePillButtonStyle(reduceMotion: display.reduceMotion))
            .onHover { hovered = $0 }
            .animation(TonoMotion.hover(reduceMotion: display.reduceMotion), value: hovered)
            .padding(.horizontal, 6)
            .padding(.bottom, 8)
            .accessibilityIdentifier("sidebar.updatePill")
        }
    }

    @ViewBuilder
    private var statusIndicator: some View {
        switch updater.phase {
        case .failed:
            Circle()
                .fill(seaAppearance ? SeaTheme.attention : TonoStatus.blocked)
                .frame(width: 7, height: 7)
                .shadow(
                    color: !display.reduceTransparency && display.contrast != .increased
                        ? (seaAppearance ? SeaTheme.attention : TonoStatus.blocked).opacity(0.65)
                        : .clear,
                    radius: 4
                )
        case .preparing, .installing:
            ProgressView()
                .controlSize(.mini)
        default:
            Circle()
                .fill(seaAppearance ? seaAccent : TonoBrand.accent)
                .frame(width: 7, height: 7)
                .shadow(
                    color: !display.reduceTransparency && display.contrast != .increased
                        ? (seaAppearance ? seaAccent : TonoBrand.accent).opacity(0.65)
                        : .clear,
                    radius: 4
                )
        }
    }

    @ViewBuilder
    private var pillLabel: some View {
        switch updater.phase {
        case let .available(version, _):
            Text("Update \(version)")
                .font(.system(size: 12.5, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
                .lineLimit(1)
        case let .downloading(version, _, _):
            Text("Downloading \(version)")
                .font(.system(size: 12, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
                .lineLimit(1)
        case .preparing:
            Text("Verifying & preparing…")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
                .lineLimit(1)
        case .installing:
            Text("Installing & restarting…")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
                .lineLimit(1)
        case .failed:
            Text("Update needs attention")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(seaAppearance ? SeaTheme.attention : TonoStatus.blocked)
                .lineLimit(1)
        case .idle, .checking, .upToDate:
            EmptyView()
        }
    }

    @ViewBuilder
    private var pillBackground: some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        let isFailure: Bool = {
            if case .failed = updater.phase { return true }
            return false
        }()
        if display.reduceTransparency || display.contrast == .increased {
            shape.fill(isFailure
                ? (seaAppearance ? SeaTheme.opaqueAttention : Color.orange.opacity(0.22))
                : (seaAppearance
                    ? (hovered ? Color(hex: "322F3B") : SeaTheme.opaqueQuiet)
                    : Color(nsColor: .controlBackgroundColor)))
        } else if seaAppearance {
            shape.fill(.ultraThinMaterial)
                .overlay {
                    shape.fill(isFailure
                        ? SeaTheme.attention.opacity(hovered ? 0.16 : 0.11)
                        : Color.white.opacity(hovered ? 0.13 : 0.08))
                }
        } else {
            shape.fill(isFailure
                ? TonoStatus.blocked.opacity(hovered ? 0.18 : 0.12)
                : Color.white.opacity(colorScheme == .dark ? (hovered ? 0.14 : 0.09) : (hovered ? 0.85 : 0.65)))
        }
    }

    private var pillBorder: some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        let isFailure: Bool = {
            if case .failed = updater.phase { return true }
            return false
        }()
        let borderStyle: AnyShapeStyle = {
            if isFailure {
                return AnyShapeStyle((seaAppearance ? SeaTheme.attention : TonoStatus.blocked)
                    .opacity(display.contrast == .increased ? 0.65 : 0.32))
            }
            if seaAppearance {
                return SeaTheme.specularBorder(
                    contrast: display.contrast,
                    reduceTransparency: display.reduceTransparency,
                    topOpacity: hovered ? 0.24 : 0.16,
                    bottomOpacity: 0.05
                )
            }
            return AnyShapeStyle(Color.white.opacity(colorScheme == .dark ? 0.16 : 0.75))
        }()
        return shape.strokeBorder(borderStyle, lineWidth: display.contrast == .increased ? 1 : 0.75)
    }
}

struct MenuBarUpdateRow: View {
    @ObservedObject var updater: AppUpdater
    @Environment(\.openWindow) private var openWindow
    @Environment(\.seaAccent) private var seaAccent
    @Environment(\.colorScheme) private var colorScheme
    @SeaAppearancePreference private var seaAppearance
    @SeaDisplayPreferences private var display
    @State private var hovered = false

    init(updater: AppUpdater) {
        self.updater = updater
    }

    var body: some View {
        if updater.showsBanner {
            Button {
                activateMainWindow()
                updater.presentPanel()
            } label: {
                HStack(spacing: 8) {
                    indicator
                    rowText
                    Spacer(minLength: 4)
                    if case .downloading = updater.phase, let fraction = updater.downloadFraction {
                        Text(verbatim: "\(Int((fraction * 100).rounded()))%")
                            .font(.system(size: 11.5, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(seaAppearance ? seaAccent : TonoBrand.accent)
                    } else {
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(seaAppearance ? SeaTheme.muted : .secondary)
                            .accessibilityHidden(true)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background {
                    let shape = Capsule()
                    let isFailure: Bool = {
                        if case .failed = updater.phase { return true }
                        return false
                    }()
                    if display.reduceTransparency || display.contrast == .increased {
                        shape.fill(isFailure
                            ? (seaAppearance ? SeaTheme.opaqueAttention : Color.orange.opacity(0.22))
                            : (seaAppearance
                                ? (hovered ? Color(hex: "343139") : SeaTheme.opaqueQuiet)
                                : Color(nsColor: .controlBackgroundColor)))
                    } else {
                        shape.fill(isFailure
                            ? (seaAppearance ? SeaTheme.attention : TonoStatus.blocked).opacity(hovered ? 0.18 : 0.12)
                            : Color.white.opacity(seaAppearance || colorScheme == .dark
                                ? (hovered ? 0.12 : 0.075)
                                : (hovered ? 0.8 : 0.55)))
                    }
                }
                .overlay {
                    let isFailure: Bool = {
                        if case .failed = updater.phase { return true }
                        return false
                    }()
                    Capsule().strokeBorder(
                        isFailure
                            ? AnyShapeStyle((seaAppearance ? SeaTheme.attention : TonoStatus.blocked)
                                .opacity(display.contrast == .increased ? 0.65 : 0.32))
                            : SeaTheme.specularBorder(
                                contrast: display.contrast,
                                reduceTransparency: display.reduceTransparency,
                                topOpacity: hovered ? 0.22 : 0.14,
                                bottomOpacity: 0.04
                            ),
                        lineWidth: display.contrast == .increased ? 1 : 0.65
                    )
                }
                .contentShape(Capsule())
            }
            .buttonStyle(UpdatePillButtonStyle(reduceMotion: display.reduceMotion))
            .onHover { hovered = $0 }
            .animation(TonoMotion.hover(reduceMotion: display.reduceMotion), value: hovered)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
            .accessibilityIdentifier("menubar.updateRow")
        }
    }

    @ViewBuilder
    private var indicator: some View {
        switch updater.phase {
        case .failed:
            Circle()
                .fill(seaAppearance ? SeaTheme.attention : TonoStatus.blocked)
                .frame(width: 7, height: 7)
        case .preparing, .installing:
            ProgressView().controlSize(.mini)
        default:
            Circle()
                .fill(seaAppearance ? seaAccent : TonoBrand.accent)
                .frame(width: 7, height: 7)
        }
    }

    @ViewBuilder
    private var rowText: some View {
        switch updater.phase {
        case let .available(version, _):
            Text("Update \(version)")
                .font(.system(size: 12.5, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
                .lineLimit(1)
        case let .downloading(version, _, _):
            Text("Downloading \(version)")
                .font(.system(size: 12.5, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
                .lineLimit(1)
        case .preparing:
            Text("Verifying & preparing…")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
                .lineLimit(1)
        case .installing:
            Text("Installing & restarting…")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
                .lineLimit(1)
        case .failed:
            Text("Update needs attention")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(seaAppearance ? SeaTheme.attention : TonoStatus.blocked)
                .lineLimit(1)
        case .idle, .checking, .upToDate:
            EmptyView()
        }
    }

    private func activateMainWindow() {
        var found = false
        for window in NSApp.windows
            where window.title == "Tono"
            || window.identifier?.rawValue.contains("main") == true
        {
            window.deminiaturize(nil)
            window.makeKeyAndOrderFront(nil)
            found = true
            break
        }
        if !found {
            openWindow(id: "main")
        }
        NSApp.activate(ignoringOtherApps: true)
    }
}

struct SettingsUpdateRow: View {
    @ObservedObject var updater: AppUpdater
    var seaEnabled: Bool
    var seaAccent: Color

    init(updater: AppUpdater, seaEnabled: Bool, seaAccent: Color) {
        self.updater = updater
        self.seaEnabled = seaEnabled
        self.seaAccent = seaAccent
    }

    var body: some View {
        HStack(spacing: 12) {
            Text("Updates")
                .font(.system(size: seaEnabled ? 15 : 13, weight: seaEnabled ? .regular : .medium))
                .foregroundStyle(seaEnabled ? SeaTheme.text : Color.primary)
            Spacer(minLength: 12)
            trailingContent
        }
        .padding(.vertical, 2)
        .frame(minHeight: seaEnabled ? 44 : nil)
    }

    @ViewBuilder
    private var trailingContent: some View {
        switch updater.phase {
        case .idle:
            Button("Check for Updates") {
                updater.openOrCheckForUpdates()
            }
            .modifier(SeaActionStyle(variant: .text, size: .row, legacy: .borderless))
            .disabled(!updater.canCheckForUpdates)

        case .checking:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Checking for updates…")
                    .font(.system(size: seaEnabled ? 13 : 12))
                    .foregroundStyle(seaEnabled ? SeaTheme.muted : .secondary)
            }

        case .upToDate:
            HStack(spacing: 10) {
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(seaEnabled ? SeaTheme.good : TonoStatus.positive)
                    Text("Tono is up to date")
                        .font(.system(size: seaEnabled ? 13 : 12))
                        .foregroundStyle(seaEnabled ? SeaTheme.muted : .secondary)
                }
                Button("Check for Updates") {
                    updater.recheckForUpdates()
                }
                .modifier(SeaActionStyle(variant: .text, size: .row, legacy: .borderless))
                .disabled(!updater.canCheckForUpdates)
            }

        case let .available(version, _):
            HStack(spacing: 10) {
                Text("Update \(version)")
                    .font(.system(size: seaEnabled ? 13 : 12, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(seaEnabled ? seaAccent : TonoBrand.accent)
                Button("View Update") {
                    updater.presentPanel()
                }
                .modifier(SeaActionStyle(variant: .quiet, size: .row, legacy: .bordered))
            }

        case let .downloading(version, _, _):
            HStack(spacing: 10) {
                HStack(spacing: 6) {
                    Text("Downloading \(version)")
                        .font(.system(size: seaEnabled ? 13 : 12, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(seaEnabled ? seaAccent : TonoBrand.accent)
                    if let fraction = updater.downloadFraction {
                        Text(verbatim: "\(Int((fraction * 100).rounded()))%")
                            .font(.system(size: 12, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(seaEnabled ? SeaTheme.muted : .secondary)
                    }
                }
                Button("View Update") {
                    updater.presentPanel()
                }
                .modifier(SeaActionStyle(variant: .quiet, size: .row, legacy: .bordered))
            }

        case .preparing:
            HStack(spacing: 10) {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("Verifying & preparing…")
                        .font(.system(size: seaEnabled ? 13 : 12))
                        .foregroundStyle(seaEnabled ? SeaTheme.muted : .secondary)
                }
                Button("View Update") {
                    updater.presentPanel()
                }
                .modifier(SeaActionStyle(variant: .quiet, size: .row, legacy: .bordered))
            }

        case .installing:
            HStack(spacing: 10) {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("Installing & restarting…")
                        .font(.system(size: seaEnabled ? 13 : 12))
                        .foregroundStyle(seaEnabled ? SeaTheme.muted : .secondary)
                }
                Button("View Update") {
                    updater.presentPanel()
                }
                .modifier(SeaActionStyle(variant: .quiet, size: .row, legacy: .bordered))
            }

        case .failed:
            HStack(spacing: 10) {
                Text("Update needs attention")
                    .font(.system(size: seaEnabled ? 13 : 12, weight: .medium))
                    .foregroundStyle(seaEnabled ? SeaTheme.attention : TonoStatus.blocked)
                Button("View Update") {
                    updater.presentPanel()
                }
                .modifier(SeaActionStyle(variant: .quiet, size: .row, legacy: .bordered))
            }
        }
    }
}

struct UpdatePanelSheet: View {
    @ObservedObject var updater: AppUpdater
    @Environment(\.seaAccent) private var seaAccent
    @SeaAppearancePreference private var seaAppearance
    @SeaDisplayPreferences private var display
    @State private var showFailureDetails = false

    init(updater: AppUpdater) {
        self.updater = updater
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            headerSection

            if showsReleaseNotesBar {
                releaseNotesBar
            }

            bodySection

            footerDivider

            footerActions
        }
        .padding(24)
        .frame(width: 440, alignment: .leading)
        .background { sheetBackground }
        .overlay {
            if seaAppearance {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(
                        SeaTheme.specularBorder(
                            contrast: display.contrast,
                            reduceTransparency: display.reduceTransparency,
                            topOpacity: 0.18,
                            bottomOpacity: 0.05
                        ),
                        lineWidth: display.contrast == .increased ? 1 : 0.75
                    )
            }
        }
        .modifier(SeaPageAppearance())
        .interactiveDismissDisabled(updater.isInstalling)
        .onChange(of: updater.phase) { _, newPhase in
            if case .failed = newPhase {
                return
            }
            showFailureDetails = false
        }
    }

    private var targetVersion: String? {
        switch updater.phase {
        case let .available(version, _),
             let .downloading(version, _, _),
             let .preparing(version),
             let .installing(version):
            return version
        case let .failed(version, _, _, _):
            return version
        case .idle, .checking, .upToDate:
            return nil
        }
    }

    private var showsReleaseNotesBar: Bool {
        switch updater.phase {
        case .available, .upToDate, .failed:
            return true
        case .idle, .checking, .downloading, .preparing, .installing:
            return false
        }
    }

    private var headerSection: some View {
        HStack(alignment: .center, spacing: 12) {
            TonoLogo(compact: true)
                .frame(width: 36, height: 36)

            VStack(alignment: .leading, spacing: 3) {
                headerTitle
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
                    .fixedSize(horizontal: false, vertical: true)

                Text("Current version \(updater.currentVersion)")
                    .font(.system(size: 12))
                    .monospacedDigit()
                    .foregroundStyle(seaAppearance ? SeaTheme.muted : .secondary)
            }

            Spacer(minLength: 8)

            if let targetVersion {
                Text(verbatim: "v\(updater.currentVersion) → v\(targetVersion)")
                    .font(.system(size: 11.5, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(seaAppearance ? seaAccent : TonoBrand.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(
                        display.reduceTransparency
                            ? SeaTheme.opaqueQuiet
                            : Color.white.opacity(seaAppearance ? 0.08 : 0.14),
                        in: Capsule()
                    )
                    .overlay {
                        Capsule().strokeBorder(
                            (seaAppearance ? seaAccent : TonoBrand.accent)
                                .opacity(display.contrast == .increased ? 0.55 : 0.25),
                            lineWidth: display.contrast == .increased ? 1 : 0.65
                        )
                    }
            }
        }
    }

    @ViewBuilder
    private var headerTitle: some View {
        switch updater.phase {
        case .idle, .checking:
            Text("Checking for updates…")
        case .upToDate:
            Text("Tono is up to date")
        case .available:
            Text("Update available")
        case let .downloading(version, _, _):
            Text("Downloading \(version)")
        case .preparing:
            Text("Verifying & preparing…")
        case .installing:
            Text("Installing & restarting…")
        case .failed:
            Text("Update needs attention")
        }
    }

    private var releaseNotesBar: some View {
        HStack(spacing: 12) {
            Button {
                NSWorkspace.shared.open(UpdateReleaseLinks.releaseNotesURL)
            } label: {
                HStack(spacing: 4) {
                    Text("Release notes")
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 10.5, weight: .semibold))
                }
            }
            .modifier(SeaActionStyle(variant: .text, size: .row, legacy: .link))

            Spacer()

            if case .available = updater.phase {
                Button {
                    updater.recheckForUpdates()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 11, weight: .medium))
                        Text("Refresh")
                    }
                }
                .modifier(SeaActionStyle(variant: .text, size: .row, legacy: .borderless))
                .disabled(!updater.canCheckForUpdates)
            }
        }
    }

    @ViewBuilder
    private var bodySection: some View {
        switch updater.phase {
        case .idle, .checking:
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text("Checking for updates…")
                    .font(.system(size: 13))
                    .foregroundStyle(seaAppearance ? SeaTheme.muted : .secondary)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background { cardBackground(tint: nil) }

        case .upToDate:
            HStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(seaAppearance ? SeaTheme.good : TonoStatus.positive)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tono is up to date")
                        .font(.system(size: 13.5, weight: .medium))
                        .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
                    Text("The signed release is not newer than this installation.")
                        .font(.system(size: 12))
                        .foregroundStyle(seaAppearance ? SeaTheme.muted : .secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background { cardBackground(tint: nil) }

        case let .available(_, packageSize):
            VStack(alignment: .leading, spacing: 14) {
                stepIndicator(activeStep: 0, completedSteps: [])
                assuranceBox(packageSize: packageSize)
            }

        case let .downloading(_, received, total):
            VStack(alignment: .leading, spacing: 14) {
                stepIndicator(activeStep: 0, completedSteps: [])
                progressBox(received: received, total: total)
                assuranceBox(packageSize: nil)
            }

        case .preparing:
            VStack(alignment: .leading, spacing: 14) {
                stepIndicator(activeStep: 1, completedSteps: [0])
                statusCard(
                    title: "Verifying & preparing…",
                    spinner: true
                )
                assuranceBox(packageSize: nil)
            }

        case .installing:
            VStack(alignment: .leading, spacing: 14) {
                stepIndicator(activeStep: 2, completedSteps: [0, 1])
                statusCard(
                    title: "Installing & restarting…",
                    spinner: true
                )
                assuranceBox(packageSize: nil)
            }

        case let .failed(_, message, detail, retryable):
            failureCard(message: message, detail: detail, retryable: retryable)
        }
    }

    private func stepIndicator(activeStep: Int, completedSteps: Set<Int>) -> some View {
        let steps: [(Int, LocalizedStringKey)] = [
            (0, "Download"),
            (1, "Verify"),
            (2, "Restart"),
        ]
        return HStack(spacing: 8) {
            ForEach(steps, id: \.0) { index, title in
                let isDone = completedSteps.contains(index)
                let isActive = activeStep == index
                HStack(spacing: 6) {
                    ZStack {
                        Circle()
                            .fill(stepBadgeFill(isDone: isDone, isActive: isActive))
                            .frame(width: 20, height: 20)
                        if isDone {
                            Image(systemName: "checkmark")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(seaAppearance ? SeaTheme.ink : .white)
                        } else {
                            Text(verbatim: "\(index + 1)")
                                .font(.system(size: 10.5, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(isActive
                                    ? (seaAppearance ? SeaTheme.ink : .white)
                                    : (seaAppearance ? SeaTheme.muted : .secondary))
                        }
                    }
                    Text(title)
                        .font(.system(size: 12, weight: isActive || isDone ? .semibold : .regular))
                        .foregroundStyle(isActive || isDone
                            ? (seaAppearance ? SeaTheme.text : .primary)
                            : (seaAppearance ? SeaTheme.tertiary : .secondary))
                }
                if index < steps.count - 1 {
                    Rectangle()
                        .fill(isDone
                            ? (seaAppearance ? seaAccent.opacity(0.6) : TonoBrand.accent.opacity(0.6))
                            : Color.white.opacity(display.contrast == .increased ? 0.35 : 0.10))
                        .frame(height: 1)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background { cardBackground(tint: nil) }
    }

    private func stepBadgeFill(isDone: Bool, isActive: Bool) -> AnyShapeStyle {
        if isDone {
            return seaAppearance ? AnyShapeStyle(SeaTheme.good) : AnyShapeStyle(TonoStatus.positive)
        }
        if isActive {
            return seaAppearance ? AnyShapeStyle(SeaTheme.primaryGradient) : AnyShapeStyle(TonoBrand.accent)
        }
        return AnyShapeStyle(display.reduceTransparency
            ? SeaTheme.opaqueTrack
            : Color.white.opacity(seaAppearance ? 0.10 : 0.16))
    }

    private func progressBox(received: Int64, total: Int64) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Downloading update…")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
                Spacer()
                if let fraction = updater.downloadFraction {
                    Text(verbatim: "\(Int((fraction * 100).rounded()))%")
                        .font(.system(size: 12.5, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(seaAppearance ? seaAccent : TonoBrand.accent)
                }
            }

            if let fraction = updater.downloadFraction {
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(display.reduceTransparency
                                ? SeaTheme.opaqueTrack
                                : Color.white.opacity(seaAppearance ? 0.11 : 0.2))
                        Capsule()
                            .fill(seaAppearance
                                ? AnyShapeStyle(SeaTheme.primaryGradient)
                                : AnyShapeStyle(TonoBrand.accent))
                            .frame(width: min(proxy.size.width, max(fraction > 0 ? 6 : 0, proxy.size.width * fraction)))
                            .animation(TonoMotion.numeric(reduceMotion: display.reduceMotion), value: fraction)
                    }
                }
                .frame(height: 6)
            } else {
                ProgressView()
                    .progressViewStyle(.linear)
            }

            HStack {
                if total > 0 {
                    Text(verbatim: "\(UpdateReleaseLinks.formattedBytes(received)) / \(UpdateReleaseLinks.formattedBytes(total))")
                } else {
                    Text(verbatim: UpdateReleaseLinks.formattedBytes(received))
                }
                Spacer()
            }
            .font(.system(size: 11.5))
            .monospacedDigit()
            .foregroundStyle(seaAppearance ? SeaTheme.muted : .secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { cardBackground(tint: nil) }
    }

    private func statusCard(title: LocalizedStringKey, spinner: Bool) -> some View {
        HStack(spacing: 10) {
            if spinner {
                ProgressView().controlSize(.small)
            }
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { cardBackground(tint: nil) }
    }

    private func assuranceBox(packageSize: Int64?) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "checkmark.shield.fill")
                .font(.system(size: 14))
                .foregroundStyle(seaAppearance ? SeaTheme.good : TonoStatus.positive)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 4) {
                Text("Signed update verified by Tono Helper. Your network protection stays active until restart.")
                    .font(.system(size: 12))
                    .foregroundStyle(seaAppearance ? SeaTheme.muted : .secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let packageSize, packageSize > 0 {
                    Text(verbatim: UpdateReleaseLinks.formattedBytes(packageSize))
                        .font(.system(size: 11.5, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(seaAppearance ? SeaTheme.tertiary : .secondary)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { cardBackground(tint: nil) }
    }

    private func failureCard(message: String, detail: String?, retryable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 15))
                    .foregroundStyle(seaAppearance ? SeaTheme.attention : TonoStatus.blocked)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 6) {
                    Text(message)
                        .font(.system(size: 13))
                        .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
                        .fixedSize(horizontal: false, vertical: true)

                    if retryable {
                        Text("Disconnect and Retry restores Internet access before retiring this attempt. Failed update evidence will be retained.")
                            .font(.system(size: 12))
                            .foregroundStyle(seaAppearance ? SeaTheme.muted : .secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            if let detail, !detail.isEmpty {
                Button {
                    withAnimation(TonoMotion.stateChange(reduceMotion: display.reduceMotion)) {
                        showFailureDetails.toggle()
                    }
                } label: {
                    HStack(spacing: 6) {
                        SeaChevron(expanded: showFailureDetails)
                        Text(showFailureDetails ? LocalizedStringKey("Hide details") : LocalizedStringKey("Show details"))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(seaAppearance ? SeaTheme.muted : .secondary)
                    }
                }
                .buttonStyle(.plain)

                if showFailureDetails {
                    ScrollView {
                        Text(detail)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(seaAppearance ? SeaTheme.muted : .secondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxHeight: 110)
                    .padding(10)
                    .background(
                        display.reduceTransparency
                            ? SeaTheme.opaqueTrack
                            : Color.black.opacity(seaAppearance ? 0.28 : 0.08),
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                    )
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            cardBackground(tint: seaAppearance ? SeaTheme.attention : TonoStatus.blocked)
        }
    }

    private var footerDivider: some View {
        Rectangle()
            .fill(Color.white.opacity(display.contrast == .increased ? 0.30 : 0.08))
            .frame(height: 0.75)
    }

    @ViewBuilder
    private var footerActions: some View {
        HStack(spacing: 10) {
            switch updater.phase {
            case .idle, .checking:
                Spacer()
                Button("Later") {
                    updater.dismissPanel()
                }
                .modifier(SeaActionStyle(variant: .quiet, size: .row, legacy: .bordered))
                .keyboardShortcut(.cancelAction)

            case .upToDate:
                Button("Check for Updates") {
                    updater.recheckForUpdates()
                }
                .modifier(SeaActionStyle(variant: .quiet, size: .row, legacy: .bordered))
                .disabled(!updater.canCheckForUpdates)

                Spacer()

                Button("Close") {
                    updater.dismissPanel()
                }
                .modifier(SeaActionStyle(variant: .primary, size: .row, legacy: .prominent))
                .keyboardShortcut(.cancelAction)

            case .available:
                Button("Later") {
                    updater.dismissPanel()
                }
                .modifier(SeaActionStyle(variant: .quiet, size: .row, legacy: .bordered))
                .keyboardShortcut(.cancelAction)

                Spacer()

                Button("Update & Restart") {
                    updater.installAvailableUpdate()
                }
                .modifier(SeaActionStyle(variant: .primary, size: .row, legacy: .prominent))
                .keyboardShortcut(.defaultAction)

            case .downloading:
                Button("Later") {
                    updater.dismissPanel()
                }
                .modifier(SeaActionStyle(variant: .quiet, size: .row, legacy: .bordered))
                .keyboardShortcut(.cancelAction)

                Spacer()

                Button("Cancel") {
                    updater.cancelDownload()
                }
                .modifier(SeaActionStyle(variant: .danger, size: .row, legacy: .bordered))

            case .preparing:
                Spacer()
                Button("Later") {
                    updater.dismissPanel()
                }
                .modifier(SeaActionStyle(variant: .quiet, size: .row, legacy: .bordered))
                .keyboardShortcut(.cancelAction)

            case .installing:
                Spacer()

            case let .failed(_, _, _, retryable):
                if retryable {
                    Button("Keep Protection") {
                        updater.dismissPanel()
                    }
                    .modifier(SeaActionStyle(variant: .quiet, size: .row, legacy: .bordered))
                    .keyboardShortcut(.cancelAction)

                    Spacer()

                    Button("Disconnect and Retry") {
                        updater.retryAfterDisconnect()
                    }
                    .modifier(SeaActionStyle(variant: .primary, size: .row, legacy: .prominent))
                } else {
                    Button("Later") {
                        updater.dismissPanel()
                    }
                    .modifier(SeaActionStyle(variant: .quiet, size: .row, legacy: .bordered))
                    .keyboardShortcut(.cancelAction)

                    Spacer()

                    if updater.hasCachedOffer {
                        Button("Retry Download") {
                            updater.installAvailableUpdate()
                        }
                        .modifier(SeaActionStyle(variant: .primary, size: .row, legacy: .prominent))
                        .keyboardShortcut(.defaultAction)
                    } else {
                        Button("Check for Updates") {
                            updater.recheckForUpdates()
                        }
                        .modifier(SeaActionStyle(variant: .primary, size: .row, legacy: .prominent))
                        .keyboardShortcut(.defaultAction)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var sheetBackground: some View {
        if seaAppearance {
            if display.reduceTransparency || display.contrast == .increased {
                SeaTheme.opaquePanel
            } else {
                ZStack {
                    SeaSecondaryScene()
                    Rectangle().fill(.ultraThinMaterial).opacity(0.45)
                }
            }
        } else {
            Rectangle().fill(.regularMaterial)
        }
    }

    @ViewBuilder
    private func cardBackground(tint: Color?) -> some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        if display.reduceTransparency || display.contrast == .increased {
            shape.fill(tint != nil ? SeaTheme.opaqueAttention : SeaTheme.opaqueQuiet)
                .overlay {
                    shape.strokeBorder(
                        (tint ?? Color.white).opacity(display.contrast == .increased ? 0.50 : 0.16),
                        lineWidth: display.contrast == .increased ? 1 : 0.75
                    )
                }
        } else {
            let borderStyle: AnyShapeStyle = if let tint {
                AnyShapeStyle(tint.opacity(0.32))
            } else {
                SeaTheme.specularBorder(
                    contrast: display.contrast,
                    reduceTransparency: display.reduceTransparency,
                    topOpacity: 0.15,
                    bottomOpacity: 0.04
                )
            }
            shape.fill(tint?.opacity(0.11) ?? Color.white.opacity(seaAppearance ? 0.06 : 0.25))
                .overlay {
                    shape.strokeBorder(borderStyle, lineWidth: 0.75)
                }
        }
    }
}

private struct UpdatePillButtonStyle: ButtonStyle {
    let reduceMotion: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(SeaHomePresentation.pressScale(pressed: configuration.isPressed, reduceMotion: reduceMotion))
            .animation(TonoMotion.tactileSpring(reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}
