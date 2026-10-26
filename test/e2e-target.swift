// A focused text box for test/e2e.mjs to type into on macOS.
//
//     e2e-target <out-file> <ready-file>
//
// Mirrors the box's contents into <out-file> on every change, and writes
// <ready-file> once the app is frontmost.
import AppKit

let args = CommandLine.arguments
let outFile = URL(fileURLWithPath: args[1])
let readyFile = URL(fileURLWithPath: args[2])

final class Target: NSObject, NSApplicationDelegate, NSTextViewDelegate {
  var window: NSWindow!
  var textView: NSTextView!

  func applicationDidFinishLaunching(_ notification: Notification) {
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    window.title = "Type Deck e2e target"
    window.level = .floating

    textView = NSTextView(frame: window.contentView!.bounds)
    textView.autoresizingMask = [.width, .height]
    textView.isRichText = false
    // Typed text must land verbatim: no smart quotes, dashes or autocorrect.
    textView.isAutomaticQuoteSubstitutionEnabled = false
    textView.isAutomaticDashSubstitutionEnabled = false
    textView.isAutomaticTextReplacementEnabled = false
    textView.isAutomaticSpellingCorrectionEnabled = false
    textView.delegate = self
    window.contentView!.addSubview(textView)

    window.center()
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(textView)
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationDidBecomeActive(_ notification: Notification) {
    try? "ready".write(to: readyFile, atomically: true, encoding: .utf8)
  }

  func textDidChange(_ notification: Notification) {
    try? textView.string.write(to: outFile, atomically: true, encoding: .utf8)
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let target = Target()
app.delegate = target
app.run()
