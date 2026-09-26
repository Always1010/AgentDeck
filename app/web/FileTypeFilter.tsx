import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.js';
import { commonFileTypes, defaultFileTypeFilter, NO_EXTENSION, normalizeExtension, type FileTypeFilter } from './fileExtensions.js';

export function FileTypeFilterControl({value,onChange}:{value:FileTypeFilter;onChange:(value:FileTypeFilter)=>void}) {
  const [open,setOpen]=useState(false);
  const [input,setInput]=useState('');
  const [error,setError]=useState('');
  const [position,setPosition]=useState({top:0,left:0});
  const button=useRef<HTMLButtonElement>(null);
  const panel=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{if(!open||!button.current||!panel.current)return;
    const anchor=button.current.getBoundingClientRect(),width=panel.current.offsetWidth,height=panel.current.offsetHeight;
    setPosition({top:anchor.bottom+height+8>innerHeight?Math.max(8,anchor.top-height-6):anchor.bottom+6,left:Math.max(8,Math.min(innerWidth-width-8,anchor.right-width))});
  },[open]);
  useEffect(()=>{if(!open)return;
    function outside(event:PointerEvent){const target=event.target as Node;if(!panel.current?.contains(target)&&!button.current?.contains(target))setOpen(false);}
    function escape(event:KeyboardEvent){if(event.key!=='Escape')return;event.preventDefault();event.stopImmediatePropagation();setOpen(false);button.current?.focus({preventScroll:true});}
    function resize(){setOpen(false);}
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);window.addEventListener('resize',resize);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',resize);};
  },[open]);
  function toggle(extension:string){onChange({...value,extensions:value.extensions.includes(extension)?value.extensions.filter(item=>item!==extension):[...value.extensions,extension]});}
  function add(event:FormEvent){event.preventDefault();const extension=normalizeExtension(input);if(!extension){setError('请输入有效后缀，例如 .log 或 tar.gz');return;}
    const common=commonFileTypes.some(([item])=>item===extension);
    onChange({...value,extensions:value.extensions.includes(extension)?value.extensions:[...value.extensions,extension],custom:common||value.custom.includes(extension)?value.custom:[...value.custom,extension]});
    setInput('');setError('');
  }
  return <>
    <button ref={button} className={value.mode!=='all'?'active':''} aria-label="文件类型筛选" title="按后缀筛选文件" aria-controls="file-type-filter" aria-expanded={open} onClick={()=>setOpen(!open)}><Icon name="filter"/></button>
    {open&&createPortal(<div ref={panel} id="file-type-filter" className="file-type-filter" role="group" aria-label="文件类型筛选" style={position}>
      <header><strong>文件类型筛选</strong><button aria-label="关闭文件类型筛选" onClick={()=>setOpen(false)}>×</button></header>
      <fieldset className="filter-modes"><legend>筛选方式</legend>{([['all','全部显示'],['allow','白名单'],['deny','黑名单']] as const).map(([mode,label])=><label key={mode}><input type="radio" name="file-type-mode" value={mode} checked={value.mode===mode} onChange={()=>onChange({...value,mode})}/>{label}</label>)}</fieldset>
      <p className="muted">白名单只显示所选后缀；黑名单隐藏所选后缀。更新未读共用此规则，所有页面同步。文件夹始终显示，已打开的文档不受影响。</p>
      <fieldset><legend>常见类型</legend><div className="filter-types">{commonFileTypes.map(([extension,label])=><label key={extension}><input type="checkbox" checked={value.extensions.includes(extension)} onChange={()=>toggle(extension)}/><span>{extension===NO_EXTENSION?label:`${extension} · ${label}`}</span></label>)}</div></fieldset>
      <form onSubmit={add}><label htmlFor="custom-file-extension">自定义后缀</label><div className="filter-add"><input id="custom-file-extension" value={input} placeholder="例如 .log、tar.gz" onChange={event=>{setInput(event.target.value);setError('');}}/><button type="submit">添加</button></div>{error&&<small role="alert">{error}</small>}</form>
      {!!value.custom.length&&<div className="filter-custom" aria-label="已添加的后缀">{value.custom.map(extension=><button key={extension} title={`移除 ${extension}`} aria-label={`移除自定义后缀 ${extension}`} onClick={()=>onChange({...value,custom:value.custom.filter(item=>item!==extension),extensions:value.extensions.filter(item=>item!==extension)})}>{extension} ×</button>)}</div>}
      <footer><span className="muted">已选择 {value.extensions.length} 种</span><button disabled={!value.extensions.length&&!value.custom.length} onClick={()=>onChange({...defaultFileTypeFilter,mode:value.mode})}>清空选择</button></footer>
    </div>,document.body)}
  </>;
}
