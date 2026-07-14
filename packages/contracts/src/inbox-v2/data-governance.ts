import { z } from "zod";

import {
  inboxV2DeploymentProfileSchema,
  inboxV2ExternalRouteIdSchema,
  inboxV2GovernanceProfileIdSchema,
  inboxV2ProcessingPurposeIdSchema,
  inboxV2VersionedProfileReferenceSchema,
  INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION
} from "./data-lifecycle-primitives";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import { inboxV2NamespacedIdSchema } from "./namespace";
import {
  createInboxV2SchemaEnvelopeSchema,
  type InboxV2SchemaEnvelope
} from "./schema-version";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";
import { inboxV2Sha256DigestSchema } from "./sync-primitives";

export const INBOX_V2_DATA_GOVERNANCE_CONTEXT_SCHEMA_ID =
  "core:inbox-v2.data-governance-context" as const;

export const inboxV2EuResponsibilityRoleSchema = z
  .object({
    regime: z.literal("eu"),
    role: z.enum([
      "controller",
      "joint_controller",
      "processor",
      "recipient",
      "subprocessor"
    ])
  })
  .strict();

export const inboxV2Ru152FzResponsibilityRoleSchema = z
  .object({
    regime: z.literal("ru_152_fz"),
    role: z.enum([
      "personal_data_operator",
      "processor_on_operator_instruction",
      "recipient",
      "subcontractor"
    ])
  })
  .strict();

export const inboxV2ApprovedExtensionResponsibilityRoleSchema = z
  .object({
    regime: z.literal("approved_extension"),
    regimeId: z
      .string()
      .min(11)
      .max(256)
      .regex(/^extension:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u),
    roleId: z
      .string()
      .min(11)
      .max(256)
      .regex(/^extension:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u),
    approvedProfile: inboxV2VersionedProfileReferenceSchema
  })
  .strict();

export const inboxV2ResponsibilityRoleSchema = z.discriminatedUnion("regime", [
  inboxV2EuResponsibilityRoleSchema,
  inboxV2Ru152FzResponsibilityRoleSchema,
  inboxV2ApprovedExtensionResponsibilityRoleSchema
]);

export const inboxV2GovernanceRoleAssignmentSchema = z
  .object({
    purposeId: inboxV2ProcessingPurposeIdSchema,
    roles: z
      .array(inboxV2ResponsibilityRoleSchema)
      .min(1)
      .max(32)
      .superRefine((roles, context) => {
        addCanonicalUniqueIssue(
          context,
          roles.map(responsibilityRoleKey),
          "Governance responsibility roles"
        );
      }),
    lawfulBasisReferenceCode: inboxV2NamespacedIdSchema,
    customerInstructionReferenceCode: inboxV2NamespacedIdSchema.nullable()
  })
  .strict()
  .superRefine((assignment, context) => {
    const requiresInstruction = assignment.roles.some(
      (role) =>
        (role.regime === "eu" &&
          (role.role === "processor" || role.role === "subprocessor")) ||
        (role.regime === "ru_152_fz" &&
          (role.role === "processor_on_operator_instruction" ||
            role.role === "subcontractor"))
    );
    if (
      requiresInstruction &&
      assignment.customerInstructionReferenceCode === null
    ) {
      addIssue(
        context,
        ["customerInstructionReferenceCode"],
        "Processor responsibility requires an explicit customer-instruction reference."
      );
    }
  });

export const inboxV2GovernanceIanaTimeZoneSchema = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (value) =>
      value === "UTC" ||
      /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)+$/u.test(value),
    { message: "Timezone must be UTC or an IANA timezone identifier." }
  );

export const inboxV2TzdbVersionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);

export const inboxV2CalendarBoundaryPolicySchema = z
  .object({
    monthOverflow: z.literal("constrain"),
    ambiguousLocalTime: z.literal("reject"),
    nonexistentLocalTime: z.literal("reject"),
    businessDayAnchor: z.literal("exclusive")
  })
  .strict();

