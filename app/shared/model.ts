import { z } from 'zod';
export const modeSchema = z.enum(['content', 'tool-library', 'single-tool']);
export const kindSchema = z.enum(['html', 'tool', 'markdown', 'text', 'data']);
export const preferenceSchema = z.object({ title: z.string().max(200).optional(), kind: kindSchema.optional(), refreshMode: z.enum(['auto', 'prompt']).optional() });
export const projectInput = z.object({ name: z.string().trim().min(1).max(120), order: z.number().int().optional() });
export const mountInput = z.object({ label: z.string().trim().min(1).max(120), absolutePath: z.string().min(1), mode: modeSchema.default('content'), toolDirectories: z.array(z.string()).default([]), excludes: z.array(z.string()).default([]), entry: z.string().default('index.html'), enabled: z.boolean().default(true) });
// PATCH must not materialize create-time defaults for omitted settings.
export const mountPatch = z.object({label:z.string().trim().min(1).max(120).optional(),absolutePath:z.string().min(1).optional(),mode:modeSchema.optional(),toolDirectories:z.array(z.string()).optional(),excludes:z.array(z.string()).optional(),entry:z.string().optional(),enabled:z.boolean().optional()});
export const projectSchema = projectInput.extend({ id: z.string(), order: z.number().int() });
export const mountSchema = mountInput.extend({ id: z.string(), projectId: z.string() });
export const overrideSchema = z.object({ mountId: z.string(), toolRoot: z.string(), entry: z.string() });
export const registrySchema = z.object({ schemaVersion: z.literal(1), revision: z.number().int(), projects: z.array(projectSchema), mounts: z.array(mountSchema), toolOverrides: z.array(overrideSchema), entryPreferences: z.record(z.string(), preferenceSchema) });
export type Project = z.infer<typeof projectSchema>;
export type Mount = z.infer<typeof mountSchema>;
export type RegistryData = z.infer<typeof registrySchema>;
export type Entry = { id: string; projectId: string; mountId: string; title: string; kind: z.infer<typeof kindSchema>; format: string; relativePath: string; toolRoot?: string; resourceRoot: string; updatedAt: number; refreshMode: 'auto' | 'prompt'; status: 'ready' | 'pending-build' | 'choose-entry'; error?: string; candidates?: string[]; previewUrl?: string; fileVersion?: string };
export type MountState = { status: 'online' | 'offline' | 'disabled'; error?: string };
export type Snapshot = { projects: Project[]; mounts: (Mount & MountState)[]; revision: number };
export type TreeItem = { name: string; relativePath: string; directory: boolean; legacyIds?: string[] };
/** Reversible references allow opening files without an index. */
export const fileReference = (mountId: string, relativePath: string) => `file:${mountId}:${relativePath}`;
export type ToolItem = { id: string; title: string };
export function parseFileReference(id: string) {
  const match = /^file:([^:]+):(.+)$/.exec(id);
  return match ? { mountId: match[1], relativePath: match[2] } : undefined;
}
export type ChangeEvent = { mountId: string; projectId: string; revision: number; paths: string[]; entryIds: string[] };
export const previewPath = (mountId: string, path: string) => `/m/${encodeURIComponent(mountId)}/${path.split('/').map(encodeURIComponent).join('/')}`;
