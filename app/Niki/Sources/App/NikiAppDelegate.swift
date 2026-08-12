import AVFoundation
import Combine
import Defaults
import KeyboardShortcuts
import Sparkle
import SwiftUI

class NikiAppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var statusItem: NSStatusItem?
    private var desktopWindow: NSWindow?   // strong: retenemos el shell para reabrirlo
    private var desktopShellRevealed = false
    private var lastModifierTap: Date?
    private var flagsMonitorLocal: Any?
    private var flagsMonitorGlobal: Any?
    var windows: [String: NSWindow] = [:] // UUID -> NSWindow
    var viewModels: [String: NikiNotchViewModel] = [:] // UUID -> NikiNotchViewModel
    var window: NSWindow?
    /// Siempre disponible (incluso en `applicationDidFinishLaunching`, antes de que
    /// SwiftUI monte la escena) — los menús y atajos operan sobre el mismo estado
    /// que la ventana y el notch.
    var appModel: NikiAppModel? = NikiAppModel.shared
    let vm: NikiNotchViewModel = .init()
    @ObservedObject var coordinator = NikiNotchCoordinator.shared
    var quickShareService = QuickShareService.shared
    var whatsNewWindow: NSWindow?
    var timer: Timer?
    var closeNotchTask: Task<Void, Never>?
    private var previousScreens: [NSScreen]?
    private var onboardingWindowController: NSWindowController?
    private var screenLockedObserver: Any?
    private var screenUnlockedObserver: Any?
    private var isScreenLocked: Bool = false
    private var windowScreenDidChangeObserver: Any?
    private var dragDetectors: [String: DragDetector] = [:] // UUID -> DragDetector

    let updaterController: SPUStandardUpdaterController = {
        let c = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        SettingsWindowController.shared.setUpdaterController(c)
        return c
    }()

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    /// Reabrir la app (open -a Niki, click en el Dock, activarla) trae de vuelta la
    /// ventana de escritorio. Sin esto, el único camino para recuperarla es el ícono de
    /// la barra de menú — que macOS esconde en el overflow cuando la barra se llena
    /// (o queda tapado por el notch), dejando la ventana irrecuperable.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showDesktopShell()
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        NotificationCenter.default.removeObserver(self)
        DistributedNotificationCenter.default().removeObserver(self)
        if let observer = screenLockedObserver {
            DistributedNotificationCenter.default().removeObserver(observer)
            screenLockedObserver = nil
        }
        if let observer = screenUnlockedObserver {
            DistributedNotificationCenter.default().removeObserver(observer)
            screenUnlockedObserver = nil
        }
        MusicManager.shared.destroy()
        cleanupDragDetectors()
        cleanupWindows()
        XPCHelperClient.shared.stopMonitoringAccessibilityAuthorization()
    }

    @MainActor
    func onScreenLocked(_ notification: Notification) {
        isScreenLocked = true
        if !Defaults[.showOnLockScreen] {
            cleanupWindows()
        } else {
            enableSkyLightOnAllWindows()
        }
    }

    @MainActor
    func onScreenUnlocked(_ notification: Notification) {
        isScreenLocked = false
        if !Defaults[.showOnLockScreen] {
            adjustWindowPosition(changeAlpha: true)
        } else {
            disableSkyLightOnAllWindows()
        }
    }

    @MainActor
    private func enableSkyLightOnAllWindows() {
        if Defaults[.showOnAllDisplays] {
            windows.values.forEach { window in
                if let skyWindow = window as? NikiNotchSkyLightWindow {
                    skyWindow.enableSkyLight()
                }
            }
        } else {
            if let skyWindow = window as? NikiNotchSkyLightWindow {
                skyWindow.enableSkyLight()
            }
        }
    }

    @MainActor
    private func disableSkyLightOnAllWindows() {
        // Delay disabling SkyLight to avoid flicker during unlock transition
        Task {
            try? await Task.sleep(for: .milliseconds(150))
            await MainActor.run {
                if Defaults[.showOnAllDisplays] {
                    self.windows.values.forEach { window in
                        if let skyWindow = window as? NikiNotchSkyLightWindow {
                            skyWindow.disableSkyLight()
                        }
                    }
                } else {
                    if let skyWindow = self.window as? NikiNotchSkyLightWindow {
                        skyWindow.disableSkyLight()
                    }
                }
            }
        }
    }

    private func cleanupWindows(shouldInvert: Bool = false) {
        let shouldCleanupMulti = shouldInvert ? !Defaults[.showOnAllDisplays] : Defaults[.showOnAllDisplays]

        if shouldCleanupMulti {
            windows.values.forEach { window in
                window.close()
                NotchSpaceManager.shared.notchSpace.windows.remove(window)
            }
            windows.removeAll()
            viewModels.removeAll()
        } else if let window = window {
            window.close()
            NotchSpaceManager.shared.notchSpace.windows.remove(window)
            if let obs = windowScreenDidChangeObserver {
                NotificationCenter.default.removeObserver(obs)
                windowScreenDidChangeObserver = nil
            }
            self.window = nil
        }
    }

    private func cleanupDragDetectors() {
        dragDetectors.values.forEach { detector in
            detector.stopMonitoring()
        }
        dragDetectors.removeAll()
    }

    private func setupDragDetectors() {
        cleanupDragDetectors()

        guard Defaults[.expandedDragDetection] else { return }

        if Defaults[.showOnAllDisplays] {
            for screen in NSScreen.screens {
                setupDragDetectorForScreen(screen)
            }
        } else {
            let preferredScreen: NSScreen? = window?.screen
                ?? NSScreen.screen(withUUID: coordinator.selectedScreenUUID)
                ?? NSScreen.main

            if let screen = preferredScreen {
                setupDragDetectorForScreen(screen)
            }
        }
    }

    private func setupDragDetectorForScreen(_ screen: NSScreen) {
        guard let uuid = screen.displayUUID else { return }

        let screenFrame = screen.frame
        let notchHeight = openNotchSize.height
        let notchWidth = openNotchSize.width

        // Create notch region at the top-center of the screen where an open notch would occupy
        let notchRegion = CGRect(
            x: screenFrame.midX - notchWidth / 2,
            y: screenFrame.maxY - notchHeight,
            width: notchWidth,
            height: notchHeight
        )

        let detector = DragDetector(notchRegion: notchRegion)

        detector.onDragEntersNotchRegion = { [weak self] in
            Task { @MainActor in
                self?.handleDragEntersNotchRegion(onScreen: screen)
            }
        }

        dragDetectors[uuid] = detector
        detector.startMonitoring()
    }

    private func handleDragEntersNotchRegion(onScreen screen: NSScreen) {
        guard let uuid = screen.displayUUID else { return }

        if Defaults[.showOnAllDisplays], let viewModel = viewModels[uuid] {
            viewModel.open()
            coordinator.currentView = .shelf
        } else if !Defaults[.showOnAllDisplays], let windowScreen = window?.screen, screen == windowScreen {
            vm.open()
            coordinator.currentView = .shelf
        }
    }

    private func createNikiNotchWindow(for screen: NSScreen, with viewModel: NikiNotchViewModel) -> NSWindow {
        let rect = NSRect(x: 0, y: 0, width: windowSize.width, height: windowSize.height)
        // Overlay limpio: borderless + non-activating (sin look HUD/utility, sin toolbar fantasma).
        let styleMask: NSWindow.StyleMask = [.borderless, .nonactivatingPanel]

        let window = NikiNotchSkyLightWindow(contentRect: rect, styleMask: styleMask, backing: .buffered, defer: false)

        // Enable SkyLight only when screen is locked
        if isScreenLocked {
            window.enableSkyLight()
        } else {
            window.disableSkyLight()
        }

        // Siempre la instancia compartida: el notch tiene que ver exactamente el mismo
        // estado que la ventana, no una copia propia.
        window.contentView = NSHostingView(
            rootView: NikiNotchContentView()
                .environmentObject(viewModel)
                .environmentObject(NikiAppModel.shared)
        )

        window.hidesOnDeactivate = false
        window.isExcludedFromWindowsMenu = true
        // No usar makeKeyAndOrderFront: robaría el foco y activaría la app. El notch es un
        // overlay pasivo — solo se muestra, sin convertirse en ventana clave al aparecer.
        window.orderFrontRegardless()
        NotchSpaceManager.shared.notchSpace.windows.insert(window)

        // Observe when the window's screen changes so we can update drag detectors
        windowScreenDidChangeObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.didChangeScreenNotification,
            object: window,
            queue: .main) { [weak self] _ in
                Task { @MainActor in
                    self?.setupDragDetectors()
                }
        }
        return window
    }

    @MainActor
    private func positionWindow(_ window: NSWindow, on screen: NSScreen, changeAlpha: Bool = false) {
        if changeAlpha {
            window.alphaValue = 0
        }

        let screenFrame = screen.frame
        window.setFrameOrigin(
            NSPoint(
                x: screenFrame.origin.x + (screenFrame.width / 2) - window.frame.width / 2,
                y: screenFrame.origin.y + screenFrame.height - window.frame.height
            ))
        window.alphaValue = 1
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screenConfigurationDidChange),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )

        NotificationCenter.default.addObserver(
            forName: Notification.Name.selectedScreenChanged, object: nil, queue: nil
        ) { [weak self] _ in
            Task { @MainActor in
                self?.adjustWindowPosition(changeAlpha: true)
                self?.setupDragDetectors()
            }
        }

        NotificationCenter.default.addObserver(
            forName: Notification.Name.notchHeightChanged, object: nil, queue: nil
        ) { [weak self] _ in
            Task { @MainActor in
                self?.adjustWindowPosition()
                self?.setupDragDetectors()
            }
        }

        NotificationCenter.default.addObserver(
            forName: Notification.Name.automaticallySwitchDisplayChanged, object: nil, queue: nil
        ) { [weak self] _ in
            guard let self = self, let window = self.window else { return }
            Task { @MainActor in
                window.alphaValue = self.coordinator.selectedScreenUUID == self.coordinator.preferredScreenUUID ? 1 : 0
            }
        }

        NotificationCenter.default.addObserver(
            forName: Notification.Name.showOnAllDisplaysChanged, object: nil, queue: nil
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self = self else { return }
                self.cleanupWindows(shouldInvert: true)
                self.adjustWindowPosition(changeAlpha: true)
                self.setupDragDetectors()
            }
        }

        NotificationCenter.default.addObserver(
            forName: Notification.Name.expandedDragDetectionChanged, object: nil, queue: nil
        ) { [weak self] _ in
            Task { @MainActor in
                self?.setupDragDetectors()
            }
        }

        // Use closure-based observers for DistributedNotificationCenter and keep tokens for removal
        screenLockedObserver = DistributedNotificationCenter.default().addObserver(
            forName: NSNotification.Name(rawValue: "com.apple.screenIsLocked"),
            object: nil, queue: .main) { [weak self] notification in
                Task { @MainActor in
                    self?.onScreenLocked(notification)
                }
        }

        screenUnlockedObserver = DistributedNotificationCenter.default().addObserver(
            forName: NSNotification.Name(rawValue: "com.apple.screenIsUnlocked"),
            object: nil, queue: .main) { [weak self] notification in
                Task { @MainActor in
                    self?.onScreenUnlocked(notification)
                }
        }

        KeyboardShortcuts.onKeyDown(for: .toggleSneakPeek) { [weak self] in
            guard let self = self else { return }
            if Defaults[.sneakPeekStyles] == .inline {
                let newStatus = !self.coordinator.expandingView.show
                self.coordinator.toggleExpandingView(status: newStatus, type: .music)
            } else {
                self.coordinator.toggleSneakPeek(
                    status: !self.coordinator.sneakPeek.show,
                    type: .music,
                    duration: 3.0
                )
            }
        }

        KeyboardShortcuts.onKeyDown(for: .toggleNotchOpen) { [weak self] in
            Task { [weak self] in
                guard let self = self else { return }

                let mouseLocation = NSEvent.mouseLocation

                var viewModel = self.vm

                if Defaults[.showOnAllDisplays] {
                    for screen in NSScreen.screens {
                        if screen.frame.contains(mouseLocation) {
                            if let uuid = screen.displayUUID, let screenViewModel = self.viewModels[uuid] {
                                viewModel = screenViewModel
                                break
                            }
                        }
                    }
                }

                self.closeNotchTask?.cancel()
                self.closeNotchTask = nil

                switch viewModel.notchState {
                case .closed:
                    await MainActor.run {
                        viewModel.open()
                    }

                    let task = Task { [weak viewModel] in
                        do {
                            try await Task.sleep(for: .seconds(3))
                            await MainActor.run {
                                viewModel?.close()
                            }
                        } catch { }
                    }
                    self.closeNotchTask = task
                case .open:
                    await MainActor.run {
                        viewModel.close()
                    }
                }
            }
        }

        if !Defaults[.showOnAllDisplays] {
            let viewModel = self.vm
            let window = createNikiNotchWindow(
                for: NSScreen.main ?? NSScreen.screens.first!, with: viewModel)
            self.window = window
            adjustWindowPosition(changeAlpha: true)
        } else {
            adjustWindowPosition(changeAlpha: true)
        }

        setupDragDetectors()

        // La app vive como overlay (notch + barra de menú), sin icono de app normal en el dock.
        // La ventana de escritorio se abre bajo demanda desde el status item ("Abrir Niki").
        setupNikiStatusItem()
        setupDoubleTapShortcut()
        NSApp.setActivationPolicy(.accessory)
        // Barridos escalonados: SwiftUI re-muestra el WindowGroup tras el arranque, así que
        // ocultamos la cromática de escritorio varias veces hasta que se asiente.
        for delay in [0.2, 0.5, 0.9, 1.5] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.hideDesktopChromeOnLaunch()
            }
        }
        // Red de seguridad: si una ventana de escritorio se vuelve key antes de que el usuario
        // abra el shell, la ocultamos. Tras "Abrir Niki" (desktopShellRevealed) deja de actuar.
        NotificationCenter.default.addObserver(
            forName: NSWindow.didBecomeKeyNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let self, !self.desktopShellRevealed else { return }
            if let w = note.object as? NSWindow, !(w is NikiNotchSkyLightWindow) {
                w.orderOut(nil)
            }
        }

        if coordinator.firstLaunch {
            coordinator.firstLaunch = false
        } else if MusicManager.shared.isNowPlayingDeprecated
            && Defaults[.mediaController] == .nowPlaying
        {
            DispatchQueue.main.async {
                self.showOnboardingWindow(step: .musicPermission)
            }
        }

        previousScreens = NSScreen.screens
    }

    // MARK: - Public API for NikiAppModel

    func setupNotchWindows() {
        guard window == nil && windows.isEmpty else { return }
        adjustWindowPosition(changeAlpha: true)
        setupDragDetectors()
    }

    func openNotchSettings() {
        DispatchQueue.main.async {
            SettingsWindowController.shared.showWindow()
        }
    }

    func restartApp() {
        DispatchQueue.main.async {
            ApplicationRelauncher.restart()
        }
    }

    func openNotch() {
        DispatchQueue.main.async {
            if Defaults[.showOnAllDisplays] {
                self.viewModels.values.forEach { $0.open() }
            } else {
                self.vm.open()
            }
        }
    }

    func closeNotch() {
        DispatchQueue.main.async {
            self.closeNotchTask?.cancel()
            self.closeNotchTask = nil
            if Defaults[.showOnAllDisplays] {
                self.viewModels.values.forEach { $0.close() }
            } else {
                self.vm.close()
            }
        }
    }

    // MARK: - Misc

    func playWelcomeSound() {
        let audioPlayer = AudioPlayer()
        audioPlayer.play(fileName: "niki", fileExtension: "m4a")
    }

    func deviceHasNotch() -> Bool {
        if #available(macOS 12.0, *) {
            for screen in NSScreen.screens {
                if screen.safeAreaInsets.top > 0 {
                    return true
                }
            }
        }
        return false
    }

    @objc func screenConfigurationDidChange() {
        let currentScreens = NSScreen.screens

        let screensChanged =
            currentScreens.count != previousScreens?.count
            || Set(currentScreens.compactMap { $0.displayUUID })
                != Set(previousScreens?.compactMap { $0.displayUUID } ?? [])
            || Set(currentScreens.map { $0.frame }) != Set(previousScreens?.map { $0.frame } ?? [])

        previousScreens = currentScreens

        if screensChanged {
            DispatchQueue.main.async { [weak self] in
                self?.cleanupWindows()
                self?.adjustWindowPosition()
                self?.setupDragDetectors()
            }
        }
    }

    @objc func adjustWindowPosition(changeAlpha: Bool = false) {
        if Defaults[.showOnAllDisplays] {
            let currentScreenUUIDs = Set(NSScreen.screens.compactMap { $0.displayUUID })

            // Remove windows for screens that no longer exist
            for uuid in windows.keys where !currentScreenUUIDs.contains(uuid) {
                if let window = windows[uuid] {
                    window.close()
                    NotchSpaceManager.shared.notchSpace.windows.remove(window)
                    windows.removeValue(forKey: uuid)
                    viewModels.removeValue(forKey: uuid)
                }
            }

            // Create or update windows for all screens
            for screen in NSScreen.screens {
                guard let uuid = screen.displayUUID else { continue }

                if windows[uuid] == nil {
                    let viewModel = NikiNotchViewModel(screenUUID: uuid)
                    let window = createNikiNotchWindow(for: screen, with: viewModel)

                    windows[uuid] = window
                    viewModels[uuid] = viewModel
                }

                if let window = windows[uuid], let viewModel = viewModels[uuid] {
                    positionWindow(window, on: screen, changeAlpha: changeAlpha)

                    if viewModel.notchState == .closed {
                        viewModel.close()
                    }
                }
            }
        } else {
            let selectedScreen: NSScreen

            if let preferredScreen = NSScreen.screen(withUUID: coordinator.preferredScreenUUID ?? "") {
                coordinator.selectedScreenUUID = coordinator.preferredScreenUUID ?? ""
                selectedScreen = preferredScreen
            } else if Defaults[.automaticallySwitchDisplay], let mainScreen = NSScreen.main,
                      let mainUUID = mainScreen.displayUUID {
                coordinator.selectedScreenUUID = mainUUID
                selectedScreen = mainScreen
            } else {
                if let window = window {
                    window.alphaValue = 0
                }
                return
            }

            vm.screenUUID = selectedScreen.displayUUID
            vm.notchSize = getClosedNotchSize(screenUUID: selectedScreen.displayUUID)

            if window == nil {
                window = createNikiNotchWindow(for: selectedScreen, with: vm)
            }

            if let window = window {
                positionWindow(window, on: selectedScreen, changeAlpha: changeAlpha)

                if vm.notchState == .closed {
                    vm.close()
                }
            }
        }
    }

    @objc func togglePopover(_ sender: Any?) {
        if window?.isVisible == true {
            window?.orderOut(nil)
        } else {
            window?.orderFrontRegardless()
        }
    }

    @objc func showMenu() {
        statusItem?.menu?.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
    }

    // MARK: - Desktop shell (ventana de escritorio bajo demanda)

    /// El shell de escritorio (chat / STT Lab / orbe) registra su ventana al aparecer.
    /// La ocultamos al arrancar para que la app muestre SOLO el notch; se reabre desde el status item.
    func registerDesktopWindow(_ window: NSWindow) {
        // El WindowAccessor sólo vive en el ContentView del shell, así que esta ventana ES el
        // shell. La retenemos (strong) y evitamos que se libere al ocultarla, para reabrirla.
        window.isReleasedWhenClosed = false
        desktopWindow = window
    }

    /// La ventana del shell de escritorio (retenida). Fallback: la no-notch más ancha
    /// (el shell es 1440px; Settings 700px), nunca Settings por error.
    private func desktopShellWindow() -> NSWindow? {
        if let desktopWindow { return desktopWindow }
        return NSApp.windows
            .filter { !($0 is NikiNotchSkyLightWindow) }
            .max(by: { $0.frame.width < $1.frame.width })
    }

    /// Oculta al arrancar TODO lo que no sea el notch (ventana de escritorio, settings,
    /// onboarding). Corre con delay para ganarle a SwiftUI, que re-muestra el WindowGroup.
    private func hideDesktopChromeOnLaunch() {
        guard !desktopShellRevealed else { return }
        for w in NSApp.windows where !(w is NikiNotchSkyLightWindow) && w.isVisible {
            w.orderOut(nil)
        }
    }

    @objc func showDesktopShell() {
        desktopShellRevealed = true
        if let shell = desktopShellWindow() {
            desktopWindow = shell
            shell.makeKeyAndOrderFront(nil)
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func newChatAction() {
        appModel?.startFreshChatSession()
        showDesktopShell()
    }

    @objc func callAction() {
        appModel?.toggleSttLab()
        showDesktopShell()
    }

    @objc func muteAction() {
        appModel?.toggleCallMute()
    }

    @objc func openSettingsAction() {
        showDesktopShell()
        appModel?.selection = .settings
    }

    /// El menú se reconstruye al abrirse para reflejar el estado (en llamada, silenciado…).
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let inCall = appModel?.sttLabActive == true
        let muted = appModel?.callMuted == true

        menu.addItem(NSMenuItem(title: "Abrir Niki", action: #selector(showDesktopShell), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Nuevo chat", action: #selector(newChatAction), keyEquivalent: "n"))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: inCall ? "Colgar llamada" : "Llamar a Niki",
                                action: #selector(callAction), keyEquivalent: ""))
        if inCall {
            menu.addItem(NSMenuItem(title: muted ? "Reactivar micrófono" : "Silenciar micrófono",
                                    action: #selector(muteAction), keyEquivalent: "m"))
        }
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Configuración", action: #selector(openSettingsAction), keyEquivalent: ","))
        menu.addItem(NSMenuItem(title: "Salir", action: #selector(quitAction), keyEquivalent: "q"))
    }

    // MARK: - Doble toque de modificador para abrir Niki

    private func setupDoubleTapShortcut() {
        let handler: (NSEvent) -> Void = { [weak self] event in
            self?.handleFlagsChanged(event)
        }
        flagsMonitorGlobal = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { handler($0) }
        flagsMonitorLocal = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { handler($0); return $0 }
    }

    private func targetModifierFlag() -> NSEvent.ModifierFlags {
        switch appModel?.doubleTapModifier {
        case "command": return .command
        case "control": return .control
        case "shift": return .shift
        default: return .option
        }
    }

    private func handleFlagsChanged(_ event: NSEvent) {
        guard appModel?.doubleTapToOpenEnabled == true else { return }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let target = targetModifierFlag()

        if flags == target {
            // "Press" del modificador objetivo (sin otros modificadores).
            let now = Date()
            if let last = lastModifierTap, now.timeIntervalSince(last) < 0.4 {
                lastModifierTap = nil
                showDesktopShell()
            } else {
                lastModifierTap = now
            }
        } else if !flags.isEmpty {
            // Cualquier otra combinación reinicia la secuencia.
            lastModifierTap = nil
        }
    }

    private func setupNikiStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            button.image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "Niki")
            button.image?.isTemplate = true
        }
        let menu = NSMenu()
        menu.delegate = self  // menuNeedsUpdate reconstruye según el estado
        item.menu = menu
        statusItem = item
    }

    @objc func quitAction() {
        NSApplication.shared.terminate(self)
    }

    private func showOnboardingWindow(step: OnboardingStep = .welcome) {
        if onboardingWindowController == nil {
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 400, height: 600),
                styleMask: [.titled, .fullSizeContentView],
                backing: .buffered,
                defer: false
            )
            window.center()
            window.title = "Onboarding"
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.contentView = NSHostingView(
                rootView: OnboardingView(
                    step: step,
                    onFinish: {
                        window.orderOut(nil)
                        window.close()
                        NSApp.deactivate()
                    },
                    onOpenSettings: {
                        window.close()
                        SettingsWindowController.shared.showWindow()
                    }
                ))
            window.isRestorable = false
            window.identifier = NSUserInterfaceItemIdentifier("OnboardingWindow")

            onboardingWindowController = NSWindowController(window: window)
        }

        NSApp.activate(ignoringOtherApps: true)
        onboardingWindowController?.window?.makeKeyAndOrderFront(nil)
        onboardingWindowController?.window?.orderFrontRegardless()
    }
}

extension Notification.Name {
    static let selectedScreenChanged = Notification.Name("SelectedScreenChanged")
    static let notchHeightChanged = Notification.Name("NotchHeightChanged")
    static let showOnAllDisplaysChanged = Notification.Name("showOnAllDisplaysChanged")
    static let automaticallySwitchDisplayChanged = Notification.Name("automaticallySwitchDisplayChanged")
    static let expandedDragDetectionChanged = Notification.Name("expandedDragDetectionChanged")
}

extension CGRect: @retroactive Hashable {
    public func hash(into hasher: inout Hasher) {
        hasher.combine(origin.x)
        hasher.combine(origin.y)
        hasher.combine(size.width)
        hasher.combine(size.height)
    }

    public static func == (lhs: CGRect, rhs: CGRect) -> Bool {
        return lhs.origin == rhs.origin && lhs.size == rhs.size
    }
}
