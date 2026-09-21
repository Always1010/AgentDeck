import { type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Entry } from '../shared/model.js';
import { previewPath } from '../shared/model.js';
function plain(node:ReactNode):string{return typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(plain).join(''):node&&typeof node==='object'&&'props' in node?plain((node.props as {children?:ReactNode}).children):'';}
export function Markdown({text,entry,previewOrigin,navigate}:{text:string;entry:Entry;previewOrigin:string;navigate:(path:string)=>void}){
  const base=previewOrigin+previewPath(entry.mountId,entry.relativePath);const prefix=previewPath(entry.mountId,'');
  function url(value:string){
    if(value.startsWith('#'))return value;
    if(/^https?:\/\//i.test(value))return value;
    if(/^[a-z][a-z\d+.-]*:/i.test(value)||value.startsWith('//')||value.includes('\\'))return '';
    try{const result=new URL(value,base);if(result.origin!==previewOrigin||!result.pathname.startsWith(prefix))return '';const decoded=decodeURIComponent(result.pathname.slice(prefix.length));if(decoded.split('/').some(p=>p==='..'||p==='.')||decoded.includes('\\'))return '';return result.href;}catch{return '';}
  }
  const heading=(Tag:'h1'|'h2'|'h3'|'h4'|'h5'|'h6')=>({children}:{children?:ReactNode})=><Tag id={plain(children).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').trim().replace(/\s+/g,'-')}>{children}</Tag>;
  return <article className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url} components={{h1:heading('h1'),h2:heading('h2'),h3:heading('h3'),h4:heading('h4'),h5:heading('h5'),h6:heading('h6'),a:({href,children})=>{
    if(href?.startsWith('#'))return <a href={href} onClick={e=>{e.preventDefault();document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();}}>{children}</a>;
    const local=href?.startsWith(previewOrigin+prefix);return <a href={href||undefined} target="_blank" rel="noopener noreferrer" onClick={e=>{if(local&&href&&/\.(md|markdown|txt|csv|json)(?:[?#]|$)/i.test(href)){e.preventDefault();navigate(decodeURIComponent(new URL(href).pathname.slice(prefix.length)));}}}>{children}</a>;
  }}}>{text}</ReactMarkdown></article>;
}
