import SwiftUI

struct ActiveNodeCard: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let nodeName: String
    var groupName: String?
    var latency: Int = 0
    var eyebrow: LocalizedStringKey = "ACTIVE SERVER"
    var onSwitch: (() -> Void)?
    @State private var isSwitchHovered = false

    private var cleanName: String {
        ProxyNode.displayName(for: ConfigParser.extractFlag(from: nodeName).cleanName)
    }

    private var secondaryLine: String {
        let parsed = ConfigParser.extractFlag(from: nodeName)
        let code = nodeRegionCode(flag: parsed.flag, name: parsed.cleanName)
        var parts: [String] = []
        if let codename = nodeCityParts(cleanName).codename { parts.append(codename) }
        if let group = groupName { parts.append(group) }
        parts.append(code)
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(eyebrow)
                    .font(.system(size: 10, weight: .semibold))
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                    .kerning(0.6)
                Spacer()
                Button {
                    onSwitch?()
                } label: {
                    Text("Switch")
                        .font(.system(size: 12, weight: .medium))
                        .fontWeight(.medium)
                        .foregroundStyle(isSwitchHovered ? .primary : .secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(
                            Color.primary.opacity(isSwitchHovered ? 0.06 : 0),
                            in: Capsule()
                        )
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .onHover { isSwitchHovered = $0 }
                .animation(
                    TonoMotion.easeOut(0.15, reduceMotion: reduceMotion),
                    value: isSwitchHovered
                )
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 8)

            HStack {
                HStack(spacing: 10) {
                    NodeRouteMark(size: 32, city: nodeCityParts(cleanName).city)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(nodeCityTitle(cleanName))
                            .font(.system(size: 13, weight: .semibold))
                            .fontWeight(.semibold)
                            .foregroundStyle(.primary)
                        Text(secondaryLine)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                // Always render the slot. Hiding it until the first probe made
                // the card reflow when the number arrived, and left no word for
                // "nobody has measured this yet".
                let measured = latency > 0
                let tint = measured
                    ? Color(hex: LatencyLevel.level(for: latency, kind: .exit).color)
                    : TonoStatus.neutral
                Text(
                    measured
                        ? LatencyLevel.spokenTitle(for: latency, kind: .exit)
                        : String(localized: "Not tested")
                )
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(tint)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 6))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                .white.opacity(colorScheme == .dark ? 0.08 : 0.24),
                in: RoundedRectangle(cornerRadius: 10)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(
                        .white.opacity(colorScheme == .dark ? 0.14 : 0.45),
                        lineWidth: 1
                    )
            }
            .glassEffect(in: RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 12)
            .padding(.bottom, 12)
        }
        .frame(width: 480)
        .background(
            .white.opacity(colorScheme == .dark ? 0.06 : 0.12),
            in: RoundedRectangle(cornerRadius: 12)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(
                    .white.opacity(colorScheme == .dark ? 0.12 : 0.4),
                    lineWidth: 1
                )
        }
        .glassEffect(in: RoundedRectangle(cornerRadius: 12))
    }
}

#Preview {
    ZStack {
        MeshGradientBackground()
        ActiveNodeCard(nodeName: "🇯🇵 Tokyo 01", groupName: "PROXY")
    }
    .frame(width: 900, height: 600)
}
