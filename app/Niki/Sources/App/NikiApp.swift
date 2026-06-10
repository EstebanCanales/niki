import AVFoundation
import Combine
import Defaults
import KeyboardShortcuts
import Sparkle
import SwiftUI

@main
struct NikiApp: App {
    @NSApplicationDelegateAdaptor(NikiAppDelegate.self) var appDelegate
    @StateObject private var appModel = NikiAppModel()

    var body: some Scene {
        WindowGroup("Niki") {
            ContentView()
                .environmentObject(appModel)
                .frame(minWidth: 1240, minHeight: 820)
                .onAppear {
                    appModel.connectAppDelegate(appDelegate)
                    appDelegate.setupNotchWindows()
                }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1440, height: 920)
        .commands {
            CommandGroup(replacing: .newItem) { }
        }

        Settings {
            SettingsView(updaterController: appDelegate.updaterController)
        }
    }
}
