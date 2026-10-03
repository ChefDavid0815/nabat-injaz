# Gateway routing and accounting

This adapter is currently inactive. The user selected a Business Workspace Agent with GPT-6 Luna. If explicitly activated later, its default model is `openai/gpt-4.1-mini` through Vercel AI Gateway. Authentication uses Vercel's runtime OIDC. Free means use of the team's limited Gateway credit allowance, not zero-priced or unlimited inference. The live catalog had no zero-priced model meeting both image-input and structured-output requirements on 2026-10-03.

| Analysis tier | Reserved model | Pilot calls per UTC day |
| ------------- | -------------- | ----------------------- |
| Free          | GPT-4.1 Mini   | 5                       |
| Plus          | GPT-6 Luna     | 30                      |
| Pro           | GPT-6.1 Sol    | 100                     |
| Enterprise    | GPT-6 Astra    | 500                     |

All four IDs were verified in Gateway's live catalog with vision and structured-output support. GPT-6 Sol has the same published standard token prices as GPT-6.1 Sol, so the Pro slot uses GPT-6.1 Sol. The catalog did not contain GPT-6.6 Astra. Paid access has not been activated or charged, and no customer checkout is connected. The current free allowance permits GPT-4.1 Mini; higher-tier access requires appropriate Gateway credit/model permissions before activation.

`organisations.ai_tier` defaults to `free`, including business workspaces. Existing `plan` is the V1 fleet entitlement and does not grant an expensive model. Registration, workspace creation and workspace settings cannot set `ai_tier`. A future trusted billing webhook/admin service can assign the tier after confirmed payment; customer-selected model strings are never accepted. Server environment variables `GATEWAY_MODEL_FREE/PLUS/PRO/ENTERPRISE` map tiers to the verified allowlist in `src/domain/analysis/routing.ts`.

Before a call, a durable `ai_generations` UUID is created against its job and original workspace. An advisory transaction lock serializes application-wide budget reservations. The default monthly application budget is $5, controlled by `AI_MONTHLY_BUDGET_USD`. The reservation uses a conservative input-token estimate and the output-token cap; this is an application guard, not a provider-enforced dollar guarantee. Configure Vercel's own credit/budget controls for a provider-enforced cap. No code purchases credits or enables auto top-up.

Every returned call records input/output/cache/reasoning tokens, provider generation ID, duration and cost. Cost comes from the Gateway generation lookup when available; otherwise it is explicitly a catalog estimate using the 2026-10-03 standard prices. The lookup has a 5-second timeout and never invokes another model. Uncertain failures retain their reserved amount rather than pretending that the upstream call was free. Pricing snapshots must be reviewed when changing models or service tiers.

Gateway logs are tagged by NABAT, plant vision, tier and opaque workspace UUID. Photos and notes remain outside application logs. OpenAI response storage is disabled in the provider request; Gateway's own retention is governed by its account controls. Strictly validated features are saved with provider/model provenance, and NABAT computes health snapshots and alerts. The plant profile is the authenticated URL for analysis history.

Authentication, credit and unsupported-model errors are terminal for that attempt and stop batch processing. Users can explicitly retry after allowance/access is resolved. An exhausted allowance preserves the uploaded photograph and its job failure; it never switches silently to another model, a paid provider or a subscription.

References: [Gateway pricing and monthly credit allowance](https://vercel.com/docs/ai-gateway/pricing), [live model catalog](https://ai-gateway.vercel.sh/v1/models), [generation lookup](https://vercel.com/docs/ai-gateway/observability/generation-lookup).
