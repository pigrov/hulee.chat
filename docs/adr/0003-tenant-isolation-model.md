# ADR 0003: Tenant Isolation Model

## Status

Proposed.

## Context

SaaS requires strict tenant isolation. On-prem usually has one tenant, but the same code should run in both modes.

## Decision

Every tenant-owned business entity must include `tenantId`. Every API operation, query, event, job, file path and audit record must be tenant-scoped.

The platform should support multiple physical isolation modes over time:

- shared database with `tenantId`;
- schema-per-tenant;
- database-per-tenant;
- isolated deployment.

MVP should start with shared database plus strict `tenantId` enforcement unless enterprise requirements force earlier physical isolation.

## Consequences

- Tenant isolation tests are required.
- Indexes must be tenant-aware.
- Background jobs must carry `tenantId`.
- Files must be stored under tenant-scoped prefixes.
- Admin/platform tables must be explicitly marked as global.
