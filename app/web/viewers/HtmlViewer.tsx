import type { Ref } from 'react';

export function HtmlViewer({ frame, url, title, source, loaded }: { frame: Ref<HTMLIFrameElement>; url?: string; title: string; source: boolean; loaded: () => void }) {
  return <iframe ref={frame} onLoad={loaded} style={{ display: source ? 'none' : undefined }} title={title} src={url}
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" />;
}
