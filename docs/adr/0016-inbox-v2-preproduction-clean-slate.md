# ADR 0016: Inbox V2 Pre-Production Clean-Slate Epoch

- Status: Accepted
- Date: 2026-07-20
- Owners: Product and platform architecture
- Decision task: `INB2-CLEAN-001`
- Disposition revision: `clean-slate-2026-07-20-r1`
- Supersedes: ADR 0014 for the current pre-production Hulee fleet and data

## Context

ADR 0014 and `INB2-MIG-001` selected an additive preserve path because a live
shared SaaS deployment, non-empty databases/object storage, provider sessions,
backups and unknown consumer/fleet roots existed. That was the correct
fail-closed conclusion while the value and ownership of those roots were
unknown.

On `2026-07-20` the product owner supplied the missing authority and classified
all current Hulee environments, including the host conventionally called
production, as pre-production test environments. All Inbox V1 rows, objects,
provider state, backups and fixtures are disposable. There is no supported
customer installation, required V1 data migration or committed consumer of the
current Inbox V1 semantics.

Maintaining dual materialization, backfill, semantic shadowing, N-1 V1 runtime
compatibility and an online preserve bridge would now protect test state at the
cost of slowing every Inbox V2 delivery. The product is better served by one
clean canonical implementation before the first real production or on-prem
release.

Public, event, realtime and module contract versions are independent from the
obsolete internal Inbox implementation. A route or schema identifier containing
`v1` is not deletion evidence by itself.

## Decision

The current Hulee pre-production fleet enters schema epoch
`preproduction-inbox-v2-1` and uses a destructive clean-slate transition:

```text
freeze automatic application/provider deployment
  -> detach every Inbox V1 runtime producer and consumer
  -> remove Inbox V1 code and schema
  -> create one clean Inbox V2 baseline
  -> reset disposable databases and object storage
  -> verify clean install, reset, repositories and runtime startup
  -> resume one V2-only delivery path
```

No Inbox V1 data is migrated. The following preserve-only work is cancelled for
this epoch:

- V1/V2 dual materialization and compatibility projection;
- operational V1 data backfill and ambiguity reconciliation;
- semantic shadow comparison and V1 command/read/source canaries;
- V1 N-1 runtime bundle and representative preserve-upgrade gate;
- online bridge review for the historical migration chain;
- V1 rollback fences, soak windows and migration ledgers.

Existing databases, object stores, caches, indexes, provider listeners/sessions
and backups are stopped, invalidated or recreated instead of upgraded. A stale
pre-clean-slate runtime or provider worker must never be allowed to reconnect to
the new epoch.

### Runtime and deployment freeze

Until `INB2-CLEAN-GATE` passes:

- pushes to `main` must not deploy API, worker, web or provider-egress services;
- the deployment workflow remains manually dispatchable only behind the
  repository variable `HULEE_CLEAN_SLATE_DEPLOY_UNLOCKED=true`;
- that variable must remain absent or false;
- no new or changed provider listener, polling, webhook or dispatch target may
  be activated from this repository;
- unfinished V2 message surfaces fail closed and never fall back to V1.

This repository freeze prevents a partial cleanup release. Stopping the already
running disposable environment and revoking provider webhooks/sessions is an
explicit operator action coupled to the V1 runtime-detachment task; changing
GitHub workflow triggers alone does not claim that a remote process was stopped.

### Retained platform roots

Clean-slate deletion is by ownership, not by name. The transition retains the
following code/schema ownership and canonical model boundaries, not the current
row/object contents, which remain disposable:

- tenants, accounts, employees, clients and client contacts;
- scoped RBAC, organization, team and queue foundations;
- source connections/accounts, auth/session/challenge/secrets, raw and
  normalized source evidence;
- files and Inbox V2 file object/version/parent relations;
- event store, outbox, audit, notifications and webhooks;
- all canonical `inbox_v2_*` relations and contracts.

It removes the obsolete V1 Conversation/participant/message/delivery/attachment
model and its runtime repositories, routes, workers, seed paths and tests after
their V2 or fail-closed replacements are composed.

Public API `/v1` may remain the first external contract version and later become
a facade over V2. Generic non-Inbox `/internal/v1` auth, admin, RBAC and
integration routes are retained. Internal `InboxV2` naming is not renamed as
part of this cleanup.

### Migration policy before the first real release

During this pre-production epoch, a fresh database is installed from one current
baseline and old databases are recreated. The baseline may be squashed while it
is unpublished, but every change must still pass schema invariants, repository
tests and disposable reset checks.

The first real production/on-prem release freezes that baseline. From that point
forward migrations are append-only and supported V2 release upgrades regain
N-1/backup/rollback requirements. This ADR does not authorize destructive reset
of any future environment containing real or legally required data.

## Consequences

Positive:

- one canonical Inbox architecture and one database baseline;
- no V1 compatibility work on every V2 task;
- faster local and CI feedback after preserve-only gates are removed;
- no invented migration facts for test data.

Negative and accepted:

- Inbox Web/API/provider messaging may be temporarily unavailable while the V2
  vertical slice is composed;
- all current Inbox/provider/object state is intentionally lost;
- old application images cannot be used against the new schema epoch;
- automatic application deployment remains frozen until the clean-slate gate.

## Verification

`INB2-CLEAN-001` is complete when:

- this decision and the exact disposition revision are linked from the canonical
  backlog and migration documents;
- ADR 0014 and the MIG-001 preserve disposition are clearly historical;
- preserve/backfill tasks no longer block the active backlog;
- `main` no longer triggers the application deployment workflow;
- the guarded manual deployment cannot run without the explicit unlock variable;
- preserve-only CI is removed while retained PostgreSQL integrity coverage stays
  active;
- repository checks verify the temporary deployment freeze.

## Operational outcome

`INB2-CLEAN-GATE` passed on `2026-07-22`. The known disposable PostgreSQL and
object-storage volumes were recreated, the one baseline and foundation seed
were applied, V1/provider/source/file state remained absent through bounded
observation, and stale images plus inventoried legacy backups were removed. The
receipt is `docs/product/inbox-v2-clean-gate.md`.

The temporary freeze controls above are therefore historical CLEAN-001 entry
guards. A successful full `Check` workflow for a push to `main` now hands its
exact checked revision to the V2-only deployment workflow. Direct-push and
manual deployment bypasses are absent, and a superseded-main fence prevents
out-of-order Check completion from rolling production back. Provider egress
remains disabled and requires a separate reviewed V2 adapter activation; this
outcome does not broaden the destructive reset authority to a future real-data
environment.
