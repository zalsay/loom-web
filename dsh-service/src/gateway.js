import { createHash, randomUUID } from 'node:crypto';
import { assessAudioQuality, createVoiceChallenge } from './voice.js';

function gatewayError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizedSpeech(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\s，。！？、,.!?：:；;]/g, '')
    .toLowerCase();
}

function stripLeadingPhrase(transcript, phrase) {
  const expected = normalizedSpeech(phrase);
  if (!expected) return String(transcript ?? '').trim();
  const characters = [...String(transcript ?? '')];
  let accumulated = '';
  let end = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (!/[\s，。！？、,.!?：:；;]/.test(character)) {
      accumulated += character.normalize('NFKC').toLowerCase();
    }
    end = index + 1;
    if (accumulated.length >= expected.length) break;
  }
  if (!accumulated.startsWith(expected)) return null;
  return characters
    .slice(end)
    .join('')
    .replace(/^[\s，。！？、,.!?：:；;]+/, '')
    .trim();
}

function transcriptHash(text) {
  return createHash('sha256').update(normalizedSpeech(text)).digest('hex');
}

export class FarmGateway {
  #queue;
  #voiceprints;
  #transcriber;
  #policy;
  #waker;
  #now;
  #randomId;
  #random;
  #challengeTtlMs;
  #confirmationTtlMs;
  #challenges = new Map();
  #confirmations = new Map();
  #onSafetyEvent;

  constructor({
    queue,
    voiceprints,
    transcriber,
    policy,
    waker,
    now = () => Date.now(),
    randomId = () => randomUUID(),
    random = Math.random,
    challengeTtlMs = 90_000,
    confirmationTtlMs = 120_000,
    onSafetyEvent = () => {},
  }) {
    for (const [name, value] of Object.entries({
      queue,
      voiceprints,
      transcriber,
      policy,
      waker,
    })) {
      if (!value) throw new TypeError(`${name} is required`);
    }
    if (typeof transcriber.transcribe !== 'function') {
      throw new TypeError('transcriber.transcribe must be a function');
    }
    if (typeof waker.request !== 'function')
      throw new TypeError('waker.request must be a function');
    if (typeof onSafetyEvent !== 'function')
      throw new TypeError('onSafetyEvent must be a function');

    this.#queue = queue;
    this.#voiceprints = voiceprints;
    this.#transcriber = transcriber;
    this.#policy = policy;
    this.#waker = waker;
    this.#now = now;
    this.#randomId = randomId;
    this.#random = random;
    this.#challengeTtlMs = challengeTtlMs;
    this.#confirmationTtlMs = confirmationTtlMs;
    this.#onSafetyEvent = onSafetyEvent;
  }

  createChallenge({ deviceSessionId, childId }) {
    const challenge = createVoiceChallenge({
      deviceSessionId,
      childId,
      now: this.#now(),
      ttlMs: this.#challengeTtlMs,
      randomId: this.#randomId,
      random: this.#random,
    });
    this.#challenges.set(challenge.challengeId, challenge);
    return { ...challenge };
  }

  async submitVoiceQuestion({
    deviceSessionId,
    claimedChildId,
    plotId,
    challengeId,
    audio,
    embedding,
    audioMeta,
    language = 'zh',
  }) {
    const challenge = this.#challenges.get(challengeId);
    if (!challenge) throw gatewayError('challenge_not_found', 'challenge does not exist');
    if (challenge.expiresAt < this.#now()) {
      this.#challenges.delete(challengeId);
      throw gatewayError('challenge_expired', 'challenge has expired');
    }
    if (challenge.deviceSessionId !== deviceSessionId || challenge.childId !== claimedChildId) {
      throw gatewayError('challenge_mismatch', 'challenge belongs to another device or child');
    }

    const quality = assessAudioQuality(audioMeta);
    if (!quality.ok) return { accepted: false, stage: 'quality', ...quality };

    const identity = this.#voiceprints.verifyClaimed({ claimedChildId, embedding });
    if (!identity.verified) return { accepted: false, stage: 'voiceprint', ...identity };

    const transcript = await this.#transcriber.transcribe({ audio, language });
    const question = stripLeadingPhrase(transcript?.text, challenge.phrase);
    if (question === null) {
      return {
        accepted: false,
        stage: 'challenge',
        code: 'challenge_not_spoken',
        message: `请先清楚地说出：${challenge.phrase}`,
      };
    }
    if (!question) {
      return {
        accepted: false,
        stage: 'asr',
        code: 'empty_transcript',
        message: '没有听清你的问题，请再说一次。',
      };
    }

    this.#challenges.delete(challengeId);
    const confirmationToken = this.#randomId();
    const createdAt = this.#now();
    const confirmation = {
      confirmationToken,
      deviceSessionId,
      childId: claimedChildId,
      plotId,
      text: question,
      textHash: transcriptHash(question),
      speakerProfileVersion: identity.profileVersion,
      createdAt,
      expiresAt: createdAt + this.#confirmationTtlMs,
    };
    this.#confirmations.set(confirmationToken, confirmation);

    return {
      accepted: true,
      stage: 'confirmation',
      confirmationToken,
      transcript: question,
      expiresAt: confirmation.expiresAt,
    };
  }

  confirmQuestion({ confirmationToken, confirmedTranscript, requestId }) {
    const confirmation = this.#confirmations.get(confirmationToken);
    if (!confirmation) throw gatewayError('confirmation_not_found', 'confirmation does not exist');
    if (confirmation.expiresAt < this.#now()) {
      this.#confirmations.delete(confirmationToken);
      throw gatewayError('confirmation_expired', 'confirmation has expired');
    }
    if (transcriptHash(confirmedTranscript) !== confirmation.textHash) {
      throw gatewayError(
        'transcript_mismatch',
        'confirmed transcript does not match the ASR result',
      );
    }

    this.#confirmations.delete(confirmationToken);
    const screening = this.#policy.screenQuestion(confirmation.text);
    if (screening.kind !== 'allow') {
      if (screening.notifyOnSite) {
        this.#onSafetyEvent({
          childId: confirmation.childId,
          kind: screening.kind,
          message: screening.message,
          at: this.#now(),
        });
      }
      return { queued: false, screening };
    }

    const record = this.#queue.enqueue({
      childId: confirmation.childId,
      plotId: confirmation.plotId,
      requestId,
      text: confirmation.text,
    });
    this.#waker.request();
    return { queued: true, case: record, screening };
  }

  claimForAgent(agentId) {
    return this.#queue.claim(agentId, { now: this.#now() });
  }

  publishAnswer({ caseId, leaseId, draft }) {
    const validation = this.#policy.validateProposal(draft);
    if (!validation.ok) return { published: false, validation };
    const record = this.#queue.complete(caseId, {
      leaseId,
      outcome: draft.outcome ?? 'answered',
      answer: {
        activityId: validation.activity.id,
        childFacingText: draft.childFacingText.trim(),
        observation: draft.observation.trim(),
        stopCondition: draft.stopCondition.trim(),
        possibleExplanations: Array.isArray(draft.possibleExplanations)
          ? draft.possibleExplanations.slice(0, 3).map(String)
          : [],
      },
      now: this.#now(),
    });
    return { published: true, case: record };
  }

  replyFromChild({ caseId, childId, text, requestId }) {
    const record = this.#queue.replyFromChild(caseId, {
      childId,
      text,
      now: this.#now(),
    });
    this.#waker.request();
    return { ...record, requestId };
  }

  getChildCases(childId) {
    return this.#queue.listForChild(childId);
  }

  setAgentRunning(running) {
    this.#waker.setRunning(running);
  }
}
