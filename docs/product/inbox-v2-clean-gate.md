# Inbox V2 CLEAN-GATE Receipt

Status: `done`

Task: `INB2-CLEAN-GATE`

Completed: `2026-07-22`

Disposition revision: `clean-slate-2026-07-20-r1`

Schema epoch: `preproduction-inbox-v2-1`

## Outcome

The clean-slate boundary is complete. Hulee has one checked-in database
baseline, one V2-only Inbox implementation and one production data-plane
composition. The known disposable pre-production PostgreSQL and object-storage
state was recreated from zero. Inbox V1 relations/types, provider/source state,
provider credentials and user files are absent.

The temporary deployment freeze is removed. This does not activate a provider:
production still contains no provider-egress worker or VPN service, the only
worker feature is `core`, and its egress profile remains
`disabled`/`unavailable` with probes disabled.

## Verified implementation boundary

- `packages/db/drizzle/0000_inbox_v2_baseline.sql` is the only SQL migration and
  its journal entry is the only supported schema epoch.
- API, Web prestart and worker assert the exact migration contract before
  listening or scheduling work. API health and OCI labels publish the exact
  schema epoch and build revision.
- The allowlisted V1 ownership scan in
  `docs/product/inbox-v2-clean-gate-v1-allowlist.md` remains verified. Retained
  `/v1` strings are public or generic internal contract versions, not Inbox V1
  runtime fallback.
- Production Compose has no provider worker/VPN, pins the worker to `core`, and
  does not pass the application secret environment file to the marketing site
  or infrastructure containers.
- Ordinary deployment rejects legacy provider enablement, stale provider
  containers, an unexpected Hulee container, a non-core worker setting and raw
  one-time bootstrap credentials.
- Deployment is admitted only from a successful completed full `Check` workflow
  for a same-repository push to `main`, and builds the exact checked `head_sha`.
  A pre-secret current-main fence rejects an out-of-order superseded revision.
  Per-branch Check concurrency cancels superseded runs before handoff.

## Local and CI evidence

- Focused clean-slate checker: `26/26` tests passed before the operational
  reset; the final permanent boundary suite passed `39/39`.
- Final pre-reset local `pnpm check`: `349` passed files and `4,028` passed
  tests (`33` files / `381` tests skipped by declared gates), plus formatting,
  ESLint, TypeScript, DB parity, i18n, encoding, branding, native and clean-slate
  checks.
- Final post-gate `pnpm check`: `349` passed files and `4,041` passed tests
  (`33` files / `381` tests skipped), including `39/39` permanent deployment
  boundary tests and every auxiliary repository gate.
- GitHub Actions run
  [29892657588](https://github.com/pigrov/hulee.chat/actions/runs/29892657588)
  passed the full check, production runtime/stale-epoch smoke, disposable
  install/reset lifecycle and PostgreSQL repository/integrity jobs for commit
  `00daa98f18797acdf6335040cf9a24b2864b57fc`.
- One-time deployment run
  [29893092728](https://github.com/pigrov/hulee.chat/actions/runs/29893092728)
  built that exact image, ran the baseline migration, ran the foundation seed
  once, started API/Web/worker/site and passed exact API and worker epoch smoke.

## Remote preflight and replacement receipt

No secret value or customer payload was printed during collection or reset.
Immediately before replacement:

- live application/provider listeners: `0`;
- database application connections and prepared transactions: `0 / 0`;
- pending/processing generic outbox, active connectors, active sessions,
  session leases, active auth challenges and V2 outbox work: all `0`;
- user object files: `0`;
- old database: `43` journal rows, `274` public tables, `214` V2 tables,
  `5` forbidden Inbox V1 relations and `3` forbidden Inbox V1 enums.

At `2026-07-22T05:11:21Z` the operator action:

1. atomically rebuilt `.env` from a 37-key allowlist;
2. rotated PostgreSQL/DATABASE_URL, encryption, internal API, MinIO, foundation
   API-key and platform-admin credentials and omitted old provider/VPN/Telegram
   and email-delivery credentials;
3. removed `8` exact containers carrying the old environment;
4. removed only the verified Compose volumes
   `hulee-chat_postgres-data` and `hulee-chat_minio-data`;
5. removed `10` exact `.env.bak*` files and the exact historical SQL gzip;
6. retained the new bootstrap credentials only in
   `/srv/hulee-chat/operator-secrets/clean-slate-foundation.env`, owned by
   `deploy:deploy` with mode `600`;
7. removed the raw platform-admin password and seed API key from runtime `.env`
   after the successful seed and recreated every service.

The generic `db:inbox-v2:reset` contract was not weakened or relabelled for the
shared target. The approved ADR 0016 operator volume replacement was used.

## Remote after-state

The exact deployed image was
`ghcr.io/pigrov/hulee.chat:00daa98f18797acdf6335040cf9a24b2864b57fc`.
API, Web, worker and site were healthy and carried matching revision and epoch
labels. API health returned migration count `1`; Web returned the expected
authenticated-shell redirect; worker logs proved schema verification followed
by `worker.started` with `core`, `disabled`, `unavailable` and probes `false`.

Database and storage evidence:

- migration journal: `1`, hash
  `e59f826785aa07d454ed125973f5afda9fb684e0f48a6bddfcd84f8b644b0064`,
  created-at `1784656735719`;
- public/V2 tables: `312 / 257`;
- forbidden V1 relations/types: `0 / 0`;
- tenants/employees/accounts/platform admins: `1 / 1 / 1 / 1`;
- configured `tenant_local_1` / `employee_local_1` identity: present;
- connectors/sessions/session events/challenges/provider validations:
  `0 / 0 / 0 / 0 / 0`;
- source connections/accounts/secret refs and tenant secrets: all `0`;
- legacy and V2 file/object rows and bucket user objects: all `0`;
- generic outbox: `2` foundation events; V2 outbox intents/work/outcomes: all
  `0`;
- legacy backup files and forbidden provider environment keys: `0 / 0`;
- marketing-site secret environment keys and runtime bootstrap secrets: `0`.

The bounded observation at `2026-07-22T05:22:41Z` repeated journal, V1,
provider, source, secret, file/object and worker checks with the same results.
No V1 or provider process reconnected. Eight stale Hulee images were removed,
leaving only the exact deployed revision before the final gate commit.

## Deployment decision

The temporary `INB2-CLEAN-001` deployment freeze may be and is removed. A
successful full `Check` for a push to `main` hands its exact checked SHA to the
V2-only workflow; direct-push and manual bypasses are absent. The one-time
unlock variable, confirmation token and bootstrap input are retired. Provider
activation remains a separate reviewed adapter task and cannot be inferred from
this gate.
