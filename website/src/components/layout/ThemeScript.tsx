/**
 * 主题初始化 —— 必须在首帧之前同步执行，否则深色模式用户会先看到浅色闪一下（FOUC）。
 * 用**普通内联 <script>** 放在 <body> 首个位置：浏览器自上而下解析，脚本在渲染正文前就跑完。
 * （不用 next/script 的 beforeInteractive —— 它走 self.__next_s 队列，执行时机不保证早于首帧。）
 * 只操作 <html data-theme>，不参与 React 树。
 */
const THEME_INIT = `(function(){try{var t=localStorage.getItem('bsync.theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />;
}
