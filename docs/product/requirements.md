# Requirements

## Tenants / Companies

- Регистрация компании в SaaS.
- Создание компании администратором платформы.
- Изоляция данных по tenant.
- Настройки компании.
- Лицензия и доступные модули.
- Брендинг компании.
- White-label профиль: название продукта, короткое название, логотипы, favicon/PWA icons, support/legal links.
- Theme token overrides для light/dark/company themes.
- Tenant/deployment branded domains.
- Брендированные email sender/template settings.
- Аудит изменений brand profile и brand assets.
- Настройки локализации, часового пояса и региона.

## Users / Employees

- Сотрудники компании.
- Роли и права.
- Инструкция для администраторов по scoped RBAC, шаблонам ролей и direct grants: `docs/product/rbac-admin-guidance.md`.
- Команды и подразделения.
- Руководители и супервизоры.
- Статусы присутствия.
- Настройки уведомлений.
- Поддержка external identities: Bitrix24, ADFS, LDAP, OIDC/SAML.

## Authorization / Responsibility

- Inbox V2 responsibility and scoped RBAC follow ADR 0013. Access is default
  deny and requires an active authenticated principal, tenant match, explicit
  permission, server-derived resource relation and current shared/Employee/
  resource authorization epoch plus entity revisions.
- Role names such as `supervisor` and provider owner/admin/member status do not
  grant authority. Supervisor override is a scoped permission combined with
  the requested operation, mandatory reason and atomic audit.
- Queue member, WorkItem primary responsible, collaborator, watcher, internal
  participant and Client owner are independent temporal relations. Membership,
  authorship, watcher state and SourceExternalIdentity claims are not grants.
- Inbox metadata, external Conversation content, private internal-chat content,
  external reply, internal send, staff-note read/create, files, Client/contact
  PII, CRM edits and reports use separate permissions.
- Client-scoped access never opens a linked Conversation. Conversation access
  never opens every linked Client/contact; a multi-client group is authorized
  independently per Client.
- Manual SourceExternalIdentity claim-to-self is forbidden. Employee and
  ClientContact claims have separate permissions and never create Account,
  session, RBAC, membership or responsibility.
- Employee deactivation enters `draining`, atomically fences sessions, access,
  notifications and assignment eligibility, then resolves WorkItems, Client
  owners and internal-group ownership in bounded revision-safe batches; it
  reaches inactive only when no effective primary/current-owner relation remains.
- Scoped access predicates are applied before list/search/report pagination.
  Permission-only UI/server checks and filtering unauthorized rows after
  `LIMIT` are not valid enforcement.

## Clients

- Клиенты компании.
- Контакты клиента: телефоны, email, мессенджеры, соцсети.
- Источник появления клиента.
- Воронка/статус квалификации.
- Ответственный сотрудник.
- История коммуникаций.
- Согласия, аудит и события.
- `client.view`, contact/PII view, pipeline transition, field edit, owner change
  and Conversation link management remain independently authorized and
  revisioned for every Client in a group.

## Conversations

Inbox V2 semantics, cardinalities and valid/invalid scenarios are defined in
`docs/product/inbox-v2-scenarios-and-glossary.md` and ADR 0009. The names below
are product scenarios/compositions, not a requirement to persist one enum that
mixes topology, transport, WorkItem lifecycle and client CRM state.

- `client_direct`: прямой клиентский чат.
- `client_group`: групповой чат с клиентом.
- `internal_direct`: прямой чат сотрудников.
- `internal_group`: групповой чат сотрудников.
- `support_case`: обращение сотрудника в команду поддержки.
- `intake`: не квалифицированный входящий клиент/лид.
- Conversation supports zero-to-many linked Clients and Employees.
- Internal direct/group conversations do not require a Client or WorkItem.
- External employee-only groups remain external and do not require a synthetic
  Client or WorkItem.
- WorkItem owns queue, operational state, SLA and one primary responsible;
  Client CRM owns pipeline stage and client owner.
- WorkItem servicing Team is an explicit temporal routing/access relation, not
  inferred from the responsible Employee's memberships and not another primary.
- Every WorkItem belongs to one Conversation; Inbox V2 allows at most one
  non-terminal WorkItem per Conversation.
- Calls, reviews, marketplace questions and other non-chat source items remain
  typed timeline items instead of fake text messages.
- Internal direct/group content is authorized by current Hulee-origin
  membership. Tenant/org/team/queue scope does not open a private internal chat;
  exceptional read uses audited time-limited break-glass and never permits send.
