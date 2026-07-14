# ADR 0005: Production Client App Strategy

## Status

Accepted.

## Context

Hulee must support browser users, mobile users and desktop users across SaaS, enterprise SaaS and on-prem installations. The platform needs real app capabilities: push notifications, deep links, file access, app badges, desktop tray, auto-update and enterprise-friendly packaging.

## Decision

Hulee uses:

- Next.js/PWA for the browser client;
- Capacitor for Android and iOS;
- Tauri for Windows desktop, with macOS/Linux support when required.

Mobile and desktop apps are first-class production clients. They share UI, i18n, contracts and app-shell logic through packages, but they do not blindly embed server-only Next.js behavior.

## Consequences

- Shared frontend code must be split into reusable packages.
- Native capabilities must be hidden behind a `native-bridge` interface.
- iOS release builds require macOS/Xcode or macOS CI.
- Desktop release builds require signing, installers and auto-update design.
- Push and notification fan-out must deduplicate across web, mobile and desktop endpoints.
- On-prem deployments need configurable server/tenant URLs in native apps.
