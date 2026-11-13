import { readEventStream } from './agent-client.js';
import { requestJSON } from './editor/api.js';

const root = document.querySelector('.panda-guide');
const toggle = document.querySelector('#guide-toggle');
const panel = document.querySelector('#guide-panel');
const input = document.querySelector('#guide-input');
const form = document.querySelector('#guide-form');
const messages = document.querySelector('#guide-messages');
const status = document.querySelector('#guide-status');
const send = document.querySelector('#guide-send');
const stop = document.querySelector('#guide-stop');
const suggestions = document.querySelector('.guide-suggestions');
let open = false,
  pending = null,
  mascot = null,
  conversationId = null,
  suspended = false,
  loading = false,
  pageActive = true,
  lifecycle = 0;

function setOpen(value, { restoreFocus = false } = {}) {
  open = value;
  panel.hidden = !value;
  toggle.setAttribute('aria-expanded', String(value));
  root.classList.toggle('is-open', value);
  mascot?.setEngaged(value);
  if (value) input.focus({ preventScroll: true });
  else if (restoreFocus) toggle.focus({ preventScroll: true });
}
toggle.addEventListener('click', () => setOpen(!open));
document.querySelector('.guide-welcome').addEventListener('click', () => setOpen(true));
document
  .querySelector('#guide-close')
  .addEventListener('click', () => setOpen(false, { restoreFocus: true }));
root.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && open) {
    event.preventDefault();
    event.stopPropagation();
    setOpen(false, { restoreFocus: true });
  }
});

// Reuse the website's signed visitor session. Locks prevent competing bootstrap cookies.
async function session(signal) {
  if ((await requestJSON('/api/v1/session', { signal })).state === 'ready') return;
  const establish = async () => {
    if ((await requestJSON('/api/v1/session', { signal })).state !== 'ready')
      await requestJSON('/api/v1/session/bootstrap', { method: 'POST', body: {}, signal });
    if ((await requestJSON('/api/v1/session', { signal })).state !== 'ready')
      throw new Error('session_unavailable');
  };
  if (navigator.locks?.request)
    await navigator.locks.request('loom-visitor-bootstrap', { signal }, establish);
  else await establish();
}
function scrollMessages(update) {
  // Keep reading position when someone has scrolled back through the conversation.
  const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100;
  update();
  if (nearBottom) messages.scrollTop = messages.scrollHeight;
}
function addMessage(role, text) {
  const article = document.createElement('article');
  article.className = `guide-message guide-message--${role}`;
  const label = document.createElement('span');
  label.className = 'guide-message-name';
  label.textContent = role === 'user' ? '你' : '小织';
  const content = document.createElement('p');
  content.textContent = text;
  article.append(label, content);
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
  return { article, content };
}
function updateSend() {
  send.disabled = Boolean(pending) || !input.value.trim();
}
function failureText(error) {
  if (error.status === 429) return '聊得有点快啦，稍等一会儿再发送吧。';
  if (error.status === 409) return '上一条消息还在回复中，请稍等一下。';
  if (error.status === 401) return '这次没能连接，请再发送一次。';
  return '暂时没连上小织，你的问题已保留，稍后可以再发送。';
}
async function submit(text) {
  if (pending || !text.trim()) return;
  const question = text.trim();
  const controller = new AbortController();
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 45_000);
  pending = controller;
  input.value = '';
  input.disabled = true;
  send.hidden = true;
  stop.hidden = false;
  suggestions.hidden = true;
  status.textContent = '小织正在想…';
  addMessage('user', question);
  const reply = addMessage('assistant', '');
  reply.article.classList.add('is-thinking');
  messages.setAttribute('aria-busy', 'true');
  let complete = false,
    answer = '';
  try {
    await session(controller.signal);
    controller.signal.throwIfAborted();
    conversationId ||= crypto.randomUUID();
    const response = await fetch('/guide', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Loom-Request': '1',
        'Makers-Conversation-Id': conversationId,
      },
      body: JSON.stringify({ message: question }),
    });
    await readEventStream(
      response,
      ({ type, data }) => {
        if (complete) throw new Error('unexpected_event');
        if (type === 'error') throw new Error('chat_interrupted');
        if (type === 'delta') {
          if (typeof data.text !== 'string' || answer.length + data.text.length > 16_000)
            throw new Error('invalid_reply');
          answer += data.text;
          reply.article.classList.remove('is-thinking');
          scrollMessages(() => {
            reply.content.textContent = answer;
          });
        }
        if (type === 'done') complete = true;
      },
      { signal: controller.signal, maxBuffer: 64 * 1024 },
    );
    if (!complete || !answer.trim()) throw new Error('chat_interrupted');
    status.textContent = '回复完成';
  } catch (error) {
    controller.abort();
    const cancelled = error.name === 'AbortError';
    status.textContent = timedOut
      ? '等候有点久，你的问题已保留，可以稍后再发送。'
      : cancelled
        ? '已停止回复，你可以继续提问。'
        : failureText(error);
    input.value = question;
    if (answer) {
      const note = document.createElement('small');
      note.textContent = cancelled ? '回复已停止' : '回复中断，内容可能不完整';
      reply.article.append(note);
    } else reply.article.remove();
  } finally {
    clearTimeout(deadline);
    reply.article.classList.remove('is-thinking');
    messages.setAttribute('aria-busy', 'false');
    pending = null;
    input.disabled = false;
    send.hidden = false;
    stop.hidden = true;
    updateSend();
    if (
      open &&
      !suspended &&
      (document.activeElement === stop || document.activeElement === document.body)
    )
      input.focus({ preventScroll: true });
  }
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void submit(input.value);
});
input.addEventListener('input', updateSend);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void submit(input.value);
  }
});
stop.addEventListener('click', () => pending?.abort());
suggestions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-question]');
  if (button) {
    input.value = button.dataset.question;
    updateSend();
    input.focus();
  }
});
updateSend();

function syncWorld() {
  suspended = document.body.classList.contains('world-open');
  mascot?.setPaused(suspended);
  if (suspended && open) setOpen(false);
}
new MutationObserver(syncWorld).observe(document.body, {
  attributes: true,
  attributeFilter: ['class'],
});
async function loadMascot() {
  if (mascot || loading || document.hidden || !pageActive) return;
  loading = true;
  const generation = lifecycle;
  try {
    const { createPandaMascot } = await import('./panda-mascot.js');
    if (generation !== lifecycle || !pageActive || document.hidden) return;
    mascot = createPandaMascot(document.querySelector('[data-panda-canvas]'));
    root.dataset.renderer = 'webgl';
    mascot.setEngaged(open);
    mascot.setPaused(suspended);
  } catch {
    root.dataset.renderer = 'fallback';
  } finally {
    if (generation === lifecycle) loading = false;
  }
}
void loadMascot();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !mascot) void loadMascot();
});
window.addEventListener('pagehide', () => {
  pageActive = false;
  lifecycle++;
  loading = false;
  pending?.abort();
  mascot?.dispose();
  mascot = null;
  root.dataset.renderer = 'fallback';
});
window.addEventListener('pageshow', () => {
  pageActive = true;
  if (!mascot) void loadMascot();
});

function fitKeyboard() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const offset = Math.max(0, innerHeight - viewport.height - viewport.offsetTop);
  root.style.setProperty('--guide-visible-height', `${viewport.height}px`);
  root.style.setProperty('--guide-keyboard-offset', `${offset}px`);
  root.classList.toggle('is-typing', offset > 120);
}
window.visualViewport?.addEventListener('resize', fitKeyboard);
window.visualViewport?.addEventListener('scroll', fitKeyboard);
fitKeyboard();
