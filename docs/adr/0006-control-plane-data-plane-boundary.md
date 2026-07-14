# ADR 0006: Control-Plane And Data-Plane Boundary

## Status

Accepted.

## Context

Hulee must support shared SaaS, isolated enterprise SaaS and on-prem deployments. If tenant lifecycle, licensing, deployments and subscription logic are mixed directly with message processing and customer data, enterprise isolation and on-prem operation will become hard to maintain.

## Decision

Hulee separates control-plane and data-plane responsibilities.

The control-plane owns global product and deployment management:

- tenant registry;
- deployment registry;
- plans, subscriptions, licenses and entitlements;
- module catalog;
- release channels;
- provisioning and update metadata.

The data-plane owns tenant business data and traffic:

- tenant settings;
- employees, clients, conversations, messages and files;
- events, outbox and audit;
- adapters and integration diagnostics;
- public API and realtime traffic.

MVP may run without a separate physical control-plane service, but the ownership boundary must be explicit in contracts, packages and data models.

## Consequences

- Customer business data must not be copied into control-plane tables.
- On-prem data-plane must operate without permanent control-plane connectivity while its local license policy allows it.
- Enterprise SaaS can use Hulee-managed control-plane metadata while keeping the data-plane physically isolated.
- Data-plane uses local snapshots of license, entitlements, module catalog and deployment config.
- Future SaaS signup/provisioning work can be added without changing core message processing.
- License/control-plane unavailability never moves customer content into the
  control-plane and does not disable the local authorized read, privacy/tenant
  export, deletion, hold or evidence operations required by ADR 0015.
