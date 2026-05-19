import AppKit
import Cocoa
import Foundation

struct SyncPayload: Decodable {
  let type: String
  let visible: Bool?
  let x: Int?
  let y: Int?
  let collapsedWidth: Double?
  let collapsedHeight: Double?
  let expandedWidth: Double?
  let expandedHeight: Double?
  let alwaysOnTop: Bool?
  let visibleOnAllWorkspaces: Bool?
  let bundleId: String?
}

final class HoverView: NSView {
  var onHoverChange: ((Bool) -> Void)?
  private var trackingAreaRef: NSTrackingArea?

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingAreaRef {
      removeTrackingArea(trackingAreaRef)
    }
    let next = NSTrackingArea(
      rect: bounds,
      options: [.activeAlways, .mouseEnteredAndExited, .inVisibleRect],
      owner: self,
      userInfo: nil
    )
    addTrackingArea(next)
    trackingAreaRef = next
  }

  override func mouseEntered(with event: NSEvent) {
    onHoverChange?(true)
  }

  override func mouseExited(with event: NSEvent) {
    onHoverChange?(false)
  }
}

final class NotchPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

final class NotchShapeLayer: CAShapeLayer {
  var topCornerRadius: CGFloat = 6
  var bottomCornerRadius: CGFloat = 14

  override func layoutSublayers() {
    super.layoutSublayers()
    path = notchPath(in: bounds).cgPath
  }

  private func notchPath(in rect: CGRect) -> NSBezierPath {
    let path = NSBezierPath()
    path.move(to: CGPoint(x: rect.minX, y: rect.minY))
    path.curve(
      to: CGPoint(x: rect.minX + topCornerRadius, y: rect.minY + topCornerRadius),
      controlPoint1: CGPoint(x: rect.minX + topCornerRadius, y: rect.minY),
      controlPoint2: CGPoint(x: rect.minX + topCornerRadius, y: rect.minY + topCornerRadius)
    )
    path.line(to: CGPoint(x: rect.minX + topCornerRadius, y: rect.maxY - bottomCornerRadius))
    path.curve(
      to: CGPoint(x: rect.minX + topCornerRadius + bottomCornerRadius, y: rect.maxY),
      controlPoint1: CGPoint(x: rect.minX + topCornerRadius, y: rect.maxY),
      controlPoint2: CGPoint(x: rect.minX + topCornerRadius + bottomCornerRadius, y: rect.maxY)
    )
    path.line(to: CGPoint(x: rect.maxX - topCornerRadius - bottomCornerRadius, y: rect.maxY))
    path.curve(
      to: CGPoint(x: rect.maxX - topCornerRadius, y: rect.maxY - bottomCornerRadius),
      controlPoint1: CGPoint(x: rect.maxX - topCornerRadius, y: rect.maxY),
      controlPoint2: CGPoint(x: rect.maxX - topCornerRadius, y: rect.maxY - bottomCornerRadius)
    )
    path.line(to: CGPoint(x: rect.maxX - topCornerRadius, y: rect.minY + topCornerRadius))
    path.curve(
      to: CGPoint(x: rect.maxX, y: rect.minY),
      controlPoint1: CGPoint(x: rect.maxX - topCornerRadius, y: rect.minY),
      controlPoint2: CGPoint(x: rect.maxX, y: rect.minY)
    )
    path.close()
    return path
  }
}

final class NotchController {
  private let window: NSWindow
  private let hoverView: HoverView
  private let shapeLayer = NotchShapeLayer()
  private let glowLayer = CAGradientLayer()

  private var visible = true
  private var hovered = false
  private var centerX: CGFloat = 0
  private var baseY: CGFloat = 0
  private var collapsedWidth: CGFloat = 185
  private var collapsedHeight: CGFloat = 34
  private var expandedWidth: CGFloat = 760
  private var expandedHeight: CGFloat = 340

  init() {
    hoverView = HoverView(frame: NSRect(x: 0, y: 0, width: 760, height: 340))
    window = NotchPanel(
      contentRect: hoverView.frame,
      styleMask: [.borderless],
      backing: .buffered,
      defer: false
    )

    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.level = .mainMenu + 3
    window.ignoresMouseEvents = false
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
    window.isMovable = false
    window.hidesOnDeactivate = false
    window.appearance = NSAppearance(named: .darkAqua)

    hoverView.wantsLayer = true
    hoverView.layer = CALayer()
    hoverView.layer?.masksToBounds = false

    shapeLayer.fillColor = NSColor(calibratedRed: 0.02, green: 0.03, blue: 0.06, alpha: 0.98).cgColor
    shapeLayer.strokeColor = NSColor(calibratedRed: 0.42, green: 0.72, blue: 1, alpha: 0.36).cgColor
    shapeLayer.lineWidth = 1.2
    shapeLayer.shadowColor = NSColor.black.cgColor
    shapeLayer.shadowOpacity = 0.58
    shapeLayer.shadowRadius = 34
    shapeLayer.shadowOffset = CGSize(width: 0, height: -2)

    glowLayer.colors = [
      NSColor(calibratedRed: 0.34, green: 0.62, blue: 1, alpha: 0.22).cgColor,
      NSColor.clear.cgColor
    ]
    glowLayer.startPoint = CGPoint(x: 0.5, y: 1)
    glowLayer.endPoint = CGPoint(x: 0.5, y: 0)

    hoverView.layer?.addSublayer(shapeLayer)
    hoverView.layer?.addSublayer(glowLayer)

    hoverView.onHoverChange = { [weak self] hovered in
      self?.hovered = hovered
      self?.applyFrame(animated: true)
    }

    window.contentView = hoverView
    applyFrame(animated: false)
    window.orderFrontRegardless()
  }

