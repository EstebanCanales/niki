import AVFoundation
import Combine
import Defaults
import KeyboardShortcuts
import Sparkle
import SwiftUI

@main
struct NikiApp: App {
    @NSApplicationDelegateAdaptor(NikiAppDelegate.self) var appDelegate
    @StateObject private var appModel = NikiAppModel.shared

    var body: some Scene {
        WindowGroup("Niki") {
            ContentView()
                .environmentObject(appModel)
                .frame(minWidth: 1240, minHeight: 820)
                .background(WindowAccessor { window in
                    appDelegate.registerDesktopWindow(window)
                })
                .onAppear {
                    appModel.connectAppDelegate(appDelegate)
                    appDelegate.appModel = appModel
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

/// Captura la NSWindow que respalda una vista SwiftUI para poder controlarla desde el AppDelegate
/// (ocultarla al arrancar, reabrirla desde el status item).
struct WindowAccessor: NSViewRepresentable {
    let onWindow: (NSWindow) -> Void

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async { [weak view] in
            if let window = view?.window { onWindow(window) }
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async { [weak nsView] in
            if let window = nsView?.window { onWindow(window) }
        }
    }
}
