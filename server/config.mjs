const truthy = (value) => value === 'true' || value === '1';

function positiveInteger(value, fallback, maximum) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

export function loadConfig(env = process.env, { production = env.NODE_ENV === 'production' } = {}) {
  let previousSecrets = {};
  if (env.LOOM_COOKIE_PREVIOUS_SECRETS_JSON) {
    try {
      const parsed = JSON.parse(env.LOOM_COOKIE_PREVIOUS_SECRETS_JSON);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) previousSecrets = parsed;
    } catch {
      previousSecrets = {};
    }
  }
  return {
    origin: env.LOOM_ORIGIN || (production ? '' : 'http://localhost:5173'),
    secret: env.LOOM_COOKIE_SECRET || '',
    previousSecrets,
    cookieKeyId: env.LOOM_COOKIE_KEY_ID || 'k1',
    cookieTtlSeconds: positiveInteger(
      env.LOOM_COOKIE_TTL_SECONDS,
      60 * 60 * 24 * 30,
      60 * 60 * 24 * 365,
    ),
    publicBaseUrl:
      env.LOOM_PUBLIC_BASE_URL || env.LOOM_ORIGIN || (production ? '' : 'http://localhost:5173'),
    production,
    agentEnabled: truthy(env.LOOM_AGENT_ENABLED),
    providerBaseUrl: env.LOOM_PROVIDER_BASE_URL || '',
    providerApiKey: env.LOOM_PROVIDER_API_KEY || '',
    providerModel: env.LOOM_PROVIDER_MODEL || '',
    providerStructuredMode:
      env.LOOM_PROVIDER_STRUCTURED_MODE === 'json_schema' ? 'json_schema' : 'json_object',
    providerTimeoutMs: positiveInteger(env.LOOM_PROVIDER_TIMEOUT_MS, 30_000, 120_000),
    providerMaxInputBytes: positiveInteger(
      env.LOOM_PROVIDER_MAX_INPUT_BYTES,
      128 * 1024,
      256 * 1024,
    ),
    providerBudgetConfirmed: truthy(env.LOOM_AGENT_PROVIDER_BUDGET_CONFIRMED),
    blobStoreName: env.LOOM_BLOB_STORE || 'loom-space-private',
    maxJsonBytes: positiveInteger(env.LOOM_MAX_JSON_BYTES, 384 * 1024, 1024 * 1024),
    maxPromptBytes: positiveInteger(env.LOOM_MAX_PROMPT_BYTES, 8 * 1024, 32 * 1024),
    softWriteLimitPerMinute: positiveInteger(env.LOOM_SOFT_WRITE_LIMIT_PER_MINUTE, 60, 1000),
    softMaxSpacesPerVisitor: positiveInteger(env.LOOM_SOFT_MAX_SPACES_PER_VISITOR, 100, 10_000),
    softMaxRevisionsPerVisitor: positiveInteger(
      env.LOOM_SOFT_MAX_REVISIONS_PER_VISITOR,
      500,
      100_000,
    ),
    edgeRateLimitConfirmed: truthy(env.LOOM_EDGE_RATE_LIMIT_CONFIRMED),
  };
}
