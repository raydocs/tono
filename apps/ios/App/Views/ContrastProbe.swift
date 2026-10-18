#if DEBUG
import SwiftUI

/// DEBUG only (`-TonoPreviewContrastProbe`): rows built like Details' Settings row with text at
/// known contrast, so the UI tests can check their contrast measurement fails low-contrast text in
/// a wide, sparse row (see `testContrastMeasureFailsLowContrastTextInASparseRow`).
struct ContrastProbe: View {
    var body: some View {
        VStack(spacing: 16) {
            // On the card (about #1F2029) white 0.41 is about 3:1 and white 0.49 about 4:1.
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
