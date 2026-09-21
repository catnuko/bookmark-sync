// 测试桥后台：把页面（content script）来的消息转发给 bookmark-sync 扩展的
// onMessageExternal 测试通道。
browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.method) return false;
  browser.runtime
    .sendMessage('bookmark-sync@bookmarksync.app', {
      type: 'bsync-test',
      action: msg.method,
      payload: msg.payload ?? {},
    })
    .then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true; // 异步 sendResponse
});
