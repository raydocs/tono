import SwiftUI

/// Brand ramp shared by the route mark and the selected-state hairline.
/// Matches the Windows tokens in `tono-ui/theme.ts` (accent → soft → warm,
/// the blue-to-peach sweep of the TO monogram).
enum TonoBrand {
    static let accent = Color(hex: "4B6EFF")
    static let accentSoft = Color(hex: "7B5CFF")
    static let accentWarm = Color(hex: "FFB07A")

    static var routeGradient: LinearGradient {
        LinearGradient(
            colors: [accent, accentSoft, accentWarm],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

/// Semantic status ramp shared across the app. Mirrors TONO_COLORS in the
/// Windows tono-ui/theme.ts. Connection green (2ED573) and latency green
/// (30D158) are deliberately distinct.
enum TonoStatus {
    static let connected = Color(hex: "2ED573")
    static let positive = Color(hex: "30D158")   // latency good / success chips
    static let connecting = Color(hex: "FFD60A")
    static let blocked = Color(hex: "FF9F0A")    // protected offline / degraded
    static let error = Color(hex: "FF453A")
    static let neutral = Color.secondary          // standby / not tested
    /// Concrete gray for fills and gradients (`Color.secondary` is dynamic).
    static let standby = Color(hex: "98989D")
}

/// Traffic-direction colours shared by the chart, the Activity header rates
/// and each connection row, so upload/download always read the same.
enum TonoTraffic {
    static let download = TonoStatus.connected
    static let upload = Color(hex: "64D2FF")
}

enum TonoMotion {
    static func easeOut(_ duration: Double, reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .easeOut(duration: duration)
    }
}

/// Compact region code for the card meta line. Flags are no longer drawn;
/// the region survives as quiet text next to the protocol chip. A flag emoji
/// decodes to its ISO letters (🇺🇸 → "US"), otherwise a known region token in
/// the wire name wins, then the city of the display name, then two-letter
/// initials. Keep the maps aligned with `nodeCode` in the Windows
/// `pages/tono/node-meta.ts`.
func nodeRegionCode(flag: String, name: String) -> String {
    let indicators = flag.unicodeScalars.filter { (0x1F1E6...0x1F1FF).contains($0.value) }
    if indicators.count == 2 {
        let letters = indicators.compactMap {
            Unicode.Scalar($0.value - 0x1F1E6 + 0x41).map(Character.init)
        }
        return String(letters)
    }

    let knownCodes: Set<String> = [
        "US", "JP", "SG", "HK", "TW", "CN", "KR", "GB",
        "DE", "FR", "CA", "AU", "IN", "RU", "BR", "NL",
    ]
    let tokens = name.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
    if let token = tokens.map({ $0.uppercased() }).first(where: knownCodes.contains) {
        return token
    }

    let displayName = ProxyNode.displayName(for: name)
    let cityCodes: [String: String] = [
        "los angeles": "US", "salt lake city": "US", "buffalo": "US",
        "new york": "US", "san jose": "US", "seattle": "US",
        "chicago": "US", "dallas": "US", "miami": "US",
        "tokyo": "JP", "osaka": "JP",
    ]
    let city = displayName.split(separator: "·")[0]
        .trimmingCharacters(in: .whitespaces)
        .lowercased()
    if let cityCode = cityCodes[city] {
        return cityCode
    }

    let words = displayName.split(whereSeparator: { !$0.isLetter })
    if words.count >= 2 {
        return String(words.prefix(2).compactMap(\.first)).uppercased()
    }
    if let word = words.first {
        return String(word.prefix(2)).uppercased()
    }
    return "GL"
}

/// A source node fanning out to two exits, drawn on a 24×24 grid. Stroked as
/// hairlines so the brand gradient reads as a network trace rather than a
/// filled color block. Same glyph as the Windows `TonoNodeBadge` SVG.
struct NodeRouteGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let unit = min(rect.width, rect.height) / 24
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(
                x: rect.midX + (x - 12) * unit,
                y: rect.midY + (y - 12) * unit
            )
        }
        func circle(_ cx: CGFloat, _ cy: CGFloat, radius r: CGFloat) -> Path {
            Path(ellipseIn: CGRect(
                x: rect.midX + (cx - r - 12) * unit,
                y: rect.midY + (cy - r - 12) * unit,
                width: 2 * r * unit,
                height: 2 * r * unit
            ))
        }

        var path = Path()
        path.addPath(circle(12, 5, radius: 2.1))
        path.addPath(circle(6, 18, radius: 2.1))
        path.addPath(circle(18, 18, radius: 2.1))
        path.move(to: point(10.7, 6.6))
        path.addLine(to: point(7.2, 15.9))
        path.move(to: point(13.3, 6.6))
        path.addLine(to: point(16.8, 15.9))
        path.move(to: point(8.1, 18))
        path.addLine(to: point(15.9, 18))
        return path
    }
}

