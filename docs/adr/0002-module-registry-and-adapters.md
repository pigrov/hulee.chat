# ADR 0002: Module Registry And Provider Adapters

## Status

Proposed.

## Context

The product needs many integrations: auth providers, messengers, social networks, telephony providers, CRM systems, AI providers and marketing systems.

## Decision

Integrations are modules. Modules declare manifests and implement stable adapter contracts. Core interacts with adapters through provider interfaces and does not contain provider-specific branches.

## Consequences

- Every module needs config schema and diagnostics.
- Provider errors must be normalized into the platform error catalog.
- UI extension points must be explicit.
- Contract tests are required for adapters.
- New providers should not require core rewrites.
