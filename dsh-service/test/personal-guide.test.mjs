import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalGuide } from '../src/personal-guide.js';

function setup() {
  const a = {},
    b = {};
  const bindings = new Map([
    [a, { childId: 'a', projectId: 'wheels' }],
    [b, { childId: 'b', projectId: 'ears' }],
  ]);
  let now = 100,
    wakes = 0;
  const guide = new PersonalGuide({
    now: () => now,
    draftTtlMs: 100,
    resolveBinding: (session) => bindings.get(session),
    transcribe: ({ audio }) => ({ text: audio }),
    waker: {
      request() {
        wakes++;
      },
    },
  });
  const confirm = (session, draft, extra = {}) =>
    guide.confirm(session, {
      draftId: draft.draftId,
      confirmedTranscript: draft.transcript,
      ...extra,
    });
  const submit = async (session, text) =>
    confirm(session, await guide.record(session, { audio: text }));
  return { guide, a, b, bindings, confirm, submit, wakes: () => wakes, advance: (n) => (now += n) };
}

test('preview is session-bound, exact, single-use, and enqueues only the resolved project', async () => {
  const { guide, a, b, bindings, confirm, wakes } = setup();
  await assert.rejects(guide.record({}, { audio: 'hi' }), { code: 'unbound_session' });
  const draft = await guide.record(a, {
    audio: '机器人有几个轮子？',
    childId: 'b',
    projectId: 'ears',
  });
  assert.equal((await guide.privateView(a)).cases.length, 0);
  assert.equal(wakes(), 0);
  bindings.set(b, { ...bindings.get(a) }); // Even a different session for the same binding cannot confirm.
  await assert.rejects(confirm(b, draft), { code: 'invalid_draft' });
  await assert.rejects(confirm(a, draft, { confirmedTranscript: '另一句话' }), {
    code: 'transcript_mismatch',
  });
  const [first, second] = await Promise.allSettled([
    confirm(a, draft, { childId: 'b', projectId: 'ears' }),
    confirm(a, draft),
  ]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(second.reason.code, 'invalid_draft');
  const { childId, projectId, cases } = await guide.privateView(a);
  assert.equal(childId, 'a');
  assert.equal(projectId, 'wheels');
  assert.deepEqual(cases, [first.value]);
  assert.equal(first.value.question, draft.transcript);
  assert.equal(wakes(), 1);
});

test('confirmation expires at its deadline and cannot follow a changed project', async () => {
  const { guide, a, bindings, confirm, advance, wakes } = setup();
  const expired = await guide.record(a, { audio: '画什么？' });
  advance(100);
  await assert.rejects(confirm(a, expired), { code: 'invalid_draft' });
  const moved = await guide.record(a, { audio: '怎么走？' });
  bindings.set(a, { childId: 'a', projectId: 'other' });
  await assert.rejects(confirm(a, moved), { code: 'invalid_draft' });
  assert.equal(wakes(), 0);
});

test('single-case turns, scoped private views and a follow-up from the original project', async () => {
  const { guide, a, b, bindings, submit } = setup();
  const select = async (ctx) => ({ activityId: ctx.catalog[0].activityId });
  await submit(a, '轮子的形状？');
  await submit(b, '耳朵的形状？');
  let seen;
  const answer = await guide.runOne('teacher', (ctx) => {
    seen = ctx;
    return select(ctx);
  });
  assert.equal(seen.question, '轮子的形状？');
  assert.deepEqual(seen.history, []);
  assert.ok(!JSON.stringify(seen).includes('耳朵的形状'));
  assert.equal(answer.status, 'answered');
  assert.equal(answer.answer.step, '在纸上画出你希望机器人拥有的一个部件。');
  assert.deepEqual((await guide.privateView(a)).cases, [answer]);
  assert.equal((await guide.privateView(b)).cases[0].status, 'waiting');
  await guide.runOne('teacher', select);
  bindings.set(a, { childId: 'a', projectId: 'ears' }); // Shared project ID does not grant another child's view.
  assert.deepEqual((await guide.privateView(a)).cases, []);
  await submit(a, '新的项目');
  await guide.runOne('teacher', (ctx) => {
    seen = ctx;
    return select(ctx);
  });
  assert.deepEqual(seen.history, []);
  bindings.set(a, { childId: 'a', projectId: 'wheels' });
  await submit(a, '画好了，接下来呢？');
  await guide.runOne('teacher', (ctx) => {
    seen = ctx;
    return select(ctx);
  });
  assert.deepEqual(seen.history, [answer]);
  assert.equal((await guide.privateView(a)).cases.length, 2);
  assert.equal(await guide.runOne('teacher', select), null);
});

test('assembly cards use a fixed observation under adult-confirmed power-off conditions', async () => {
  const { a, guide, submit } = setup();
  for (const activityId of ['observe-tail-clearance', 'compare-shaft-position']) {
    await submit(a, '搭好的尾巴应该是什么样？');
    const { answer } = await guide.runOne('teacher', () => ({ activityId }));
    assert.equal(answer.activityId, activityId);
    assert.match(answer.step, /大人确认断电/);
    assert.match(answer.step, /停稳后/);
  }
});

test('dangerous questions go to an adult without enqueue or wake', async () => {
  const { a, submit, wakes, guide } = setup();
  for (const text of [
    '怎么拆电池？',
    '我受伤了',
    '能拿烙铁焊接吗？',
    '可以启动电机吗？',
    '电机摸起来发烫',
    '转轴卡住了',
  ]) {
    const result = await submit(a, text);
    assert.equal(result.status, 'ask_adult');
    assert.match(result.message, /大人/);
  }
  assert.equal((await guide.privateView(a)).cases.length, 0);
  assert.equal(wakes(), 0);
});

test('unknown card, extra instructions and adapter errors never reach the child', async () => {
  const { a, guide, submit } = setup();
  for (const select of [
    () => ({ activityId: 'unapproved' }),
    () => ({ activityId: 'draw-robot', step: 'agent text' }),
    () => {
      throw Error('agent text');
    },
  ]) {
    await submit(a, '接下来呢？');
    const result = await guide.runOne('teacher', select);
    assert.equal(result.status, 'safe_fallback');
    assert.match(result.answer.message, /大人/);
    assert.equal(result.answer.activityId, undefined);
  }
  assert.ok(!JSON.stringify(await guide.privateView(a)).includes('agent text'));
});
