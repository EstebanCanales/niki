import AppKit
import SwiftUI

@main
struct NikiDesktopApp: App {
    @NSApplicationDelegateAdaptor(NikiDesktopAppDelegate.self) private var appDelegate
    @StateObject private var appModel = NikiAppModel()

    var body: some Scene {
        WindowGroup("Niki") {
            ContentView()
                .environmentObject(appModel)
                .frame(minWidth: 1240, minHeight: 820)
                .onAppear {
                    appModel.ensureNotchRunning()
                }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1440, height: 920)
        .commands {
            CommandGroup(replacing: .newItem) { }
        }
    }
}

final class NikiDesktopAppDelegate: NSObject, NSApplicationDelegate {
    private let notchBundleID = "com.niki.notch"

    func applicationWillTerminate(_ notification: Notification) {
        NSRunningApplication
            .runningApplications(withBundleIdentifier: notchBundleID)
            .forEach { app in
                if !app.terminate() {
                    app.forceTerminate()
                }
            }
    }
}
