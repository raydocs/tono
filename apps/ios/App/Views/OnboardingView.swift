import SwiftUI
import TonoKit

/// First run, before sign-in: what Tono does in three lines and the one promise that matters
/// (matched traffic fails closed). One screen, one button; shown once per install.
struct OnboardingView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        ZStack {
            TonoColor.night.ignoresSafeArea()
            SeaScene(sky: .dawn, horizon: 0.40)
            LinearGradient(colors: [.clear, TonoColor.nightDeep.opacity(typeSize.isAccessibilitySize ? 0.92 : 0.7), TonoColor.nightDeep.opacity(0.92)],
                           startPoint: UnitPoint(x: 0.5, y: typeSize.isAccessibilitySize ? 0 : 0.38), endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            BottomScroll { content }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            TonoMark(size: 40).padding(.bottom, 14)
            Text(L.t("onboard_title"))
                .tonoFont(30, .regular, relativeTo: .largeTitle)
                .foregroundStyle(TonoColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("onboardTitle")
            VStack(alignment: .leading, spacing: 0) {
                row(.ai, L.t("onboard_row_ai"))
                row(.video, L.t("onboard_row_video"))
                row(.apps, L.t("onboard_row_other"))
            }
            .padding(.vertical, 6)
            .contentCard(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .padding(.top, 20)
            Text(L.t("onboard_fail_closed"))
                .tonoFont(15, relativeTo: .subheadline)
                .foregroundStyle(TonoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 14)
            PrimaryButton(title: L.t("onboard_continue")) {
                withAnimation(TonoMotion.surface) { model.finishOnboarding() }
            }
            .accessibilityIdentifier("onboardContinue")
            .padding(.top, 22)
        }
        .padding(.horizontal, 24).padding(.bottom, 12)
    }

    private func row(_ glyph: Glyph, _ text: String) -> some View {
        HStack(alignment: typeSize.isAccessibilitySize ? .top : .center, spacing: 14) {
            GlyphIcon(glyph: glyph, tint: TonoColor.accent)
            Text(text).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        .accessibilityElement(children: .combine)
    }
}

/// Before the iOS "Add VPN Configurations" prompt: what it is, what to tap, how to undo it.
struct VPNPrimerSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HorizonGlyph(sunRise: 0.5, warn: false, size: 48)
                Text(L.t("primer_title"))
                    .tonoFont(22, .semibold, relativeTo: .title2)
                    .foregroundStyle(TonoColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("primerTitle")
                Text(L.t("primer_body"))
                    .tonoFont(16, relativeTo: .callout)
                    .foregroundStyle(TonoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                point(L.t("primer_point_switch"))
                point(L.t("primer_point_remove"))
                PrimaryButton(title: L.t("primer_continue")) { model.confirmVPNPrimer() }
                    .accessibilityIdentifier("primerContinue")
                    .padding(.top, 6)
                QuietButton(title: L.t("primer_later"), color: TonoColor.textSecondary) { model.dismissVPNPrimer() }
                    .frame(maxWidth: .infinity)
                    .accessibilityIdentifier("primerLater")
            }
            .padding(.horizontal, 22).padding(.top, 26).padding(.bottom, 16)
        }
        .modifier(SheetSurface())
        .presentationDetents(typeSize.isAccessibilitySize || DebugAccessibility.largeSheets ? [.large] : [.medium, .large])
        // One detent (accessibility sizes): nothing to drag between, so no grabber; a swipe still closes it.
        .presentationDragIndicator(typeSize.isAccessibilitySize || DebugAccessibility.largeSheets ? .hidden : .visible)
    }

    private func point(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            StatusDot(color: TonoColor.accent, size: 6)
            Text(text).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}
