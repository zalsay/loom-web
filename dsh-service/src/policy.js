const EMERGENCY_PATTERN =
  /(受伤|流血|呼吸困难|头晕|晕倒|中毒|触电|着火|火灾|溺水|很疼|不舒服|危险|help|hurt|bleed|dizzy|fire|electric)/i;
const FORBIDDEN_PATTERN =
  /(农药|除草剂|杀虫剂|打药|喷药|化肥|点火|明火|燃烧|插电|接电|拆电池|带电|爬高|屋顶|拿刀|用剪刀|混合药剂|喝下|直接吃|未知植物|pesticide|herbicide|insecticide|fertilizer|ignite|open flame|mains power|battery|climb|roof|knife|eat unknown)/i;

const DEFAULT_ACTIVITIES = Object.freeze([
  {
    id: 'observe-leaf-color',
    title: '观察叶片颜色和形态',
    mode: 'observe',
    requiresTools: false,
  },
  {
    id: 'observe-soil-surface',
    title: '观察土壤表面干湿和裂缝',
    mode: 'observe',
    requiresTools: false,
  },
  {
    id: 'measure-water-volume',
    title: '用量杯测量水的体积',
    mode: 'measure',
    requiresTools: true,
  },
  {
    id: 'compare-shade',
    title: '比较遮阴和日照位置',
    mode: 'observe',
    requiresTools: false,
  },
  {
    id: 'record-plant-growth',
    title: '记录植物高度和叶片数量',
    mode: 'measure',
    requiresTools: true,
  },
  {
    id: 'count-garden-visitors',
    title: '观察并记录来访昆虫数量',
    mode: 'observe',
    requiresTools: false,
  },
]);

function policyEvent(kind, message, extra = {}) {
  return { kind, message, ...extra };
}

export class FarmSafetyPolicy {
  #activities;

  constructor({ activities = DEFAULT_ACTIVITIES } = {}) {
    this.#activities = new Map(
      activities.map((activity) => [activity.id, Object.freeze({ ...activity })]),
    );
  }

  screenQuestion(text) {
    const normalized = String(text ?? '').trim();
    if (!normalized) {
      return policyEvent('blocked', '没有听清问题，请重新说一遍。');
    }

    if (EMERGENCY_PATTERN.test(normalized)) {
      return policyEvent(
        'emergency',
        '先停下来，远离危险，马上大声叫附近的现场负责人或急救人员。不要碰设备，也不要继续试验。',
        { notifyOnSite: true },
      );
    }

    if (FORBIDDEN_PATTERN.test(normalized)) {
      return policyEvent(
        'blocked',
        '这个问题不能直接动手尝试。今天可以改成先观察植物或土壤，把看到的变化记下来。',
        { notifyOnSite: false },
      );
    }

    return policyEvent('allow', normalized);
  }

  validateProposal({ activityId, childFacingText, observation, stopCondition } = {}) {
    const activity = this.#activities.get(activityId);
    if (!activity) {
      return { ok: false, code: 'activity_not_allowed', message: '活动不在允许目录中。' };
    }
    if (typeof childFacingText !== 'string' || !childFacingText.trim()) {
      return { ok: false, code: 'missing_child_text', message: '缺少给孩子看的回答。' };
    }
    if (childFacingText.length > 800) {
      return { ok: false, code: 'child_text_too_long', message: '给孩子看的回答太长。' };
    }
    if (typeof stopCondition !== 'string' || !stopCondition.trim()) {
      return { ok: false, code: 'missing_stop_condition', message: '缺少停止条件。' };
    }
    if (typeof observation !== 'string' || !observation.trim()) {
      return { ok: false, code: 'missing_observation', message: '缺少需要观察的内容。' };
    }

    const outputScreen = this.screenQuestion(childFacingText);
    if (outputScreen.kind !== 'allow') {
      return {
        ok: false,
        code: outputScreen.kind === 'emergency' ? 'emergency_content' : 'unsafe_content',
        message: outputScreen.message,
      };
    }

    return { ok: true, activity: { ...activity } };
  }

  catalog() {
    return [...this.#activities.values()].map((activity) => ({ ...activity }));
  }
}

export { DEFAULT_ACTIVITIES };
