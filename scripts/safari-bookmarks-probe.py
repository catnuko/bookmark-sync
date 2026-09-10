#!/usr/bin/env python3
"""
Phase 0 探针：验证能否读取并解析 Safari 书签文件。

仅使用 Python 标准库（plistlib），零第三方依赖、零供应链风险。
用途：在为原生 macOS App 投入开发前，用最低成本证明"能读到书签"这条通路。

用法:
    python3 scripts/safari-bookmarks-probe.py

退出码:
    0 = 成功读到并解析
    2 = 文件不存在
    3 = 权限被拒（需要「完全磁盘访问」）
    4 = 其他解析错误
"""
import os
import sys
import plistlib
from datetime import datetime

PLIST_PATH = os.path.expanduser("~/Library/Safari/Bookmarks.plist")
READING_LIST_TITLE = "com.apple.ReadingList"


def fmt_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return "%.2f %s" % (n, unit)
        n /= 1024
    return "%.2f TB" % n


def count(node):
    """递归统计文件夹 / 书签 / 阅读列表条目数。"""
    folders = bookmarks = reading = 0
    is_reading = node.get("Title") == READING_LIST_TITLE

    for child in node.get("Children", []):
        t = child.get("WebBookmarkType")
        if t == "WebBookmarkTypeList":
            f, b, r = count(child)
            folders += f + 1
            bookmarks += b
            reading += r
        elif t == "WebBookmarkTypeLeaf":
            bookmarks += 1
            if is_reading:
                reading += 1
    return folders, bookmarks, reading


def top_level(node, limit=12):
    out = []
    for child in node.get("Children", []):
        uri = child.get("URIDictionary") or {}
        title = child.get("Title") or uri.get("title") or "(untitled)"
        t = child.get("WebBookmarkType")
        if t == "WebBookmarkTypeList":
            out.append(("folder", title, len(child.get("Children", []))))
        else:
            out.append(("leaf", title, 0))
    return out[:limit]


def main():
    print("=== Phase 0: Safari Bookmarks.plist 读取探针 ===")
    print("path  : %s" % PLIST_PATH)

    if not os.path.exists(PLIST_PATH):
        print("exists: False  -> 系统里没有该文件（Safari 可能从未使用过）")
        return 2

    st = os.stat(PLIST_PATH)
    print("exists: True")
    print("size  : %s" % fmt_size(st.st_size))
    print("mtime : %s" % datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S"))
    print("-" * 52)

    try:
        with open(PLIST_PATH, "rb") as f:
            data = plistlib.load(f)
    except PermissionError as e:
        print("[读取] FAILED: PermissionError -> %s" % e)
        print("  >> 需要给本进程（WorkBuddy / 终端）授予「完全磁盘访问」")
        print("  >> 系统设置 → 隐私与安全性 → 完全磁盘访问 → 添加并勾选 WorkBuddy")
        return 3
    except Exception as e:
        print("[读取] FAILED: %s -> %s" % (type(e).__name__, e))
        return 4

    print("[读取] OK（plist 解析成功）")
    folders, bookmarks, reading = count(data)
    print("[统计] 文件夹 %d 个 / 书签 %d 条 / 阅读列表 %d 条"
          % (folders, bookmarks, reading))
    print("[顶层结构]")
    for kind, title, n in top_level(data):
        if kind == "folder":
            print("  [folder] %s  (%d 项)" % (title, n))
        else:
            print("  [leaf]   %s" % title)
    print("-" * 52)
    print("结论：通路可用 —— 原生 App 可复用同样的解析逻辑。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
