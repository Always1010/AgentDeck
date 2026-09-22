export const BRIDGE_MARKER = 'agentdeck-bridge' as const;
export const BRIDGE_VERSION = 1 as const;
export type BridgeAction = 'back' | 'forward' | 'sidebar' | 'immersive' | 'search' | 'help' | 'escape';
export type BridgeConfig = { mode: 'web' | 'workbench'; singles: boolean; navigation: boolean; escape: boolean; active: boolean };
type Envelope = { marker: typeof BRIDGE_MARKER; version: typeof BRIDGE_VERSION; session: string };
export type BridgeMessage = Envelope & (
  { type: 'ready' | 'focus' } |
  { type: 'action'; action: BridgeAction } |
  { type: 'scroll' | 'restore-scroll'; x: number; y: number } |
  { type: 'config'; config: BridgeConfig }
);
