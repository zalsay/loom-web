// A start request is deliberately never retried here: a dropped stream may still incur model cost.
export async function readEventStream(response, onEvent, { signal, maxBuffer = 1024 * 1024 } = {}) {
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get('content-type')?.includes('text/event-stream')
  ) {
    const data = await response.json().catch(() => ({}));
    const nestedError = data?.error;
    const message =
      data?.message ||
      (typeof nestedError === 'string' ? nestedError : nestedError?.message) ||
      '助手暂时不可用，请保留草稿后再试。';
    const error = new Error(message);
    error.name = 'ApiError';
    error.status = response.status;
    error.code = data?.code || (typeof nestedError === 'string' ? nestedError : nestedError?.code);
    throw error;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = { type: 'message', id: '', data: [] };
  const seen = new Set();
  const dispatch = async () => {
    if (!event.data.length) {
      event = { type: 'message', id: '', data: [] };
      return;
    }
    const next = event;
    event = { type: 'message', id: '', data: [] };
    if (next.id && seen.has(next.id)) return;
    if (next.id) seen.add(next.id);
    if (seen.size > 2048) throw new Error('助手事件过多，已停止读取；草稿已保留。');
    let data;
    try {
      data = JSON.parse(next.data.join('\n'));
    } catch {
      throw new Error('助手返回了无法识别的数据，未应用新的修改。');
    }
    await onEvent({ type: next.type, id: next.id, data });
  };
  const line = async (value) => {
    if (!value) return dispatch();
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    const content = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event.type = content;
    if (field === 'id' && !content.includes('\0')) event.id = content;
    if (field === 'data') {
      event.data.push(content);
      if (event.data.reduce((length, part) => length + part.length, 0) > maxBuffer)
        throw new Error('助手响应超过安全大小上限。');
    }
  };
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const current = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        await line(current);
      }
      if (buffer.length > maxBuffer) throw new Error('助手响应超过安全大小上限。');
      if (done) break;
    }
    // A partial final frame is not a committed proposal. It is intentionally discarded.
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function startAgentTurn({ conversationId, body, onEvent, signal }) {
  const response = await fetch('/space-designer', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Loom-Request': '1',
      'Makers-Conversation-Id': conversationId,
    },
    body: JSON.stringify(body),
    signal,
  });
  return readEventStream(response, onEvent, { signal });
}
