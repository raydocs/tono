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

// MARK: - City glyphs

/// Landmark strokes per exit city — palm for Los Angeles, torii for Tokyo,
/// castle keep for Osaka — all drawn on the same 24×24 grid and stroked with
/// the brand gradient, so identity varies while the language stays one.

/// Palm tree (Los Angeles and, for now, other US beach/west cities).
struct PalmGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let u = min(rect.width, rect.height) / 24
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.midX + (x - 12) * u, y: rect.midY + (y - 12) * u)
        }
        var path = Path()
        // Trunk with a slight sway
        path.move(to: p(12, 21))
        path.addCurve(to: p(12, 11), control1: p(12.5, 18), control2: p(12.5, 14))
        // Fountain of open fronds — single strokes, no doubling back, so the
        // silhouette stays readable at badge size.
        path.move(to: p(12, 11))
        path.addCurve(to: p(5.6, 12.6), control1: p(10.2, 10.6), control2: p(7.4, 11.2))
        path.move(to: p(12, 11))
        path.addCurve(to: p(18.4, 12.6), control1: p(13.8, 10.6), control2: p(16.6, 11.2))
        path.move(to: p(12, 11))
        path.addCurve(to: p(5.8, 7.2), control1: p(10.4, 9.4), control2: p(8.2, 7.8))
        path.move(to: p(12, 11))
        path.addCurve(to: p(18.2, 7.2), control1: p(13.6, 9.4), control2: p(15.8, 7.8))
        path.move(to: p(12, 11))
        path.addCurve(to: p(9.4, 4.6), control1: p(11.2, 8.8), control2: p(10.4, 6.4))
        path.move(to: p(12, 11))
        path.addCurve(to: p(14.6, 4.6), control1: p(12.8, 8.8), control2: p(13.6, 6.4))
        // Ground
        path.move(to: p(8.5, 21))
        path.addLine(to: p(15.5, 21))
        return path
    }
}

/// Torii gate (Tokyo).
struct ToriiGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let u = min(rect.width, rect.height) / 24
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.midX + (x - 12) * u, y: rect.midY + (y - 12) * u)
        }
        var path = Path()
        // Curved kasagi (top lintel)
        path.move(to: p(4, 6.5))
        path.addCurve(to: p(20, 6.5), control1: p(6.6, 5.5), control2: p(17.4, 5.5))
        // Lintel end caps
        path.move(to: p(6, 6.2)); path.addLine(to: p(6, 5.4))
        path.move(to: p(18, 6.2)); path.addLine(to: p(18, 5.4))
        // Nuki (second beam)
        path.move(to: p(5.5, 10)); path.addLine(to: p(18.5, 10))
        // Pillars, slightly splayed
        path.move(to: p(7, 6.5)); path.addLine(to: p(6.5, 20))
        path.move(to: p(17, 6.5)); path.addLine(to: p(17.5, 20))
        // Gakuzuka (center strut)
        path.move(to: p(12, 6.5)); path.addLine(to: p(12, 10))
        return path
    }
}

/// Castle keep (Osaka).
struct CastleGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let u = min(rect.width, rect.height) / 24
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.midX + (x - 12) * u, y: rect.midY + (y - 12) * u)
        }
        var path = Path()
        // Gate
        path.move(to: p(9.5, 20)); path.addLine(to: p(9.5, 16.8))
        path.addLine(to: p(14.5, 16.8)); path.addLine(to: p(14.5, 20))
        // First eave (curved)
        path.move(to: p(7, 16.8))
        path.addCurve(to: p(17, 16.8), control1: p(8.4, 15.8), control2: p(15.6, 15.8))
        // Tiers
        path.move(to: p(8.6, 13.4)); path.addLine(to: p(15.4, 13.4))
        path.addLine(to: p(16.6, 15.4)); path.addLine(to: p(7.4, 15.4)); path.closeSubpath()
        path.move(to: p(9.4, 10.2)); path.addLine(to: p(14.6, 10.2))
        path.addLine(to: p(15.6, 12)); path.addLine(to: p(8.4, 12)); path.closeSubpath()
        path.move(to: p(10.4, 7.4)); path.addLine(to: p(13.6, 7.4))
        path.addLine(to: p(14.5, 9)); path.addLine(to: p(9.5, 9)); path.closeSubpath()
        // Finial
        path.move(to: p(12, 7.4)); path.addLine(to: p(12, 5.2))
        path.addLine(to: p(13.3, 4.5))
        // Ground
        path.move(to: p(5.5, 20)); path.addLine(to: p(18.5, 20))
        return path
    }
}

/// Mountain peaks over the lake (Salt Lake City — the Wasatch over the
/// Great Salt Lake).
struct MountainLakeGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let u = min(rect.width, rect.height) / 24
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.midX + (x - 12) * u, y: rect.midY + (y - 12) * u)
        }
        var path = Path()
        // Two peaks, the far one lower
        path.move(to: p(3.5, 16))
        path.addLine(to: p(9, 7))
        path.addLine(to: p(12.2, 12.2))
        path.move(to: p(10.8, 14.5))
        path.addLine(to: p(15, 5.5))
        path.addLine(to: p(20.5, 16))
        // Snow notch on the tall peak
        path.move(to: p(13.7, 8.4))
        path.addLine(to: p(15, 9.6))
        path.addLine(to: p(16.3, 8.4))
        // Lake: two calm strokes
        path.move(to: p(4.5, 18.5))
        path.addCurve(to: p(12, 18.5), control1: p(7, 17.8), control2: p(9.5, 19.2))
        path.move(to: p(13.5, 18.5))
        path.addCurve(to: p(19.5, 18.5), control1: p(15.5, 19.2), control2: p(17.5, 17.8))
        return path
    }
}

