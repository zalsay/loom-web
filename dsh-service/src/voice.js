import { randomUUID } from 'node:crypto';

const DEFAULT_THRESHOLD = 0.72;
const DEFAULT_MARGIN = 0.08;
const DEFAULT_MIN_TEMPLATES = 3;
const DEFAULT_MAX_TEMPLATES = 5;
const CHALLENGE_PHRASES = Object.freeze([
  '蓝色小番茄',
  '三片绿叶子',
  '向日葵点点头',
  '小水滴慢慢流',
  '今天的风很轻',
]);

function voiceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireVector(vector, name = 'embedding') {
  if (!Array.isArray(vector) || vector.length < 8) {
    throw voiceError('invalid_embedding', `${name} must be an array with at least 8 values`);
  }
  if (!vector.every((value) => Number.isFinite(value))) {
    throw voiceError('invalid_embedding', `${name} contains a non-finite value`);
  }
  return vector;
}

export function normalizeEmbedding(embedding) {
  const vector = requireVector(embedding);
  const norm = Math.hypot(...vector);
  if (norm === 0) throw voiceError('invalid_embedding', 'embedding norm is zero');
  return vector.map((value) => value / norm);
}

export function cosineSimilarity(left, right) {
  const a = normalizeEmbedding(left, 'left embedding');
  const b = normalizeEmbedding(right, 'right embedding');
  if (a.length !== b.length) throw voiceError('dimension_mismatch', 'embedding dimensions differ');
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

export function assessAudioQuality({
  durationMs,
  speechMs,
  silenceRatio,
  clippingRatio,
  speakerCount = 1,
  minDurationMs = 1_000,
  maxDurationMs = 30_000,
  minSpeechMs = 800,
  maxSilenceRatio = 0.75,
  maxClippingRatio = 0.05,
} = {}) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { ok: false, code: 'invalid_duration', message: '录音时长无效。' };
  }
  if (durationMs < minDurationMs) {
    return { ok: false, code: 'too_short', message: '录音太短，请完整说出问题。' };
  }
  if (durationMs > maxDurationMs) {
    return { ok: false, code: 'too_long', message: '录音太长，请压缩成一个问题。' };
  }
  if (!Number.isFinite(speechMs) || speechMs < minSpeechMs) {
    return { ok: false, code: 'too_little_speech', message: '没有听到足够清楚的语音。' };
  }
  if (!Number.isFinite(silenceRatio) || silenceRatio > maxSilenceRatio) {
    return {
      ok: false,
      code: 'too_much_silence',
      message: '录音里空白太多，请靠近设备再说一次。',
    };
  }
  if (!Number.isFinite(clippingRatio) || clippingRatio < 0 || clippingRatio > maxClippingRatio) {
    return { ok: false, code: 'clipping', message: '声音太大或太吵，请稍微离远一点再说。' };
  }
  if (!Number.isInteger(speakerCount) || speakerCount < 1) {
    return { ok: false, code: 'invalid_speaker_count', message: '无法判断说话人数。' };
  }
  if (speakerCount > 1) {
    return { ok: false, code: 'multiple_speakers', message: '一次只让一个小朋友说。' };
  }
  return { ok: true };
}

export class VoiceprintRegistry {
  #profiles = new Map();
  #threshold;
  #margin;
  #minTemplates;
  #maxTemplates;

