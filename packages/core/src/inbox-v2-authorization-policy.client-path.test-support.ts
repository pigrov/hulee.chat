import {
  inboxV2EntityKeySchema,
  type InboxV2EntityKey
} from "@hulee/contracts";

import type { InboxV2PolicyGuardEvidence } from "./inbox-v2-authorization-policy";

type ClientGuard = Extract<
  InboxV2PolicyGuardEvidence,
  { profileId: "core:rbac.guard.client_context" }
>;

type PathEvidence<TPath extends ClientGuard["accessPath"]> = Extract<
  ClientGuard,
  { accessPath: TPath }
>["pathEvidence"];

type CommonInput = Readonly<{
  targetResource: InboxV2EntityKey;
  clientResource: InboxV2EntityKey;
  suffix: string;
  revision?: string;
}>;

export function exactClientBindingPathEvidence(
  input: CommonInput & Readonly<{ authorityResource: InboxV2EntityKey }>
): PathEvidence<"exact_client_binding"> {
  const manifestResource = derivedResource(
    input.targetResource,
    "core:client-access-path-manifest",
    `client_access_path_manifest:${input.suffix}`
  );
  const bindingResource = derivedResource(
    input.targetResource,
    "core:client-access-binding",
    `client_access_binding:${input.suffix}`
  );
  const resources = uniqueResources([
    manifestResource,
    input.targetResource,
    input.clientResource,
    bindingResource,
    input.authorityResource
  ]);
  return {
    kind: "exact_client_binding",
    manifestResource,
    manifestTargetResource: input.targetResource,
    manifestRevisionChecks: checks(resources, input.revision),
    pathRevisionChecks: checks(resources, input.revision),
    clientResource: input.clientResource,
    bindingResource,
    bindingClientResource: input.clientResource,
    authorityResource: input.authorityResource,
    bindingAuthorityResource: input.authorityResource,
    state: "active"
  };
}

export function activeConversationLinkPathEvidence(
  input: CommonInput & Readonly<{ conversationResource: InboxV2EntityKey }>
): PathEvidence<"active_conversation_link"> {
  const manifestResource = derivedResource(
    input.targetResource,
    "core:client-access-path-manifest",
    `client_access_path_manifest:${input.suffix}`
  );
  const linkResource = derivedResource(
    input.targetResource,
    "core:conversation-client-link",
    `conversation_client_link:${input.suffix}`
  );
  const resources = uniqueResources([
    manifestResource,
    input.targetResource,
    input.clientResource,
    input.conversationResource,
    linkResource
  ]);
  return {
    kind: "active_conversation_link",
    manifestResource,
    manifestTargetResource: input.targetResource,
    manifestRevisionChecks: checks(resources, input.revision),
    pathRevisionChecks: checks(resources, input.revision),
    clientResource: input.clientResource,
    conversationResource: input.conversationResource,
    linkResource,
    linkClientResource: input.clientResource,
    linkConversationResource: input.conversationResource,
    state: "active"
  };
}

export function currentWorkItemQueuePathEvidence(
  input: CommonInput &
    Readonly<{
      conversationResource: InboxV2EntityKey;
      workItemResource: InboxV2EntityKey;
      queueResource: InboxV2EntityKey;
    }>
): PathEvidence<"current_work_item_queue"> {
  const common = workPathResources(input);
  const queueRelationResource = derivedResource(
    input.targetResource,
    "core:work-item-queue-relation",
    `work_item_queue_relation:${input.suffix}`
  );
  const resources = uniqueResources([
    ...common.resources,
    input.queueResource,
    queueRelationResource
  ]);
  return {
    kind: "current_work_item_queue",
    manifestResource: common.manifestResource,
    manifestTargetResource: input.targetResource,
    manifestRevisionChecks: checks(resources, input.revision),
    pathRevisionChecks: checks(resources, input.revision),
    clientResource: input.clientResource,
    conversationResource: input.conversationResource,
    linkResource: common.linkResource,
    linkClientResource: input.clientResource,
    linkConversationResource: input.conversationResource,
    workHeadResource: common.workHeadResource,
    workHeadConversationResource: input.conversationResource,
    workHeadWorkItemResource: input.workItemResource,
    workItemResource: input.workItemResource,
    workConversationRelationResource: common.workConversationRelationResource,
    relationWorkItemResource: input.workItemResource,
    relationConversationResource: input.conversationResource,
    workState: "in_progress",
    state: "active",
    queueResource: input.queueResource,
    queueRelationResource,
    queueRelationWorkItemResource: input.workItemResource,
    relationQueueResource: input.queueResource
  };
}

