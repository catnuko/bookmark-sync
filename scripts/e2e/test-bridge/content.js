// 测试桥 content script：postMessage 桥（Firefox 内容脚本与页面通信的标准方式）。
//
// 页面主世界 window.postMessage 请求 → 本脚本收到（message 事件数据是结构化
// 克隆的普通对象，无 Xray 问题）→ 转发 bookmark-sync 扩展测试通道 →
// 结果 postMessage 回传。
(() => {
  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || data.__bsyncBridge !== true || data.__resp === true) return;
    browser.runtime.sendMessage({ method: data.method, payload: data.payload ?? {} }).then(
      (result) => {
        window.postMessage({ __bsyncBridge: true, __resp: true, id: data.id, result }, '*');
      },
      (err) => {
        window.postMessage(
          {
            __bsyncBridge: true,
            __resp: true,
            id: data.id,
            result: { ok: false, error: String(err) },
          },
          '*',
        );
      },
    );
  });
})();