- Watcher is a notification subscription, not read/reply authority. A
  collaborator is explicit Hulee assistance, not provider membership,
  responsibility or Client ownership.

## Messages

- Входящие и исходящие сообщения.
- Text and attachments. Calls and system/source events remain typed TimelineItems
  and become Messages only when the source actually represents communicative
  message content.
- Every human/bot Message has one immutable ConversationParticipant author;
  Client, current responsible and SourceAccount cannot substitute for it.
- Authorship, server-stamped Hulee application actor and provider transport
  sender/account are separate facts. Provider echo cannot replace app author.
- Unknown source senders remain first-class source identities until an audited
  claim links them; identity linking never rewrites message history or grants
  application access.
- Native-provider outbound by an identity linked to an Employee remains
  source-authored with no Hulee app actor; reporting retains claim-at-event.
- Staff-only notes have an Employee/bot author but can never create a provider
  delivery, receipt or transport sender.
- Delivery status.
- Error catalog.
- Retry/requeue.
- Read receipts.
- Idempotency для внешних операций.
- External direct/group communication resolves by a versioned adapter-declared
  thread/message realm and provider/connection/account scope, never by current
  Client/contact or first connector.
- One provider-scoped group can have several SourceAccount bindings and one
  canonical Message with several source occurrences; account-scoped private
  dialogs remain separate.
- Every normal external send/reply persists exactly one immutable opaque route
  before provider I/O. Explicit route cannot silently fall back/fan out, and
  retry never hops accounts.
- Binding remote membership, administrative enablement and runtime health are
  independent; disable/rebind before I/O causes no provider call.
- Provider acceptance with lost acknowledgement becomes uncertain and is not
  automatically retried unless the adapter proves send idempotency.
- Timeline order uses an immutable server-assigned per-Conversation sequence;
  provider/server timestamps remain separate display/reporting facts and cannot
  be synchronization cursors.
- Every client-visible mutable entity has a monotonic revision and revisioned
  tombstone. Delivery, receipt, reaction, attachment and dispatch transitions
  cannot be silent row updates.
- Canonical state, one commit-safe tenant-stream change set, domain events,
  command result and outbox intents are transactional. Outbox claim order and
  PostgreSQL notifications do not define realtime order.
- Inbox snapshot is authoritative only for its declared scope/manifest and
  returns a revisioned graph plus resume cursor; SSE replays every retained
  scanned range after it, and polling consumes the same versioned batches.
  Expired/changed cursors force explicit resync.
- Sidebar, active timeline and background conversations use one normalized
  client entity graph/reducer so a stale HTTP response cannot overwrite a newer
  SSE or provider-echo revision.
- Employee `lastReadSequence` is monotonic across devices; manual unread and
  provider delivery/read receipts remain separate state.
- External reply, internal send and staff-only note are distinct commands.
  External reply additionally requires exact SourceAccount/binding authority;
  staff-note commands accept no route and are rejected again by dispatch.

## Channels

- Channel provider contract.
- Telegram adapter.
- VK adapter.
- MAX adapter.
- WhatsApp/Wazzup adapter.
- SMS adapter/fallback.
- Включение каналов на уровне tenant.
- Диагностика webhook/send failures.

## Source Integrations

- Universal source model for messengers, social networks, marketplaces, classifieds, reviews, maps, website forms, email, telephony, CRM, public API and custom connectors.
- Source connections per tenant with source type, source name, display name, status, auth type, capabilities, diagnostics and configuration.
- Source accounts for concrete bots, user sessions, groups, shops, branches, mailboxes, phone numbers, ad accounts and custom resources.
- Immutable raw occurrence-envelope persistence before normalization, with
  credentials/auth/cookies/session material stripped before the first durable
  write and provider payload/evidence stored separately under ADR 0015.
- Normalized inbound events with event type, direction, external thread/message/user ids and payload version.
- Reply capability per source event or conversation: native reply, external link, read-only, unsupported or expired.
- Idempotency across webhook, polling, email and API sources.
- Replay-safe processing and diagnostics for failed source events.
- Source context for marketplace orders, listings, reviews, calls, lead forms and CRM mappings without provider-specific branches in core.
- Every messenger provider surface declares its access model and binding-scoped
  capabilities; bot, personal-session, phone-addressed business, group/workspace
  and archive surfaces from one brand are not interchangeable.
- Consumer QR/web/desktop login without an approved programmable transport and
  verified capability evidence cannot be advertised as a production connector.

## Telephony

