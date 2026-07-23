# Inbox V2 Production-Target Reset Receipt — 2026-07-23

Status: `done`

Reset completed: `2026-07-23T05:17:21Z`

Bounded observation: `2026-07-23T05:27:45Z`

Disposition revision: `clean-slate-2026-07-20-r1`

Schema epoch: `preproduction-inbox-v2-1`

## Authority and scope

On `2026-07-23` the product owner explicitly confirmed that all data on the
known `https://chat.hulee.ru/` target was disposable pre-production test state
and authorized its destructive replacement.

The authorization applied only to this reset, `/srv/hulee-chat`, Compose
project `hulee-chat` and these two exact volumes:

- `hulee-chat_postgres-data`;
- `hulee-chat_minio-data`.

It did not create a reusable destructive shared-SaaS reset path. The guarded
`db:inbox-v2:reset` contract remains unchanged and continues to reject the
shared target. No V1 or previous V2 test data was migrated.

No secret value or customer payload was printed or committed.

## Incident and deployment-safety repair

Full Check
[29950422944](https://github.com/pigrov/hulee.chat/actions/runs/29950422944)
passed for commit
`449de4df7637267023c0293329d7b951bc362c31`, but Deploy
[29950825054](https://github.com/pigrov/hulee.chat/actions/runs/29950825054)
failed with `inbox_v2.migration_journal_not_prefix`.

The old deployment order had already removed API, Web and worker before that
check, leaving nginx without its `hulee_chat_web:3000` upstream and causing
`502 Bad Gateway`.

The last compatible image
`8a847095ea63f79723395d1d3bf64e11bd49b944` was temporarily restored before
the destructive action. API, Web and worker were healthy and
`https://chat.hulee.ru/` again reached `/login`.

Commit `3181d7f533d6001dcdba3d708086dfcab5ca49c7` added a read-only exact-journal
preflight before runtime drain. Full Check
[29980817828](https://github.com/pigrov/hulee.chat/actions/runs/29980817828)
passed. Deploy
[29981097273](https://github.com/pigrov/hulee.chat/actions/runs/29981097273)
attempt 1 then rejected the incompatible journal while the restored API, Web
and worker remained healthy. This live failure proved that the original 502
failure mode was closed before the reset.

After replacement, attempt 2 of the same exact Deploy run completed
successfully, including API and worker epoch smoke.

## Immediate pre-reset state

The destructive action started after a fresh preflight at
`2026-07-23T05:11:46Z`.

- runtime image: restored compatible revision `8a847095...`, all three
  data-plane containers healthy;
- target image: `3181d7f...`, present locally with matching revision and
  `preproduction-inbox-v2-1` labels;
- migration journal: `1` row, hash
  `e59f826785aa07d454ed125973f5afda9fb684e0f48a6bddfcd84f8b644b0064`,
  created-at `1784656735719`;
- PostgreSQL public / Inbox V2 tables: `312 / 257`;
- forbidden Inbox V1 relations / enums: `0 / 0`;
- tenants / employees / accounts / platform admins / API keys:
  `1 / 1 / 1 / 1 / 1`;
- connectors, sessions, session events, auth challenges, provider validations,
  source connections, source accounts and tenant secrets: all `0`;
- Inbox V2 conversations, messages, files, V2 file objects and V2 outbox
  intent/work/outcome rows: all `0`;
- generic outbox: `2` foundation rows;
- other database connections / prepared transactions: `0 / 0`;
- MinIO user files: `0`;
- legacy backups, provider-egress/VPN containers and forbidden provider
  enablement keys: all `0`;
- each target volume was attached only to its expected infrastructure
  container.

No state requiring preservation and no active provider path were present.

## Operator action

At `2026-07-23T05:15:43Z` the operator:

1. reverified the exact directory, Compose project, image labels, containers
   and volume attachments;
2. rebuilt runtime `.env` from the exact `35`-key allowlist;
3. rotated PostgreSQL/DATABASE_URL, application encryption, internal API,
   MinIO, foundation API-key and platform-admin credentials;
4. stopped and removed only `hulee_chat_api`, `hulee_chat_worker`,
   `hulee_chat_web`, `hulee_chat_minio_create_bucket`,
   `hulee_chat_postgres` and `hulee_chat_minio`;
5. removed only `hulee-chat_postgres-data` and
   `hulee-chat_minio-data`;
6. kept the independent marketing site available during volume replacement;
7. recreated empty PostgreSQL and MinIO volumes;
8. applied the one checked-in Inbox V2 baseline from image
   `ghcr.io/pigrov/hulee.chat:3181d7f533d6001dcdba3d708086dfcab5ca49c7`;
9. ran the foundation seed exactly once;
10. retained the new bootstrap credentials only in
    `/srv/hulee-chat/operator-secrets/clean-slate-foundation.env`, owned by
    `deploy:deploy` with mode `600`;
11. kept `HULEE_SEED_API_KEY` and `HULEE_PLATFORM_ADMIN_PASS` absent from
    runtime `.env`;
12. started API, Web, core worker and site on the exact target image.

An infrastructure-only Compose `--wait` invocation reported non-zero after
`minio-create-bucket` exited successfully with code `0`. The operator verified
PostgreSQL and MinIO health plus the initializer exit code before continuing;
no migration or seed had run at that point. The normal full-service Deploy
attempt 2 subsequently completed successfully without a workflow change.

The seed created only the retained tenant/auth/RBAC/brand/module/entitlement
foundation and its two generic outbox events. It created no Inbox client,
conversation, message, source, connector, provider credential/session or user
file.

## Verified after-state

| Evidence                                                    | Observed result                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Migration journal                                           | `1` row                                                            |
| Migration hash                                              | `aeb2e73818cb9bdbed7ef2c60f55642e647aaf9357df839a968b93fb1a8a43c9` |
| Migration created-at                                        | `1784656735719`                                                    |
| Schema epoch                                                | `preproduction-inbox-v2-1`                                         |
| Public / Inbox V2 tables                                    | `317 / 262`                                                        |
| Forbidden Inbox V1 relations / enums                        | `0 / 0`                                                            |
| Tenants / employees / accounts / platform admins / API keys | `1 / 1 / 1 / 1 / 1`                                                |
| `tenant_local_1` / `employee_local_1`                       | present / present                                                  |
| Connector/session/provider/source/secret state              | all `0`                                                            |
| Inbox conversation/message/file/object state                | all `0`                                                            |
| Inbox V2 outbox intent/work/outcome state                   | all `0`                                                            |
| Generic outbox                                              | `2` foundation rows                                                |
| MinIO user files                                            | `0`                                                                |
| Legacy backups / forbidden provider keys                    | `0 / 0`                                                            |
| Runtime bootstrap secrets                                   | absent                                                             |
| Bootstrap credential file                                   | `deploy:deploy`, mode `600`                                        |

API health returned HTTP `200`, migration count `1`, the exact schema epoch and
build revision `3181d7f533d6001dcdba3d708086dfcab5ca49c7`. API, Web, worker and
site were healthy on that exact image. Worker logs showed `worker.started` with
features `core`, egress `disabled/unavailable` and probes `false`.

At the bounded observation:

- `https://chat.hulee.ru/login` returned `200`;
- the unauthenticated root continued to redirect to login instead of returning
  `502`;
- `https://hulee.ru/` followed redirects to `200`;
- journal, provider/source and Inbox/file counts remained unchanged;
- no stale or provider runtime reconnected.

## Boundary

This reset restored the current pre-production Inbox V2 baseline; it did not
activate messenger traffic. Provider activation remains a separate reviewed
adapter task.

The first real production/on-prem release remains the boundary after which the
baseline is frozen, migrations become append-only and destructive reset is
forbidden without a new explicit classification and operator decision.

References:

- [ADR 0016](../../../docs/adr/0016-inbox-v2-preproduction-clean-slate.md)
- [Original CLEAN-GATE receipt](../../../docs/product/inbox-v2-clean-gate.md)
- [Production deployment boundary](../README.md)
