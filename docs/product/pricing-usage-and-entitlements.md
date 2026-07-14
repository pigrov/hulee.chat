# Pricing, Usage And Entitlements

Hulee pricing should protect infrastructure and expensive provider costs without turning core product value into artificial feature locks.

## Pricing Principle

Core collaboration and communication features should stay available across paid SaaS plans:

- inbox;
- clients and conversations;
- messages;
- basic roles and permissions;
- basic integration diagnostics;
- public API and webhooks within limits;
- data export.

Plans should primarily differ by:

- seats / active employees;
- included storage;
- included transcription minutes;
- included AI credits;
- API and webhook throughput;
- retention windows;
- support/SLA;
- compliance and audit capabilities;
- deployment model;
- white-label/release profile needs;
- custom modules/company-layer.

## Concepts

```ts
type DeploymentType = "saas_shared" | "saas_isolated" | "on_prem";

type EntitlementKey =
  | "module.enabled"
  | "seat.active_employee"
  | "storage.gb_month"
  | "transcription.minute"
  | "ai.credit"
  | "api.request"
  | "webhook.event"
  | "retention.day"
  | "deployment.type"
  | "support.sla"
  | "white_label.runtime"
  | "white_label.release_profile";

type UsagePolicy = {
  entitlement: EntitlementKey;
  included: number;
  softLimit?: number;
  hardLimit?: number;
  overageUnitPrice?: string;
  resetPeriod?: "monthly" | "daily" | "none";
};
```

`license` means the right to run the product. `plan` means the commercial package. `entitlement` means a specific right, feature, module or resource limit. `tenant_modules` means what is actually enabled for a tenant.

Feature availability should be evaluated as:

```text
license/plan entitlement allows it
+ tenant has enabled the module
+ module is configured and healthy
+ user has permission
= feature available
```

## SaaS Plan Shape

Recommended SaaS packaging:

- plan includes core product and a baseline of resources;
- expensive or unbounded resources use included quota plus overage;
- enterprise capabilities are add-ons or separate plans;
- provider pass-through costs are visible where relevant.

Resource examples:

- storage: GB-month, file size, file retention;
- transcription: minutes, audio retention, provider class;
- AI: credits/tokens, monthly caps, task classes;
- API: requests per minute/month, burst limits;
- webhooks: event volume, retry window, payload retention;
- seats: active employees or named seats;
- retention: message/file/audit retention windows.

Retention entitlements operate only inside the approved ADR 0015 lifecycle and
jurisdiction envelope. A plan may include or sell a longer optional period, but
it cannot silently repurpose collected data, exceed a legal maximum, shorten a
legal/contractual minimum, bypass legal hold or make verified export/delete
unavailable. A downgrade requires policy preview, notice/cooling period and an
explicit tenant decision where applicable; non-payment is never an immediate
deletion instruction.

## SaaS Overage Behavior

Limits should degrade product behavior predictably:

- storage soft limit: warnings at 80/90/100%;
- storage hard limit: block new uploads, keep read/download/export access;
- transcription limit: stop new transcription jobs or require overage approval;
- AI limit: stop new AI jobs or require overage approval;
- API rate limit: return versioned rate-limit errors with retry hints;
- webhook volume limit: throttle/retry according to policy, keep diagnostics;
- seats hard limit: block activating additional employees, not existing login by default.

Expired or over-limit plans should not immediately block access to existing business data. Read, export and audit access should follow a documented policy.

Privacy request, legal hold, tenant offboarding export and policy-required
deletion/evidence operations remain available even when an entitlement/license
expires. Their workload may be rate-bounded operationally but not disabled.

## On-Prem Model

On-prem pricing is license/deployment based because compute, database and object storage usually run on customer infrastructure.

On-prem may still need entitlements for:

- enabled modules;
- maximum active employees;
- deployment type;
- support/SLA;
- offline grace period;
- white-label release profile;
- AI/transcription mode.

AI and transcription for on-prem should support:

- customer-owned provider keys;
- Hulee-managed provider add-on where connectivity and contract allow it;
- disabled/offline mode;
- signed entitlement flags for enabled AI modules.

## Usage Metering

Usage records should be tenant-scoped and event-backed:

- storage bytes by tenant and retention class;
- transcription seconds/minutes by tenant, provider and job type;
- AI credits/tokens by tenant, model/provider and task type;
- API requests by tenant, key and endpoint group;
- webhook events by tenant, subscription and event type;
- active employees by tenant and billing period.

Metering should be idempotent and auditable. Usage aggregation can be eventually consistent, but enforcement points must use clear, deterministic policy.

## MVP Scope

MVP should include:

- plan/license flags in tenant settings;
- entitlement contract and evaluator;
- quota policy model for storage, API/webhooks, transcription and AI;
- storage usage metering foundation;
- API/webhook rate-limit placeholder;
- explicit `usage.limit_exceeded` error codes;
- admin-visible usage summary placeholder.

MVP should not include:

- payment provider integration;
- invoice generation;
- full usage-based billing automation;
- production AI/transcription provider billing;
- automated overage charging.

## Quality Rules

- Business logic must check entitlements through a shared evaluator, not ad hoc plan checks.
- Core must not contain provider-specific pricing branches.
- Limit errors must be versioned, diagnosable and safe to show to admins.
- Overage and limit events must include `tenantId`, usage period, entitlement key and idempotency key.