  func sync(_ payload: SyncPayload) {
    visible = payload.visible ?? visible
    centerX = CGFloat(payload.x ?? Int(centerX))
    baseY = CGFloat(payload.y ?? Int(baseY))
    collapsedWidth = CGFloat(payload.collapsedWidth ?? Double(collapsedWidth))
    collapsedHeight = CGFloat(payload.collapsedHeight ?? Double(collapsedHeight))
    expandedWidth = CGFloat(payload.expandedWidth ?? Double(expandedWidth))
    expandedHeight = CGFloat(payload.expandedHeight ?? Double(expandedHeight))

    window.level = (payload.alwaysOnTop ?? true) ? (.mainMenu + 3) : .statusBar

    if payload.visibleOnAllWorkspaces ?? true {
      window.collectionBehavior.insert(.canJoinAllSpaces)
    } else {
      window.collectionBehavior.remove(.canJoinAllSpaces)
    }

    if let screen = resolvedScreen() {
      collapsedWidth = recommendedClosedWidth(for: screen)
    }

    hovered = true
    applyFrame(animated: false)

    if visible {
      window.orderFrontRegardless()
    } else {
      window.orderOut(nil)
    }
  }

  func close() {
    NSApp.terminate(nil)
  }

  private func applyFrame(animated: Bool) {
    if let screen = resolvedScreen() {
      collapsedWidth = recommendedClosedWidth(for: screen)
    }

    let width = hovered ? expandedWidth : collapsedWidth
    let height = hovered ? expandedHeight : collapsedHeight
    let frame = resolvedFrame(width: width, height: height)

    if animated {
      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.22
        context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        window.animator().setFrame(frame, display: true)
      }
    } else {
      window.setFrame(frame, display: true)
    }

    hoverView.frame = NSRect(origin: .zero, size: frame.size)
    hoverView.layer?.frame = hoverView.bounds

    shapeLayer.frame = hoverView.bounds
    shapeLayer.topCornerRadius = hovered ? 19 : 6
    shapeLayer.bottomCornerRadius = hovered ? 24 : 14
    shapeLayer.setNeedsLayout()

    glowLayer.frame = hoverView.bounds
    glowLayer.mask = shapeLayer
  }

  private func resolvedScreen() -> NSScreen? {
    let targetPoint = NSPoint(x: centerX, y: baseY)
    return NSScreen.screens.first(where: { screen in
      let frame = screen.visibleFrame
      let topLeftY = screen.frame.maxY - frame.maxY
      let screenTopLeftRect = NSRect(
        x: frame.minX,
        y: topLeftY,
        width: frame.width,
        height: frame.height
      )
      return screenTopLeftRect.contains(targetPoint)
    }) ?? NSScreen.main ?? NSScreen.screens.first
  }

  private func recommendedClosedWidth(for screen: NSScreen) -> CGFloat {
    if let topLeft = screen.auxiliaryTopLeftArea?.width,
       let topRight = screen.auxiliaryTopRightArea?.width {
      return max(185, screen.frame.width - topLeft - topRight + 4)
    }
    return 185
  }

  private func resolvedFrame(width: CGFloat, height: CGFloat) -> NSRect {
    let screen = resolvedScreen()

    guard let screen else {
      return NSRect(x: centerX - width / 2, y: baseY, width: width, height: height)
    }

    let visibleFrame = screen.visibleFrame
    let topInset = baseY - (screen.frame.maxY - visibleFrame.maxY)
    let targetX = centerX - width / 2
    let clampedX = max(
      visibleFrame.minX,
      min(targetX, visibleFrame.maxX - width)
    )
    let macY = visibleFrame.maxY - topInset - height

    return NSRect(
      x: clampedX,
      y: max(visibleFrame.minY, macY),
      width: width,
      height: height
    )
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  private let controller = NotchController()

  func applicationDidFinishLaunching(_ notification: Notification) {
    FileHandle.standardInput.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      if data.isEmpty {
        DispatchQueue.main.async { self?.controller.close() }
        return
      }

      guard let text = String(data: data, encoding: .utf8) else { return }
      for line in text.split(separator: "\n") {
        guard let json = String(line).data(using: .utf8) else { continue }
        guard let payload = try? JSONDecoder().decode(SyncPayload.self, from: json) else { continue }
        DispatchQueue.main.async {
          if payload.type == "close" {
            self?.controller.close()
          } else {
            self?.controller.sync(payload)
          }
        }
      }
    }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.accessory)
app.delegate = delegate
app.run()
