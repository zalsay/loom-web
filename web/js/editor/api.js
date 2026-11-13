export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function requestJSON(path, { method = 'GET', body, signal, headers = {} } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: {
      Accept: 'application/json',
      ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-Loom-Request': '1' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      data.message || data.error?.message || '请求未完成，请稍后再试。',
      response.status,
      data.code || data.error?.code || data.error,
    );
  }
  return data;
}

export async function establishSession() {
  const existing = await requestJSON('/api/v1/session');
  if (existing.state === 'ready') return existing;
  if (!navigator.locks?.request) {
    throw new Error('这个浏览器暂时无法使用云端保存，仍可在这里编辑和导出备份。');
  }
  return navigator.locks.request('loom-visitor-bootstrap', async () => {
    const session = await requestJSON('/api/v1/session');
    if (session.state === 'ready') return session;
    await requestJSON('/api/v1/session/bootstrap', { method: 'POST', body: {} });
    const verified = await requestJSON('/api/v1/session');
    if (verified.state !== 'ready')
      throw new Error('浏览器未能保留访问凭证，暂时无法保存到云端。请检查是否允许此网站保存数据。');
    return verified;
  });
}

export async function requestCollection(path, field) {
  const values = [];
  const visited = new Set();
  let cursor = null;
  do {
    const url = new URL(path, location.origin);
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    const page = await requestJSON(`${url.pathname}${url.search}`);
    if (!Array.isArray(page[field])) throw new Error('暂时无法显示已保存的空间，当前草稿已保留。');
    values.push(...page[field]);
    cursor = page.nextCursor ?? null;
    if (cursor !== null) {
      if (visited.has(String(cursor))) throw new Error('空间列表未能完整打开，请稍后再试。');
      visited.add(String(cursor));
    }
  } while (cursor !== null);
  return values;
}
