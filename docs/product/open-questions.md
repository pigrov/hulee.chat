# Open Questions

## Resolved for MVP

- MVP modules: local auth, public API channel, Telegram channel, outbound webhooks, S3-compatible storage, license stub and company example.
- MVP app topology: `apps/web`, `apps/api` and `apps/worker`; `apps/mobile` and `apps/desktop` scaffold-only; `apps/realtime` deferred.
- MVP realtime: SSE endpoints in `apps/api` with polling fallback.
- MVP tenant isolation: shared PostgreSQL with strict `tenantId`; schema-per-tenant and database-per-tenant remain future options.
- MVP auth: email/password plus `AuthProvider` contract; SSO providers are outside MVP.
- MVP channels: Telegram plus public API channel; VK, MAX, WhatsApp/Wazzup and SMS fallback are outside MVP.
- MVP telephony: `TelephonyProvider` contract and event schema only, no production telephony adapter.
- MVP workflow: domain events, outbox and webhooks only; workflow/rule engine is outside MVP.
- SaaS pricing principle: core functionality should not be artificially cut by plan; plans primarily differ by seats, storage, transcription, AI usage, API/webhook throughput, retention, SLA and enterprise capabilities.
- MVP billing scope: no payment provider or invoice automation; include entitlement evaluator, usage policies and storage/API/webhook metering foundation.
- MVP control-plane scope: logical control-plane/data-plane boundary only; no separate control-plane service until data-plane vertical slice is stable.

## Product And Delivery Release Questions

The questions below do not block the provider-neutral Inbox V2 contracts. Each
blocks only the named commercial, deployment, extension or native-client surface.
If an answer would change a shared-core invariant, it requires an ADR and backlog
impact review rather than an implementation-time assumption.

| ID       | Unresolved decision                                                                      | Owner                                               | Blocking impact                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `PQ-001` | Whether on-prem customers receive source code, packaged builds or both                   | Product + Legal + Platform                          | On-prem commercial offer, delivery artifacts and support/upgrade contract                                         |
| `PQ-002` | Required company-layer isolation beyond the accepted module/config/no-core-fork boundary | Platform Architecture + Security                    | Public company-extension SDK and stronger isolation guarantees; not shared-core contracts                         |
| `PQ-003` | Initial on-prem license format, offline grace and renewal/recovery policy                | Commercial + Legal + Platform                       | Production license issuance and offline commercial enforcement; not the entitlement evaluator                     |
| `PQ-004` | Exact SaaS plan names, included quotas, overage prices and commercial packaging          | Commercial + Product                                | Pricing/catalog launch; not versioned entitlement/usage contracts                                                 |
| `PQ-005` | Production telephony providers and priority order for v1                                 | Telephony Product + Integrations                    | Provider adapter selection/live certification; not `TelephonyProvider` or typed call contracts                    |
| `PQ-006` | Internal billing implementation versus external billing provider                         | Product + Finance + Platform                        | Automated subscription, invoice and payment flows                                                                 |
| `PQ-007` | Minimum public third-party plugin/module API guaranteed for v1                           | Platform + Developer Experience + Security          | External plugin compatibility/support promise; internal versioned manifest/adapter contracts remain authoritative |
| `PQ-008` | First enterprise compliance profiles and contractual controls                            | Legal + Product + Security                          | Tracked in `DG-001..DG-012`; affected production/commercial profiles                                              |
| `PQ-009` | Bundled native assets versus controlled remote shell versus hybrid per deployment        | Client Platform + Security + Product                | Production mobile/desktop bootstrap, update and offline behavior                                                  |
| `PQ-010` | Runtime-only white label versus separate mobile/desktop release profiles                 | Product + Branding + Release Engineering            | Customer-specific store/installer binaries; runtime brand profiles are already accepted                           |
| `PQ-011` | Apple Developer, Google Play and desktop signing accounts/certificates                   | Release Engineering + Legal                         | Store submission and signed production installers                                                                 |
| `PQ-012` | On-prem desktop auto-update authority, channels, signing and rollback policy             | Client Platform + SRE + Security                    | Production on-prem desktop distribution/update                                                                    |
| `PQ-013` | Customer-specific MDM/private distribution for enterprise/on-prem mobile apps            | Enterprise Product + Security + Release Engineering | Private mobile distribution commitments                                                                           |
| `PQ-014` | Required offline behavior for mobile/desktop beyond durable reconnect/resync             | Client Platform + Product                           | Offline reads/mutations/cache policy; normal online/reconnect contracts remain unchanged                          |