/// Waterfall curtain with mist (Buffalo — Niagara).
struct FallsGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let u = min(rect.width, rect.height) / 24
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.midX + (x - 12) * u, y: rect.midY + (y - 12) * u)
        }
        var path = Path()
        // Upstream river reaching the brink
        path.move(to: p(3.5, 7.5))
        path.addCurve(to: p(10, 7.5), control1: p(5.5, 7.1), control2: p(8, 7.9))
        // Brink arc
        path.move(to: p(10, 7.5))
        path.addCurve(to: p(17.5, 8.2), control1: p(12.5, 7.2), control2: p(15.5, 7.4))
        // Falling curtain
        path.move(to: p(11, 7.9)); path.addLine(to: p(11, 16.5))
        path.move(to: p(13.5, 7.8)); path.addLine(to: p(13.5, 17.2))
        path.move(to: p(16, 8)); path.addLine(to: p(16, 16.5))
        // Mist at the plunge pool
        path.move(to: p(7.5, 18.8))
        path.addCurve(to: p(12, 18.8), control1: p(9, 17.8), control2: p(10.5, 19.6))
        path.addCurve(to: p(16.5, 18.8), control1: p(13.5, 17.9), control2: p(15, 19.6))
        return path
    }
}

/// Splits a catalog display name ("Los Angeles · Sunset") into the city the
/// user actually thinks in and the codename that merely tells lines apart.
func nodeCityParts(_ displayName: String) -> (city: String, codename: String?) {
    let parts = displayName.split(separator: "·", maxSplits: 1)
    guard parts.count == 2 else { return (displayName, nil) }
    return (
        parts[0].trimmingCharacters(in: .whitespaces),
        parts[1].trimmingCharacters(in: .whitespaces)
    )
}

/// The user-facing city title, localized (洛杉矶 / 东京 / …) when the catalog
/// city has a translation; otherwise the original name.
func nodeCityTitle(_ displayName: String) -> String {
    let city = nodeCityParts(displayName).city
    return String(localized: String.LocalizationValue(city))
}

private func cityGlyphShape(for city: String) -> AnyShape {
    switch city.lowercased() {
    case "los angeles", "san jose", "miami":
        AnyShape(PalmGlyph())
    case "salt lake city":
        AnyShape(MountainLakeGlyph())
    case "buffalo":
        AnyShape(FallsGlyph())
    case "tokyo":
        AnyShape(ToriiGlyph())
    case "osaka":
        AnyShape(CastleGlyph())
    default:
        AnyShape(NodeRouteGlyph())
    }
}

/// The node identity mark: a neutral glass tile carrying a brand-gradient
/// stroke. With a `city`, the stroke is that city's landmark (palm, torii,
/// castle keep); otherwise the generic route glyph. The tile itself stays
/// neutral so it sits quietly in both light and dark mode.
struct NodeRouteMark: View {
    @Environment(\.colorScheme) private var colorScheme
    var size: CGFloat = 44
    var city: String? = nil

    var body: some View {
        cityGlyphShape(for: city ?? "")
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
    /// When provided, the active top hairline slides between cards on
    /// selection instead of blinking out and in.
    var activeLineNamespace: Namespace.ID? = nil
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
                        .modifier(ActiveLineMatch(namespace: reduceMotion ? nil : activeLineNamespace))
                }
            }
            // No per-card glassEffect: adjacent Liquid Glass shapes in a grid
            // render merge bridges between cards (the stray white bar under
            // each card). The translucent fill + hairline + shadow carry the
            // glass read on their own.
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

/// Applies matchedGeometryEffect only when a namespace is supplied, so the
/// surface stays usable outside grids (and under Reduce Motion).
private struct ActiveLineMatch: ViewModifier {
    var namespace: Namespace.ID?

    func body(content: Content) -> some View {
        if let namespace {
            content.matchedGeometryEffect(id: "tono.activeTopLine", in: namespace)
        } else {
            content
        }
    }
}

struct NodeLatencyBadge: View {
    let latency: Int
    var didFail: Bool = false

    private var tint: Color {
        if didFail { return TonoStatus.error }
        if latency <= 0 { return TonoStatus.neutral }
        return Color(hex: LatencyLevel.level(for: latency, kind: .exit).color)
    }

    private var title: String {
        if didFail { return String(localized: "Timeout") }
        guard latency > 0 else { return "—" }
        return LatencyLevel.spokenTitle(for: latency, kind: .exit)
    }

    private var detail: String? {
        if didFail { return String(localized: "Unavailable") }
        return nil
    }

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(tint)
                .frame(width: 6, height: 6)
                .shadow(color: tint.opacity(0.45), radius: 3)

            VStack(alignment: .trailing, spacing: 1) {
                // Digits roll as results land, so a latency sweep reads as a
                // wave of numbers arriving card by card.
                Text(title)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(tint)
                    .contentTransition(.numericText())
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
        .animation(.easeOut(duration: 0.35), value: latency)
        .animation(.easeOut(duration: 0.35), value: didFail)
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
                        NodeRouteMark(city: nodeCityParts(node.displayName).city)

                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 7) {
                                // City first — the name users actually think
                                // in; the codename only tells lines apart.
                                Text(nodeCityTitle(node.displayName))
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                    .layoutPriority(1)

                                if let codename = nodeCityParts(node.displayName).codename {
                                    Text(codename)
                                        .font(.system(size: 9, weight: .semibold, design: .rounded))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2.5)
                                        .background(.primary.opacity(0.05), in: Capsule())
                                }

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
