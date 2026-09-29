import { afterEach, describe, expect, it, vi } from 'vitest';
import { LatestRead } from '../app/web/viewers/requests.js';
import { api } from '../app/web/api.js';

afterEach(() => vi.unstubAllGlobals());

describe('viewer reads', () => {
  it('aborts replaced work and rejects late results even if transport ignores abort', () => {
    const reads = new LatestRead();
    const first = reads.begin();
    const second = reads.begin();
    expect(first.signal.aborted).toBe(true);
    expect(first.current()).toBe(false);
    expect(second.current()).toBe(true);
    reads.cancel();
    expect(second.signal.aborted).toBe(true);
    expect(second.current()).toBe(false);
  });

  it('passes cancellation through the API without changing request headers', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal);
      expect(init.headers).toEqual({});
      throw new DOMException('取消读取', 'AbortError');
    });
    vi.stubGlobal('fetch', fetch);
    await expect(api('/api/example', 'GET', undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
