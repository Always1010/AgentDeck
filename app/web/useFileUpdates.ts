import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultFileTypeFilter, isFileTypeFilter, type FileTypeFilter } from '../shared/file-types.js';
import type { UpdatesSnapshot } from '../shared/updates.js';
import { api } from './api.js';

const empty:UpdatesSnapshot={initialized:false,filter:defaultFileTypeFilter,items:[],total:0,through:0,busy:false,errors:[]};
function legacyFilter(){try{const value:unknown=JSON.parse(localStorage.getItem('explorer.file-types')||'null');return isFileTypeFilter(value)?value:defaultFileTypeFilter;}catch{return defaultFileTypeFilter;}}
export function useFileUpdates(){
  const [snapshot,setSnapshot]=useState(empty);
  const [filter,setLocalFilter]=useState(legacyFilter);
  const [error,setError]=useState('');
  const [writeError,setWriteError]=useState('');
  const [ready,setReady]=useState(false);
  const [saving,setSaving]=useState(false);
  const mounted=useRef(false),serial=useRef(0),writes=useRef(0),queue=useRef<Promise<unknown>>(Promise.resolve());
  const accept=useCallback((next:UpdatesSnapshot)=>{setSnapshot(next);if(!writes.current)setLocalFilter(next.filter);setReady(true);setError('');},[]);
  const reload=useCallback(async()=>{
    const token=++serial.current;
    try{const next=await api<UpdatesSnapshot>('/api/file-updates');if(mounted.current&&token===serial.current)accept(next);}
    catch(e){if(mounted.current&&token===serial.current)setError((e as Error).message);}
  },[accept]);
  useEffect(()=>{
    mounted.current=true;
    void (async()=>{
      try{const next=await api<UpdatesSnapshot>('/api/file-updates');if(!mounted.current)return;
        if(!next.initialized&&!next.errors.length)await api('/api/file-updates/filter','PUT',{filter:legacyFilter(),initializeOnly:true});
        if(mounted.current)await reload();
      }catch(e){if(mounted.current)setError((e as Error).message);}
    })();
    return()=>{mounted.current=false;serial.current++;};
  },[reload]);
  function setFilter(next:FileTypeFilter){
    setLocalFilter(next);writes.current++;setSaving(true);
    queue.current=queue.current.catch(()=>{}).then(()=>api('/api/file-updates/filter','PUT',{filter:next})).then(()=>{
      try{localStorage.setItem('explorer.file-types',JSON.stringify(next));}catch{/* Server preference remains authoritative. */}
      if(mounted.current)setWriteError('');
    }).catch(e=>{if(mounted.current)setWriteError(`筛选保存失败：${(e as Error).message}`);}).finally(()=>{
      writes.current--;if(mounted.current&&!writes.current){setSaving(false);void reload();}
    });
  }
  const acknowledge=useCallback(async(input:{id:string;version:string}|{through:number})=>{
    try{await api('/api/file-updates/read','POST',input);if(mounted.current){setWriteError('');await reload();}}
    catch(e){if(mounted.current)setWriteError(`已读状态保存失败：${(e as Error).message}`);throw e;}
  },[reload]);
  return {snapshot,filter,setFilter,error:[error,writeError].filter(Boolean).join(' '),ready,saving,reload,acknowledge};
}
