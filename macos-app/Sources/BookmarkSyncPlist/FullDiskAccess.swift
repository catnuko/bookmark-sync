// FullDiskAccess.swift — 「完全磁盘访问」（FDA / TCC）检测与引导（M3）。
//
// 读 ~/Library/Safari/Bookmarks.plist 需要 FDA；未授权时打开文件抛 EPERM。
// isReadableFile 在 TCC 下可能误报 true，所以用 FileHandle 实际打开作为判据。

import AppKit
import Foundation

public enum FullDiskAccess {

    /// 能否读到 Safari 书签（FDA 授权的直接判据）。
    /// TCC 未授权时 FileHandle(forReadingFrom:) 抛错 → false。
    public static func canReadBookmarks() -> Bool {
        let url = URL(fileURLWithPath: SafariBookmarks.plistPath)
        guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
        handle.closeFile()
        return true
    }

    /// 尝试读取并解析书签；nil = 未授权 / 文件缺失 / plist 损坏（调用方自行区分）。
    public static func loadBookmarks() -> [SafariBookmark]? {
        let url = URL(fileURLWithPath: SafariBookmarks.plistPath)
        guard let data = try? Data(contentsOf: url) else { return nil }
        guard let root = try? PropertyListSerialization.propertyList(
            from: data,
            options: [],
            format: nil
        ) else { return nil }
        return SafariBookmarks.parse(root)
    }

    /// 打开系统设置「完全磁盘访问」面板。
    /// macOS 13+ 两种 URL 形态（?Privacy_AllFiles 与 ?Privacy=AllFiles）逐一尝试。
    @discardableResult
    public static func openSystemSettings() -> Bool {
        let candidates = [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
            "x-apple.systempreferences:com.apple.preference.security?Privacy=AllFiles",
        ]
        for urlString in candidates {
            if let url = URL(string: urlString), NSWorkspace.shared.open(url) {
                return true
            }
        }
        return false
    }
}
