import SwiftUI

@main
struct VoidStudioApp: App {
    var body: some Scene {
        WindowGroup {
            StudioRoot()
                .preferredColorScheme(.dark)
        }
    }
}

private struct StudioRoot: View {
    @State private var showLiDAR = false
    @State private var confirmSwitch = false
    @StateObject private var lidar = LiDARCamera()

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("VOID")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .tracking(5)
                    .accessibilityLabel("VOID Studio")
                Spacer()
                Picker("Camera mode", selection: Binding(
                    get: { showLiDAR },
                    set: { selectLiDAR in
                        if selectLiDAR != showLiDAR { confirmSwitch = true }
                    }
                )) {
                    Text("Studio").tag(false)
                    Text("LiDAR").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 230)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            if showLiDAR {
                LiDARStudio(model: lidar)
            } else {
                StudioWebView()
            }
        }
        .background(Color.black.ignoresSafeArea())
        .confirmationDialog(showLiDAR ? "Return to Studio?" : "Open the rear LiDAR camera?", isPresented: $confirmSwitch, titleVisibility: .visible) {
            Button(showLiDAR ? "Open Studio" : "Open LiDAR") { showLiDAR.toggle() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Finish any take before switching cameras.")
        }
    }
}
