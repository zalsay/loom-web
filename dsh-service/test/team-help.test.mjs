import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeamHelp, HELP_TYPES } from '../src/team-help.js';

function setup() {
  const bindings = new Map(
    ['a', 'b', 'c', 'x'].map((s) => [
      s,
      {
        childId: `private-child-${s}`,
        projectId: `private-project-${s}`,
        teamId: s === 'x' ? 'private-other' : 'private-team',
      },
    ]),
  );
  const service = createTeamHelp({ resolveBinding: async (session) => bindings.get(session) });
  return { service, bindings };
}
const input = { type: HELP_TYPES[0], requestId: 'private-nonce' };
const empty = { cards: [], teamPoints: 0 };

test('explicit templates only; reject private text or forged binding without creating cards', async () => {
  const { service } = setup();
  for (const data of [
    null,
    {},
    { ...input, type: 'my private chat' },
    { ...input, rawChat: 'my private chat' },
    { ...input, childId: 'private-child-b' },
    { ...input, requestId: '' },
    { type: HELP_TYPES[0] },
  ]) {
    await assert.rejects(service.publish('a', data), { code: 'invalid_input' });
  }
  assert.deepEqual(await service.board('a'), empty);
  const card = await service.publish('a', input);
  assert.deepEqual(card, {
    cardId: card.cardId,
    type: input.type,
    status: 'open',
    myRole: 'author',
    myConfirmed: false,
  });
  card.status = 'completed';
  const board = await service.board('b');
  assert.deepEqual(board, {
    cards: [{ ...card, status: 'open', myRole: 'member' }],
    teamPoints: 0,
  });
  assert.doesNotMatch(JSON.stringify(board), /private/);
});

test('publication replay is scoped to intent and participant, including concurrent calls', async () => {
  const { service } = setup();
  const [first, replay] = await Promise.all([
    service.publish('a', input),
    service.publish('a', input),
  ]);
  assert.deepEqual(first, replay);
  await assert.rejects(service.publish('a', { ...input, type: HELP_TYPES[1] }), {
    code: 'request_conflict',
  });
  assert.notEqual((await service.publish('b', input)).cardId, first.cardId);
  assert.equal((await service.board('b')).cards.length, 2);
});

test('distinct children in different projects on one team can complete; credit only once', async () => {
  const { service } = setup();
  const { cardId } = await service.publish('a', input);
  await assert.rejects(service.claim('a', cardId), { code: 'self_claim' });
  await assert.rejects(service.confirm('a', cardId), { code: 'not_claimed' });
  const results = await Promise.allSettled(['b', 'c'].map((s) => service.claim(s, cardId)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'already_claimed');
  const [helper, third] = results[0].status === 'fulfilled' ? ['b', 'c'] : ['c', 'b'];
  assert.equal((await service.claim(helper, cardId)).myRole, 'helper');
  await assert.rejects(service.confirm(third, cardId), { code: 'not_participant' });
  for (const s of [helper, helper])
    assert.equal((await service.confirm(s, cardId)).status, 'claimed');
  assert.equal((await service.board('a')).teamPoints, 0);
  const confirmations = await Promise.all(
    ['a', helper, 'a'].map((s) => service.confirm(s, cardId)),
  );
  assert.ok(confirmations.every((card) => card.status === 'completed' && card.myConfirmed));
  assert.equal((await service.claim(helper, cardId)).status, 'completed');
  assert.equal((await service.publish('a', input)).status, 'completed');
  assert.deepEqual(await service.board(third), {
    cards: [
      { cardId, type: input.type, status: 'completed', myRole: 'member', myConfirmed: false },
    ],
    teamPoints: 1,
  });
});

test('cross-team board and mutations cannot distinguish foreign cards from missing ones', async () => {
  const { service, bindings } = setup();
  const { cardId } = await service.publish('a', input);
  Object.assign(bindings.get('x'), {
    childId: bindings.get('a').childId,
    projectId: bindings.get('a').projectId,
  });
  assert.deepEqual(await service.board('x'), empty);
  for (const id of [cardId, 'missing']) {
    for (const op of ['claim', 'confirm'])
      await assert.rejects(service[op]('x', id), { code: 'not_found', message: 'not_found' });
  }
  await service.claim('b', cardId);
  await service.confirm('a', cardId);
  await service.confirm('b', cardId);
  assert.deepEqual(await service.board('x'), empty);
});

test('re-resolve binding each time; self-claim and stale project participation are blocked', async () => {
  const { service, bindings } = setup();
  const { cardId } = await service.publish('a', input);
  await service.claim('b', cardId);
  for (const s of ['a', 'b']) {
    bindings.get(s).projectId += '-changed';
    assert.equal((await service.board(s)).cards[0].myRole, 'member');
    await assert.rejects(service.confirm(s, cardId), { code: 'not_participant' });
  }
  await assert.rejects(service.claim('a', cardId), { code: 'self_claim' });
  await assert.rejects(service.claim('b', cardId), { code: 'already_claimed' });
  assert.equal((await service.board('c')).teamPoints, 0);
  bindings.delete('a');
  await assert.rejects(service.board('a'), { code: 'unbound' });
});

test('missing bindings and host failures fail closed without exposing session or IDs', async () => {
  for (const resolveBinding of [
    () => null,
    () => ({ childId: 'private', projectId: 'p' }),
    async (s) => {
      throw new Error(`secret: ${s}`);
    },
  ]) {
    const service = createTeamHelp({ resolveBinding });
    for (const call of [
      () => service.board('token'),
      () => service.publish('token', input),
      () => service.claim('token', 'id'),
      () => service.confirm('token', 'id'),
    ]) {
      await assert.rejects(call, { code: 'unbound', message: 'unbound' });
    }
  }
});
