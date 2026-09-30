// SafariBookmarksTests.swift — plist 宽容解析的 fixture 测试矩阵（M3 回归防线）。
//
// 覆盖：类型映射、title 优先级、url 提取、ReadingList 标记、损坏节点保留、
// 非字典项跳过、统计对齐（probe.py count 语义）。

import XCTest
@testable import BookmarkSyncPlist

final class SafariBookmarksTests: XCTestCase {

    /// 模拟一份接近真实 Safari 的 Bookmarks.plist 根字典。
    /// 刻意混入：损坏 leaf（缺 title/url）、字符串脏项、未知类型（ProxyWeb）。
    private func makeFixture() -> [String: Any] {
        return [
            "WebBookmarkFileVersion": 1,
            "WebBookmarkType": "WebBookmarkTypeList",
            "WebBookmarkIdentifier": "Root",
            "WebBookmarkTitle": "",
            "Children": [
                // 1. FavoritesBar 文件夹：2 个 leaf（一个正常、一个损坏）
                [
                    "WebBookmarkType": "WebBookmarkTypeList",
                    "WebBookmarkIdentifier": "FavoritesBar",
                    "WebBookmarkTitle": "FavoritesBar",
                    "Children": [
                        [
                            "WebBookmarkType": "WebBookmarkTypeLeaf",
                            "WebBookmarkIdentifier": "leaf-1",
                            "WebBookmarkTitle": "Example",
                            "URLString": "https://example.com",
                            "URIDictionary": ["title": "Example 首页"],
                        ],
                        [
                            "WebBookmarkType": "WebBookmarkTypeLeaf",
                            "WebBookmarkIdentifier": "leaf-broken",
                        ],
                    ],
                ],
                // 2. ReadingList 文件夹：1 个 leaf
                [
                    "WebBookmarkType": "WebBookmarkTypeList",
                    "WebBookmarkIdentifier": "ReadingList",
                    "WebBookmarkTitle": "com.apple.ReadingList",
                    "Children": [
                        [
                            "WebBookmarkType": "WebBookmarkTypeLeaf",
                            "WebBookmarkIdentifier": "rl-1",
                            "WebBookmarkTitle": "Article",
                            "URLString": "https://news.example.com/a",
                        ],
                    ],
                ],
                // 3. 脏项：字符串（非字典）应被跳过
                "garbage-string-item",
                // 4. 未知类型：保留为 .other，不展开
                [
                    "WebBookmarkType": "WebBookmarkTypeProxyWeb",
                    "WebBookmarkIdentifier": "proxy-1",
                ],
            ],
        ]
    }

    // MARK: - 结构

    func testTopLevelStructure() {
        let nodes = SafariBookmarks.parse(makeFixture())
        XCTAssertEqual(nodes.count, 3, "脏字符串项应被跳过，顶层只剩 3 个节点")

        XCTAssertEqual(nodes[0].kind, .folder)
        XCTAssertEqual(nodes[0].identifier, "FavoritesBar")
        XCTAssertEqual(nodes[0].title, "FavoritesBar")

        XCTAssertEqual(nodes[1].kind, .folder)
        XCTAssertEqual(nodes[1].readingList, true, "com.apple.ReadingList 应被识别")

        XCTAssertEqual(nodes[2].kind, .other, "未知类型保留为 .other")
        XCTAssertEqual(nodes[2].identifier, "proxy-1")
        XCTAssertTrue(nodes[2].children.isEmpty, ".other 不展开 children")
    }

    func testTitlePriority() {
        let nodes = SafariBookmarks.parse(makeFixture())
        let favoritesBar = nodes[0]
        let example = favoritesBar.children[0]
        // URIDictionary.title 优先于 WebBookmarkTitle
        XCTAssertEqual(example.title, "Example 首页")
        XCTAssertEqual(example.url, "https://example.com")
    }

    func testBrokenNodeSurvives() {
        let nodes = SafariBookmarks.parse(makeFixture())
        let broken = nodes[0].children[1]
        XCTAssertEqual(broken.kind, .bookmark, "缺 title/url 的 leaf 仍保留为 bookmark")
        XCTAssertEqual(broken.title, "leaf-broken", "title 回退为 identifier")
        XCTAssertNil(broken.url)
        XCTAssertEqual(broken.identifier, "leaf-broken")
    }

    // MARK: - 宽容性

    func testRootNotDictionaryReturnsEmpty() {
        XCTAssertTrue(SafariBookmarks.parse("not a dict").isEmpty)
        XCTAssertTrue(SafariBookmarks.parse([1, 2, 3]).isEmpty)
        XCTAssertTrue(SafariBookmarks.parse(["Children": "not-array"]).isEmpty)
    }

    func testFolderChildrenParsedRecursively() {
        let nodes = SafariBookmarks.parse(makeFixture())
        let readingList = nodes[1]
        XCTAssertEqual(readingList.children.count, 1)
        XCTAssertEqual(readingList.children[0].title, "Article")
        XCTAssertEqual(readingList.children[0].url, "https://news.example.com/a")
    }

    // MARK: - 统计（对齐 probe.py count 语义）

    func testStatsMatchProbeSemantics() {
        let stats = SafariBookmarks.stats(of: SafariBookmarks.parse(makeFixture()))
        // 文件夹：FavoritesBar + ReadingList = 2
        XCTAssertEqual(stats.folders, 2)
        // 书签：leaf-1 + leaf-broken + rl-1 = 3
        XCTAssertEqual(stats.bookmarks, 3)
        // 阅读列表：仅 ReadingList 文件夹下的 leaf = 1
        XCTAssertEqual(stats.reading, 1)
    }

    func testStatsEmpty() {
        let stats = SafariBookmarks.stats(of: [])
        XCTAssertEqual(stats, SafariBookmarks.Stats(folders: 0, bookmarks: 0, reading: 0))
    }
}
