import { z } from "zod";

import type { Brand } from "../brand";
import {
  inboxV2ConversationClientLinkPolicyIdSchema,
  type InboxV2ConversationClientLinkPolicyId
} from "./conversation-client-link";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2EmployeeReferenceSchema,
  inboxV2TenantIdSchema,
  type InboxV2EmployeeReference
} from "./ids";
import {
  inboxV2IdentityClaimPolicyIdSchema,
  inboxV2TrustedServiceIdSchema,
  type InboxV2IdentityClaimPolicyId,
  type InboxV2TrustedServiceId
} from "./participant-identity";
import { inboxV2SchemaVersionTokenSchema } from "./schema-version";

export const INBOX_V2_TENANT_POLICY_AUTHORITY_CONTRACT_VERSION = "v1" as const;

export const inboxV2TenantPolicyFamilySchema = z.enum([
  "source_identity_claim",
  "conversation_client_link"
]);

export type InboxV2TenantPolicyFamily = z.infer<
  typeof inboxV2TenantPolicyFamilySchema
>;

export type InboxV2PolicyDefinitionDigestSha256 = Brand<
  string,
  "InboxV2PolicyDefinitionDigestSha256"
>;

export const inboxV2PolicyDefinitionDigestSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .transform((value) => value as InboxV2PolicyDefinitionDigestSha256);

const sourceIdentityClaimPolicyKeyShape = {
  family: z.literal("source_identity_claim"),
  policyId: inboxV2IdentityClaimPolicyIdSchema
} as const;

const conversationClientLinkPolicyKeyShape = {
  family: z.literal("conversation_client_link"),
  policyId: inboxV2ConversationClientLinkPolicyIdSchema
} as const;

export const inboxV2TenantPolicyAuthorityKeySchema = z.discriminatedUnion(
  "family",
  [
    z.object(sourceIdentityClaimPolicyKeyShape).strict(),
    z.object(conversationClientLinkPolicyKeyShape).strict()
  ]
);

export type InboxV2TenantPolicyAuthorityKey =
  | Readonly<{
      family: "source_identity_claim";
      policyId: InboxV2IdentityClaimPolicyId;
    }>
  | Readonly<{
      family: "conversation_client_link";
      policyId: InboxV2ConversationClientLinkPolicyId;
    }>;

const policyVersionFields = {
  policyVersion: inboxV2SchemaVersionTokenSchema,
  definitionContractVersion: inboxV2SchemaVersionTokenSchema,
  definitionDigestSha256: inboxV2PolicyDefinitionDigestSha256Schema,
  approvedTrustedServiceId: inboxV2TrustedServiceIdSchema
} as const;

function createPolicyFamilySchemas<TShape extends z.ZodRawShape>(
  shape: TShape
) {
  return [
    z.object({ ...sourceIdentityClaimPolicyKeyShape, ...shape }).strict(),
    z.object({ ...conversationClientLinkPolicyKeyShape, ...shape }).strict()
  ] as const;
}

export const inboxV2TenantPolicyVersionAuthoritySchema = z
  .discriminatedUnion(
    "family",
    createPolicyFamilySchemas({
      tenantId: inboxV2TenantIdSchema,
      ...policyVersionFields,
      approvedBy: inboxV2EmployeeReferenceSchema,
      approvedAt: inboxV2TimestampSchema,
      revision: inboxV2EntityRevisionSchema,
      createdAt: inboxV2TimestampSchema,
      updatedAt: inboxV2TimestampSchema
    })
  )
  .superRefine((authority, context) => {
    addEmployeeTenantIssue(context, authority.tenantId, authority.approvedBy, [
      "approvedBy"
    ]);
    if (String(authority.revision) !== "1") {
      addIssue(
        context,
        ["revision"],
        "Policy versions are immutable revision-1 facts."
      );
    }
    if (
      authority.createdAt !== authority.approvedAt ||
      authority.updatedAt !== authority.approvedAt
    ) {
      addIssue(
        context,
        ["approvedAt"],
        "Policy approval, creation and update timestamps must share one immutable boundary."
      );
    }
  });

export type InboxV2TenantPolicyVersionAuthority = z.infer<
  typeof inboxV2TenantPolicyVersionAuthoritySchema
>;

