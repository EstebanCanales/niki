import SwiftUI
import WebKit
import SceneKit

/// Panel de contenido que aparece cuando Niki activa una "surface" (búsqueda, mapa, modelo 3D)
/// mientras habla — el orbe se retira a una esquina y este panel ocupa el espacio libre.
struct NikiSurfacePanel: View {
    let surface: NikiRuntimeSurface
    let onDismiss: () -> Void

    var body: some View {
        NikiGlassPanel(cornerRadius: 28, blurBackground: true) {
            VStack(spacing: 0) {
                header
                Divider().overlay(Color.white.opacity(0.08))
                content(for: surface)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: iconName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.75))

            VStack(alignment: .leading, spacing: 2) {
                Text(surface.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.92))
                if let subtitle = surface.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.5))
                }
            }

            Spacer()

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.65))
                    .padding(7)
                    .background(Circle().fill(Color.white.opacity(0.08)))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var iconName: String {
        switch surface.kind {
        case .search: return "magnifyingglass"
        case .map: return "map"
        case .model3d: return "cube.transparent"
        }
    }

    @ViewBuilder
    private func content(for surface: NikiRuntimeSurface) -> some View {
        switch surface.kind {
        case .search:
            if let url = surface.url, let target = URL(string: url) {
                NikiWebSurfaceView(url: target)
            } else {
                NikiSurfaceEmptyState(text: "Sin resultados de búsqueda todavía.")
            }
        case .map:
            NikiWebSurfaceView(url: mapURL)
        case .model3d:
            if let modelUrl = surface.modelUrl, let url = URL(string: modelUrl) {
                NikiModel3DSurfaceView(url: url)
            } else {
                NikiModel3DPlaceholderView(subject: surface.subtitle ?? surface.query ?? "")
            }
        }
    }

    private var mapURL: URL {
        let query = surface.location?.address
            ?? surface.location?.label
            ?? surface.subtitle
            ?? surface.query
            ?? ""
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""

        // Coordenadas reales (geocodificadas en el backend) dan un pin preciso;
        // sin ellas, Apple Maps solo puede adivinar a partir del texto.
        if let lat = surface.location?.lat, let lng = surface.location?.lng {
            return URL(string: "https://maps.apple.com/?ll=\(lat),\(lng)&q=\(encoded)")
                ?? URL(string: "https://maps.apple.com")!
        }
        return URL(string: "https://maps.apple.com/?q=\(encoded)") ?? URL(string: "https://maps.apple.com")!
    }
}

private struct NikiSurfaceEmptyState: View {
    let text: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "tray")
                .font(.system(size: 22))
                .foregroundStyle(Color.white.opacity(0.3))
            Text(text)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.45))
        }
    }
}

// MARK: - Web content (search / map)

private struct NikiWebSurfaceView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero)
        view.load(URLRequest(url: url))
        return view
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        if nsView.url != url {
            nsView.load(URLRequest(url: url))
        }
    }
}

// MARK: - 3D model content

private struct NikiModel3DSurfaceView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> SCNView {
        let view = SCNView(frame: .zero)
        view.scene = (try? SCNScene(url: url, options: nil)) ?? SCNScene()
        view.allowsCameraControl = true
        view.autoenablesDefaultLighting = true
        view.backgroundColor = .clear
        return view
    }

    func updateNSView(_ nsView: SCNView, context: Context) {}
}

private struct NikiModel3DPlaceholderView: View {
    let subject: String

    var body: some View {
        VStack(spacing: 10) {
            NikiSpinningCubeView()
                .frame(width: 140, height: 140)
            Text(subject.isEmpty ? "Modelo 3D no disponible todavía." : "Sin modelo para \"\(subject)\" todavía.")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.45))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
    }
}

private struct NikiSpinningCubeView: NSViewRepresentable {
    func makeNSView(context: Context) -> SCNView {
        let view = SCNView(frame: .zero)
        let scene = SCNScene()
        let box = SCNBox(width: 1.4, height: 1.4, length: 1.4, chamferRadius: 0.12)
        box.firstMaterial?.diffuse.contents = NSColor.white.withAlphaComponent(0.18)
        box.firstMaterial?.specular.contents = NSColor.white
        let node = SCNNode(geometry: box)
        node.runAction(.repeatForever(.rotateBy(x: 0.6, y: 1, z: 0, duration: 4)))
        scene.rootNode.addChildNode(node)

        let cameraNode = SCNNode()
        cameraNode.camera = SCNCamera()
        cameraNode.position = SCNVector3(0, 0, 4)
        scene.rootNode.addChildNode(cameraNode)

        view.scene = scene
        view.backgroundColor = .clear
        view.autoenablesDefaultLighting = true
        return view
    }

    func updateNSView(_ nsView: SCNView, context: Context) {}
}
