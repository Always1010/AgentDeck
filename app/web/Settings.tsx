import { useEffect, useRef, useState } from 'react';
import { ThemePicker } from './Theme.js';
import { restoreFocus } from './shortcuts.js';

export type HtmlOpening = 'workbench' | 'browser';
export const isHtmlOpening = (value: unknown): value is HtmlOpening => value === 'workbench' || value === 'browser';

export function Settings({ close, htmlOpening, setHtmlOpening, singles, setSingles }: {
  close: () => void; htmlOpening: HtmlOpening; setHtmlOpening: (value: HtmlOpening) => void;
  singles: boolean; setSingles: (value: boolean) => void;
}) {
  const [section, setSection] = useState('opening');
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    back.current?.focus();
    return () => restoreFocus(previous, document.querySelector<HTMLElement>('[aria-label="设置"]'));
  }, []);
  return <main className="settings-page" aria-label="设置页面" data-workbench-dialog onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <header className="settings-header"><button ref={back} onClick={close}>← 返回工作台</button><h1>设置</h1><span>更改自动保存</span></header>
    <div className="settings-layout"><nav aria-label="设置分类">
      {[['opening', '文件打开'], ['keyboard', '快捷键'], ['appearance', '外观']].map(([id, label]) =>
        <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{label}</button>)}
    </nav><div className="settings-content">
      {section === 'opening' && <section><h2>文件打开</h2><label>HTML 默认打开方式<select value={htmlOpening} onChange={event => setHtmlOpening(event.target.value as HtmlOpening)}>
        <option value="workbench">工作台标签页</option><option value="browser">浏览器新标签页</option>
      </select></label><p>用于从文件、收藏和工具列表打开 HTML。浏览器新标签页直接显示报告或工具本身。文件的打开方式菜单可临时选择其他方式。</p><p className="muted">外部网页链接默认在浏览器新标签页打开。已打开的工作台标签不受此设置影响。</p></section>}
      {section === 'keyboard' && <section><h2>快捷键</h2><label className="inline"><input type="checkbox" checked={singles} onChange={event => setSingles(event.target.checked)}/>启用单键快捷键（B、F、/、?）</label><p>输入文字和中文输入法组词时，不触发单键命令。完整操作说明见工作台右上角的问号。</p></section>}
      {section === 'appearance' && <section><h2>外观</h2><ThemePicker/><p>主题设置保存在当前浏览器中。</p></section>}
    </div></div>
  </main>;
}