export const inboxV2ApproveTenantPolicyVersionCommandSchema = z
  .discriminatedUnion(
    "family",
    createPolicyFamilySchemas({
      tenantId: inboxV2TenantIdSchema,
      ...policyVersionFields,
      approvedBy: inboxV2EmployeeReferenceSchema,
      approvedAt: inboxV2TimestampSchema
    })
  )
  .superRefine((command, context) => {
    addEmployeeTenantIssue(context, command.tenantId, command.approvedBy, [
      "approvedBy"
    ]);
  });

export type InboxV2ApproveTenantPolicyVersionCommand = z.infer<
  typeof inboxV2ApproveTenantPolicyVersionCommandSchema
>;

export const inboxV2TenantPolicyActivationStateSchema = z.enum([
  "active",
  "revoked"
]);

export const inboxV2TenantPolicyActivationHeadSchema = z
  .discriminatedUnion(
    "family",
    createPolicyFamilySchemas({
      tenantId: inboxV2TenantIdSchema,
      ...policyVersionFields,
      state: inboxV2TenantPolicyActivationStateSchema,
      activatedBy: inboxV2EmployeeReferenceSchema,
      activatedAt: inboxV2TimestampSchema,
      revokedBy: inboxV2EmployeeReferenceSchema.nullable(),
      revokedAt: inboxV2TimestampSchema.nullable(),
      revision: inboxV2EntityRevisionSchema,
      createdAt: inboxV2TimestampSchema,
      updatedAt: inboxV2TimestampSchema
    })
  )
  .superRefine((head, context) => {
    addEmployeeTenantIssue(context, head.tenantId, head.activatedBy, [
      "activatedBy"
    ]);
    if (head.revokedBy !== null) {
      addEmployeeTenantIssue(context, head.tenantId, head.revokedBy, [
        "revokedBy"
      ]);
    }
    if (!isInboxV2TimestampOrderValid(head.createdAt, head.activatedAt)) {
      addIssue(
        context,
        ["activatedAt"],
        "Policy activation cannot precede activation-head creation."
      );
    }

    if (head.state === "active") {
      if (head.revokedAt !== null || head.revokedBy !== null) {
        addIssue(
          context,
          ["state"],
          "An active policy head cannot carry revocation metadata."
        );
      }
      if (head.updatedAt !== head.activatedAt) {
        addIssue(
          context,
          ["updatedAt"],
          "An active policy head must be updated at its activation boundary."
        );
      }
      return;
    }

    if (head.revokedAt === null || head.revokedBy === null) {
      addIssue(
        context,
        ["state"],
        "A revoked policy head requires one Employee actor and timestamp."
      );
      return;
    }
    if (!isInboxV2TimestampOrderValid(head.activatedAt, head.revokedAt)) {
      addIssue(
        context,
        ["revokedAt"],
        "Policy revocation cannot precede activation."
      );
    }
    if (head.updatedAt !== head.revokedAt) {
      addIssue(
        context,
        ["updatedAt"],
        "A revoked policy head must be updated at its revocation boundary."
      );
    }
  });

export type InboxV2TenantPolicyActivationHead = z.infer<
  typeof inboxV2TenantPolicyActivationHeadSchema
>;

export const inboxV2ActivateTenantPolicyVersionCommandSchema = z
  .discriminatedUnion(
    "family",
    createPolicyFamilySchemas({
      tenantId: inboxV2TenantIdSchema,
      policyVersion: inboxV2SchemaVersionTokenSchema,
      expectedHeadRevision: inboxV2EntityRevisionSchema.nullable(),
      activatedBy: inboxV2EmployeeReferenceSchema,
      activatedAt: inboxV2TimestampSchema
    })
  )
  .superRefine((command, context) => {
    addEmployeeTenantIssue(context, command.tenantId, command.activatedBy, [
      "activatedBy"
    ]);
  });

export type InboxV2ActivateTenantPolicyVersionCommand = z.infer<
  typeof inboxV2ActivateTenantPolicyVersionCommandSchema
>;

export const inboxV2RevokeTenantPolicyVersionCommandSchema = z
  .discriminatedUnion(
    "family",
    createPolicyFamilySchemas({
      tenantId: inboxV2TenantIdSchema,
      policyVersion: inboxV2SchemaVersionTokenSchema,
      expectedHeadRevision: inboxV2EntityRevisionSchema,
      revokedBy: inboxV2EmployeeReferenceSchema,
      revokedAt: inboxV2TimestampSchema
    })
  )
  .superRefine((command, context) => {
    addEmployeeTenantIssue(context, command.tenantId, command.revokedBy, [
      "revokedBy"
    ]);
  });

