import { useState } from 'react';
import { ThemePicker } from './Theme.js';
import type { HtmlKeyMode } from './useHtmlBridge.js';
import { RecentReadingSessions } from './RecentReadingSessions.js';
import { Dialog } from './Dialog.js';

export type HtmlOpening = 'workbench' | 'browser';
export const isHtmlOpening = (value: unknown): value is HtmlOpening => value === 'workbench' || value === 'browser';

export function Settings({ currentSession, flushSession, close, htmlOpening, setHtmlOpening, singles, setSingles, closeEmpty, setCloseEmpty, confirmPaneClose, setConfirmPaneClose, navigation, setNavigation, htmlKeys, setHtmlKeys, documentFontSize, setDocumentFontSize }: {
  currentSession?: string;
  flushSession?: () => Promise<void>;
  close: () => void; htmlOpening: HtmlOpening; setHtmlOpening: (value: HtmlOpening) => void;
  singles: boolean; setSingles: (value: boolean) => void;
  htmlKeys: HtmlKeyMode; setHtmlKeys: (value: HtmlKeyMode) => void;
  navigation: boolean; setNavigation: (value: boolean) => void;
  confirmPaneClose: boolean; setConfirmPaneClose: (value: boolean) => void;
  closeEmpty: 'keep'|'remove'; setCloseEmpty: (value: 'keep'|'remove') => void;
  documentFontSize: number; setDocumentFontSize: (value: number) => void;
}) {
  const [section, setSection] = useState('opening');
  return <Dialog label="设置" close={close} className="settings-dialog" backdropClose>
    <header className="settings-header"><h2>设置</h2><span>更改自动保存</span><button data-autofocus aria-label="关闭设置" onClick={close}>×</button></header>
    <div className="settings-layout"><nav aria-label="设置分类">
      {[['opening', '文件打开'], ['reading', '阅读布局'], ['sessions', '阅读现场'], ['keyboard', '快捷键'], ['appearance', '外观']].map(([id, label]) =>
        <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{label}</button>)}
    </nav><div className="settings-content">
      {section === 'opening' && <section><h2>文件打开</h2><label>HTML 默认打开方式<select value={htmlOpening} onChange={event => setHtmlOpening(event.target.value as HtmlOpening)}>
        <option value="workbench">工作台标签页</option><option value="browser">浏览器新标签页</option>
      </select></label><p>用于从文件、收藏和工具列表打开 HTML。浏览器新标签页直接显示报告或工具本身。文件的打开方式菜单可临时选择其他方式。</p><p className="muted">外部网页链接默认在浏览器新标签页打开。已打开的工作台标签不受此设置影响。</p></section>}
      {section === 'reading' && <section><h2>阅读布局</h2><label>关闭阅读区最后一个标签后<select value={closeEmpty} onChange={event=>setCloseEmpty(event.target.value as 'keep'|'remove')}><option value="keep">保留空阅读区</option><option value="remove">自动关闭空阅读区</option></select></label><label className="inline"><input type="checkbox" checked={confirmPaneClose} onChange={event=>setConfirmPaneClose(event.target.checked)}/>关闭阅读区时提示确认</label><p>用区域右上角的 × 或 Q 关闭整个阅读区。启用确认时，仅含多个标签的区域会提示，默认聚焦“确定关闭”；W 只关闭当前标签。关闭最后一个区域会清空标签并保留空阅读区。</p><p>使用 O 上下分屏、E 左右分屏、X 最大化或恢复当前区域。鼠标点击选择区域，拖动分隔线调整比例，双击恢复等分。最后一个阅读区始终保留。</p><label className="font-size-control">文档字号 <output>{documentFontSize} px</output><input aria-label="文档字号" type="range" min="12" max="24" step="1" value={documentFontSize} onChange={event=>setDocumentFontSize(Number(event.target.value))}/></label><button onClick={()=>setDocumentFontSize(14)} disabled={documentFontSize===14}>恢复默认字号</button><p>只调整 Markdown 和纯文本，HTML 页面及其源码保持原有字号。设置自动保存并作用于所有阅读区。</p></section>}
      {section === 'keyboard' && <section><h2>快捷键</h2><label className="inline"><input type="checkbox" checked={singles} onChange={event => setSingles(event.target.checked)}/>启用单键快捷键（O、E、X、P、W、Q、B、F、/、?）</label><p>输入文字和中文输入法组词时，不触发单键命令。完整操作说明见工作台右上角的问号。</p><label className="inline"><input type="checkbox" checked={navigation} onChange={event=>setNavigation(event.target.checked)}/>启用文件前进后退（Alt＋← / →）</label><p>作用于当前阅读区，与单键快捷键独立。到达历史起点或终点时停留在当前文件。</p><label>HTML 内快捷键处理<select value={htmlKeys} onChange={event=>setHtmlKeys(event.target.value as HtmlKeyMode)}><option value="web">网页优先</option><option value="workbench">工作台优先</option></select></label><p>工作台优先时，内嵌 HTML 中也能使用已启用的工作台快捷键；冲突按键只执行工作台操作。每个 HTML 的更多设置可单独覆盖。浏览器独立标签页保持网页自身快捷键。</p></section>}
      {section === 'sessions' && <RecentReadingSessions current={currentSession} flush={flushSession}/>}
      {section === 'appearance' && <section><h2>外观</h2><ThemePicker/><p>主题设置保存在当前浏览器中。</p></section>}
    </div></div>
  </Dialog>;
}
