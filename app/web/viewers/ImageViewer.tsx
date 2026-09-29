import { useRef, useState } from 'react';

export function ImageViewer({ url, title, loaded }: { url: string; title: string; loaded: () => void }) {
  const image = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState<number | 'fit'>('fit');
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [failed, setFailed] = useState(false);
  function zoom(direction: number) {
    const current = scale === 'fit' ? (image.current?.getBoundingClientRect().width || 0) / (size?.width || 1) * 100 : scale;
    setScale(Math.max(25, Math.min(400, Math.round((current || 100) + direction * 25))));
  }
  return <div className="image-viewer">
    <div className="data-viewer-controls" role="group" aria-label="图片显示">
      <button aria-pressed={scale === 'fit'} onClick={() => setScale('fit')}>适合宽度</button>
      <button aria-pressed={scale === 100} onClick={() => setScale(100)}>原始尺寸</button>
      <button aria-label="缩小图片" disabled={!size || scale === 25} onClick={() => zoom(-1)}>−</button>
      <span aria-live="polite">{scale === 'fit' ? '适宽' : `${scale}%`}</span>
      <button aria-label="放大图片" disabled={!size || scale === 400} onClick={() => zoom(1)}>＋</button>
      {size && <span className="muted">{size.width} × {size.height}</span>}
    </div>
    <div className="image-viewer-stage">
      {failed ? <p role="alert">图片无法显示，请刷新重试，或在更多菜单中下载原文件。</p> : <img ref={image} src={url} alt={title} draggable={false}
        style={scale === 'fit' ? { maxWidth: '100%', width: 'auto' } : { maxWidth: 'none', width: size ? size.width * scale / 100 : undefined }}
        onLoad={event => { setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); loaded(); }}
        onError={() => setFailed(true)} />}
    </div>
  </div>;
}
