# ADR 0002: Module Registry And Provider Adapters

## Status

Accepted.

## Context

The product needs many integrations: auth providers, messengers, social networks, telephony providers, CRM systems, AI providers and marketing systems.

## Decision

Integrations are modules. Modules declare manifests and implement stable adapter
contracts. Core interacts with adapters through provider interfaces and does not
contain provider-specific branches.

A module that stores, derives, exports or transmits tenant/customer data declares
a typed, namespaced ADR 0015 data-governance contribution: storage roots and
data classes, core parent, sensitivity, purposes, subject/export behavior,
external routes and export/delete/verification/uninstall handlers. Only a
validated non-data module may omit it. Activation, upgrade and uninstall fail
closed when retained data would lose a compatible handler.

## Consequences

- Every module needs config schema and diagnostics.
- Provider errors must be normalized into the platform error catalog.
- UI extension points must be explicit.
- Contract tests are required for adapters.
- New providers should not require core rewrites.
- Module lifecycle completeness is a versioned contract, not an optional list of
  string hints.
