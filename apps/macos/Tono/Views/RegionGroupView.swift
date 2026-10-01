import SwiftUI

struct RegionGroupView: View {
    let region: ProxyRegion
    let selectedNodeId: String?
    let onToggleExpand: () -> Void
    let onSelectNode: (ProxyNode) -> Void
    var onDeleteNode: ((ProxyNode) -> Void)?
    var onEditNode: ((ProxyNode) -> Void)?

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
    ]

    private var regionFlagEmoji: String? {
        if let emoji = UnicodeCountryFlag.emoji(for: region.id) {
            return emoji
        }
        if let emoji = UnicodeCountryFlag.emoji(for: region.name) {
            return emoji
        }
        let codes = Set(region.nodes.map { nodeRegionCode(flag: $0.flag, name: $0.name) })
        if codes.count == 1, let singleCode = codes.first {
            return UnicodeCountryFlag.emoji(for: singleCode)
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Region header — large hit area
            Button(action: onToggleExpand) {
                HStack(spacing: 8) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(region.isExpanded ? 90 : 0))

                    if let flagEmoji = regionFlagEmoji {
                        Text(flagEmoji)
                            .font(.system(size: 11))
                    }

                    Text(LocalizedStringKey(region.name))
                        .font(.system(size: 11, weight: .semibold))
                        .kerning(1.0)
                        .foregroundStyle(.secondary)

                    Text("\(region.nodes.count)")
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)

                    Spacer()
                }
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // Node cards grid
            if region.isExpanded {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(region.nodes) { node in
                        NodeCardView(
                            node: node,
                            isSelected: node.id == selectedNodeId,
                            onTap: { onSelectNode(node) }
                        )
                        .contextMenu {
                            if let onEdit = onEditNode {
                                Button {
                                    onEdit(node)
                                } label: {
                                    Label("Edit Node", systemImage: "pencil")
                                }
                            }
                            if let onDelete = onDeleteNode {
                                Button(role: .destructive) {
                                    onDelete(node)
                                } label: {
                                    Label("Delete Node", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

#Preview {
    ZStack {
        MeshGradientBackground()
        RegionGroupView(
            region: mockProxyRegions[0],
            selectedNodeId: "ap1",
            onToggleExpand: {},
            onSelectNode: { _ in }
        )
        .padding(32)
    }
    .frame(width: 700, height: 300)
}
