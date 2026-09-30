// BookmarksMonitor.swift — FSEvents 监听 Safari 书签目录变更（M3）。
//
// - 回调在 FSEvents 派发队列（utility）触发，使用方须自行切回主队列。
// - FileEvents + WatchRoot：原子替换（write plist 是整文件替换）与目录级变化都触发。
// - FDA 未授权时 TCC 会拦截该目录的事件（与读取同理），所以监听应在授权后启动。

import Foundation

/// 监听 ~/Library/Safari 目录，书签文件变更时回调。
public final class BookmarksMonitor {

    public typealias ChangeHandler = () -> Void

    private var stream: FSEventStreamRef?
    private let directory: String
    private let handler: ChangeHandler

    public init(directory: String, handler: @escaping ChangeHandler) {
        self.directory = directory
        self.handler = handler
    }

    deinit {
        stop()
    }

    public func start() {
        guard stream == nil else { return }

        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )

        // C 回调：经 info 取回 self，闭包本身不捕获上下文（可作 C 函数指针）。
        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            let monitor = Unmanaged<BookmarksMonitor>.fromOpaque(info).takeUnretainedValue()
            monitor.handler()
        }

        let paths = [directory] as CFArray
        let flags = FSEventStreamCreateFlags(
            UInt32(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagWatchRoot)
        )

        guard let newStream = FSEventStreamCreate(
            nil,
            callback,
            &context,
            paths,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.5, // 延迟 0.5s 合并突发事件
            flags
        ) else {
            return
        }

        stream = newStream
        FSEventStreamSetDispatchQueue(newStream, DispatchQueue.global(qos: .utility))
        FSEventStreamStart(newStream)
    }

    public func stop() {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        self.stream = nil
    }
}
