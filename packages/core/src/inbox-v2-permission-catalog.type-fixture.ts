import type {
  InboxV2CatalogId,
  InboxV2ClientId,
  InboxV2ConversationId,
  InboxV2OrgUnitId,
  InboxV2TenantId
} from "@hulee/contracts";

import type { InboxV2PermissionScope } from "./inbox-v2-permission-catalog";

declare const tenantId: InboxV2TenantId;
declare const clientId: InboxV2ClientId;
declare const conversationId: InboxV2ConversationId;
declare const orgUnitId: InboxV2OrgUnitId;
declare const permissionCatalogId: InboxV2CatalogId<"inbox-v2-permission">;
declare const scopeCatalogId: InboxV2CatalogId<"inbox-v2-permission-scope">;

const _tenantScope: InboxV2PermissionScope = {
  type: "tenant",
  tenantId
};
const _conversationScope: InboxV2PermissionScope = {
  type: "conversation",
  tenantId,
  id: conversationId
};
const _orgSubtreeScope: InboxV2PermissionScope = {
  type: "org_unit",
  tenantId,
  id: orgUnitId,
  mode: "subtree"
};
const _permissionCatalogId: InboxV2CatalogId<"inbox-v2-permission"> =
  permissionCatalogId;

// @ts-expect-error Catalog ID brands cannot substitute across catalogs.
const _scopeIdAsPermissionId: InboxV2CatalogId<"inbox-v2-permission"> =
  scopeCatalogId;

const _clientAsConversationScope: InboxV2PermissionScope = {
  type: "conversation",
  tenantId,
  // @ts-expect-error Client IDs cannot substitute for exact Conversation IDs.
  id: clientId
};

// @ts-expect-error Org-unit hierarchy mode is mandatory and explicit.
const _orgScopeWithoutMode: InboxV2PermissionScope = {
  type: "org_unit",
  tenantId,
  id: orgUnitId
};

const _assignedScope: InboxV2PermissionScope = {
  // @ts-expect-error V1 assigned is not an Inbox V2 relation scope.
  type: "assigned",
  tenantId
};

const _providerMemberScope: InboxV2PermissionScope = {
  // @ts-expect-error Provider roster membership is evidence, not a V2 scope.
  type: "provider_member",
  tenantId
};

void [
  _tenantScope,
  _conversationScope,
  _orgSubtreeScope,
  _permissionCatalogId,
  _scopeIdAsPermissionId,
  _clientAsConversationScope,
  _orgScopeWithoutMode,
  _assignedScope,
  _providerMemberScope
];
