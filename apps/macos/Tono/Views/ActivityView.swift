import SwiftUI
import AppKit

/// Resolves a client process name to the owning application's real icon.
///
/// Mihomo reports the executable name only, so the icon is recovered by
/// matching against currently running applications. A process that has already
/// exited, or a helper with no bundle, resolves to nil exactly once and is then
/// cached — the connection list re-renders on every traffic tick and must never
/// re-walk the process table per row.
@MainActor
private enum ClientAppIconCache {
    private static var cache: [String: NSImage?] = [:]

    static func icon(for processName: String) -> NSImage? {
        if let cached = cache[processName] { return cached }
        var resolved: NSImage?
        for app in NSWorkspace.shared.runningApplications {
            let executable = app.executableURL?.lastPathComponent
            guard executable == processName
                    || app.localizedName == processName else { continue }
            if let bundleURL = app.bundleURL {
                resolved = NSWorkspace.shared.icon(forFile: bundleURL.path)
            }
            break
        }
        cache[processName] = resolved
        return resolved
    }
}

private struct ClientAppIcon: View {
    let processName: String?

    var body: some View {
        ZStack {
            if let processName, let icon = ClientAppIconCache.icon(for: processName) {
                Image(nsImage: icon)
                    .resizable()
                    .frame(width: 22, height: 22)
            } else {
                Image(systemName: processName == nil ? "globe" : "app.dashed")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 22, height: 22)
            }
        }
        .frame(width: 22, height: 22)
        .help(processName ?? "")
    }
}

