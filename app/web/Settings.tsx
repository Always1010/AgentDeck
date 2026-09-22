import { useEffect, useRef, useState } from 'react';
import { ThemePicker } from './Theme.js';
import { restoreFocus } from './shortcuts.js';
import type { HtmlKeyMode } from './useHtmlBridge.js';
import type { Layout } from './workspace.js';

export type HtmlOpening = 'workbench' | 'browser';
export const isHtmlOpening = (value: unknown): value is HtmlOpening => value === 'workbench' || value === 'browser';

export function Settings({ close, htmlOpening, setHtmlOpening, singles, setSingles, layout, setLayout, navigation, setNavigation, htmlKeys, setHtmlKeys }: {
  close: () => void; htmlOpening: HtmlOpening; setHtmlOpening: (value: HtmlOpening) => void;
  singles: boolean; setSingles: (value: boolean) => void;
  htmlKeys: HtmlKeyMode; setHtmlKeys: (value: HtmlKeyMode) => void;
  navigation: boolean; setNavigation: (value: boolean) => void;
  layout: Layout; setLayout: (value: Layout) => void;
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
      {[['opening', '文件打开'], ['reading', '阅读布局'], ['keyboard', '快捷键'], ['appearance', '外观']].map(([id, label]) =>
        <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{label}</button>)}
    </nav><div className="settings-content">
      {section === 'opening' && <section><h2>文件打开</h2><label>HTML 默认打开方式<select value={htmlOpening} onChange={event => setHtmlOpening(event.target.value as HtmlOpening)}>
        <option value="workbench">工作台标签页</option><option value="browser">浏览器新标签页</option>
      </select></label><p>用于从文件、收藏和工具列表打开 HTML。浏览器新标签页直接显示报告或工具本身。文件的打开方式菜单可临时选择其他方式。</p><p className="muted">外部网页链接默认在浏览器新标签页打开。已打开的工作台标签不受此设置影响。</p></section>}
      {section === 'reading' && <section><h2>阅读布局</h2><label>布局方式<select value={layout} onChange={event => setLayout(event.target.value as Layout)}><option value="single">单屏</option><option value="columns">左右分屏</option><option value="rows">上下分屏</option></select></label><p>横屏和竖屏都可自由选择。拖动分隔线调整比例，双击分隔线恢复各占一半。返回单屏保留当前操作区，另一区暂时收起。</p></section>}
      {section === 'keyboard' && <section><h2>快捷键</h2><label className="inline"><input type="checkbox" checked={singles} onChange={event => setSingles(event.target.checked)}/>启用单键快捷键（B、F、/、?）</label><p>输入文字和中文输入法组词时，不触发单键命令。完整操作说明见工作台右上角的问号。</p><label className="inline"><input type="checkbox" checked={navigation} onChange={event=>setNavigation(event.target.checked)}/>启用文件前进后退（Alt＋← / →）</label><p>作用于当前阅读区，与单键快捷键独立。到达历史起点或终点时停留在当前文件。</p><label>HTML 内快捷键处理<select value={htmlKeys} onChange={event=>setHtmlKeys(event.target.value as HtmlKeyMode)}><option value="web">网页优先</option><option value="workbench">工作台优先</option></select></label><p>工作台优先时，内嵌 HTML 中也能使用已启用的工作台快捷键；冲突按键只执行工作台操作。每个 HTML 的更多设置可单独覆盖。浏览器独立标签页保持网页自身快捷键。</p></section>}
      {section === 'appearance' && <section><h2>外观</h2><ThemePicker/><p>主题设置保存在当前浏览器中。</p></section>}
    </div></div>
  </main>;
}