export function currentResponsiblePathEvidence(
  input: CommonInput &
    Readonly<{
      conversationResource: InboxV2EntityKey;
      workItemResource: InboxV2EntityKey;
      responsibleEmployeeResource: InboxV2EntityKey;
    }>
): PathEvidence<"current_responsible"> {
  const common = workPathResources(input);
  const responsibilityRelationResource = derivedResource(
    input.targetResource,
    "core:work-item-primary-responsibility",
    `work_item_primary_responsibility:${input.suffix}`
  );
  const resources = uniqueResources([
    ...common.resources,
    input.responsibleEmployeeResource,
    responsibilityRelationResource
  ]);
  return {
    kind: "current_responsible",
    manifestResource: common.manifestResource,
    manifestTargetResource: input.targetResource,
    manifestRevisionChecks: checks(resources, input.revision),
    pathRevisionChecks: checks(resources, input.revision),
    clientResource: input.clientResource,
    conversationResource: input.conversationResource,
    linkResource: common.linkResource,
    linkClientResource: input.clientResource,
    linkConversationResource: input.conversationResource,
    workHeadResource: common.workHeadResource,
    workHeadConversationResource: input.conversationResource,
    workHeadWorkItemResource: input.workItemResource,
    workItemResource: input.workItemResource,
    workConversationRelationResource: common.workConversationRelationResource,
    relationWorkItemResource: input.workItemResource,
    relationConversationResource: input.conversationResource,
    workState: "in_progress",
    state: "active",
    responsibleEmployeeResource: input.responsibleEmployeeResource,
    responsibilityRelationResource,
    responsibilityRelationWorkItemResource: input.workItemResource,
    relationResponsibleEmployeeResource: input.responsibleEmployeeResource
  };
}

export function clientOwnerPathEvidence(
  input: CommonInput & Readonly<{ ownerEmployeeResource: InboxV2EntityKey }>
): PathEvidence<"client_owner"> {
  const manifestResource = derivedResource(
    input.targetResource,
    "core:client-access-path-manifest",
    `client_access_path_manifest:${input.suffix}`
  );
  const ownershipRelationResource = derivedResource(
    input.targetResource,
    "core:client-owner-relation",
    `client_owner_relation:${input.suffix}`
  );
  const resources = uniqueResources([
    manifestResource,
    input.targetResource,
    input.clientResource,
    input.ownerEmployeeResource,
    ownershipRelationResource
  ]);
  return {
    kind: "client_owner",
    manifestResource,
    manifestTargetResource: input.targetResource,
    manifestRevisionChecks: checks(resources, input.revision),
    pathRevisionChecks: checks(resources, input.revision),
    clientResource: input.clientResource,
    ownerEmployeeResource: input.ownerEmployeeResource,
    ownershipRelationResource,
    relationClientResource: input.clientResource,
    relationOwnerEmployeeResource: input.ownerEmployeeResource,
    state: "active"
  };
}

function workPathResources(
  input: CommonInput &
    Readonly<{
      conversationResource: InboxV2EntityKey;
      workItemResource: InboxV2EntityKey;
    }>
) {
  const manifestResource = derivedResource(
    input.targetResource,
    "core:client-access-path-manifest",
    `client_access_path_manifest:${input.suffix}`
  );
  const linkResource = derivedResource(
    input.targetResource,
    "core:conversation-client-link",
    `conversation_client_link:${input.suffix}`
  );
  const workHeadResource = derivedResource(
    input.targetResource,
    "core:conversation-work-head",
    `conversation_work_head:${input.suffix}`
  );
  const workConversationRelationResource = derivedResource(
    input.targetResource,
    "core:work-item-conversation-relation",
    `work_item_conversation_relation:${input.suffix}`
  );
  return {
    manifestResource,
    linkResource,
    workHeadResource,
    workConversationRelationResource,
    resources: uniqueResources([
      manifestResource,
      input.targetResource,
      input.clientResource,
      input.conversationResource,
      linkResource,
      workHeadResource,
      input.workItemResource,
      workConversationRelationResource
    ])
  };
}

function checks(resources: readonly InboxV2EntityKey[], revision = "1") {
  return resources.map((resource) => ({
    resource,
    expected: revision,
    actual: revision
  }));
}

function uniqueResources(
  resources: readonly InboxV2EntityKey[]
): readonly InboxV2EntityKey[] {
  return [
    ...new Map(
      resources.map((resource) => [
        `${resource.tenantId}\u0000${resource.entityTypeId}\u0000${resource.entityId}`,
        resource
      ])
    ).values()
  ];
}

function derivedResource(
  anchor: InboxV2EntityKey,
  entityTypeId: string,
  entityId: string
): InboxV2EntityKey {
  return inboxV2EntityKeySchema.parse({
    tenantId: anchor.tenantId,
    entityTypeId,
    entityId
  });
}
