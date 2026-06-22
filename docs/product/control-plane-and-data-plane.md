# Control Plane And Data Plane

Hulee should separate product management concerns from customer data processing concerns.

## Definitions

Control-plane manages product ownership, deployments and commercial state.

Data-plane processes tenant business data and user traffic.

```text
control-plane:
  tenants registry, deployments, plans, licenses, entitlements,
  module catalog, release channels, provisioning, updates

data-plane:
  employees, clients, conversations, messages, files,
  events, outbox, audit, adapters, diagnostics, inbox traffic
```

## Control-Plane Responsibilities

The control-plane owns:

- SaaS signup and company registration workflow;
- global tenant registry;
- deployment registry;
- mapping tenants to shared, isolated or on-prem deployments;
- plan, subscription, license and entitlement state;
- module catalog and allowed module availability;
- release channels and compatible versions;
- provisioning jobs for SaaS and enterprise SaaS deployments;
- on-prem license issuance and update metadata;
- platform-level operational metadata.

Control-plane must not own tenant business records such as clients, conversations, messages, files or provider payloads.

## Data-Plane Responsibilities

Each data-plane deployment owns:

- tenant settings;
- brand profiles resolved for that deployment/tenant;
- tenant modules and module configuration;
- employees, roles, permissions and sessions;
- clients and contacts;
- conversations and messages;
- files and tenant-scoped object storage keys;
- domain events, outbox and audit records;
- public API keys and request audit;
- provider adapters and integration diagnostics;
- realtime streams for inbox updates.

The data-plane can run in:

- shared SaaS deployment;
- isolated enterprise SaaS deployment;
- on-prem/private deployment.

## Boundary Rules

- Customer business data stays in the data-plane.
- Control-plane can provision or configure data-plane deployments, but it should not be required for normal message processing.
- On-prem data-plane must keep processing inbox, messages, files, events and adapters without permanent control-plane connectivity while its local license policy allows it.
- Enterprise SaaS data-plane can be managed by the Hulee control-plane while keeping customer data physically isolated.
- Data-plane services consume a local snapshot of license, entitlement, module catalog and deployment config.
- Sync from control-plane to data-plane must be idempotent and versioned.
- Control-plane outages should not immediately stop existing data-plane users from reading and processing business data.
- Data-plane must expose safe operational status back to control-plane without leaking customer message contents or files.

## Minimal Future Entities

Control-plane global entities:

- `control_plane_tenants`
- `deployments`
- `deployment_tenants`
- `deployment_versions`
- `release_channels`
- `module_catalog`
- `plans`
- `subscriptions`
- `licenses`
- `entitlement_templates`
- `tenant_provisioning_jobs`

Data-plane local/global entities:

- `tenants`
- `tenant_domains`
- `tenant_settings`
- `tenant_modules`
- `tenant_entitlements`
- `tenant_usage_policies`
- `deployment_config_snapshot`
- `license_snapshot`

Tenant-owned data-plane entities remain the regular product entities: employees, clients, conversations, messages, files, events, outbox, audit and diagnostics.

## MVP Scope

MVP should not build a full external control-plane service yet. It should include:

- logical ownership boundaries in packages and docs;
- control-plane compatible contracts for deployment type and license snapshots;
- seed/local commands that can create a first tenant/admin without SaaS signup;
- data-plane tenant settings and entitlement checks using local snapshots;
- Docker Compose on-prem path that does not depend on a SaaS control-plane.

MVP should defer:

- automated SaaS provisioning;
- subscription provider integration;
- release channel automation;
- remote on-prem update management;
- centralized fleet management UI.

Those can be added once the data-plane vertical slice is stable.
