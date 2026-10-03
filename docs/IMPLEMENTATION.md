# NABAT V1 implementation plan

1. Establish one botanical design specification, standalone image assets and vector identity.
2. Build a shared PostgreSQL schema with persistent embedded Postgres for frictionless local development, explicit migrations, deterministic demo fixtures and production safeguards.
3. Implement session identity, tenant-scoped service authorization, care/history, location hierarchy, tags, assignments, transfer acceptance, entitlements and audit events.
4. Implement private media, image validation/derivatives, immutable versioned vision records, durable job claiming/retry, longitudinal health snapshots and warning lifecycle.
5. Ship marketing, auth/onboarding, responsive workspace console, fleet, NFC passport/profile, care, observation, tags, locations, team, analytics and settings.
6. Verify strict types, lint, unit/integration and browser E2E, persistence, public privacy, cross-tenant denial, responsive/RTL/reduced-motion and production build.
7. Deploy to the authorized Vercel project, verify real Neon/private Blob/production flows, and provide evidence and physical-tag instructions. Complete the user-selected subscription connection through actual OAuth and model/analysis checks. Physical NFC and subscribed inference are never implied by a build.

## Chosen architecture

Next.js App Router/React + strict TypeScript; parameterized SQL against one PostgreSQL schema. Local: PGlite filesystem adapter. Production: node-postgres pool, explicit migration job. Domain services are independent of React and providers. No database session travels to the browser. Secure random sessions stored as SHA-256 hashes, scrypt password hashes, origin checks, durable database rate limits, tenant-scoped queries and composite foreign keys. Local private media has expiring HMAC access; private S3 is the production storage adapter. Analysis runs in a durable worker, with development fixture provider and optional OpenAI structured-output provider. Health engine and alert rules are versioned, explainable and source-linked.

## Intentional boundaries

The development provider demonstrates state changes; it does not inspect or diagnose photographs. Original images and metadata stay private. Public passports expose only opted-in identity/species and no employee, location, photo, care or health history. Physical NFC writing uses an external NDEF writer; the web app provisions and verifies the URL. Offline PWA caches only a static offline page; care queue is an extension interface, not a promised offline save.
