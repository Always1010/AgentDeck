import { Dialog } from './Dialog.js';

export function ShortcutHelp({ close, enabled, setEnabled }: { close: () => void; enabled: boolean; setEnabled: (enabled: boolean) => void }) {
  return <Dialog label="快捷键" close={close}>
    <header><h2>快捷键</h2><button aria-label="关闭快捷键帮助" onClick={close}>×</button></header>
    <dl className="shortcut-list">
      <div><dt><kbd>F</kbd></dt><dd>进入 / 退出沉浸</dd></div>
      <div><dt><kbd>Esc</kbd></dt><dd>关闭最上层弹窗或更多设置；结束搜索；退出沉浸</dd></div>
      <div><dt><kbd>/</kbd></dt><dd>筛选已加载文件或收藏，沉浸时临时展开侧栏</dd></div>
      <div><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>在内容列表中移动焦点，不切换当前预览</dd></div>
      <div><dt><kbd>Enter</kbd></dt><dd>打开聚焦文件；左右方向键展开 / 收起文件夹</dd></div>
      <div><dt><kbd>?</kbd></dt><dd>显示快捷键帮助</dd></div>
    </dl>
    <label className="inline"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />启用单键快捷键（F、/、?）</label>
    <p className="muted">输入文字、中文输入法组词时，不触发单键快捷键。浏览器和系统的 Ctrl、Alt、Win / Command 组合键保持原行为。</p>
    <p className="muted">在内嵌 HTML 报告或工具中操作时，工作台收不到其中的按键。请使用顶部“退出沉浸”按钮，或先点击工作台工具栏。Markdown 和原文阅读区可直接使用。</p>
  </Dialog>;
}
