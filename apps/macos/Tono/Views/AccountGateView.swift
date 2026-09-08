import SwiftUI
import AppKit

struct AccountGateView<Content: View>: View {
    @Bindable var session: AccountSession
    @ViewBuilder let content: () -> Content

    var body: some View {
        Group {
            if session.state == .ready {
                // ContentView owns its background. Keeping the account-gate
                // visual-effect view underneath it doubled the live desktop
                // blur cost for the entire connected session.
                content()
            } else if session.state == .restoring {
                ZStack {
                    // Paint the real application shell immediately while the
                    // authenticated session is validated. Controls stay inert,
                    // but launch no longer feels like a blank blocking screen.
                    content()
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)

                    // Stronger than 0.08 so Dashboard type does not punch
                    // through the restoring copy. No extra blur: the gate
                    // already paid for ContentView's frost underneath.
                    Rectangle()
                        .fill(.black.opacity(0.20))
                        .ignoresSafeArea()

                    RestoringSessionCard()
                }
                // NavigationSplitView (ContentView underneath) installs a
                // system sidebar toggle. The gate has no sidebar.
                .toolbar(removing: .sidebarToggle)
            } else {
                ZStack {
                    // Account states are displayed before ContentView exists,
                    // so they need their own full-window background.
                    MeshGradientBackground(emphasis: true)

                    Group {
                        switch session.state {
                        case .restoring:
                            EmptyView()
                        case .signedOut, .authenticating, .error:
                            LoginView(session: session)
                        case .enrolling:
                            ProgressView("Enrolling this Mac with Tono…")
                        case .suspended:
                            AccountBlockedView(session: session)
                        case .ready:
                            EmptyView()
                        }
                    }
                }
                .toolbar(removing: .sidebarToggle)
            }
        }
    }
}
