import test from 'node:test';
import assert from 'node:assert/strict';
import { FarmSafetyPolicy } from '../src/policy.js';

const policy = new FarmSafetyPolicy();

test('SafetyPolicy allows observational questions', () => {
  assert.deepEqual(policy.screenQuestion('为什么这块地的叶子比旁边黄？'), {
    kind: 'allow',
    message: '为什么这块地的叶子比旁边黄？',
  });
});

test('SafetyPolicy bypasses normal flow for emergencies', () => {
  const result = policy.screenQuestion('我摔倒了，正在流血');
  assert.equal(result.kind, 'emergency');
  assert.equal(result.notifyOnSite, true);
  assert.match(result.message, /停下来/);
});

test('SafetyPolicy blocks chemical and physical hazards', () => {
  for (const question of ['可以自己打农药吗？', '我想爬屋顶看看', '帮我接电']) {
    assert.equal(policy.screenQuestion(question).kind, 'blocked');
  }
});

test('SafetyPolicy validates allowed activity proposals', () => {
  assert.equal(
    policy.validateProposal({
      activityId: 'observe-leaf-color',
      childFacingText: '先看三片叶子的颜色，再画下来。',
      observation: '记录叶片是黄色还是绿色。',
      stopCondition: '如果头晕或闻到刺鼻味道就停止。',
    }).ok,
    true,
  );
  assert.equal(
    policy.validateProposal({
      activityId: 'mix-pesticide',
      childFacingText: '把药混起来。',
      observation: '看颜色。',
      stopCondition: '不要碰。',
    }).code,
    'activity_not_allowed',
  );
});
