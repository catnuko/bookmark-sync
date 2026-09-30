// main.swift — 菜单栏 App 入口（SwiftPM executable，纯代码，无 Info.plist）。
//
// 要点：
//   - setActivationPolicy(.accessory)：菜单栏工具不占 Dock、不抢焦点；
//   - SwiftPM executable 直接产可执行文件，swift build 即可运行，
//     Xcode 仅用于后续签名/公证/真机调试。

import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
