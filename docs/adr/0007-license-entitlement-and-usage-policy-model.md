# ADR 0007: License, Entitlement And Usage Policy Model

## Status

Proposed.

## Context

Hulee needs SaaS pricing, enterprise SaaS contracts and on-prem licensing. The product should not scatter plan checks through business logic or artificially disable core communication features by plan. Expensive and unbounded resources such as storage, transcription, AI, API volume and webhook volume still need clear limits and usage policies.

## Decision

Hulee separates:

- `license`: the right to run the product or deployment;
- `plan`: the commercial package;
- `entitlement`: a specific right, module, feature or limit;
- `usage policy`: included quota, soft limit, hard limit and reset period;
- `tenant_modules`: modules actually enabled for a tenant.

Feature availability is evaluated through a shared entitlement and usage policy evaluator:

```text
license/plan entitlement allows it
+ tenant has enabled the module
+ module is configured and healthy
+ user has permission
= feature available
```

SaaS plans should primarily differ by seats, storage, transcription minutes, AI credits, API/webhook throughput, retention, SLA, compliance, deployment model and enterprise capabilities. Core inbox, clients, conversations, messages, basic roles, basic diagnostics and data export should not be artificial feature locks across paid plans.

On-prem deployments use signed license snapshots and local usage policies. AI and transcription can use customer-owned provider keys, Hulee-managed add-ons or disabled/offline mode depending on entitlement.

## Consequences

- Business logic must call entitlement/usage evaluators instead of checking plan names directly.
- Limit errors must be versioned and diagnosable.
- Over-limit behavior should preserve access to existing customer data according to policy.
- Usage metering must be tenant-scoped, idempotent and auditable.
- Payment providers and invoice automation can be added later without rewriting core feature gates.
