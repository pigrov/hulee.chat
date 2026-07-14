# Modules And Integrations

## Module Types

- `auth`
- `channel`
- `source`
- `telephony`
- `crm`
- `ai`
- `marketing`
- `analytics`
- `storage`
- `notification`
- `workflow`
- `billing`
- `company`

## Module Manifest

Every module declares whether it can persist, derive, export or transmit tenant/
customer data. `dataGovernance` may be absent only for a module that declares
`dataHandling: "none"` and whose schemas, jobs and routes pass that validation.

```ts
type ModuleManifestBase = {
  id: string;
  type: string;
  name: string;
  version: string;
  capabilities: string[];
  configSchema: unknown;
  secretsSchema?: unknown;
  permissions?: string[];
  events?: string[];
  webhooks?: string[];
  jobs?: string[];
  uiSlots?: UiSlotContribution[];
  healthChecks?: string[];
};

type ModuleDataClassDeclaration = {
  id: `module:${string}:${string}`;
  parentCoreClass: `core:${string}`;
  storageRootIds: Array<`module:${string}:${string}`>;
  sensitivity: DataSensitivity;
  allowedPurposes: ProcessingPurpose[];
  parentBehavior: "independent" | "inherits_all_live_parents";
  subjectLinkBehavior: SubjectLinkBehavior;
  exportProjectionRef: string;
  exportHandlerRef: string;
  deleteHandlerRef: string;
  verificationHandlerRef: string;
};

type ModuleExternalDataRoute = {
  id: string;
  dataClassIds: DataClass[];
  purpose: ProcessingPurpose;
  recipientCategory: string;
  regionProfileRef: string;
  deleteCapabilityRef: string;
};

type ModuleDataGovernanceContribution = {
  schemaVersion: number;
  dataClasses: ModuleDataClassDeclaration[];
  externalRoutes: ModuleExternalDataRoute[];
  migrationAndUninstallHandlerRef: string;
};

type ModuleManifest = ModuleManifestBase &
  (
    | { dataHandling: "none"; dataGovernance?: never }
    | {
        dataHandling: "tenant_or_customer_data";
        dataGovernance: ModuleDataGovernanceContribution;
      }
  );
```

## Adapter Contracts

Core should depend on provider interfaces, not providers.

Any module that stores, derives, exports or sends tenant/customer data declares
the complete typed ADR 0015 contribution above. Activation fails closed when a
storage root, parent/sensitivity/purpose, subject/export behavior, external route
or delete/verification handler is unknown or incompatible. Module disable/
uninstall does not orphan data or bypass retention/legal hold; the core registry
must retain a compatible migration/lifecycle handler or block removal with a
diagnostic.

Manifest validation also proves that every `module:*` class/root ID is namespaced
to the declaring manifest ID and that every `core:*` parent exists in the pinned
core catalog version.

Examples:

- `AuthProvider`
- `SourceAdapter`
- `ChannelAdapter`
- `TelephonyProvider`
- `CrmProvider`
- `AiProvider`
- `StorageProvider`
- `NotificationProvider`

`ChannelAdapter` is the communication-channel specialization of the broader
source integration model. Marketplaces, classifieds, reviews, forms, email,
telephony, CRM and public API integrations should be modeled as source
connections and source accounts before they materialize conversations, messages,
calls, leads or reviews.

## SourceAdapter Responsibilities

- Accept webhook, polling, email, SDK, import or public API input.
- Persist or request persistence of the immutable safe occurrence envelope
  before normalization; separately submit only the classified, secret-stripped
  provider payload/evidence accepted by the pre-persistence sanitizer.
- Normalize events into versioned source events.
- Declare versioned account/thread/message identity realms, scope and
  canonicalization; provider-wide scope requires authoritative evidence.
- Expose source and account capabilities.
- Produce bounded secret-free opaque route descriptors for exact bindings.
- Provide idempotency keys and provider timestamps.
- Declare send retry safety before provider I/O and support exact outcome
  reconciliation without choosing another route.
- Map provider errors to the platform error catalog.
- Expose health checks, diagnostics and replay-safe processing hints.

## ChannelAdapter Responsibilities

- Normalize incoming messages.
- Normalize incoming attachments.
- Send outgoing messages.
- Send outgoing attachments.
- Map provider delivery statuses.
- Map provider errors to the platform error catalog.
- Expose health checks and diagnostics.

## TelephonyProvider Responsibilities

- Normalize call events.
- Resolve recordings.
- Normalize missed/cancelled/completed states.
- Map employee extension data.
- Map provider errors.
- Expose health checks and diagnostics.

## AuthProvider Responsibilities

- Start login flow.
- Validate callback/assertion.
- Resolve external identity.
- Map external profile to employee.
- Support account linking.
- Expose tenant-level configuration.

## UI Slots

Modules can extend UI only through approved slots:

- `tenant.settings.section`: company/tenant settings sections;
- `integration.settings.section`: integration settings sections;
- `client.profile.card`: blocks inside a client profile/card;
- `conversation.composer.tool`: actions/tools inside the message composer;
- `conversation.message.action`: actions on a message bubble;
- `inbox.sidebar.section`: sections inside the inbox sidebar;
- `admin.section`: admin page sections or module admin entrypoints;
- `reports.section`: report widgets, filters or module report pages;
- `support.case.panel`: blocks inside support case panels.

This keeps company and provider-specific UI from spreading through core screens.

Slot contributions should be declared with a stable contract:

```ts
type UiSlotId =
  | "tenant.settings.section"
  | "integration.settings.section"
  | "client.profile.card"
  | "conversation.composer.tool"
  | "conversation.message.action"
  | "inbox.sidebar.section"
  | "admin.section"
  | "reports.section"
  | "support.case.panel";

type UiClientKind = "web" | "mobile" | "desktop";

type UiSlotContribution = {
  id: string;
  slot: UiSlotId;
  componentRef: string;
  titleKey?: string;
  requiredPermissions?: string[];
  supportedClients?: UiClientKind[];
  order?: number;
};
```

`componentRef` is resolved by the app composition root or module UI registry. Core and contracts know the reference and metadata, not React components or provider-specific UI.

## UI Slot Rules

- Slots are versioned public module API and should not be renamed casually.
- A module can render only in slots declared by its manifest and enabled for the tenant.
- Slot rendering receives scoped context only: tenant, current employee, locale, theme, permissions and the relevant entity id.
- Slot components must use shared UI primitives, i18n dictionaries and design tokens.
- Slot components must call versioned API/module actions instead of importing core repositories or provider clients directly.
- Slot visibility must be guarded by tenant module state, license flags and permissions.
- Web, mobile and desktop can choose different supported slot subsets, but unsupported clients must fail gracefully.
- Contract tests should verify that a module declares valid slot ids, required permissions and supported clients.
