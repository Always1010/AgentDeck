import { test, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkbench } from '../app/server/server.js';
import { legacyId } from '../app/server/files.js';
import { fileReference } from '../app/shared/model.js';

test('upgrade snapshot resolves old links at startup without directory reads and rejects unsafe records', async () => {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-upgrade-'));
  const root=path.join(temp,'project'),stateDir=path.join(temp,'state');await fs.mkdir(root);
  await fs.writeFile(path.join(root,'中文 #%.md'),'# preserved');
  const options={stateDir,port:4310,previewPort:4311};let app=await createWorkbench(options);
  const headers={host:'127.0.0.1:4310','sec-fetch-site':'same-origin',origin:'http://127.0.0.1:4310','x-workbench':'1','content-type':'application/json'};
  try {
    await app.main.inject({method:'POST',url:'/api/projects',headers,payload:{name:'project',mount:{label:'root',absolutePath:root}}});
    const id=app.registry.data.mounts[0].id,old=legacyId(id,'中文 #%.md'),target=fileReference(id,'中文 #%.md');
    await app.close();await fs.writeFile(path.join(stateDir,'legacy-file-references.json'),JSON.stringify({[old]:target,['a'.repeat(32)]:fileReference(id,'../secret.txt'),invalid:target}));
    const readdir=vi.spyOn(fs,'readdir');
    try {
      app=await createWorkbench(options);
      expect((await app.main.inject({url:'/api/legacy-files',headers})).json()).toEqual({[old]:target});
      expect((await app.main.inject({url:`/api/entries/${old}`,headers})).json()).toMatchObject({id:target,relativePath:'中文 #%.md'});
      expect((await app.main.inject({url:`/api/entries/${'a'.repeat(32)}`,headers})).statusCode).toBe(404);
      expect(readdir).not.toHaveBeenCalled();
    } finally { readdir.mockRestore(); }
  } finally { await app.close();await fs.rm(temp,{recursive:true,force:true}); }
});
