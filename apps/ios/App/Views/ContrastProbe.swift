#if DEBUG
import SwiftUI

/// DEBUG only (`-TonoPreviewContrastProbe`): controls for the UI tests' contrast measurements.
/// Rows built like Details' Settings row with text at known contrast (a wide, sparse row; see
/// `testContrastMeasureFailsLowContrastTextInASparseRow`), and two primary capsules for the local
/// label measurement: round 11's white label over the translucent sunrise fill (must fail) and the
/// real `ActionCapsule` while preparing (see `testLocalLabelMeasureFailsTheRound11FillAndPassesTheNewOne`),
/// on their own screen (`-TonoPreviewContrastProbeCapsules`) so the rows stay laid out as calibrated.
struct ContrastProbe: View {
    let capsules: Bool

    var body: some View {
        VStack(spacing: 16) {
            if capsules {
                round11Fill.accessibilityIdentifier("probeOldFill")
                ActionCapsule(phase: .preparing, connectedSince: nil) { _ in }
                    .accessibilityIdentifier("probeNewFill")
            } else {
                // On the card (smokeHigh at 50% over night, about #161622) white 0.41 is 3.24:1 and
                // white 0.49 is 4.42:1 (sRGB compositing; round 11's review recomputed them).
                row("Probe", Color(white: 0.41), id: "probe3")
                row("Probe", Color(white: 0.49), id: "probe4")
                row("Probe", TonoColor.textPrimary, id: "probePrimary")
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(TonoColor.night.ignoresSafeArea())
    }

    /// Round 11's capsule while preparing: white "Cancel" over the translucent sunEdge → sunCore
    /// fill at 36%, on dark glass.
    private var round11Fill: some View {
        ZStack(alignment: .leading) {
            Capsule().fill(Color.white.opacity(0.08))
            GeometryReader { geo in
                Capsule()
                    .fill(LinearGradient(colors: [TonoColor.sunEdge.opacity(0.55), TonoColor.sunCore.opacity(0.85)],
                                         startPoint: .leading, endPoint: .trailing))
                    .frame(width: max(geo.size.height, geo.size.width * 0.36))
            }
            .clipShape(Capsule())
            Text("Cancel").tonoFont(17, .semibold, relativeTo: .body).foregroundStyle(TonoColor.textPrimary)
                .padding(.horizontal, 22)
        }
        .frame(maxWidth: .infinity, minHeight: 56)
        .accessibilityElement(children: .combine)
    }

    private func row(_ text: String, _ color: Color, id: String) -> some View {
        HStack {
            Text(text).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(color)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 52)
        .contentCard(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(id)
    }
}
#endif
