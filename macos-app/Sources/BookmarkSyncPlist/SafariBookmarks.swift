// SafariBookmarks.swift — ~/Library/Safari/Bookmarks.plist 的宽容解析（M3）。
//
// 「宽容」= 字段缺失/类型不符一律兜底、损坏节点跳过、未知类型保留，
// 解析绝不因单条脏数据整体失败（plist 无官方 schema，fixture 测试矩阵是回归防线）。
//
// 字段映射（对照 scripts/safari-bookmarks-probe.py 与真实 plist 样本）：
//   WebBookmarkType       → kind（WebBookmarkTypeList / WebBookmarkTypeLeaf / 其他）
//   WebBookmarkIdentifier → identifier（书签/文件夹的稳定 id）
//   WebBookmarkUUID       → uuid（可选）
//   URIDictionary.title   → title（leaf 的本地化标题，优先于 WebBookmarkTitle）
//   WebBookmarkTitle      → title 兜底 / ReadingList 文件夹标记
//   URLString             → url（仅 leaf）
//   Children              → children（仅 folder）

import Foundation

/// Safari 书签节点（宽容解析后的稳定模型，后续 M5 树 → MoveOps 的输入）。
public struct SafariBookmark {
    public enum Kind: Equatable, Sendable {
        case folder // WebBookmarkTypeList
        case bookmark // WebBookmarkTypeLeaf
        case other // 未知 / 代理类型（WebBookmarkTypeProxyWeb 等），保留不展开
    }

    public let kind: Kind
    public let identifier: String
    public let uuid: String?
    public let title: String
    public let url: String?
    /// 自身是否为 ReadingList 文件夹（WebBookmarkTitle == "com.apple.ReadingList"）。
    public let readingList: Bool
    public let children: [SafariBookmark]

    public init(
        kind: Kind,
        identifier: String,
        uuid: String?,
        title: String,
        url: String?,
        readingList: Bool,
        children: [SafariBookmark]
    ) {
        self.kind = kind
        self.identifier = identifier
        self.uuid = uuid
        self.title = title
        self.url = url
        self.readingList = readingList
        self.children = children
    }
}

/// 解析入口与统计（与 scripts/safari-bookmarks-probe.py 的 count/top_level 对齐）。
public enum SafariBookmarks {

    /// Safari 书签文件路径（用户主目录下，无需硬编码用户名）。
    public static var plistPath: String {
        NSHomeDirectory() + "/Library/Safari/Bookmarks.plist"
    }

    public static let readingListTitle = "com.apple.ReadingList"

    /// 从 plist 反序列化出的根字典解析出顶层节点。
    /// `root` 不是字典时返回空（不抛错）。
    public static func parse(_ root: Any) -> [SafariBookmark] {
        guard let dict = root as? [String: Any] else { return [] }
        return parseChildren(dict["Children"] as? [Any])
    }

    private static func parseChildren(_ raw: Any?) -> [SafariBookmark] {
        guard let items = raw as? [Any] else { return [] }
        // compactMap：非字典项（脏数据）直接跳过，不影响其余解析。
        return items.compactMap { item -> SafariBookmark? in
            guard let dict = item as? [String: Any] else { return nil }
            return parseNode(dict)
        }
    }

    private static func parseNode(_ dict: [String: Any]) -> SafariBookmark {
        let type = dict["WebBookmarkType"] as? String ?? ""
        let kind: SafariBookmark.Kind =
            type == "WebBookmarkTypeList" ? .folder
            : type == "WebBookmarkTypeLeaf" ? .bookmark
            : .other

        let identifier = dict["WebBookmarkIdentifier"] as? String ?? ""
        let uuid = dict["WebBookmarkUUID"] as? String

        // title 优先级：URIDictionary.title（本地化标题）→ WebBookmarkTitle → identifier 兜底。
        let uriTitle = (dict["URIDictionary"] as? [String: Any])?["title"] as? String
        let webTitle = dict["WebBookmarkTitle"] as? String
        let title = uriTitle ?? webTitle ?? (identifier.isEmpty ? "未命名" : identifier)

        let url = dict["URLString"] as? String
        let readingList = webTitle == readingListTitle
        let children = kind == .folder ? parseChildren(dict["Children"]) : []

        return SafariBookmark(
            kind: kind,
            identifier: identifier,
            uuid: uuid,
            title: title,
            url: url,
            readingList: readingList,
            children: children
        )
    }

    // MARK: - 统计

    public struct Stats: Equatable, Sendable {
        public let folders: Int
        public let bookmarks: Int
        public let reading: Int

        public init(folders: Int, bookmarks: Int, reading: Int) {
            self.folders = folders
            self.bookmarks = bookmarks
            self.reading = reading
        }
    }

    /// 递归统计：reading 计 ReadingList 文件夹（含嵌套）下的书签数。
    /// 语义与 probe.py count() 对齐。
    public static func stats(of nodes: [SafariBookmark]) -> Stats {
        var folders = 0
        var bookmarks = 0
        var reading = 0

        func walk(_ list: [SafariBookmark], inReadingFolder: Bool) {
            for node in list {
                switch node.kind {
                case .folder:
                    folders += 1
                    walk(node.children, inReadingFolder: inReadingFolder || node.readingList)
                case .bookmark:
                    bookmarks += 1
                    if inReadingFolder { reading += 1 }
                case .other:
                    break
                }
            }
        }

        walk(nodes, inReadingFolder: false)
        return Stats(folders: folders, bookmarks: bookmarks, reading: reading)
    }
}