export const inboxV2DataGovernanceContextReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2GovernanceProfileIdSchema,
    version: inboxV2EntityRevisionSchema,
    contextHash: inboxV2Sha256DigestSchema
  })
  .strict();

const dataGovernanceContextShape = {
  tenantId: inboxV2TenantIdSchema,
  id: inboxV2GovernanceProfileIdSchema,
  version: inboxV2EntityRevisionSchema,
  policyRevision: inboxV2EntityRevisionSchema,
  deploymentProfile: inboxV2DeploymentProfileSchema,
  rolesByPurpose: z
    .array(inboxV2GovernanceRoleAssignmentSchema)
    .min(1)
    .max(256)
    .superRefine((assignments, context) => {
      addCanonicalUniqueIssue(
        context,
        assignments.map(({ purposeId }) => purposeId),
        "Governance purpose assignments"
      );
    }),
  jurisdictionProfiles: z
    .array(inboxV2VersionedProfileReferenceSchema)
    .min(1)
    .max(64)
    .superRefine((references, context) =>
      addCanonicalUniqueIssue(
        context,
        references.map(versionedReferenceKey),
        "Jurisdiction profiles"
      )
    ),
  residencyRegionIds: z
    .array(inboxV2GovernanceProfileIdSchema)
    .min(1)
    .max(64)
    .superRefine((ids, context) =>
      addCanonicalUniqueIssue(context, ids, "Residency regions")
    ),
  crossBorderRouteIds: z
    .array(inboxV2ExternalRouteIdSchema)
    .max(128)
    .superRefine((ids, context) =>
      addCanonicalUniqueIssue(context, ids, "Cross-border routes")
    ),
  timeZone: inboxV2GovernanceIanaTimeZoneSchema,
  tzdbVersion: inboxV2TzdbVersionSchema,
  calendarPeriodResolver: inboxV2VersionedProfileReferenceSchema,
  calendarBoundaryPolicy: inboxV2CalendarBoundaryPolicySchema,
  businessCalendars: z
    .array(inboxV2VersionedProfileReferenceSchema)
    .max(64)
    .superRefine((references, context) =>
      addCanonicalUniqueIssue(
        context,
        references.map(versionedReferenceKey),
        "Business calendars"
      )
    ),
  requestSlaProfile: inboxV2VersionedProfileReferenceSchema,
  industryProfiles: z
    .array(inboxV2VersionedProfileReferenceSchema)
    .max(64)
    .superRefine((references, context) =>
      addCanonicalUniqueIssue(
        context,
        references.map(versionedReferenceKey),
        "Industry profiles"
      )
    ),
  approvedAt: inboxV2TimestampSchema,
  effectiveAt: inboxV2TimestampSchema,
  reviewAt: inboxV2TimestampSchema
} as const;

const inboxV2DataGovernanceContextBodySchema = z
  .object(dataGovernanceContextShape)
  .strict()
  .superRefine(addGovernanceTimestampIssues);

export const inboxV2DataGovernanceContextSchema = z
  .object({
    ...dataGovernanceContextShape,
    contextHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((governance, context) => {
    addGovernanceTimestampIssues(governance, context);
    const { contextHash, ...body } = governance;
    const parsedBody = inboxV2DataGovernanceContextBodySchema.safeParse(body);
    if (
      parsedBody.success &&
      contextHash !== calculateInboxV2DataGovernanceContextHash(parsedBody.data)
    ) {
      addIssue(
        context,
        ["contextHash"],
        "Governance context hash must match its canonical reviewed content."
      );
    }
  });

export const inboxV2DataGovernanceContextEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_DATA_GOVERNANCE_CONTEXT_SCHEMA_ID,
    INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
    inboxV2DataGovernanceContextSchema
  );

const definedInboxV2DataGovernanceContexts = new WeakSet<object>();

export function isInboxV2DataGovernanceContext(
  value: unknown
): value is InboxV2DataGovernanceContext {
  return (
    typeof value === "object" &&
    value !== null &&
    definedInboxV2DataGovernanceContexts.has(value)
  );
}

export function calculateInboxV2DataGovernanceContextHash(
  input: z.input<typeof inboxV2DataGovernanceContextBodySchema>
) {
  const body = inboxV2DataGovernanceContextBodySchema.parse(input);
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.data-governance-context",
    hashVersion: "v1",
    context: body
  });
}

