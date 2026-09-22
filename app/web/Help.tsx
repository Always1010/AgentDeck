import { useRef, useState } from 'react';
import { parseFileReference, type Snapshot } from '../shared/model.js';
import { Dialog } from './Dialog.js';
import { Icon } from './Icon.js';
import './help.css';

const sections = [
  ['start', '快速上手', '从第一个成果开始'],
  ['workflow', '高效使用', '整理、阅读与复用'],
  ['communicate', '与 Agent 沟通', '让需求更容易落地'],
  ['prompts', '任务模板', '复制后就能开始'],
  ['faq', '常见问题', '遇到问题先看这里'],
] as const;
type Section = typeof sections[number][0];
type Scenario = 'report' | 'tool' | 'revise' | 'handoff';
const scenarios: [Scenario, string][] = [['report', '生成报告'], ['tool', '制作工具'], ['revise', '反馈修改'], ['handoff', '交接任务']];

function joinPath(root: string, relative: string) {
  const separator = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${separator}${relative.replace(/[\\/]/g, separator)}`;
}

function PromptTemplates({ snapshot, selected }: { snapshot: Snapshot; selected: string }) {
  const reference = parseFileReference(selected);
  const mounts = snapshot.mounts.filter(m => m.enabled && m.status !== 'offline');
  const [mountId, setMountId] = useState(mounts.find(m => m.id === reference?.mountId)?.id || mounts[0]?.id || '');
  const [scenario, setScenario] = useState<Scenario>('report');
  const [copiedText, setCopiedText] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  const [copying, setCopying] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const mount = mounts.find(m => m.id === mountId);
  const project = snapshot.projects.find(p => p.id === mount?.projectId);
  const root = mount?.absolutePath || '【填写实际输出目录的绝对路径】';
  const current = mount && reference?.mountId === mount.id ? joinPath(root, reference.relativePath) : '【填写需要处理的文件绝对路径】';
  const context = `我使用 AgentDeck 浏览本地成果。${project ? `项目名称：${project.name}。` : ''}
成果目录：${root}
请先确认你能访问这个目录；不能访问时，说明需要我提供哪些文件或如何转移成果。`;
  const delivery = `交付：列出真实文件路径、打开的 HTML 入口、必要的构建命令和实际验证结果；未验证的部分请明确说明。
我会在 AgentDeck 中展开目录、打开入口并验收。无需修改 AgentDeck 的源码、路由或首页清单。`;
  const prompts: Record<Scenario, string> = {
    report: `${context}

目标：为【读者 / 使用场景】生成一份关于【主题】的报告，帮助我判断【关键问题】。
输入：阅读【资料路径 / 来源链接】，范围为【时间区间 / 数据口径】。缺失资料请标明，不要编造。
输出：${joinPath(root, 'reports/【主题】/index.html')}
内容：先给结论，再给证据、比较和不确定性；在正文中附上来源链接及资料日期。
约束：交付可直接预览的静态 HTML；CSS、JS、图片和数据使用相对路径；外链在新标签打开并使用 noopener noreferrer。联网依赖请说明。
验收：结论能追溯到来源；图表单位清楚；窄屏可阅读；资源和链接可用。
${delivery}`,
    tool: `${context}

目标：制作一个【工具名称】，用来完成【具体任务】。
输入与输出：输入【格式及示例】，输出【期望格式及示例】。
输出入口：${joinPath(root, 'tools/【工具名】/index.html')}
约束：纯前端静态工具，资源使用相对路径，路由如有需要使用 hash。不要依赖开发服务器、后端 API 或把密钥写进页面；如确实需要后端，先说明方案。
若需要构建，请在源码目录完成构建，并交付完整静态输出目录；AgentDeck 不会自动安装依赖或构建。
验收：正常输入、空输入、错误输入各验证一个例子；错误有清楚提示；如需保存用户数据，请提供明确的导出方式并说明保存位置。
${delivery}`,
    revise: `${context}

需要修改的文件：${current}
操作步骤：【在哪个页面，输入了什么，点击了什么】
实际结果：【看到的现象 / 错误原文；如有截图请一并提供】
期望结果：【具体希望变成什么】
本次范围：【只需要修改的内容】；保留【已经满意的内容 / 行为】。
请先阅读现有文件，解释原因，再在上述范围内修改；不要另建一份无关成果。
验收：【输入示例 → 期望输出】。完成后重走复现步骤，说明改动和验证结果。
${delivery}`,
    handoff: `${context}

请接手以下任务，先阅读已有成果后再继续。
入口文件：${current}
原始目标：【要解决的问题及验收标准】
已经完成：【当前成果和已通过的验证】
已确定的约束：【数据口径 / 输出格式 / 需要保留的行为】
尚未完成：【剩余事项、已知问题和未验证内容】
本轮只做：【下一步任务】。
若你无法看到之前的对话，请以本段说明和提供的文件为上下文，缺少关键信息时明确提出。
${delivery}`,
  };
  const text = prompts[scenario];
  async function copy() {
    setCopying(true); setCopyFailed(false);
    try { await navigator.clipboard.writeText(text); setCopiedText(text); }
    catch { setCopiedText(''); setCopyFailed(true); textRef.current?.focus(); textRef.current?.select(); }
    finally { setCopying(false); }
  }
  return <>
    <span className="eyebrow">04 / 从具体任务开始</span><h2>把需求变成可执行的任务</h2>
    <p className="help-lead">选择场景和目录，复制到 Codex 或其他 Agent，把所有【待填写项】替换成你的实际需求。</p>
    <div className="help-scenarios" role="group" aria-label="任务场景">{scenarios.map(([id, label]) => <button key={id} aria-pressed={scenario === id} onClick={() => { setScenario(id); setCopyFailed(false); }}>{label}</button>)}</div>
    <label className="help-mount">成果所在目录<select value={mount?.id || ''} onChange={e => { setMountId(e.target.value); setCopyFailed(false); }}>
      <option value="">手动填写路径</option>
      {mounts.map(m => <option key={m.id} value={m.id}>{snapshot.projects.find(p => p.id === m.projectId)?.name} / {m.label} — {m.absolutePath}</option>)}
    </select></label>
    <p className="help-caption">{mount ? <>使用实际目录：<code>{root}</code></> : '未选择可用挂载目录。复制后填写绝对路径，并确认 Agent 有权访问。'}</p>
    <textarea ref={textRef} className="help-prompt" aria-label="任务提示词" value={text} readOnly spellCheck={false} />
    <div className="help-copy-row"><button className="primary" disabled={copying} onClick={() => void copy()}>{copying ? '复制中…' : '复制任务模板'}</button><span role="status">{copyFailed ? '未能自动复制，文本已选中，请按 Ctrl+C 或使用系统复制。' : copiedText === text ? '已复制，请到 Agent 中填写待填写项后发送。' : ''}</span></div>
    <p className="help-caption">模板只会复制文本，不会发送给 Agent，也不会写入文件。挂载目录不等于授予 Agent 文件访问权限。</p>
  </>;
}

export function Help({ snapshot, selected, close, shortcuts }: { snapshot: Snapshot; selected: string; close: () => void; shortcuts: () => void }) {
  const [section, setSection] = useState<Section>('start');
  const content = useRef<HTMLElement>(null);
  function navigate(next: Section) { setSection(next); content.current?.scrollTo({ top: 0 }); }
  return <Dialog label="使用帮助" close={close} className="help-page">
    <header className="help-header"><div><strong>AgentDeck</strong><span>使用帮助</span></div><button onClick={close} aria-label="关闭使用帮助"><Icon name="close"/> 返回工作台</button></header>
    <div className="help-layout">
      <nav className="help-nav" aria-label="帮助主题">
        {sections.map(([id, title, description], index) => <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => navigate(id)}><span className="help-nav-number">0{index + 1}</span><span><strong>{title}</strong><small>{description}</small></span></button>)}
        <button className="help-keyboard" onClick={shortcuts}><span>⌨</span><span><strong>快捷键</strong><small>查看操作与按键设置</small></span></button>
      </nav>
      <article ref={content} className="help-content" aria-label="帮助正文" tabIndex={0}>
        {section === 'start' && <>
          <span className="eyebrow">01 / 欢迎使用 AGENTDECK</span><h1>让 Agent 的成果，<br/>成为随手可用的工作资料。</h1>
          <p className="help-lead">把真实目录接进来，用一个工作台阅读报告、查看笔记、试用小工具。文件留在原处，之后还能继续修改和复用。</p>
          <div className="help-flow" aria-label="协作流程"><div><b>你</b><span>定目标与验收</span></div><span aria-hidden="true">→</span><div><b>Agent</b><span>生成或修改文件</span></div><span aria-hidden="true">→</span><div><b>AgentDeck</b><span>阅读、试用与复用</span></div></div>
          <h2>第一次使用，走完这四步</h2>
          <ol className="help-steps">
            <li><div><h3>准备一个成果目录</h3><p>选已有报告或工具的文件夹，也可以先创建一个专门的目录。路径不必位于 AgentDeck 工程内；让 Agent 知道这个真实路径。</p></div></li>
            <li><div><h3>在工作台挂载目录</h3><p>侧栏切到“文件”，点击＋，填写项目名称并选择本机文件夹，点击“确认范围并保存”。项目用于分组，挂载就是登记目录，不会搬迁文件。</p></div></li>
            <li><div><h3>请 Agent 把成果写进来</h3><p>给出目标、资料、输出位置和验收标准。报告适合 HTML，笔记适合 Markdown，小工具交付可运行的静态网页。</p><button className="help-text-button" onClick={() => navigate('prompts')}>选择一个任务模板 →</button></div></li>
            <li><div><h3>打开成果，检查后反馈</h3><p>展开左侧目录并打开文件，核对内容或试用输入。把文件路径、具体问题和期望结果反馈给 Agent；修改后在预览中加载更新。</p></div></li>
          </ol>
          <div className="help-note"><strong>先试一个小任务</strong><p>从一页周报或一个简单计算工具开始，走通“提出需求 → 文件落地 → 验收 → 修改”。满意后点击星标收藏，常用 HTML 工具还可加入“工具”。</p></div>
        </>}
        {section === 'workflow' && <>
          <span className="eyebrow">02 / 日常工作流</span><h2>减少找文件，把时间留给判断</h2><p className="help-lead">按任务组织目录，用收藏直达成果，用工具入口复用稳定的小应用。</p>
          <div className="help-cards"><section><h3>文件 · 保留完整上下文</h3><p>按主题建立项目。一个项目可以追加多个目录；需要了解资料来龙去脉时，从真实文件树进入。</p></section><section><h3>收藏 · 直达常读内容</h3><p>点击文件旁或预览顶部的星标。收藏可直接打开，不必每次展开多层目录。</p></section><section><h3>工具 · 复用常用能力</h3><p>在 HTML 预览的“更多设置”中加入工具，或切到“工具”后点击＋。移除工具只取消分类。</p></section></div>
          <h3>同时保留几份报告</h3><p>斜体标题表示未固定标签。打开尚未打开的文件只替换当前未固定标签；当前标签已固定时新建，后台标签保留。目标文件已在本区打开时直接切换。双击文件列表中的文件、双击顶部标签，或右键标签选择“保留标签页”，即可固定它，标题恢复正体。点击标签或左侧“已打开页面”切回时，阅读位置和工具输入会保留。</p><p>已打开列表可折叠；W 或标签上的 × 关闭当前文件，包括固定标签，并切回最近使用的剩余页面。预览工具栏的刷新只影响当前页。固定标签和星标收藏互不替代，工具的未保存数据仍需按工具提供的方式保存或导出。</p>
          <h3>选择适合阅读的主题</h3><p>顶部主题默认跟随系统，也可以固定为浅色或深色。选择会在当前浏览器中保存，切换不会刷新已打开的报告。工作台、Markdown、文本、帮助和弹窗会一起切换；HTML 报告自身的配色由报告决定，旧报告可能仍是白底。</p>
          <h3>设置、分屏与文件历史</h3><p>右上角“设置”打开浮窗，可调整 HTML 默认打开方式、阅读布局、快捷键和主题，也可找回最近的阅读现场。HTML 可在工作台标签页或浏览器新标签页打开，文件旁的打开方式菜单可临时指定。</p><p>点击阅读区后，按 O 上下分屏、E 左右分屏，新区域打开当前标签的同一文件并自动激活；可重复切分不同区域，形成多屏组合。侧栏打开文件作用于当前区域，各区可以查看同一文件的不同章节。鼠标拖动分隔线调整比例，双击恢复等分。X 最大化当前区域，再按恢复原布局；这些操作会保留已有 HTML 工具输入。顶部也有对应按钮。</p><p>每个区域右上角的 × 或 Q 关闭整个阅读区；多个标签时默认提示确认，按 Enter 确认、Esc 取消，可在“设置 → 阅读布局”关闭提示。W 仍只关闭当前文件标签。关闭最后一个阅读区时清空标签并保留空区域。</p><p>关闭最后一个文件标签后的动作在“设置 → 阅读布局”选择：默认保留空区域，也可自动关闭该区域，让相邻区域补满。最后一个阅读区始终保留。区域切换、文件标签切换和大小调整可直接用鼠标完成。</p><p>Alt＋左右箭头按查看顺序后退和前进，只影响当前阅读区。目标已打开时直接切换；否则替换当前未固定标签，当前标签已固定时新建。重新加载的页面不保证恢复未保存的工具输入。HTML 内快捷键可在设置中选择“工作台优先”，单个文件也可覆盖；输入文字和中文组词时不触发单键操作。</p>
          <h3>刷新或误关之后继续阅读</h3><p>分屏结构与比例、文件标签及固定状态、各区历史、支持的滚动位置、最大化、沉浸和侧栏状态会自动保存。刷新页面或恢复原浏览器标签时回到该现场；文件内容读取磁盘上的当前版本，HTML 表单输入和运行中的任务由工具自身保存。</p><p>每个浏览器标签拥有独立现场。新开首页从最近使用的现场开始；复制标签或打开仍在其他页面使用的现场，会自动建立副本，之后各自保存，互不覆盖。“设置 → 阅读现场”列出最近使用时间、阅读区数和文件摘要，可在新浏览器标签中恢复。不同浏览器或访问地址之间不会自动同步，保存失败时工作台会提示。</p>
          <h3>在浏览器中核对报告来源</h3><p>报告优先采用 HTML，把结论、图表和证据放在直观的页面里。点击引用链接到浏览器新标签查看原始出处，再返回工作台中保留的报告继续阅读。本地 HTML 和 Markdown 的普通外部网页链接默认在浏览器新标签页打开；工具内部路由和脚本导航保持页面自己的逻辑。</p>
          <h3>推荐的目录约定</h3><pre className="help-folder">{'项目目录/\n  reports/   按主题或日期存放 HTML 报告\n  notes/     过程笔记与交接说明\n  data/      输入资料与原始数据\n  tools/     辅助核对的静态工具'}</pre><p>这只是组织建议。现有目录可以直接接入，无需为了工作台重新整理文件。</p>
          <h3>一次高效的日常循环</h3><ol className="help-list"><li>在 Agent 中明确本轮成果和保存位置，保留需要追溯的旧版本。</li><li>在 AgentDeck 中展开对应目录。已展开且可见的目录约每 4 秒刷新；页面隐藏时暂停。</li><li>用沉浸阅读检查报告，用正常、空白、错误输入试用工具；需要对照时选择左右或上下分屏；独立使用 HTML 时可选择浏览器新标签页。</li><li>一次集中反馈一个目标：写清具体位置、现象、期望和需要保留的部分。</li><li>看到 HTML 更新提示后，先保存工具中需要保留的数据，再点击加载更新。文本可在更多设置中开启自动更新。</li></ol>
          <div className="help-note"><strong>两个容易忽略的细节</strong><p>筛选只查已经加载的目录和文件；找不到时先展开目标目录。只改 CSS、JS 或图片时，请手动刷新当前预览。</p></div>
          <p>收藏、设置和阅读现场保存在当前浏览器；工具登记保存在服务端注册表。换浏览器不会自动带走收藏和阅读现场。需要长期保存的数据，应由工具提供导出或单独保存的方式。</p>
          <button onClick={shortcuts}>查看快捷键</button>
        </>}
        {section === 'communicate' && <>
          <span className="eyebrow">03 / 与 CODEX 或其他 AGENT 配合</span><h2>说明想得到什么，以及怎样算完成</h2><p className="help-lead">不必写很长的提示词。把关键信息讲清楚，再用一次可检查的交付逐步迭代。</p>
          <dl className="help-brief"><div><dt>目标</dt><dd>给谁使用，解决什么问题？例如“给团队做本周进展报告，读完能看清风险和下一步”。</dd></div><div><dt>上下文</dt><dd>资料在哪里，应该参考哪个文件？提供绝对路径、数据口径、样例或截图，并说明哪些资料必须阅读。</dd></div><div><dt>约束</dt><dd>保存到哪个目录，用什么格式，哪些内容需要保留？对 AgentDeck 说明“静态 HTML、相对资源、完整构建输出”。</dd></div><div><dt>验收</dt><dd>哪些条件成立才算完成？例如“来源可追溯、窄屏可读、空输入有提示，并说明实际做过的验证”。</dd></div></dl>
          <h3>按任务阶段调整沟通</h3><ul className="help-list"><li><strong>需求还模糊：</strong>“先阅读这些资料，整理你的理解和两种可选方案；先和我确定方向，再生成文件。”</li><li><strong>目标已经清楚：</strong>“按这些范围完成并验证，交付文件位置和检查结果。只有影响目标的关键缺失才需要问我。”</li><li><strong>继续修改：</strong>“这个文件的第二张图单位错误，应为万元；保留已有布局，修改后核对原始数据。”比“再优化一下”更容易验收。</li><li><strong>换一个 Agent：</strong>交接目标、文件位置、已经完成的部分、约束、剩余问题和下一步，不依赖对方自动看到之前的对话。</li></ul>
          <div className="help-note"><strong>文件是协作的连接点</strong><p>AgentDeck 不会自动把你正在看的文件、工具输入或浏览器错误发送给 Agent。请提供实际文件路径；远端 Agent 无法直接访问你电脑上的 127.0.0.1 地址或本地目录，需要提供文件或可访问的工作空间。</p></div>
          <h3>把稳定要求留下来</h3><p>重复使用的输出目录、格式和验证要求可以写在内容项目的 AGENTS.md 中，先与已有规则合并。使用其他 Agent 时，确认它支持的指令文件；不支持就明确请它阅读这份说明。只把稳定规则写进去，每次任务的变化放在当次消息中。</p>
          <p className="help-caption">沟通原则参考 <a href="https://learn.chatgpt.com/guides/best-practices" target="_blank" rel="noopener noreferrer">OpenAI 官方最佳实践</a>。这里的工作流和交付要求按 AgentDeck 当前能力编写。</p>
          <button className="primary" onClick={() => navigate('prompts')}>使用任务模板</button>
        </>}
        {section === 'prompts' && <PromptTemplates snapshot={snapshot} selected={selected}/>}
        {section === 'faq' && <>
          <span className="eyebrow">05 / 常见问题</span><h2>遇到问题，从这里找下一步</h2><p className="help-lead">先区分目录、文件内容和预览资源，再把可复现的信息交给 Agent。</p>
          <div className="help-faq">
            <section><h3>Agent 已经生成文件，为什么看不到？</h3><p>核对它报告的真实路径是否位于已挂载目录。展开对应文件夹，清空筛选，点击“刷新目录”。未展开的子目录不会自动扫描；隐藏敏感目录、排除路径和链接目录也不会显示。</p></section>
            <section><h3>网页空白，或者样式、图片丢失？</h3><p>确认交付的是 HTML 或完整构建输出。让 Agent 检查资源是否齐全、引用是否相对入口、资源是否在允许访问的挂载范围内。Vite 静态输出使用 <code>base: './'</code>，SPA 推荐 hash 路由；依赖后端或开发服务器的页面需要另行适配。</p></section>
            <section><h3>文件改了，为什么页面没变化？</h3><p>HTML 更新会提示手动加载，以保留当前输入。只改引用的 CSS、JS、图片不会触发入口更新提示，点击预览顶部“刷新”。需要构建的工具还应先由 Agent 重新构建。</p></section>
            <section><h3>CSV、JSON、PDF、Office 文件怎么用？</h3><p>CSV 和 JSON 当前显示原文；PDF、Office 等不支持的文件提供下载。需要可阅读的图表或交互表格时，请 Agent 另行生成 HTML，并保留原始数据便于核对。</p></section>
            <section><h3>项目移除、挂载停用，会删除文件吗？</h3><p>不会，这些操作只改变登记。路径离线时检查磁盘或目录是否可用，恢复后重试。文件真实改名不会自动跟踪；重新找到文件后更新收藏或工具入口。</p></section>
            <section><h3>能直接在这里和 Agent 对话、修改文件吗？</h3><p>当前工作台负责展示和只读访问。请到 Codex 或其他 Agent 中提出任务，让它在有权访问的目录里修改文件，再回到工作台验收。挂载不是上传，也不是同步。</p></section>
            <section><h3>刷新后能恢复分屏和文件吗？</h3><p>可以。工作台自动保存阅读现场，刷新或恢复原浏览器标签会继续原布局；也可到“设置 → 阅读现场”找回。多个浏览器标签独立保存。文件离线时保留标签并显示错误，恢复目录后可重试。</p></section>
            <section><h3>工具数据会自动保存吗？快捷键为什么没反应？</h3><p>阅读现场保存文件与布局，工具数据由工具自身保存，刷新或关闭前请先保存或导出。内嵌 HTML 默认“网页优先”，可在设置或文件的更多设置中选择“工作台优先”。输入框内不触发单键；页面提示“未接管”时请使用工作台按钮。</p></section>
            <section><h3>可以把本地地址分享给别人吗？</h3><p>服务仅供本机访问；127.0.0.1 在别人的电脑上指向他们自己。要交付成果，请分享完整文件及相邻资源，或另行部署。只挂载可信内容；HTML 可按浏览器规则联网，各项目共用预览来源。</p></section>
          </div>
          <button onClick={() => navigate('prompts')}>用模板整理问题并反馈给 Agent</button>
        </>}
      </article>
    </div>
  </Dialog>;
}
