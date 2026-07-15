# Hulee Agent Context

Перед любой работой с этим проектом прочитай:

- `docs/product/vision.md`
- `docs/product/requirements.md`
- `docs/product/backlog.md`
- `docs/product/mvp-plan.md`
- `docs/product/architecture-principles.md`
- `docs/product/modules-and-integrations.md`
- `docs/product/source-integrations.md`
- `docs/product/deployment-model.md`
- `docs/product/tech-stack.md`
- `docs/product/client-applications.md`
- `docs/product/control-plane-and-data-plane.md`
- `docs/product/branding-and-white-label.md`
- `docs/product/pricing-usage-and-entitlements.md`
- `docs/product/quality-gates.md`
- `docs/product/open-questions.md`
- `docs/adr/`

Перед работой с Inbox V2 дополнительно прочитай:

- `docs/product/inbox-v2-backlog.md`
- `docs/product/inbox-v2-epic-0-architecture-review.md`
- `docs/product/inbox-v2-baseline.md`
- `docs/product/inbox-v2-direct-messenger-matrix.md`
- `docs/product/inbox-v2-direct-messenger-cells.csv`
- `docs/product/inbox-v2-data-lifecycle-and-privacy.md`
- `docs/product/inbox-v2-migration-and-cutover.md`
- `docs/product/inbox-v2-mig-001-inventory-and-disposition.md`
- `docs/product/inbox-v2-scenarios-and-glossary.md`
- `docs/adr/0009-inbox-v2-domain-boundaries.md`
- `docs/adr/0010-inbox-v2-participants-identity-and-authorship.md`
- `docs/adr/0011-inbox-v2-external-threads-bindings-and-routing.md`
- `docs/adr/0012-inbox-v2-sequence-revisions-and-realtime-recovery.md`
- `docs/adr/0013-inbox-v2-responsibility-collaboration-and-rbac.md`
- `docs/adr/0014-inbox-v1-to-v2-migration-cutover.md`
- `docs/adr/0015-inbox-v2-data-lifecycle-privacy-and-audit.md`

## Цель

Hulee - новая модульная платформа коммуникаций, клиентского сервиса и внутренних обращений для компаний. Продукт должен изначально поддерживать две поставки:

- SaaS / online: компании регистрируются, покупают подписку и работают на домене/инфраструктуре Hulee.
- On-prem / private deployment: продукт устанавливается на инфраструктуру компании и может расширяться company-слоем без форка core.

## Ключевые правила

- SaaS и on-prem используют один core.
- Company-specific логика не должна размазываться по core.
- Интеграции реализуются через modules/adapters с явными контрактами.
- Каналы - это частный случай source integrations; не моделируй маркетплейсы, телефонию, отзывы, формы и CRM как messenger-only channels.
- Core владеет бизнес-сущностями: tenants, employees, clients, conversations, messages, files, events, permissions, audit.
- Внешние системы подключаются через стабильные provider-интерфейсы.
- Все важные действия порождают события.
- Публичные API, webhooks, module API и event contracts версионируются.
- Tenant boundary обязателен во всех таблицах, API, очередях, событиях и файловом хранилище.
- UI строится на дизайн-токенах, поддерживает light/dark/company themes и i18n.
- Branding/white-label реализуется через brand profiles, assets и design token overrides, а не через форк UI/core.
- Тарифы/лимиты проверяются через entitlement/usage policy, а не через ad hoc plan checks в бизнес-логике.
- Control-plane не владеет customer data; data-plane должен обрабатывать сообщения без постоянной связи с SaaS control-plane.
- Provider/company-specific UI добавляется только через утвержденные UI extension slots.
- Web, mobile и desktop клиенты являются production-клиентами одного продукта.
- Native-возможности должны идти через `packages/native-bridge`, а не напрямую из UI/core.
- `apps/mobile` и `apps/desktop` не должны зависеть от server-only Next.js поведения.
- Unit-тесты обязательны для бизнес-логики, adapters, parsers, mappers, permissions и module contracts.

## Рабочие правила для Codex

- Сначала ищи код через `rg`/`rg --files`.
- Перед изменениями читай релевантные документы из `docs/product` и `docs/adr`.
- Для ручных правок используй patch-подход, не перетирай файлы целиком без необходимости.
- Не откатывай чужие изменения.
- Не добавляй provider-specific условия в core, если можно расширить adapter contract.
- Не добавляй русские UI-строки напрямую в компоненты: используй i18n dictionaries.
- Не добавляй цвета напрямую в компоненты: используй design tokens.
- Не хардкодь название продукта, логотипы или brand assets в UI: используй brand profile/app-shell.
- Любая новая бизнес-логика должна иметь unit-тесты.
- Любая новая интеграция должна иметь contract tests и диагностируемые ошибки.
