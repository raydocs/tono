#if DEBUG
import SwiftUI

/// DEBUG only (`-TonoPreviewContrastProbe`): rows built like Details' Settings row with text at
/// known contrast, a wide, sparse row, for `testContrastMeasureFailsLowContrastTextInASparseRow`.
struct ContrastProbe: View {
    var body: some View {
        VStack(spacing: 16) {
            // On the card (smokeHigh at 50% over night, about #161622) white 0.41 is 3.24:1 and white
            // 0.49 is 4.42:1 (sRGB compositing; round 11's review recomputed them).
            row("Probe", Color(white: 0.41), id: "probe3")
            row("Probe", Color(white: 0.49), id: "probe4")
            row("Probe", TonoColor.textPrimary, id: "probePrimary")
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(TonoColor.night.ignoresSafeArea())
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
