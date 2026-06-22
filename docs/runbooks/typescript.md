# TypeScript Baseline

The repository keeps `strict: true` for application and package code.

`skipLibCheck` is enabled because `drizzle-orm` publishes declaration files for optional dialects and drivers that are not part of Hulee's PostgreSQL runtime. With `skipLibCheck: false`, TypeScript checks those external optional declarations and fails on missing optional driver packages and dialect-specific declaration issues.

This is an external dependency declaration check exception, not permission to weaken local code:

- local code must stay strict;
- package boundaries should remain typed;
- no local `any` escapes for business logic;
- revisit this when upgrading Drizzle/TypeScript.
