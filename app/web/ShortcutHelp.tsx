import { Dialog } from './Dialog.js';

export function ShortcutHelp({ close, enabled, setEnabled }: { close: () => void; enabled: boolean; setEnabled: (enabled: boolean) => void }) {
  return <Dialog label="快捷键" close={close}>
    <header><h2>快捷键</h2><button aria-label="关闭快捷键帮助" onClick={close}>×</button></header>
    <dl className="shortcut-list">
      <div><dt><kbd>Alt</kbd>＋<kbd>← / →</kbd></dt><dd>当前阅读区的文件后退 / 前进，可在设置中单独关闭</dd></div>
      <div><dt><kbd>B</kbd></dt><dd>展开 / 收起文件侧栏；沉浸中也可展开</dd></div>
      <div><dt><kbd>F</kbd></dt><dd>进入 / 退出沉浸</dd></div>
      <div><dt><kbd>Esc</kbd></dt><dd>关闭最上层弹窗或更多设置；结束搜索；退出沉浸</dd></div>
      <div><dt><kbd>/</kbd></dt><dd>筛选已加载文件、收藏或工具，沉浸时临时展开侧栏</dd></div>
      <div><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>在内容列表中移动焦点，不切换当前预览</dd></div>
      <div><dt><kbd>Enter</kbd></dt><dd>打开聚焦文件；左右方向键展开 / 收起文件夹</dd></div>
      <div><dt><kbd>?</kbd></dt><dd>显示快捷键帮助</dd></div>
    </dl>
    <section className="tab-help"><h3>标签页操作</h3><p><em>斜体标题</em>表示临时预览。单击其他尚未打开的文件，会替换当前阅读区的临时标签。</p><p><strong>双击文件列表中的文件，或双击标签页，即可保留标签。</strong>保留后标题恢复正体，打开其他文件不会替换它。也可右键标签选择“保留标签页”。</p><p className="muted">保留标签不等于保存文件，也不代表刷新浏览器后自动恢复。HTML 设置为浏览器新标签页打开时，文件列表遵循该设置。</p></section>
    <label className="inline"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />启用单键快捷键（B、F、/、?）</label>
    <p className="muted">输入文字、中文输入法组词时，不触发单键快捷键。除启用的 Alt＋左右箭头外，浏览器和系统组合键保持原行为。</p>
    <p className="muted">内嵌 HTML 可在设置中选择“工作台优先”，启用页面内快捷键；输入文字时不触发单键命令。页面提示“未接管”时请使用工作台按钮。浏览器独立标签页保持网页自身快捷键。</p>
  </Dialog>;
}