## Inbox V2 Data Governance Release Questions

ADR 0015 and `docs/product/inbox-v2-data-lifecycle-and-privacy.md` settle the
provider-neutral architecture. The decisions below do not block versioned core
contracts, but each blocks the named production/commercial surface until its
owner records dated legal/product approval.

| ID       | Unresolved decision                                                                                                                                                                                                           | Owner                              | Blocking impact                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `DG-001` | First-launch jurisdictions/industries and regime-specific roles: EU controller/joint controller/processor/recipient/subprocessor; Russian personal-data operator/person processing on its instruction/recipient/subcontractor | Legal + Product                    | Production compliance profiles, customer terms/DPA and regulator/request responsibility                                       |
| `DG-002` | Whether Hulee is an ORI/ОРИ, telecom operator/оператор связи, or EU interpersonal-communications service for each delivery model                                                                                              | Legal/Regulatory + Product         | Public/direct-number messaging, internal groups and telephony launch in the affected jurisdiction                             |
| `DG-003` | Approved minimum/default/maximum period per data class, purpose and contract; which plan options may select only within that lawful-purpose envelope                                                                          | Legal + Product + Commercial       | SaaS retention settings/pricing and production activation of lifecycle workers                                                |
| `DG-004` | Provider/subprocessor, region, localization, cross-border mechanism and remote-deletion commitments per surface                                                                                                               | Integrations + Legal + Security    | Production enablement of each messenger, telephony, AI/transcription and support-data route                                   |
| `DG-005` | Call recording/transcription notice, consent/basis, access and retention by jurisdiction                                                                                                                                      | Legal + Telephony Product          | Recording, transcription, summary and call-content analytics                                                                  |
| `DG-006` | Employee/internal-chat privacy, lawful monitoring, compliance aggregate and exceptional-access policy                                                                                                                         | Legal + HR + Security              | Exceptional monitoring/access/export of internal chats stays default deny; normal authorized chat operation remains available |
| `DG-007` | Treatment or prohibition of special-category, child and biometric data in content, CRM, recordings and AI                                                                                                                     | Legal + Security + Product         | Automated extraction/classification and affected regulated-customer onboarding                                                |
| `DG-008` | Subject verification, jurisdiction SLAs/extensions, response schemas and third-party redaction review                                                                                                                         | Legal/Privacy + Product            | External privacy-request API/UI and committed response SLA                                                                    |
| `DG-009` | Hold authority/separation of duties, WORM/tamper evidence, crypto-shredding acceptability and backup erasure deadline                                                                                                         | Legal + Security + SRE             | Enterprise legal-hold feature and verified deletion/restore evidence                                                          |
| `DG-010` | Tenant termination grace, final export, billing boundary, wipe schedule and on-prem responsibility certificate                                                                                                                | Product + Commercial + SRE + Legal | SaaS cancellation/offboarding and enterprise contract termination                                                             |
| `DG-011` | Testable threshold/method for irreversible anonymous aggregates and approved long-lived dimensions                                                                                                                            | Data + Privacy + Security          | Analytics retention beyond person-level facts and claims that data is anonymous                                               |
| `DG-012` | Incident-classification and notification responsibility, recipients, evidence and timers per regime, including GDPR's 72-hour authority deadline where applicable and the Russian two-stage notification process              | Legal/Privacy + Security + SRE     | Production incident runbooks, contractual notification SLA and compliance evidence                                            |