/// The node identity mark: a neutral glass tile carrying the brand route
/// glyph. Identity comes from the Tono brand language (gradient trace), not
/// from flags or per-region color blocks; the tile itself stays neutral so it
/// sits quietly in both light and dark mode.
struct NodeRouteMark: View {
    @Environment(\.colorScheme) private var colorScheme
    var size: CGFloat = 44

    var body: some View {
        NodeRouteGlyph()
            .stroke(
                TonoBrand.routeGradient,
                style: StrokeStyle(
                    lineWidth: max(1.0, size * 0.042),
                    lineCap: .round,
                    lineJoin: .round
                )
            )
            .padding(size * 0.26)
            .frame(width: size, height: size)
            .background(
                .primary.opacity(colorScheme == .dark ? 0.07 : 0.045),
                in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                    .strokeBorder(
                        .primary.opacity(colorScheme == .dark ? 0.13 : 0.10),
                        lineWidth: 0.7
                    )
            }
            .accessibilityHidden(true)
    }
}

/// Shared card surface for the server cards (grid card and custom-region
/// card): neutral glass, a hairline border, a hover lift, and — when active —
/// a restrained accent tint, accent border, and the brand hairline across the
/// top edge. Keeps every state legible without loud fills.
struct NodeCardSurface<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var isActive: Bool = false
    var isDisabled: Bool = false
    @ViewBuilder var content: () -> Content

    @State private var isHovering = false

    var body: some View {
        content()
            .padding(15)
            .frame(maxWidth: .infinity, minHeight: 122, alignment: .leading)
            .background(
                isActive
                    ? TonoBrand.accent.opacity(colorScheme == .dark ? 0.13 : 0.08)
                    : .white.opacity(colorScheme == .dark
                        ? (isHovering ? 0.10 : 0.07)
                        : (isHovering ? 0.66 : 0.58)),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(
                        isActive
                            ? LinearGradient(
                                colors: [
                                    TonoBrand.accent.opacity(0.6),
                                    TonoBrand.accent.opacity(0.35),
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                            : LinearGradient(
                                colors: [
                                    .white.opacity(colorScheme == .dark ? 0.16 : 0.72),
                                    .white.opacity(colorScheme == .dark ? 0.06 : 0.34),
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                        lineWidth: isActive ? 1.1 : 0.7
                    )
            }
            .overlay(alignment: .top) {
                if isActive {
                    Capsule()
                        .fill(TonoBrand.routeGradient)
                        .frame(height: 2)
                        .padding(.horizontal, 18)
                        .allowsHitTesting(false)
                }
            }
            .glassEffect(
                .regular.tint(isActive
                    ? TonoBrand.accent.opacity(0.06)
                    : .white.opacity(0.035)),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .shadow(
                color: isActive ? TonoBrand.accent.opacity(0.16) : .black.opacity(0.04),
                radius: isActive ? 14 : 7,
                y: isActive ? 6 : 3
            )
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .opacity(isDisabled ? 0.55 : 1)
            .animation(TonoMotion.easeOut(0.15, reduceMotion: reduceMotion), value: isHovering)
            .animation(TonoMotion.easeOut(0.2, reduceMotion: reduceMotion), value: isActive)
            .onHover { isHovering = $0 }
    }
}

struct NodeLatencyBadge: View {
    let latency: Int
    var didFail: Bool = false

    private var tint: Color {
        if didFail { return TonoStatus.error }
        if latency <= 0 { return TonoStatus.neutral }
        return Color(hex: LatencyLevel.level(for: latency).color)
    }

    private var title: String {
        if didFail { return String(localized: "Timeout") }
        if latency > 0 { return "\(latency) ms" }
        return String(localized: "Not tested")
    }

    private var detail: String? {
        if didFail { return String(localized: "Unavailable") }
        guard latency > 0 else { return nil }
        switch LatencyLevel.level(for: latency) {
        case .low: return String(localized: "Good")
        case .mid: return String(localized: "Slow")
        case .high: return String(localized: "Poor")
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(tint)
                .frame(width: 6, height: 6)
                .shadow(color: tint.opacity(0.45), radius: 3)

            VStack(alignment: .trailing, spacing: 1) {
                Text(title)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(tint)
                if let detail {
                    Text(detail)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(tint.opacity(0.10), in: Capsule())
        .overlay {
            Capsule().strokeBorder(tint.opacity(0.18), lineWidth: 0.7)
        }
        .fixedSize()
    }
}

struct NodeCardView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let node: ProxyNode
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            NodeCardSurface(isActive: isSelected) {
                VStack(alignment: .leading, spacing: 13) {
                    HStack(alignment: .top, spacing: 11) {
                        NodeRouteMark()

                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 7) {
                                Text(node.displayName)
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)

                                if isSelected {
                                    Text("ACTIVE")
                                        .font(.system(size: 8, weight: .bold, design: .rounded))
                                        .kerning(0.7)
                                        .foregroundStyle(TonoStatus.positive)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 3)
                                        .background(TonoStatus.positive.opacity(0.12), in: Capsule())
                                }
                            }

                            HStack(spacing: 6) {
                                nodeMetaChip(node.protocolType.uppercased(), systemImage: "lock.fill")
                                Label(
                                    nodeRegionCode(flag: node.flag, name: node.name),
                                    systemImage: "globe"
                                )
                                .font(.system(size: 10, weight: .semibold, design: .rounded))
                                .foregroundStyle(.secondary)
                                if !node.relay.isEmpty {
                                    Text(node.relay)
                                        .font(.system(size: 10, weight: .medium))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                        }

                        Spacer(minLength: 0)
                        NodeLatencyBadge(latency: node.latency)
                    }

                    // The ACTIVE chip and the accent surface already say
                    // "selected" — the footer only exists to invite selection.
                    if !isSelected {
                        HStack(spacing: 7) {
                            Image(systemName: "circle.dotted")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.secondary)
                            Text("Select to use this server")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(.secondary)
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .animation(TonoMotion.easeOut(0.2, reduceMotion: reduceMotion), value: isSelected)
        .accessibilityLabel(accessibilitySummary)
    }

    private var accessibilitySummary: String {
        var parts = [
            node.displayName,
            nodeRegionCode(flag: node.flag, name: node.name),
            node.protocolType,
        ]
        if node.latency > 0 { parts.append(String(localized: "\(node.latency) milliseconds")) }
        if isSelected { parts.append(String(localized: "active")) }
        return parts.joined(separator: ", ")
    }

    @ViewBuilder
    private func nodeMetaChip(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.system(size: 9, weight: .semibold, design: .rounded))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.42), in: Capsule())
    }
}

#Preview {
    ZStack {
        MeshGradientBackground()
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            NodeCardView(
                node: mockProxyRegions[0].nodes[0],
                isSelected: true,
                onTap: {}
            )
            NodeCardView(
                node: mockProxyRegions[0].nodes[1],
                isSelected: false,
                onTap: {}
            )
        }
        .padding(32)
    }
    .frame(width: 700, height: 300)
}
