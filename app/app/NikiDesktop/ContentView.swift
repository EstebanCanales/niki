import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        Group {
            if appModel.bootStage == .shell {
                NikiShellView()
            } else {
                NikiAuthRootView()
            }
        }
        .preferredColorScheme(.dark)
    }
}
