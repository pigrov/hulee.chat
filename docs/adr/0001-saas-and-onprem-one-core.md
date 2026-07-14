# ADR 0001: SaaS And On-Prem Use One Core

## Status

Accepted.

## Context

Hulee must support online/SaaS companies and on-prem/private deployments. If these become separate products, development cost and regression risk will grow quickly.

## Decision

SaaS and on-prem must use the same core packages and the same product contracts. Differences are expressed through:

- deployment topology;
- tenant config;
- license;
- enabled modules;
- company-layer extensions;
- environment settings.

## Consequences

- Core must avoid SaaS-only assumptions.
- On-prem packaging is a first-class requirement.
- Company-specific changes must not require a permanent fork of core.
- Upgrade compatibility must be tracked explicitly.
