import path from 'node:path';
import { createWorkbench } from './server.js';
import { dataHome, migrateLegacyState, projectRoot } from './runtime.js';
const args = process.argv.slice(2);
function option(name: string, fallback: string) { const i = args.indexOf(name); return i >= 0 ? args[i+1] : fallback; }
const stateDir = path.resolve(option('--state-dir', path.join(dataHome(), 'state')));
const port = Number(option('--port','4310')); const previewPort = Number(option('--preview-port','4311'));
try {
  if (!args.includes('--state-dir')) await migrateLegacyState();
  process.chdir(await projectRoot(import.meta.url));
  const app = await createWorkbench({ stateDir, port, previewPort, dev: args.includes('--dev') });
  await app.listen();
  console.log(`AgentDeck: ${app.mainOrigin} · 预览: ${app.previewOrigin} · 配置: ${app.registry.directory}`);
  for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, async () => { await app.close(); process.exit(0); });
} catch (e) { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }
