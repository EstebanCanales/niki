import AppKit
import SwiftUI

struct NikiComposerTextView: NSViewRepresentable {
    @Binding var text: String
    var isEditable: Bool
    var onSubmit: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.borderType = .noBorder
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay

        let textView = SubmitAwareTextView()
        textView.delegate = context.coordinator
        textView.onSubmit = onSubmit
        textView.string = text
        textView.drawsBackground = false
        textView.font = .systemFont(ofSize: 14, weight: .medium)
        textView.textColor = .white
        textView.insertionPointColor = .white
        textView.isRichText = false
        textView.importsGraphics = false
        textView.isContinuousSpellCheckingEnabled = false
        textView.isGrammarCheckingEnabled = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.textContainerInset = NSSize(width: 0, height: 7)
        textView.textContainer?.lineFragmentPadding = 0
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: 34)
        textView.minSize = NSSize(width: 0, height: 34)
        textView.isVerticallyResizable = false
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.containerSize = NSSize(width: 0, height: 34)
        textView.textContainer?.widthTracksTextView = true

        scrollView.documentView = textView
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? SubmitAwareTextView else { return }
        if textView.string != text {
            textView.string = text
        }
        textView.isEditable = isEditable
        textView.onSubmit = onSubmit
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        @Binding var text: String

        init(text: Binding<String>) {
            _text = text
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            text = textView.string
        }
    }
}

final class SubmitAwareTextView: NSTextView {
    var onSubmit: (() -> Void)?

    override func keyDown(with event: NSEvent) {
        let isEnter = event.keyCode == 36 || event.keyCode == 76
        if isEnter {
            if event.modifierFlags.contains(.shift) {
                insertNewline(nil)
            } else {
                onSubmit?()
            }
            return
        }

        super.keyDown(with: event)
    }
}
