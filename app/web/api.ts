export class ApiError extends Error { constructor(message: string, public code: string, public details: Record<string, unknown>) { super(message); } }
export async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Workbench':'1' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error?.message || '请求失败', data.error?.code, data.error || {});
  return data;
}
