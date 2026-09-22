export function FileOpenMenu({ name, url, internal, other }: { name: string; url?: string; internal: () => void; other?: () => void }) {
  return <details className="file-open-menu" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
  }}><summary aria-label={`打开方式：${name}`} title="打开方式">⋯</summary><div className="file-open-options" onClick={event => { event.currentTarget.closest('details')!.open = false; }}>
    <button onClick={internal}>在工作台标签页打开</button>
    <a href={url} target="_blank" rel="noopener noreferrer" aria-disabled={!url}>在浏览器新标签页打开</a>
    {other && <button onClick={other}>在右侧新分屏打开</button>}
  </div></details>;
}