  constructor({
    threshold = DEFAULT_THRESHOLD,
    margin = DEFAULT_MARGIN,
    minTemplates = DEFAULT_MIN_TEMPLATES,
    maxTemplates = DEFAULT_MAX_TEMPLATES,
  } = {}) {
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
      throw new TypeError('threshold must be in (0, 1]');
    }
    if (!Number.isFinite(margin) || margin < 0 || margin > 1) {
      throw new TypeError('margin must be in [0, 1]');
    }
    if (!Number.isSafeInteger(minTemplates) || minTemplates <= 0) {
      throw new TypeError('minTemplates must be a positive integer');
    }
    if (!Number.isSafeInteger(maxTemplates) || maxTemplates < minTemplates) {
      throw new TypeError('maxTemplates must be at least minTemplates');
    }
    this.#threshold = threshold;
    this.#margin = margin;
    this.#minTemplates = minTemplates;
    this.#maxTemplates = maxTemplates;
  }

  enroll(childId, embeddings) {
    const id = String(childId ?? '').trim();
    if (!id) throw voiceError('invalid_child', 'childId is required');
    if (!Array.isArray(embeddings) || embeddings.length < this.#minTemplates) {
      throw voiceError('not_enough_templates', 'not enough voice templates');
    }
    if (embeddings.length > this.#maxTemplates) {
      throw voiceError('too_many_templates', 'too many voice templates');
    }

    const templates = embeddings.map((embedding) => normalizeEmbedding(embedding));
    const current = this.#profiles.get(id);
    const profile = {
      childId: id,
      templates,
      version: (current?.version ?? 0) + 1,
      modelVersion: 'unconfigured',
    };
    this.#profiles.set(id, profile);
    return { childId: id, version: profile.version, templateCount: templates.length };
  }

  remove(childId) {
    return this.#profiles.delete(childId);
  }

  verifyClaimed({ claimedChildId, embedding, threshold = this.#threshold, margin = this.#margin }) {
    const profile = this.#profiles.get(claimedChildId);
    if (!profile) {
      return { verified: false, code: 'unknown_profile', score: null, margin: null };
    }

    const probe = normalizeEmbedding(embedding);
    const score = Math.max(
      ...profile.templates.map((template) => cosineSimilarity(probe, template)),
    );
    let bestOther = null;
    for (const [childId, otherProfile] of this.#profiles) {
      if (childId === claimedChildId) continue;
      const otherScore = Math.max(
        ...otherProfile.templates.map((template) => cosineSimilarity(probe, template)),
      );
      bestOther = bestOther === null ? otherScore : Math.max(bestOther, otherScore);
    }
    const scoreMargin = bestOther === null ? 1 : score - bestOther;
    if (score < threshold) {
      return { verified: false, code: 'score_below_threshold', score, margin: scoreMargin };
    }
    if (scoreMargin < margin) {
      return { verified: false, code: 'ambiguous_speaker', score, margin: scoreMargin };
    }

    return {
      verified: true,
      code: 'verified',
      score,
      margin: scoreMargin,
      profileVersion: profile.version,
    };
  }

  identify({ embedding, threshold = this.#threshold, margin = this.#margin }) {
    const probe = normalizeEmbedding(embedding);
    const scores = [...this.#profiles.entries()]
      .map(([childId, profile]) => ({
        childId,
        score: Math.max(...profile.templates.map((template) => cosineSimilarity(probe, template))),
        profileVersion: profile.version,
      }))
      .sort((left, right) => right.score - left.score);
    if (!scores.length) return { identified: false, code: 'empty_gallery' };
    const first = scores[0];
    const second = scores[1] ?? null;
    const scoreMargin = second ? first.score - second.score : 1;
    if (first.score < threshold || scoreMargin < margin) {
      return { identified: false, code: 'ambiguous_speaker', candidates: scores.slice(0, 3) };
    }
    return { identified: true, childId: first.childId, profileVersion: first.profileVersion };
  }

  profile(childId) {
    const profile = this.#profiles.get(childId);
    if (!profile) return null;
    return {
      childId: profile.childId,
      version: profile.version,
      templateCount: profile.templates.length,
      modelVersion: profile.modelVersion,
    };
  }
}

export function createVoiceChallenge({
  deviceSessionId,
  childId,
  now = Date.now(),
  ttlMs = 90_000,
  randomId = () => randomUUID(),
  random = Math.random,
} = {}) {
  const normalizedDevice = String(deviceSessionId ?? '').trim();
  const normalizedChild = String(childId ?? '').trim();
  if (!normalizedDevice || !normalizedChild) {
    throw voiceError('invalid_challenge', 'deviceSessionId and childId are required');
  }
  const index = Math.min(
    CHALLENGE_PHRASES.length - 1,
    Math.floor(random() * CHALLENGE_PHRASES.length),
  );
  return {
    challengeId: randomId(),
    deviceSessionId: normalizedDevice,
    childId: normalizedChild,
    phrase: CHALLENGE_PHRASES[index],
    createdAt: now,
    expiresAt: now + ttlMs,
  };
}