struct ActivityView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.colorScheme) private var colorScheme
    @State private var selectedFilter: String = "All"

    private let filters = ["All", "Proxied", "Direct", "Rejected"]

    private var filteredConnections: [ConnectionEntry] {
        if selectedFilter == "All" { return appState.connections }
        return appState.connections.filter { $0.type.rawValue == selectedFilter }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerRow
                .padding(.bottom, 24)

            // Timeline logs
            ScrollView {
                ZStack(alignment: .leading) {
                    // Timeline line
                    timelineLine

                    // Log entries
                    VStack(spacing: 14) {
                        ForEach(filteredConnections) { entry in
                            LogEntryRow(entry: entry) {
                                Task { await appState.closeConnection(entry.id) }
                            }
                        }
                    }
                    .padding(.leading, 32)
                }
            }
            .scrollIndicators(.hidden)
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 16)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: - Timeline Line

    private var timelineLine: some View {
        LinearGradient(
            colors: [Color(hex: "4B6EFF"), .secondary.opacity(0.3)],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(width: 2)
        .padding(.leading, 10)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    // MARK: - Header

    private var headerRow: some View {
        HStack(alignment: .center) {
            Text("Connections")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.primary)

            Spacer()

            HStack(spacing: 14) {
                // Filter pills
                HStack(spacing: 6) {
                    ForEach(filters, id: \.self) { filter in
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                selectedFilter = filter
                            }
                        } label: {
                            Text(LocalizedStringKey(filter))
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(selectedFilter == filter ? .white : .secondary)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 6)
                                .background(
                                    selectedFilter == filter
                                        ? Color(hex: "4B6EFF")
                                        : .white.opacity(colorScheme == .dark ? 0.08 : 0.4),
                                    in: Capsule()
                                )
                                .overlay(
                                    Capsule().strokeBorder(
                                        selectedFilter == filter ? .clear : .white.opacity(colorScheme == .dark ? 0.12 : 0.7),
                                        lineWidth: 0.5
                                    )
                                )
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }

                // Close All button
                if !appState.connections.isEmpty {
                    Button {
                        Task { await appState.closeAllConnections() }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "xmark.circle")
                                .font(.system(size: 11))
                            Text("Close All")
                                .font(.system(size: 12, weight: .medium))
                        }
                        .foregroundStyle(Color(hex: "FF6E52"))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.4), in: Capsule())
                        .overlay(Capsule().strokeBorder(Color(hex: "FF6E52").opacity(0.3), lineWidth: 0.5))
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

// MARK: - Log Entry Row

private struct LogEntryRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let entry: ConnectionEntry
    var onClose: (() -> Void)?
    @State private var isHovered = false

    private var dotColor: Color {
        switch entry.type {
        case .proxied:  return Color(hex: "4B6EFF")
        case .direct:   return Color(hex: "FF6E52")
        case .rejected: return Color(hex: "333333")
        }
    }

    @ViewBuilder
    private func directionRow(
        symbol: String,
        value: String,
        tint: Color
    ) -> some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(tint)
            Text(value.isEmpty ? "0 B" : value)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(.primary)
        }
    }

    private var latencyStyle: (fg: String, bg: String) {
        guard let ms = entry.latency else { return ("A2A3C4", "000000") }
        if ms <= 80 { return ("10B981", "10B981") }
        if ms <= 200 { return ("F59E0B", "F59E0B") }
        return ("EF4444", "EF4444")
    }

    var body: some View {
        HStack(spacing: 0) {
            // Timeline dot
            Circle()
                .fill(.white)
                .frame(width: 10, height: 10)
                .overlay(Circle().strokeBorder(dotColor, lineWidth: 2))
                .shadow(color: dotColor.opacity(0.4), radius: 4)
                .offset(x: -26)

            // Card content
            HStack(spacing: 16) {
                // Client app icon. The process is the identity a user actually
                // recognises — the host is secondary detail.
                ClientAppIcon(processName: entry.processName)

                // Client process + destination host
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        if let processName = entry.processName {
                            Text(processName)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                                .layoutPriority(1)
                            Text(entry.domain)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        } else {
                            Text(entry.domain)
                                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }

                    // Routing policy is deliberately not surfaced here: Tono
                    // decides it and the user never configures it, so naming
                    // the matched rule would only invite questions about
                    // settings that do not exist.
                    Text(
                        [
                            entry.network.isEmpty ? entry.protocolName : entry.network,
                            entry.destination,
                        ]
                        .filter { !$0.isEmpty }
                        .joined(separator: " • ")
                    )
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                // Node
                HStack(spacing: 6) {
                    Text(entry.nodeFlag)
                        .font(.system(size: 14))
                    Text(ProxyNode.displayName(for: entry.nodeName))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(width: 160, alignment: .leading)
                .help(entry.route.isEmpty ? entry.nodeName : entry.route)

                // Latency
                if let ms = entry.latency {
                    Text("\(ms)ms")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color(hex: latencyStyle.fg))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color(hex: latencyStyle.bg).opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                        .frame(width: 80)
                } else {
                    Text("- -")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))
                        .frame(width: 80)
                }

                // Stats: two directions, or the combined total when a source
                // has not filled the split counters in.
                VStack(alignment: .trailing, spacing: 2) {
                    if entry.downloadText.isEmpty, entry.uploadText.isEmpty {
                        Text(entry.dataSize)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.primary)
                        Text(entry.dataLabel)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    } else {
                        directionRow(
                            symbol: "arrow.down",
                            value: entry.downloadText,
                            tint: Color(hex: "10B981")
                        )
                        directionRow(
                            symbol: "arrow.up",
                            value: entry.uploadText,
                            tint: Color(hex: "4B6EFF")
                        )
                    }
                }
                .frame(width: 88, alignment: .trailing)

                // Close button
                Button {
                    onClose?()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 24, height: 24)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .opacity(isHovered ? 1 : 0)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
        }
        .background(
            isHovered
                ? .white.opacity(colorScheme == .dark ? 0.15 : 0.9)
                : .white.opacity(colorScheme == .dark ? 0.08 : 0.4),
            in: RoundedRectangle(cornerRadius: 18)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .strokeBorder(.white.opacity(colorScheme == .dark ? 0.12 : 0.7), lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.15)) {
                isHovered = hovering
            }
        }
    }
}

#Preview {
    ZStack {
        MeshGradientBackground()
        ActivityView()
    }
    .frame(width: 900, height: 600)
    .environment({
        let state = AppState()
        state.loadMockData()
        return state
    }())
}
