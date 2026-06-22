import type { BrandProfile } from "@hulee/branding";
import type {
  ClientId,
  ConversationId,
  EmployeeId,
  EventEnvelope,
  MessageId,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import { evaluateEntitlement, type LicenseSnapshot } from "@hulee/entitlements";

import { createDomainEvent, type TenantScope } from "./domain-events";
import { CoreError } from "./errors";
import { createSequentialIdFactory, type IdFactory } from "./ids";
import { assertEmployeeCan, type Employee } from "./permissions";

export type Tenant = TenantScope & {
  id: TenantId;
  slug: string;
  displayName: string;
  locale: string;
  timezone: string;
  createdAt: string;
  enabledModules: readonly string[];
  moduleConfigs?: ModuleConfigMap;
};

export type Client = TenantScope & {
  id: ClientId;
  displayName: string;
  source: ClientSource;
  createdAt: string;
};

export type ClientSource = "public_api" | "external_channel" | "manual";

export type ClientContactType = "phone" | "email" | "external_handle";

export type ClientContact = TenantScope & {
  id: string;
  clientId: ClientId;
  type: ClientContactType;
  value: string;
  createdAt: string;
};

export type ConversationType =
  | "client_direct"
  | "client_group"
  | "internal_direct"
  | "internal_group"
  | "support_case"
  | "intake";

export type Conversation = TenantScope & {
  id: ConversationId;
  type: ConversationType;
  clientId: ClientId;
  participantEmployeeIds: readonly EmployeeId[];
  createdAt: string;
};

export type MessageDirection = "inbound" | "outbound";

export type Message = TenantScope & {
  id: MessageId;
  conversationId: ConversationId;
  direction: MessageDirection;
  text?: string;
  status: MessageStatus;
  idempotencyKey: string;
  createdAt: string;
};

export type MessageStatus = "received" | "queued" | "sent" | "failed";

export type MvpTenantWorkspace = {
  tenant: Tenant;
  brandProfile: BrandProfile;
  license: LicenseSnapshot;
  admin: Employee;
  client: Client;
  conversation: Conversation;
  inboundMessage: Message;
  events: readonly PlatformEvent[];
};

export type CreateMvpTenantWorkspaceInput = {
  now: string;
  tenantSlug: string;
  tenantDisplayName: string;
  productName: string;
  adminEmail: string;
  clientDisplayName: string;
  inboundText: string;
  enabledModules?: readonly string[];
  moduleConfigs?: ModuleConfigMap;
  idFactory?: IdFactory;
};

export type ModuleConfigMap = Readonly<Record<string, unknown>>;

export type SendConversationReplyInput = {
  now: string;
  idFactory: IdFactory;
  license: LicenseSnapshot;
  actor: Employee;
  conversation: Conversation;
  text: string;
  channelModuleId?: string;
};

export type SendConversationReplyResult = {
  message: Message;
  events: readonly EventEnvelope<"message.sent", { messageId: MessageId }>[];
};

export type ExternalClientContactInput = {
  type: ClientContactType;
  value: string;
};

export type RegisterExternalClientInput = {
  now: string;
  tenantId: TenantId;
  idFactory: IdFactory;
  channelExternalId: string;
  clientExternalId: string;
  displayName: string;
  source: ClientSource;
  contacts?: readonly ExternalClientContactInput[];
};

export type RegisterExternalClientResult = {
  client: Client;
  contacts: readonly ClientContact[];
  events: readonly EventEnvelope<"client.created", { clientId: ClientId }>[];
};

export type IngestExternalIncomingMessageInput = {
  now: string;
  idFactory: IdFactory;
  tenantId: TenantId;
  channelExternalId: string;
  clientExternalId: string;
  providerMessageId: string;
  occurredAt: string;
  idempotencyKey: string;
  text?: string;
  existingClient?: Client;
  existingConversation?: Conversation;
  clientDisplayName?: string;
  clientSource?: ClientSource;
};

export type IngestExternalIncomingMessageResult = {
  client: Client;
  externalContact?: ClientContact;
  conversation: Conversation;
  message: Message;
  events: readonly PlatformEvent[];
  createdClient: boolean;
  createdConversation: boolean;
};

export type QueueExternalOutboundMessageInput = {
  now: string;
  idFactory: IdFactory;
  tenantId: TenantId;
  conversation: Conversation;
  text?: string;
  idempotencyKey: string;
};

export type QueueExternalOutboundMessageResult = {
  message: Message;
  events: readonly EventEnvelope<"message.sent", { messageId: MessageId }>[];
};

const defaultEnabledModules = [
  "auth-local",
  "channel-public-api",
  "channel-telegram",
  "storage-s3",
  "license-basic"
] as const;

export function createMvpTenantWorkspace(
  input: CreateMvpTenantWorkspaceInput
): MvpTenantWorkspace {
  const ids = input.idFactory ?? createSequentialIdFactory(input.tenantSlug);
  const enabledModules = input.enabledModules ?? defaultEnabledModules;
  const tenantId = ids.tenantId();
  const tenant: Tenant = {
    id: tenantId,
    tenantId,
    slug: input.tenantSlug,
    displayName: input.tenantDisplayName,
    locale: "ru",
    timezone: "Europe/Moscow",
    createdAt: input.now,
    enabledModules,
    moduleConfigs: input.moduleConfigs
  };
  const brandProfile = createTenantBrandProfile({
    tenant,
    productName: input.productName,
    id: ids.stringId("brand")
  });
  const license = createLocalLicenseSnapshot({
    tenant,
    enabledModules,
    id: ids.stringId("license"),
    now: input.now
  });

  assertModuleAvailable({
    license,
    now: input.now,
    moduleId: "channel-public-api"
  });

  const admin: Employee = {
    id: ids.employeeId(),
    tenantId,
    email: input.adminEmail,
    displayName: input.adminEmail,
    roles: ["tenant_admin"],
    createdAt: input.now
  };
  const client: Client = {
    id: ids.clientId(),
    tenantId,
    displayName: input.clientDisplayName,
    source: "public_api",
    createdAt: input.now
  };
  const conversation: Conversation = {
    id: ids.conversationId(),
    tenantId,
    type: "client_direct",
    clientId: client.id,
    participantEmployeeIds: [admin.id],
    createdAt: input.now
  };
  const inboundMessage: Message = {
    id: ids.messageId(),
    tenantId,
    conversationId: conversation.id,
    direction: "inbound",
    text: input.inboundText,
    status: "received",
    idempotencyKey: `public-api:${client.id}:${input.now}`,
    createdAt: input.now
  };
  const events: PlatformEvent[] = [
    createDomainEvent({
      id: ids.eventId("tenant.created"),
      type: "tenant.created",
      tenantId,
      occurredAt: input.now,
      payload: { tenantId }
    }),
    createDomainEvent({
      id: ids.eventId("employee.created"),
      type: "employee.created",
      tenantId,
      occurredAt: input.now,
      payload: { employeeId: admin.id }
    }),
    createDomainEvent({
      id: ids.eventId("client.created"),
      type: "client.created",
      tenantId,
      occurredAt: input.now,
      payload: { clientId: client.id }
    }),
    createDomainEvent({
      id: ids.eventId("conversation.created"),
      type: "conversation.created",
      tenantId,
      occurredAt: input.now,
      payload: { conversationId: conversation.id }
    }),
    createDomainEvent({
      id: ids.eventId("message.received"),
      type: "message.received",
      tenantId,
      occurredAt: input.now,
      idempotencyKey: inboundMessage.idempotencyKey,
      payload: { messageId: inboundMessage.id }
    })
  ];

  return {
    tenant,
    brandProfile,
    license,
    admin,
    client,
    conversation,
    inboundMessage,
    events
  };
}

export function sendConversationReply(
  input: SendConversationReplyInput
): SendConversationReplyResult {
  assertEmployeeCan(input.actor, "message.reply");
  assertSameTenant(input.actor, input.conversation);
  assertModuleAvailable({
    license: input.license,
    now: input.now,
    moduleId: input.channelModuleId ?? "channel-public-api"
  });

  const message: Message = {
    id: input.idFactory.messageId(),
    tenantId: input.conversation.tenantId,
    conversationId: input.conversation.id,
    direction: "outbound",
    text: input.text,
    status: "queued",
    idempotencyKey: `reply:${input.conversation.id}:${input.now}`,
    createdAt: input.now
  };

  return {
    message,
    events: [
      createDomainEvent({
        id: input.idFactory.eventId("message.sent"),
        type: "message.sent",
        tenantId: input.conversation.tenantId,
        occurredAt: input.now,
        idempotencyKey: message.idempotencyKey,
        payload: { messageId: message.id }
      })
    ]
  };
}

export function registerExternalClient(
  input: RegisterExternalClientInput
): RegisterExternalClientResult {
  const client: Client = {
    id: input.idFactory.clientId(),
    tenantId: input.tenantId,
    displayName: input.displayName,
    source: input.source,
    createdAt: input.now
  };
  const externalHandle = createExternalHandleContact({
    id: input.idFactory.stringId("client_contact"),
    tenantId: input.tenantId,
    clientId: client.id,
    channelExternalId: input.channelExternalId,
    clientExternalId: input.clientExternalId,
    createdAt: input.now
  });
  const extraContacts = (input.contacts ?? []).map((contact) => {
    return createClientContact({
      id: input.idFactory.stringId("client_contact"),
      tenantId: input.tenantId,
      clientId: client.id,
      type: contact.type,
      value: contact.value,
      createdAt: input.now
    });
  });

  return {
    client,
    contacts: [externalHandle, ...extraContacts],
    events: [
      createDomainEvent({
        id: input.idFactory.eventId("client.created"),
        type: "client.created",
        tenantId: input.tenantId,
        occurredAt: input.now,
        payload: { clientId: client.id }
      })
    ]
  };
}

export function ingestExternalIncomingMessage(
  input: IngestExternalIncomingMessageInput
): IngestExternalIncomingMessageResult {
  assertTenantId(input.tenantId, input.existingClient);
  assertTenantId(input.tenantId, input.existingConversation);

  const createdClient = input.existingClient === undefined;
  const client =
    input.existingClient ??
    createExternalClient({
      now: input.now,
      tenantId: input.tenantId,
      idFactory: input.idFactory,
      clientExternalId: input.clientExternalId,
      displayName: input.clientDisplayName ?? input.clientExternalId,
      source: input.clientSource ?? "external_channel"
    });
  const externalContact = createdClient
    ? createExternalHandleContact({
        id: input.idFactory.stringId("client_contact"),
        tenantId: input.tenantId,
        clientId: client.id,
        channelExternalId: input.channelExternalId,
        clientExternalId: input.clientExternalId,
        createdAt: input.now
      })
    : undefined;
  const createdConversation = input.existingConversation === undefined;
  const conversation =
    input.existingConversation ??
    createClientDirectConversation({
      now: input.now,
      tenantId: input.tenantId,
      idFactory: input.idFactory,
      clientId: client.id
    });
  const message: Message = {
    id: input.idFactory.messageId(),
    tenantId: input.tenantId,
    conversationId: conversation.id,
    direction: "inbound",
    text: input.text,
    status: "received",
    idempotencyKey: input.idempotencyKey,
    createdAt: input.occurredAt
  };
  const events: PlatformEvent[] = [];

  if (createdClient) {
    events.push(
      createDomainEvent({
        id: input.idFactory.eventId("client.created"),
        type: "client.created",
        tenantId: input.tenantId,
        occurredAt: input.now,
        payload: { clientId: client.id }
      })
    );
  }

  if (createdConversation) {
    events.push(
      createDomainEvent({
        id: input.idFactory.eventId("conversation.created"),
        type: "conversation.created",
        tenantId: input.tenantId,
        occurredAt: input.now,
        payload: { conversationId: conversation.id }
      })
    );
  }

  events.push(
    createDomainEvent({
      id: input.idFactory.eventId("message.received"),
      type: "message.received",
      tenantId: input.tenantId,
      occurredAt: input.now,
      idempotencyKey: input.idempotencyKey,
      payload: { messageId: message.id }
    })
  );

  return {
    client,
    externalContact,
    conversation,
    message,
    events,
    createdClient,
    createdConversation
  };
}

export function queueExternalOutboundMessage(
  input: QueueExternalOutboundMessageInput
): QueueExternalOutboundMessageResult {
  assertTenantId(input.tenantId, input.conversation);

  const message: Message = {
    id: input.idFactory.messageId(),
    tenantId: input.tenantId,
    conversationId: input.conversation.id,
    direction: "outbound",
    text: input.text,
    status: "queued",
    idempotencyKey: input.idempotencyKey,
    createdAt: input.now
  };

  return {
    message,
    events: [
      createDomainEvent({
        id: input.idFactory.eventId("message.sent"),
        type: "message.sent",
        tenantId: input.tenantId,
        occurredAt: input.now,
        idempotencyKey: message.idempotencyKey,
        payload: { messageId: message.id }
      })
    ]
  };
}

export function buildExternalClientHandle(input: {
  channelExternalId: string;
  clientExternalId: string;
}): string {
  return `channel:${input.channelExternalId}:client:${input.clientExternalId}`;
}

function createExternalClient(input: {
  now: string;
  tenantId: TenantId;
  idFactory: IdFactory;
  clientExternalId: string;
  displayName: string;
  source: ClientSource;
}): Client {
  return {
    id: input.idFactory.clientId(),
    tenantId: input.tenantId,
    displayName: input.displayName,
    source: input.source,
    createdAt: input.now
  };
}

function createClientDirectConversation(input: {
  now: string;
  tenantId: TenantId;
  idFactory: IdFactory;
  clientId: ClientId;
}): Conversation {
  return {
    id: input.idFactory.conversationId(),
    tenantId: input.tenantId,
    type: "client_direct",
    clientId: input.clientId,
    participantEmployeeIds: [],
    createdAt: input.now
  };
}

function createExternalHandleContact(input: {
  id: string;
  tenantId: TenantId;
  clientId: ClientId;
  channelExternalId: string;
  clientExternalId: string;
  createdAt: string;
}): ClientContact {
  return createClientContact({
    id: input.id,
    tenantId: input.tenantId,
    clientId: input.clientId,
    type: "external_handle",
    value: buildExternalClientHandle({
      channelExternalId: input.channelExternalId,
      clientExternalId: input.clientExternalId
    }),
    createdAt: input.createdAt
  });
}

function createClientContact(input: ClientContact): ClientContact {
  return input;
}

function createTenantBrandProfile(input: {
  tenant: Tenant;
  productName: string;
  id: string;
}): BrandProfile {
  return {
    id: input.id,
    scope: "tenant",
    tenantId: input.tenant.id,
    productName: input.productName,
    shortProductName: input.productName,
    assets: {},
    themeTokens: {}
  };
}

function createLocalLicenseSnapshot(input: {
  tenant: Tenant;
  enabledModules: readonly string[];
  id: string;
  now: string;
}): LicenseSnapshot {
  return {
    licenseId: input.id,
    customerId: input.tenant.id,
    deploymentId: "local-data-plane",
    validFrom: input.now,
    issuer: "local-seed",
    entitlements: input.enabledModules.map((moduleId) => {
      return {
        key: "module.enabled",
        value: moduleId,
        enabled: true
      };
    })
  };
}

function assertModuleAvailable(input: {
  license: LicenseSnapshot;
  now: string;
  moduleId: string;
}): void {
  const decision = evaluateEntitlement(
    {
      license: input.license,
      now: new Date(input.now)
    },
    "module.enabled",
    input.moduleId
  );

  if (decision.allowed) {
    return;
  }

  if (decision.code === "license.inactive") {
    throw new CoreError("license.inactive");
  }

  throw new CoreError("module.disabled");
}

function assertSameTenant(left: TenantScope, right: TenantScope): void {
  if (left.tenantId !== right.tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }
}

function assertTenantId(
  tenantId: TenantId,
  entity: TenantScope | undefined
): void {
  if (entity === undefined) {
    return;
  }

  if (entity.tenantId !== tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }
}
