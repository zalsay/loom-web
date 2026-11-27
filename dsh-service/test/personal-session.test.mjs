import assert from 'node:assert/strict';
import test from 'node:test';
import { createTeamHelp, PersonalGuide } from '../src/index.js';

test('two personal terminals receive different private steps and explicitly cooperate across projects', async () => {
  const bindings = new Map([
    ['device-A', { childId: 'a', projectId: 'dog', teamId: 'makers' }],
    ['device-B', { childId: 'b', projectId: 'arm', teamId: 'makers' }],
  ]);
  const resolveBinding = (session) => bindings.get(session);
  const guide = new PersonalGuide({ resolveBinding, transcribe: ({ audio }) => audio });
  const team = createTeamHelp({ resolveBinding });
  for (const [device, question] of [
    ['device-A', '想画一只机器狗'],
    ['device-B', '我想用什么信号？'],
  ]) {
    const draft = await guide.record(device, { audio: question });
    await guide.confirm(device, { draftId: draft.draftId, confirmedTranscript: draft.transcript });
  }
  const seen = [];
  const choose = ({ projectId, question, history }) => {
    seen.push({ projectId, question });
    assert.deepEqual(history, []);
    return { activityId: projectId === 'dog' ? 'draw-robot' : 'name-signal' };
  };
  await guide.runOne('g', choose);
  await guide.runOne('g', choose);
  assert.equal(seen.length, 2);
  for (const [device, activity] of [
    ['device-A', 'draw-robot'],
    ['device-B', 'name-signal'],
  ]) {
    const { cases } = await guide.privateView(device);
    assert.equal(cases.length, 1);
    assert.equal(cases[0].answer.activityId, activity);
  }
  assert.deepEqual(await team.board('device-B'), { cards: [], teamPoints: 0 });
  const { cardId } = await team.publish('device-A', {
    type: 'check_observation',
    requestId: 'demo',
  });
  await team.claim('device-B', cardId);
  await team.confirm('device-B', cardId);
  await team.confirm('device-A', cardId);
  assert.equal((await team.board('device-B')).teamPoints, 1);
});
