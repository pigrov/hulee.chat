# ADR 0004: i18n, Design Tokens And Quality Gates

## Status

Accepted.

## Context

Hulee should be localizable for different countries and brandable for different companies. The UI must support light/dark themes and avoid hardcoded Russian text or colors.

## Decision

The frontend uses:

- i18n dictionaries for user-facing text;
- design tokens for colors, typography, spacing and semantic states;
- light/dark theme support from the start;
- company theme overrides through token values;
- checks for hardcoded UI text, broken characters and invalid token usage.

## Consequences

- Components should not contain Russian UI copy.
- Components should not contain raw visual constants where tokens exist.
- Locale dictionaries become part of feature work.
- CI must include i18n and encoding checks.