/** Creates a governance context whose digest cannot be caller-authored. */
export function defineInboxV2DataGovernanceContext(
  input: z.input<typeof inboxV2DataGovernanceContextBodySchema> & {
    contextHash?: unknown;
  }
): InboxV2DataGovernanceContext {
  const { contextHash: _ignored, ...candidate } = input;
  const body = inboxV2DataGovernanceContextBodySchema.parse(candidate);
  const context = deepFreeze({
    ...inboxV2DataGovernanceContextSchema.parse({
      ...body,
      contextHash: calculateInboxV2DataGovernanceContextHash(body)
    })
  });
  definedInboxV2DataGovernanceContexts.add(context);
  return context;
}

export function matchesInboxV2DataGovernanceContextReference(input: {
  context: z.input<typeof inboxV2DataGovernanceContextSchema>;
  reference: z.input<typeof inboxV2DataGovernanceContextReferenceSchema>;
}): boolean {
  const context = inboxV2DataGovernanceContextSchema.safeParse(input.context);
  const reference = inboxV2DataGovernanceContextReferenceSchema.safeParse(
    input.reference
  );
  return (
    context.success &&
    reference.success &&
    context.data.tenantId === reference.data.tenantId &&
    context.data.id === reference.data.id &&
    context.data.version === reference.data.version &&
    context.data.contextHash === reference.data.contextHash
  );
}

export type InboxV2ResponsibilityRole = z.infer<
  typeof inboxV2ResponsibilityRoleSchema
>;
export type InboxV2GovernanceRoleAssignment = z.infer<
  typeof inboxV2GovernanceRoleAssignmentSchema
>;
export type InboxV2DataGovernanceContextReference = z.infer<
  typeof inboxV2DataGovernanceContextReferenceSchema
>;
export type InboxV2DataGovernanceContext = z.infer<
  typeof inboxV2DataGovernanceContextSchema
>;
export type InboxV2DataGovernanceContextEnvelope = InboxV2SchemaEnvelope<
  typeof INBOX_V2_DATA_GOVERNANCE_CONTEXT_SCHEMA_ID,
  typeof INBOX_V2_DATA_LIFECYCLE_SCHEMA_VERSION,
  InboxV2DataGovernanceContext
>;

function responsibilityRoleKey(
  role: z.infer<typeof inboxV2ResponsibilityRoleSchema>
): string {
  return role.regime === "approved_extension"
    ? `${role.regime}\u0000${role.regimeId}\u0000${role.roleId}\u0000${versionedReferenceKey(role.approvedProfile)}`
    : `${role.regime}\u0000${role.role}`;
}

function versionedReferenceKey(
  reference: z.infer<typeof inboxV2VersionedProfileReferenceSchema>
): string {
  return `${reference.id}\u0000${reference.version}`;
}

function addCanonicalUniqueIssue(
  context: z.RefinementCtx,
  values: readonly string[],
  label: string
): void {
  if (
    new Set(values).size !== values.length ||
    values.some((value, index) => index > 0 && value <= values[index - 1]!)
  ) {
    addIssue(context, [], `${label} must be unique and canonically sorted.`);
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}

function addGovernanceTimestampIssues(
  governance: {
    approvedAt: string;
    effectiveAt: string;
    reviewAt: string;
  },
  context: z.RefinementCtx
): void {
  if (
    !isInboxV2TimestampOrderValid(
      governance.approvedAt,
      governance.effectiveAt
    ) ||
    !isInboxV2TimestampOrderValid(
      governance.effectiveAt,
      governance.reviewAt
    ) ||
    Date.parse(governance.reviewAt) === Date.parse(governance.effectiveAt)
  ) {
    addIssue(
      context,
      ["reviewAt"],
      "Governance approval, effective time and future review must be ordered."
    );
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}
