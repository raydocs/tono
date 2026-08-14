import SwiftUI

/// First-launch language chooser. Labels are bilingual on purpose: the
/// locale is not applied until the user picks one and Tono relaunches.
struct LanguageSetupView: View {
    var body: some View {
        ZStack {
            MeshGradientBackground()

            VStack(spacing: 22) {
                Image(systemName: "globe")
                    .font(.system(size: 42, weight: .medium))
                    .foregroundStyle(.tint)

                VStack(spacing: 8) {
                    Text(verbatim: "Choose your language")
                        .font(.title.bold())
                    Text(verbatim: "选择语言")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.secondary)
                }

                VStack(spacing: 10) {
                    languageButton(
                        title: "English",
                        subtitle: "Use English for the Tono interface"
                    ) {
                        choose(InterfaceLanguagePreference.english)
                    }
                    languageButton(
                        title: "简体中文",
                        subtitle: "使用简体中文显示 Tono 界面"
                    ) {
                        choose(InterfaceLanguagePreference.simplifiedChinese)
                    }
                }
                .frame(maxWidth: 360)

                Button {
                    choose(InterfaceLanguagePreference.auto)
                } label: {
                    Text(verbatim: "Use system language · 跟随系统")
                        .font(.system(size: 13, weight: .medium))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
            .padding(32)
            .frame(width: 470)
        }
    }

    private func languageButton(
        title: String,
        subtitle: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: title)
                    .font(.system(size: 16, weight: .semibold))
                Text(verbatim: subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
    }

    private func choose(_ language: String) {
        InterfaceLanguagePreference.apply(language)
        InterfaceLanguagePreference.relaunch()
    }
}
