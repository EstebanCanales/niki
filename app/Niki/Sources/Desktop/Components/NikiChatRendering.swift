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
                NikiThinkingOrbView(state: .composing, size: 28, accentHex: "#7bdcff", speed: 1.1)
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
