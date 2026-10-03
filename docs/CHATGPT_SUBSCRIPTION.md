# ChatGPT subscription analysis

The user's required billing path is their own Business Premium subscription, with model `gpt-6.1-sol`. No AI API key, Gateway credit purchase, fallback model or alternative billing path is used by this mode.

## Runtime and eligibility

The public site remains on Vercel with Neon and private Blob. Vercel stores observations and durable jobs; `AI_PROVIDER=chatgpt-subscription` and `ANALYSIS_RUNTIME=external` prevent web requests and cron from invoking Gateway or an API-key provider. The local worker fetches private photos, calls the public Responses endpoint with a separately authorized ChatGPT plan OAuth token, and saves immutable analysis/health records back to PostgreSQL.

OpenAI currently documents this preview for open-source/local applications and self-hosted runtimes. A commercial or remotely hosted integration needs its separate approval process. This local adapter is an experiment; implementation does not establish account, workspace-policy or commercial eligibility. Check the real OAuth result, granted scope and account model catalog before running inference. Do not reuse Codex credentials or ChatGPT backend endpoints.

## Connect

```powershell
cd E:\INJAZ
npm run chatgpt:connect
```

The command serves a local connection page at `http://127.0.0.1:14557/` (override with `NABAT_CHATGPT_CALLBACK_PORT`). **Continue with ChatGPT** generates fresh state, nonce and S256 PKCE for a ten-minute attempt, and writes the temporary authorization URL to ignored `data/chatgpt/authorization-url.txt`. Complete authorization personally. Choose the Business Premium workspace, allow plan usage for **NABAT Local Analysis**, set an app usage limit appropriate to the pilot, and disable any permission to consume extra paid credits. The callback requires the issued dynamic client ID, verifies the ID-token signature/issuer/audience/expiry/nonce and checks `chatgpt.tokens.use.direct` before storing credentials. A loopback URL must open on the computer running the listener.

The user must confirm the real selected workspace and granted plan permissions. An app cannot infer subscription tier or administrative eligibility from a claimed account label. GPT-6.1 Sol must appear in the account-specific model catalog; unavailable models are never substituted.

Use `npm run chatgpt:connect -- --new-account` for a distinct account/workspace registration. Existing registrations are preserved separately. Routine reconnect uses the saved issued client ID and stable host ID. Each authorization expires after ten minutes; return to the local connection page and click Continue with ChatGPT for a fresh attempt.

## Run a scoped worker

Production DB/Blob credentials are pulled to ignored `.env.vercel.production`, separate from local development. The worker loads only the DB/storage keys and local signing configuration from ignored `data/deploy-secrets.json`. It never copies ChatGPT credentials into Vercel.

```powershell
npm run worker:subscription -- --workspace YOUR_NABAT_WORKSPACE_UUID
# A single batch for a controlled check:
npm run worker:subscription -- --workspace YOUR_NABAT_WORKSPACE_UUID --once
```

The selected NABAT workspace UUID is visible in its owner's Settings. It is distinct from the ChatGPT Business workspace. The SQL claim and stale-lease updates are scoped to that NABAT workspace, so unrelated public signups cannot consume this subscriber's quota. The computer and worker must remain running; when offline, uploads remain queued rather than inventing analysis results.

## Credentials, requests and recovery

- Windows credential files use DPAPI CurrentUser encryption. Unix storage uses owner-only files/directories. Tokens never enter browser storage, source control, URLs, public logs or deployment files. The PKCE verifier remains local.
- The local worker validates the account model catalog, uses `store:false`, `stream:true`, low reasoning effort, image input and strict structured output. Preview-unsupported fields including `max_output_tokens`, `background`, `metadata`, `temperature` and `user` are omitted. A 90-second deadline and two-megabyte stream limit bound each call; success requires `response.completed` plus schema validation.
- Refreshes use the issued client ID and rotating refresh token under an exclusive local lock. Run only one worker for a renewable session. Credentials are atomically replaced after validation.
- Permission, eligibility, policy or usage-limit failures stop the worker and fail the affected job. No billing fallback runs. Network/truncated-stream failures use the existing bounded job retry policy. Check ChatGPT Settings → Usage, correct policy/limits, reconnect if necessary, then explicitly retry the failed observation.
- To disconnect, stop the local worker and revoke **NABAT Local Analysis** in ChatGPT Settings. A revoked or unusable session stops further inference. Do not erase a working session merely because a transient provider request failed.

References: [plan usage scope](https://developers.openai.com/siwc/token-sharing-open-source), [registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [accounts and refresh](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).