- Telephony provider contract.
- Входящие/исходящие/пропущенные звонки.
- Записи разговоров.
- Связка звонка с клиентом и сотрудником.
- Нормализация длительности, ожидания, статусов.
- Диагностика provider errors.

## Public API

- Регистрация клиентов.
- Отправка сообщений клиентам.
- Получение статусов доставки.
- Webhooks для внешних систем.
- Версионирование API.
- OpenAPI schema.
- API keys per tenant.
- Rate limits and audit.

## Data Lifecycle, Privacy And Audit

- Inbox V2 follows ADR 0015 and
  `docs/product/inbox-v2-data-lifecycle-and-privacy.md`.
- Retention is versioned per tenant/deployment, data class, processing purpose,
  jurisdiction profile and canonical anchor; one global message TTL is invalid.
- Immutable sequence/authorship/route/audit envelopes do not copy immortal PII:
  content, provider payloads, contact values, files, recordings, transcripts and
  sensitive evidence have independent purgeable lifecycle.
- Legal hold, processing restriction, RBAC and ordinary retention are separate;
  a hold blocks eligible purge but grants no content/export authority and never
  preserves usable credentials.
- Tenant export, manager/report export and verified subject access/portability
  export use different permissions, redaction and manifests.
- Privacy erasure, provider message delete and retention expiry are distinct
  idempotent workflows with object/index/cache/analytics/backup/external outcomes.
- Group requests protect other participants and cannot infer one Client or
  delete/export a whole Conversation from one subject identity.
- Audit is typed, minimized, tamper-evident according to deployment profile and
  finite; raw Message/contact/provider/file/secret data is referenced or kept in
  separately restricted purgeable evidence, never generic audit JSON.
- Backup restore reapplies the erasure/hold ledger before serving traffic and
  cannot resurrect deleted exports/content into active processing.
- On-prem executes policy, holds, exports/deletion and evidence locally without
  permanent SaaS control-plane connectivity.

## Admin

- Управление tenants.
- Управление сотрудниками, ролями, командами.
- Управление модулями и лицензиями.
- Настройки интеграций.
- Мониторинг каналов, очередей, ошибок.
- Аудит событий.
- Privileged role/grant/membership mutation, bounded shared/Employee/relation
  authorization revision, event/outbox and required security audit commit
  atomically; scoped admin permissions are evaluated
  against the target resource rather than by permission presence alone.

## Manager Reports

- Aggregate view, aggregate export, row drilldown, PII view and PII export are
  separate permissions.
- Aggregate permission exposes no message content, participant/contact data or
  stable person/resource row identifiers.
- Named operator dimensions require separate workforce-directory permission;
  private internal-chat activity is excluded by default, and aggregate cells
  use minimum-size/complementary suppression plus differencing budgets.
- Drilldown reauthorizes every underlying Conversation, WorkItem, Client,
  contact/file and staff-note boundary; export revalidates access per bounded
  chunk and before download; revoke deletes/quarantines partial export and
  invalidates its download.
- Historical facts retain event-time author, responsible, queue/team/org and
  Client attribution; current assignee/owner changes never rewrite history.

## Client Applications

- Web/PWA client for browser access.
- Android app through Capacitor.
- iOS app through Capacitor.
- Windows desktop app through Tauri.
- macOS/Linux desktop app support when required.
- Shared UI, i18n, app-shell and API contracts across all clients.
- Native bridge for push notifications, deep links, files, camera/media, badges and app metadata.
- Tenant/server selection for SaaS, isolated SaaS and on-prem deployments.
- Runtime brand profile resolution for product name, logos, theme tokens and support/legal links.
- Build/release profile support for white-label app names, icons, bundle ids and update channels when required.
- Notification deduplication across web, mobile and desktop devices.
- Production signing, packaging and release pipelines.

## SaaS

- Self-service registration.
- Subscription/billing.
- Управление тарифами.
- Включение модулей по подписке.
- Entitlements and usage limits per tenant.
- Included quotas and overage policies for storage, transcription, AI, API and webhooks.
- Usage metering for storage, transcription, AI, API requests, webhook events and active employees.
- Admin-visible warnings for soft limits and diagnosable errors for hard limits.
- Shared или isolated deployment в зависимости от клиента.

## On-Prem

- Docker Compose для простого старта.
- Helm chart для production Kubernetes.
- License/config mechanism.
- Signed license with enabled modules, deployment type, support level, limits and offline grace period.
- Customer-owned provider keys or disabled/offline mode for AI and transcription.
- Поддержка offline/limited connectivity режима.
- Возможность company-layer без форка core.
