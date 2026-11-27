import { randomUUID } from 'node:crypto';
import { FarmQueue } from './queue.js';
import { FarmSafetyPolicy } from './policy.js';

// Agent output is a selection, never instructions for the child or commands for a robot.
const cards = new Map([
  ['draw-robot', '在纸上画出你希望机器人拥有的一个部件。'],
  ['trace-route', '用手指在纸上比划一次想象中机器人的路线。'],
  ['name-signal', '说出一个你希望机器人能识别的信号。'],
  ['observe-tail-clearance', '大人确认断电、尾巴停稳后，用眼睛看看尾巴和外壳之间有没有空隙。'],
  [
    'compare-shaft-position',
    '大人确认断电、转轴停稳后，对照搭建图看看尾巴有没有对准转轴，不用手去碰。',
  ],
]);
const adultMessage = '先停下来，不要操作机器人，请找身边可信任的大人帮忙。';
const robotHazard =
  /短路|焊接|烙铁|裸线|市电|锂电池|拆开电池|插座|刀片|上电|通电|加电|接通电源|启动电机|启动马达|开启动力|发热|发烫|烫手|冒烟|焦味|糊味|火花|卡住|夹住|失控|solder|short[ -]?circuit|overheat|smok(?:e|ing)|spark|power on/i;

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function belongs(record, binding) {
  return record.childId === binding.childId && record.projectId === binding.projectId;
}

function privateCase({ caseId, text, status, answer }) {
  return { caseId, question: text, status, answer };
}

/** In-memory core. Host supplies a stable, authenticated session handle (not a client field),
 * a binding resolver, and a fresh Agent context per runOne. The Host audio adapter must
 * validate recording type, size, duration and consent before passing it to transcribe. */
export class PersonalGuide {
  #queue;
  #policy;
  #resolveBinding;
  #transcribe;
  #waker;
  #now;
  #draftTtlMs;
  #drafts = new Map(); // One pending confirmation per authenticated session.

  constructor({
    resolveBinding,
    transcribe,
    now = Date.now,
    policy = new FarmSafetyPolicy(),
    waker = { request() {} },
    draftTtlMs = 120_000,
  }) {
    if (
      typeof resolveBinding !== 'function' ||
      typeof transcribe !== 'function' ||
      typeof now !== 'function' ||
      typeof waker?.request !== 'function' ||
      typeof policy?.screenQuestion !== 'function' ||
      !Number.isSafeInteger(draftTtlMs) ||
      draftTtlMs <= 0
    ) {
      throw new TypeError('invalid personal guide dependencies');
    }
    this.#resolveBinding = resolveBinding;
    this.#transcribe = transcribe;
    this.#queue = new FarmQueue({ now }); // Never claim from the farm gateway's queue.
    this.#policy = policy;
    this.#waker = waker;
    this.#now = now;
    this.#draftTtlMs = draftTtlMs;
  }

  async #binding(session) {
    if (session == null) fail('unbound_session');
    const { childId, projectId } = (await this.#resolveBinding(session)) ?? {};
    for (const id of [childId, projectId]) {
      if (typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > 128)
        fail('unbound_session');
    }
    return { childId, projectId };
  }

  async record(session, { audio }) {
    const binding = await this.#binding(session);
    const result = await this.#transcribe({ audio });
    const text = typeof result === 'string' ? result : result?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 2_000) fail('invalid_transcript');
    if (!belongs(binding, await this.#binding(session))) fail('binding_changed');
    const now = this.#now();
    for (const [key, draft] of this.#drafts) if (draft.expiresAt <= now) this.#drafts.delete(key);
    const preview = {
      draftId: randomUUID(),
      transcript: text.trim(),
      expiresAt: now + this.#draftTtlMs,
    };
    this.#drafts.set(session, { ...binding, ...preview });
    return preview;
  }

  async confirm(session, { draftId, confirmedTranscript }) {
    const binding = await this.#binding(session);
    const draft = this.#drafts.get(session);
    if (!draft || draft.draftId !== draftId) fail('invalid_draft');
    if (!belongs(draft, binding) || draft.expiresAt <= this.#now()) {
      this.#drafts.delete(session);
      fail('invalid_draft');
    }
    if (confirmedTranscript !== draft.transcript) fail('transcript_mismatch');
    if (
      this.#policy.screenQuestion(draft.transcript)?.kind !== 'allow' ||
      robotHazard.test(draft.transcript)
    ) {
      this.#drafts.delete(session);
      return { status: 'ask_adult', message: adultMessage };
    }
    const record = this.#queue.enqueue({ ...binding, requestId: draftId, text: draft.transcript });
    this.#drafts.delete(session);
    this.#waker.request();
    return privateCase(record);
  }

  #cases(binding) {
    return this.#queue.listForChild(binding.childId).filter((record) => belongs(record, binding));
  }

  async privateView(session) {
    const binding = await this.#binding(session);
    return { ...binding, cases: this.#cases(binding).map(privateCase) };
  }

  /** Host-only worker entry. chooseCard receives no session, lease, queue, audio or sibling history. */
  async runOne(agentId, chooseCard) {
    if (typeof chooseCard !== 'function') throw new TypeError('chooseCard must be a function');
    const [record] = this.#queue.claim(agentId, { limit: 1 });
    if (!record) return null;
    let outcome = 'safe_fallback';
    let answer = { message: adultMessage };
    try {
      if (!record.projectId) fail('unbound_case');
      const history = this.#cases(record)
        .filter((item) => item.status === 'answered')
        .slice(-10)
        .map(privateCase);
      const selection = await chooseCard({
        childId: record.childId,
        projectId: record.projectId,
        question: record.text,
        history,
        catalog: [...cards].map(([activityId, step]) => ({ activityId, step })),
      });
      if (
        selection &&
        Object.keys(selection).length === 1 &&
        Object.hasOwn(selection, 'activityId')
      ) {
        const activityId = selection.activityId;
        if (cards.has(activityId)) {
          outcome = 'answered';
          answer = { activityId, step: cards.get(activityId) };
        }
      }
    } catch {
      // Never forward raw model/adapter output, including exception messages.
    }
    this.#queue.releaseExpired();
    return privateCase(
      this.#queue.complete(record.caseId, { leaseId: record.leaseId, outcome, answer }),
    );
  }
}
