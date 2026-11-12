import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentWaker } from '../src/agent-waker.js';
import { FarmGateway } from '../src/gateway.js';
import { FarmSafetyPolicy } from '../src/policy.js';
import { FarmQueue } from '../src/queue.js';
import { VoiceprintRegistry } from '../src/voice.js';

function makeGateway({ transcript = '蓝色小番茄，我的番茄叶子为什么黄了？' } = {}) {
  let queueId = 0;
  const queue = new FarmQueue({
    now: () => 1_000,
    randomId: () => `queue-${++queueId}`,
  });
  const voiceprints = new VoiceprintRegistry({ threshold: 0.8, margin: 0.1 });
  voiceprints.enroll('child-a', [
    [1, 0, 0, 0, 0, 0, 0, 0],
    [0.99, 0.01, 0, 0, 0, 0, 0, 0],
    [0.98, 0.02, 0, 0, 0, 0, 0, 0],
  ]);
  const safetyEvents = [];
  const waker = new AgentWaker({ send: () => {} });
  let gatewayId = 0;
  const gateway = new FarmGateway({
    queue,
    voiceprints,
    transcriber: {
      transcribe: async () => ({ text: transcript, audioSeconds: 3, inferenceSeconds: 1 }),
    },
    policy: new FarmSafetyPolicy(),
    waker,
    now: () => 1_000,
    randomId: () => `gateway-${++gatewayId}`,
    random: () => 0,
    onSafetyEvent: (event) => safetyEvents.push(event),
  });
  return { gateway, queue, waker, safetyEvents };
}

const audioMeta = {
  durationMs: 4_000,
  speechMs: 3_000,
  silenceRatio: 0.2,
  clippingRatio: 0.01,
};
const embedding = [1, 0.01, 0, 0, 0, 0, 0, 0];

test('Gateway verifies, transcribes, confirms and queues one question', async () => {
  const { gateway, queue } = makeGateway();
  const challenge = gateway.createChallenge({ deviceSessionId: 'device-1', childId: 'child-a' });
  const voice = await gateway.submitVoiceQuestion({
    deviceSessionId: 'device-1',
    claimedChildId: 'child-a',
    plotId: 'plot-a',
    challengeId: challenge.challengeId,
    audio: new Uint8Array([1, 2, 3]),
    embedding,
    audioMeta,
  });
  assert.equal(voice.accepted, true);
  assert.equal(voice.transcript, '我的番茄叶子为什么黄了？');

  const confirmed = gateway.confirmQuestion({
    confirmationToken: voice.confirmationToken,
    confirmedTranscript: voice.transcript,
    requestId: 'request-1',
  });
  assert.equal(confirmed.queued, true);
  assert.equal(queue.snapshot().length, 1);
});

test('Gateway rejects a voiceprint mismatch before enqueue', async () => {
  const { gateway, queue } = makeGateway();
  const challenge = gateway.createChallenge({ deviceSessionId: 'device-1', childId: 'child-a' });
  const voice = await gateway.submitVoiceQuestion({
    deviceSessionId: 'device-1',
    claimedChildId: 'child-a',
    plotId: 'plot-a',
    challengeId: challenge.challengeId,
    audio: new Uint8Array([1]),
    embedding: [0, 1, 0, 0, 0, 0, 0, 0],
    audioMeta,
  });
  assert.equal(voice.accepted, false);
  assert.equal(voice.stage, 'voiceprint');
  assert.equal(queue.snapshot().length, 0);
});

test('Gateway emergency path notifies but does not enqueue a model task', async () => {
  const { gateway, queue, safetyEvents } = makeGateway({
    transcript: '蓝色小番茄，我摔倒了正在流血',
  });
  const challenge = gateway.createChallenge({ deviceSessionId: 'device-1', childId: 'child-a' });
  const voice = await gateway.submitVoiceQuestion({
    deviceSessionId: 'device-1',
    claimedChildId: 'child-a',
    plotId: 'plot-a',
    challengeId: challenge.challengeId,
    audio: new Uint8Array([1]),
    embedding,
    audioMeta,
  });
  const confirmed = gateway.confirmQuestion({
    confirmationToken: voice.confirmationToken,
    confirmedTranscript: voice.transcript,
    requestId: 'request-emergency',
  });
  assert.equal(confirmed.queued, false);
  assert.equal(confirmed.screening.kind, 'emergency');
  assert.equal(queue.snapshot().length, 0);
  assert.equal(safetyEvents.length, 1);
});

test('Gateway publishes only policy-validated answers under the active lease', async () => {
  const { gateway } = makeGateway();
  const challenge = gateway.createChallenge({ deviceSessionId: 'device-1', childId: 'child-a' });
  const voice = await gateway.submitVoiceQuestion({
    deviceSessionId: 'device-1',
    claimedChildId: 'child-a',
    plotId: 'plot-a',
    challengeId: challenge.challengeId,
    audio: new Uint8Array([1]),
    embedding,
    audioMeta,
  });
  gateway.confirmQuestion({
    confirmationToken: voice.confirmationToken,
    confirmedTranscript: voice.transcript,
    requestId: 'request-1',
  });
  const [claimed] = gateway.claimForAgent('farm-agent');
  const result = gateway.publishAnswer({
    caseId: claimed.caseId,
    leaseId: claimed.leaseId,
    draft: {
      activityId: 'observe-leaf-color',
      childFacingText: '先看新叶和旧叶，把颜色画下来。',
      observation: '记录哪一片叶子更黄。',
      stopCondition: '如果不舒服就停止并找现场负责人。',
    },
  });
  assert.equal(result.published, true);
  assert.equal(result.case.status, 'answered');
  assert.equal(result.case.answer.activityId, 'observe-leaf-color');
});
