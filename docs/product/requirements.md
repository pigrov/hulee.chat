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
- Команды и подразделения.
- Руководители и супервизоры.
- Статусы присутствия.
- Настройки уведомлений.
- Поддержка external identities: Bitrix24, ADFS, LDAP, OIDC/SAML.

## Clients

- Клиенты компании.
- Контакты клиента: телефоны, email, мессенджеры, соцсети.
- Источник появления клиента.
- Воронка/статус квалификации.
- Ответственный сотрудник.
- История коммуникаций.
- Согласия, аудит и события.

## Conversations

- `client_direct`: прямой клиентский чат.
- `client_group`: групповой чат с клиентом.
- `internal_direct`: прямой чат сотрудников.
- `internal_group`: групповой чат сотрудников.
- `support_case`: обращение сотрудника в команду поддержки.
- `intake`: не квалифицированный входящий клиент/лид.

## Messages

- Входящие и исходящие сообщения.
- Текст, вложения, системные события, звонки.
- Delivery status.
- Error catalog.
- Retry/requeue.
- Read receipts.
- Idempotency для внешних операций.

## Channels

- Channel provider contract.
- Telegram adapter.
- VK adapter.
- MAX adapter.
- WhatsApp/Wazzup adapter.
- SMS adapter/fallback.
- Включение каналов на уровне tenant.
- Диагностика webhook/send failures.

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

## Admin

- Управление tenants.
- Управление сотрудниками, ролями, командами.
- Управление модулями и лицензиями.
- Настройки интеграций.
- Мониторинг каналов, очередей, ошибок.
- Аудит событий.

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
