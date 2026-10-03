export const AI_TIERS = ['free', 'plus', 'pro', 'enterprise'] as const;
export type AiTier = (typeof AI_TIERS)[number];
export const aiModels = {
  'openai/gpt-4.1-mini': {
    label: 'GPT-4.1 Mini',
    input: 0.0000004,
    output: 0.0000016,
    cache: 0.0000001,
  },
  'openai/gpt-6-luna': {
    label: 'GPT-6 Luna',
    input: 0.0000001,
    output: 0.0000005,
    cache: 0.00000001,
  },
  'openai/gpt-6.1-sol': {
    label: 'GPT-6.1 Sol',
    input: 0.000002,
    output: 0.00001,
    cache: 0.0000001,
  },
  'openai/gpt-6-astra': { label: 'GPT-6 Astra', input: 0.00001, output: 0.00005, cache: 0.000001 },
} as const;
export type GatewayModel = keyof typeof aiModels;
// Vision/structured output support and standard prices verified against Gateway on 2026-10-03.
const defaults: Record<AiTier, GatewayModel> = {
  free: 'openai/gpt-4.1-mini',
  plus: 'openai/gpt-6-luna',
  pro: 'openai/gpt-6.1-sol',
  enterprise: 'openai/gpt-6-astra',
};
const limits: Record<AiTier, number> = { free: 5, plus: 30, pro: 100, enterprise: 500 };
export function aiTier(value: unknown): AiTier {
  if (value == null) return 'free';
  if (!AI_TIERS.includes(value as AiTier)) throw Error('Unknown AI entitlement.');
  return value as AiTier;
}
export function gatewayRoute(value: unknown) {
  const tier = aiTier(value);
  const model = process.env[`GATEWAY_MODEL_${tier.toUpperCase()}`] || defaults[tier];
  if (!Object.hasOwn(aiModels, model)) throw Error('Configure a verified Gateway vision model.');
  return {
    tier,
    model: model as GatewayModel,
    dailyLimit: limits[tier],
    ...aiModels[model as GatewayModel],
  };
}
export function tokenCost(model: GatewayModel, input: number, output: number, cached = 0) {
  const prices = aiModels[model];
  const read = Math.min(Math.max(0, cached), input);
  return (input - read) * prices.input + read * prices.cache + output * prices.output;
}
