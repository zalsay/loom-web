import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VoiceprintRegistry,
  assessAudioQuality,
  cosineSimilarity,
  normalizeEmbedding,
} from '../src/voice.js';

test('voice vectors normalize and compare deterministically', () => {
  const vector = normalizeEmbedding([3, 4, 0, 0, 0, 0, 0, 0]);
  assert.equal(vector[0], 0.6);
  assert.equal(vector[1], 0.8);
  assert.equal(cosineSimilarity(vector, vector), 1);
});

test('VoiceprintRegistry verifies the claimed child and rejects another speaker', () => {
  const registry = new VoiceprintRegistry({ threshold: 0.8, margin: 0.1 });
  registry.enroll('child-a', [
    [1, 0.02, 0, 0, 0, 0, 0, 0],
    [0.98, 0.03, 0, 0, 0, 0, 0, 0],
    [0.99, 0.01, 0, 0, 0, 0, 0, 0],
  ]);
  registry.enroll('child-b', [
    [0, 1, 0.02, 0, 0, 0, 0, 0],
    [0, 0.98, 0.03, 0, 0, 0, 0, 0],
    [0, 0.99, 0.01, 0, 0, 0, 0, 0],
  ]);

  const accepted = registry.verifyClaimed({
    claimedChildId: 'child-a',
    embedding: [1, 0.01, 0, 0, 0, 0, 0, 0],
  });
  assert.equal(accepted.verified, true);

  const rejected = registry.verifyClaimed({
    claimedChildId: 'child-a',
    embedding: [0, 1, 0, 0, 0, 0, 0, 0],
  });
  assert.equal(rejected.verified, false);
});

test('Quality gate rejects short, clipped and multi-speaker recordings', () => {
  assert.equal(
    assessAudioQuality({
      durationMs: 2_000,
      speechMs: 1_500,
      silenceRatio: 0.2,
      clippingRatio: 0.01,
    }).ok,
    true,
  );
  assert.equal(
    assessAudioQuality({
      durationMs: 500,
      speechMs: 300,
      silenceRatio: 0.4,
      clippingRatio: 0.01,
    }).code,
    'too_short',
  );
  assert.equal(
    assessAudioQuality({
      durationMs: 2_000,
      speechMs: 1_500,
      silenceRatio: 0.2,
      clippingRatio: 0.2,
    }).code,
    'clipping',
  );
  assert.equal(
    assessAudioQuality({
      durationMs: 2_000,
      speechMs: 1_500,
      silenceRatio: 0.2,
      clippingRatio: 0.01,
      speakerCount: 2,
    }).code,
    'multiple_speakers',
  );
});
