import Cocoa

class NikiStatusMenu: NSMenu {
    
    var statusItem: NSStatusItem!
    
    override init(title: String) {
        super.init(title: title)

        // Initialize the status item
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "music.note", accessibilityDescription: "Niki")
            button.action = #selector(showMenu)
        }

        // Set up the menu
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quitAction), keyEquivalent: "q"))
        statusItem.menu = menu
    }

    convenience init() {
        self.init(title: "")
    }

    required init(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    @objc private func showMenu() {
        guard let button = statusItem.button, let menu = statusItem.menu else { return }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height), in: button)
    }

    @objc private func quitAction() {
        NSApp.terminate(nil)
    }

}
