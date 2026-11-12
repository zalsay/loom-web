import { randomUUID } from 'node:crypto';

const OPEN_STATUSES = new Set(['waiting', 'processing', 'needs_child']);
const COMPLETION_OUTCOMES = new Set(['answered', 'needs_child', 'safe_fallback']);

function queueError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredString(value, name, maximum = 4_000) {
  if (typeof value !== 'string' || !value.trim()) {
    throw queueError('invalid_input', `${name} must be a non-empty string`);
  }
  if (value.length > maximum) {
    throw queueError('invalid_input', `${name} is too long`);
  }
  return value.trim();
}

function clone(value) {
  return structuredClone(value);
}

export class FarmQueue {
  #cases = new Map();
  #requestIds = new Map();
  #lastServedAt = new Map();
  #now;
  #randomId;
  #leaseMs;
  #maxOpenPerChild;
  #maxBatchSize;

  constructor({
    now = () => Date.now(),
    randomId = () => randomUUID(),
    leaseMs = 120_000,
    maxOpenPerChild = 3,
    maxBatchSize = 8,
  } = {}) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
      throw new TypeError('leaseMs must be a positive integer');
    }
    if (!Number.isSafeInteger(maxOpenPerChild) || maxOpenPerChild <= 0) {
      throw new TypeError('maxOpenPerChild must be a positive integer');
    }
    if (!Number.isSafeInteger(maxBatchSize) || maxBatchSize <= 0) {
      throw new TypeError('maxBatchSize must be a positive integer');
    }

    this.#now = now;
    this.#randomId = randomId;
    this.#leaseMs = leaseMs;
    this.#maxOpenPerChild = maxOpenPerChild;
    this.#maxBatchSize = maxBatchSize;
  }

  enqueue({ childId, plotId, requestId, text, prediction = '' }) {
    const normalizedChildId = requiredString(childId, 'childId', 128);
    const normalizedPlotId = requiredString(plotId, 'plotId', 128);
    const normalizedRequestId = requiredString(requestId, 'requestId', 128);
    const normalizedText = requiredString(text, 'text', 2_000);
    const normalizedPrediction = String(prediction ?? '')
      .trim()
      .slice(0, 1_000);

    const existingId = this.#requestIds.get(normalizedRequestId);
    if (existingId) {
      const existing = this.#cases.get(existingId);
      if (existing && existing.text !== normalizedText) {
        throw queueError('request_conflict', 'requestId was reused for different text');
      }
      return clone(existing);
    }

    const openCount = [...this.#cases.values()].filter(
      (record) => record.childId === normalizedChildId && OPEN_STATUSES.has(record.status),
    ).length;
    if (openCount >= this.#maxOpenPerChild) {
      throw queueError('queue_limit', 'this child already has too many open questions');
    }

    const createdAt = this.#now();
    const record = {
      caseId: this.#randomId(),
      childId: normalizedChildId,
      plotId: normalizedPlotId,
      requestId: normalizedRequestId,
      text: normalizedText,
      prediction: normalizedPrediction,
      status: 'waiting',
      answer: null,
      observations: [],
      leaseId: null,
      leaseUntil: null,
      claimedBy: null,
      createdAt,
      updatedAt: createdAt,
      revision: 1,
    };

    this.#cases.set(record.caseId, record);
    this.#requestIds.set(normalizedRequestId, record.caseId);
    return clone(record);
  }

  claim(agentId, { limit = this.#maxBatchSize, now = this.#now() } = {}) {
    const normalizedAgentId = requiredString(agentId, 'agentId', 128);
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw queueError('invalid_input', 'limit must be a positive integer');
    }

    this.releaseExpired(now);

    const byChild = new Map();
    const busyChildren = new Set(
      [...this.#cases.values()]
        .filter((record) => record.status === 'processing')
        .map((record) => record.childId),
    );
    for (const record of this.#cases.values()) {
      if (record.status !== 'waiting' || busyChildren.has(record.childId)) continue;
      const records = byChild.get(record.childId) ?? [];
      records.push(record);
      byChild.set(record.childId, records);
    }

    const childIds = [...byChild.keys()].sort((left, right) => {
      const servedDifference =
        (this.#lastServedAt.get(left) ?? 0) - (this.#lastServedAt.get(right) ?? 0);
      return servedDifference || left.localeCompare(right);
    });

    const selected = [];
    const claimLimit = Math.min(limit, this.#maxBatchSize);
    for (const childId of childIds) {
      const records = byChild.get(childId);
      records.sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.caseId.localeCompare(right.caseId),
      );
      const record = records[0];
      const leaseId = this.#randomId();
      record.status = 'processing';
      record.leaseId = leaseId;
      record.leaseUntil = now + this.#leaseMs;
      record.claimedBy = normalizedAgentId;
      record.updatedAt = now;
      record.revision += 1;
      this.#lastServedAt.set(childId, now);
      selected.push(clone(record));
      if (selected.length >= claimLimit) break;
    }

    return selected;
  }

  complete(caseId, { leaseId, outcome = 'answered', answer = null, now = this.#now() }) {
    const record = this.#cases.get(caseId);
    if (!record) throw queueError('case_not_found', 'case does not exist');
    if (!COMPLETION_OUTCOMES.has(outcome)) {
      throw queueError('invalid_outcome', 'unsupported completion outcome');
    }
    if (record.status !== 'processing') {
      throw queueError('case_not_processing', 'case is not processing');
    }
    if (record.leaseId !== leaseId) {
      throw queueError('stale_lease', 'lease does not match the current case owner');
    }
    if (outcome === 'answered' && answer === null) {
      throw queueError('invalid_answer', 'answered outcome requires an answer');
    }

    record.status = outcome;
    record.answer = answer;
    record.leaseId = null;
    record.leaseUntil = null;
    record.claimedBy = null;
    record.updatedAt = now;
    record.revision += 1;
    return clone(record);
  }

  replyFromChild(caseId, { childId, text, now = this.#now() }) {
    const record = this.#cases.get(caseId);
    if (!record) throw queueError('case_not_found', 'case does not exist');
    if (record.childId !== childId) throw queueError('not_owner', 'case belongs to another child');
    if (record.status !== 'needs_child') {
      throw queueError('case_not_waiting_for_child', 'case is not waiting for the child');
    }
    const normalized = requiredString(text, 'text', 2_000);
    record.observations.push({ type: 'child_reply', text: normalized, at: now });
    record.status = 'waiting';
    record.answer = null;
    record.updatedAt = now;
    record.revision += 1;
    return clone(record);
  }

  addObservation(caseId, { childId, text, now = this.#now() }) {
    const record = this.#cases.get(caseId);
    if (!record) throw queueError('case_not_found', 'case does not exist');
    if (record.childId !== childId) throw queueError('not_owner', 'case belongs to another child');
    const normalized = requiredString(text, 'text', 2_000);
    record.observations.push({ type: 'child_observation', text: normalized, at: now });
    record.updatedAt = now;
    record.revision += 1;
    return clone(record);
  }

  releaseExpired(now = this.#now()) {
    const released = [];
    for (const record of this.#cases.values()) {
      if (record.status !== 'processing' || record.leaseUntil > now) continue;
      record.status = 'waiting';
      record.leaseId = null;
      record.leaseUntil = null;
      record.claimedBy = null;
      record.updatedAt = now;
      record.revision += 1;
      released.push(clone(record));
    }
    return released;
  }

  get(caseId) {
    const record = this.#cases.get(caseId);
    return record ? clone(record) : null;
  }

  listForChild(childId) {
    return [...this.#cases.values()]
      .filter((record) => record.childId === childId)
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.caseId.localeCompare(right.caseId),
      )
      .map(clone);
  }

  snapshot() {
    return [...this.#cases.values()]
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.caseId.localeCompare(right.caseId),
      )
      .map(clone);
  }
}
