import AppKit
import SwiftUI

enum NikiMessageBlock: Identifiable, Hashable {
    case text(String)
    case code(String, String?)

    var id: String {
        switch self {
        case let .text(value):
            return "text:\(value.hashValue)"
        case let .code(value, language):
            return "code:\(language ?? "plain"):\(value.hashValue)"
        }
    }
}

enum NikiAttachmentPreviewPayload: Identifiable {
    case image(NikiChatAttachment, NSImage)
    case text(NikiChatAttachment, String)
    case file(NikiChatAttachment)

    var id: String {
        switch self {
        case let .image(attachment, _):
            return attachment.id
        case let .text(attachment, _):
            return attachment.id
        case let .file(attachment):
            return attachment.id
        }
    }
}

struct NikiMessageContentView: View {
    let message: NikiChatMessage

    private var blocks: [NikiMessageBlock] {
        NikiMessageRenderer.blocks(from: message.content)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if blocks.isEmpty, message.role == .assistant, message.content.isEmpty {
                DotmHex10LoaderView(size: 28, dotSize: 3.4, speed: 1.1, bloom: true, colorPreset: .aurora)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 8)
            } else {
                ForEach(blocks) { block in
                    switch block {
                    case let .text(value):
                        Text(value)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.94))
                            .lineSpacing(2)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    case let .code(value, language):
                        VStack(alignment: .leading, spacing: 10) {
                            if let language, !language.isEmpty {
                                Text(language.uppercased())
                                    .font(.system(size: 10, weight: .bold))
                                    .tracking(1.8)
                                    .foregroundStyle(Color.white.opacity(0.36))
                            }
                            ScrollView(.horizontal, showsIndicators: false) {
                                Text(value)
                                    .font(.system(size: 13, weight: .regular, design: .monospaced))
                                    .foregroundStyle(Color.white.opacity(0.86))
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(Color.black.opacity(0.28))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                                        .stroke(Color.white.opacity(0.07), lineWidth: 1)
                                )
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }
}

enum DotmHex10ColorPreset {
    case aurora

    var colors: [Color] {
        switch self {
        case .aurora:
            return [
                Color(red: 0.42, green: 0.78, blue: 1.0),
                Color(red: 0.68, green: 0.98, blue: 0.76),
                Color(red: 0.92, green: 0.72, blue: 1.0)
            ]
        }
    }
}

struct DotmHex10LoaderView: View {
    var size: CGFloat = 32
    var dotSize: CGFloat = 4
    var speed: Double = 1
    var bloom = false
    var opacityBase: Double = 0.12
    var opacityMid: Double = 0.42
    var opacityPeak: Double = 0.95
    var colorPreset: DotmHex10ColorPreset = .aurora
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let activeCells: [(x: Int, y: Int)] = [
        (1, 0), (2, 0), (3, 0),
        (0, 1), (1, 1), (2, 1), (3, 1), (4, 1),
        (0, 2), (1, 2), (2, 2), (3, 2), (4, 2),
        (0, 3), (1, 3), (2, 3), (3, 3), (4, 3),
        (1, 4), (2, 4), (3, 4)
    ]

    var body: some View {
        TimelineView(.animation) { timeline in
            let phase = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate * max(speed, 0.1)
            ZStack {
                ForEach(Array(activeCells.enumerated()), id: \.offset) { index, cell in
                    let opacity = opacity(for: index, phase: phase)
                    Circle()
                        .fill(color(for: index).opacity(opacity))
                        .frame(width: dotSize, height: dotSize)
                        .shadow(
                            color: bloom ? color(for: index).opacity(max(0, opacity - 0.35)) : .clear,
                            radius: bloom ? 6 * opacity : 0
                        )
                        .position(position(for: cell))
                }
            }
            .frame(width: size, height: size)
            .accessibilityLabel("Loading")
        }
    }

    private func position(for cell: (x: Int, y: Int)) -> CGPoint {
        let step = (size - dotSize) / 4
        return CGPoint(
            x: dotSize / 2 + CGFloat(cell.x) * step,
            y: dotSize / 2 + CGFloat(cell.y) * step
        )
    }

    private func opacity(for index: Int, phase: Double) -> Double {
        let wave = (sin(phase * 3.2 + Double(index) * 0.72) + 1) / 2
        if wave < 0.5 {
            return opacityBase + (opacityMid - opacityBase) * (wave / 0.5)
        }
        return opacityMid + (opacityPeak - opacityMid) * ((wave - 0.5) / 0.5)
    }

    private func color(for index: Int) -> Color {
        let colors = colorPreset.colors
        return colors[index % colors.count]
    }
}

enum NikiMessageRenderer {
    static func blocks(from raw: String) -> [NikiMessageBlock] {
        let normalized = raw
            .replacingOccurrences(of: #"\[\[[^\]]+\]\]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\r\n"#, with: "\n", options: .regularExpression)
            .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !normalized.isEmpty else { return [] }

        var blocks: [NikiMessageBlock] = []
        var cursor = normalized.startIndex

        while let start = normalized[cursor...].range(of: "```") {
            let before = String(normalized[cursor..<start.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !before.isEmpty {
                blocks.append(.text(before))
            }

            let fenceStart = start.upperBound
            guard let end = normalized[fenceStart...].range(of: "```") else {
                let tail = String(normalized[start.lowerBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                if !tail.isEmpty {
                    blocks.append(.text(tail))
                }
                cursor = normalized.endIndex
                break
            }

            let fencedBody = String(normalized[fenceStart..<end.lowerBound])
            let lines = fencedBody.components(separatedBy: "\n")
            let language = lines.first?.trimmingCharacters(in: .whitespacesAndNewlines)
            let codeLines = Array(lines.dropFirst())
            let code = (codeLines.isEmpty ? lines : codeLines).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !code.isEmpty {
                blocks.append(.code(code, language))
            }

            cursor = end.upperBound
        }

        if cursor < normalized.endIndex {
            let tail = String(normalized[cursor...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !tail.isEmpty {
                blocks.append(.text(tail))
            }
        }

        return blocks.isEmpty ? [.text(normalized)] : blocks
    }
}

enum NikiAttachmentPreviewLoader {
    static func load(for attachment: NikiChatAttachment) -> NikiAttachmentPreviewPayload {
        let url = URL(fileURLWithPath: attachment.path)
        if isImage(attachment.kind), let image = NSImage(contentsOf: url) {
            return .image(attachment, image)
        }
        if isText(attachment.kind), let data = try? Data(contentsOf: url), let value = decodeText(data) {
            return .text(attachment, value)
        }
        return .file(attachment)
    }

    private static func isImage(_ kind: String) -> Bool {
        ["png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "bmp"].contains(kind.lowercased())
    }

    private static func isText(_ kind: String) -> Bool {
        ["txt", "md", "json", "js", "ts", "tsx", "swift", "py", "rb", "go", "rs", "html", "css", "yml", "yaml", "xml", "csv", "log"].contains(kind.lowercased())
    }

    private static func decodeText(_ data: Data) -> String? {
        String(data: data, encoding: .utf8)
            ?? String(data: data, encoding: .unicode)
            ?? String(data: data, encoding: .ascii)
    }
}