export type InboxV2RevokeTenantPolicyVersionCommand = z.infer<
  typeof inboxV2RevokeTenantPolicyVersionCommandSchema
>;

export const inboxV2TenantPolicyActivationTransitionOperationSchema = z.enum([
  "activate",
  "revoke"
]);

const policyActivationSnapshotSchema = z
  .object({
    ...policyVersionFields,
    state: inboxV2TenantPolicyActivationStateSchema
  })
  .strict();

export const inboxV2TenantPolicyActivationTransitionSchema = z
  .discriminatedUnion(
    "family",
    createPolicyFamilySchemas({
      tenantId: inboxV2TenantIdSchema,
      operation: inboxV2TenantPolicyActivationTransitionOperationSchema,
      expectedHeadRevision: inboxV2EntityRevisionSchema.nullable(),
      resultingHeadRevision: inboxV2EntityRevisionSchema,
      previous: policyActivationSnapshotSchema.nullable(),
      resulting: policyActivationSnapshotSchema,
      actor: inboxV2EmployeeReferenceSchema,
      occurredAt: inboxV2TimestampSchema,
      createdAt: inboxV2TimestampSchema
    })
  )
  .superRefine((transition, context) => {
    addEmployeeTenantIssue(context, transition.tenantId, transition.actor, [
      "actor"
    ]);
    const expectedResultingRevision =
      transition.expectedHeadRevision === null
        ? 1n
        : BigInt(transition.expectedHeadRevision) + 1n;
    if (
      BigInt(transition.resultingHeadRevision) !== expectedResultingRevision
    ) {
      addIssue(
        context,
        ["resultingHeadRevision"],
        "Policy activation transition must advance the head by exactly one revision."
      );
    }
    if (transition.createdAt !== transition.occurredAt) {
      addIssue(
        context,
        ["createdAt"],
        "Policy activation transitions are immutable at their occurrence boundary."
      );
    }

    if (transition.operation === "activate") {
      if (
        transition.resulting.state !== "active" ||
        (transition.previous !== null &&
          transition.previous.state !== "revoked")
      ) {
        addIssue(
          context,
          ["operation"],
          "Activation starts a first head or advances a revoked head to active."
        );
      }
      if (
        (transition.expectedHeadRevision === null) !==
        (transition.previous === null)
      ) {
        addIssue(
          context,
          ["previous"],
          "First activation has no previous head; reactivation must pin it exactly."
        );
      }
      return;
    }

    if (
      transition.previous === null ||
      transition.previous.state !== "active" ||
      transition.resulting.state !== "revoked"
    ) {
      addIssue(
        context,
        ["operation"],
        "Revocation must advance one active head to revoked."
      );
      return;
    }
    for (const field of [
      "policyVersion",
      "definitionContractVersion",
      "definitionDigestSha256",
      "approvedTrustedServiceId"
    ] as const) {
      if (transition.previous[field] !== transition.resulting[field]) {
        addIssue(
          context,
          ["resulting", field],
          "Revocation cannot replace the activated policy proof."
        );
      }
    }
  });

export type InboxV2TenantPolicyActivationTransition = z.infer<
  typeof inboxV2TenantPolicyActivationTransitionSchema
>;

export const inboxV2ExactActiveTenantPolicyAuthorityInputSchema =
  z.discriminatedUnion(
    "family",
    createPolicyFamilySchemas({
      tenantId: inboxV2TenantIdSchema,
      ...policyVersionFields,
      expectedHeadRevision: inboxV2EntityRevisionSchema.nullable(),
      occurredAt: inboxV2TimestampSchema
    })
  );

export type InboxV2ExactActiveTenantPolicyAuthorityInput = z.infer<
  typeof inboxV2ExactActiveTenantPolicyAuthorityInputSchema
>;

export type InboxV2ExactActiveTenantPolicyAuthority = Readonly<{
  version: InboxV2TenantPolicyVersionAuthority;
  activation: InboxV2TenantPolicyActivationHead & { state: "active" };
  headRevision: InboxV2TenantPolicyActivationHead["revision"];
  approvedTrustedServiceId: InboxV2TrustedServiceId;
}>;

function addEmployeeTenantIssue(
  context: z.RefinementCtx,
  tenantId: string,
  employee: InboxV2EmployeeReference,
  path: readonly PropertyKey[]
): void {
  if (employee.tenantId !== tenantId) {
    addIssue(
      context,
      path,
      "Policy authority Employee must belong to its tenant."
    );
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: readonly PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path: [...path], message });
}
