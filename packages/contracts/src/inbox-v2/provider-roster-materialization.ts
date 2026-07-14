import { z } from "zod";

import {
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import {
  inboxV2ProviderRosterEvidenceSchema,
  inboxV2ProviderRosterMemberEvidenceSchema
} from "./participant-identity";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema
} from "./source-routing-primitives";
import { inboxV2SourceThreadBindingCurrentProjectionSchema } from "./source-thread-binding";

export const INBOX_V2_PROVIDER_ROSTER_MATERIALIZATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.provider-roster-materialization-commit" as const;
export const INBOX_V2_PROVIDER_ROSTER_MATERIALIZATION_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_PROVIDER_ROSTER_MATERIALIZATION_MEMBER_MAX = 50_000;

export const inboxV2ProviderRosterMaterializationAuthoritySchema = z
  .object({
    kind: z.literal("trusted_service"),
    trustedServiceId: inboxV2RoutingTrustedServiceIdSchema,
    authorizationToken: inboxV2RoutingTokenSchema,
    authorizedAt: inboxV2TimestampSchema
  })
  .strict();

const frozenProviderRosterMembersSchema = z
  .array(inboxV2ProviderRosterMemberEvidenceSchema)
  .max(INBOX_V2_PROVIDER_ROSTER_MATERIALIZATION_MEMBER_MAX)
  .readonly();

/**
 * One bounded, side-effect-free persistence proof for one provider roster
 * observation. Membership, responsibility, RBAC and notification commands are
 * deliberately absent and must run only after this immutable evidence exists.
 */
export const inboxV2ProviderRosterMaterializationCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    evidence: inboxV2ProviderRosterEvidenceSchema,
    members: frozenProviderRosterMembersSchema,
    currentBindingProjection: inboxV2SourceThreadBindingCurrentProjectionSchema,
    authority: inboxV2ProviderRosterMaterializationAuthoritySchema,
    materializedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((commit, context) => {
    const { evidence } = commit;
    const { binding } = commit.currentBindingProjection;
    const adapterContract = binding.capabilities.adapterContract;

    if (
      commit.tenantId !== evidence.tenantId ||
      commit.tenantId !== binding.tenantId
    ) {
      addIssue(
        context,
        ["tenantId"],
        "Roster evidence and current binding projection must share the materialization tenant."
      );
    }

    if (
      evidence.sourceThreadBinding.tenantId !== binding.tenantId ||
      String(evidence.sourceThreadBinding.id) !== String(binding.id)
    ) {
      addIssue(
        context,
        ["evidence", "sourceThreadBinding"],
        "Roster evidence must target the exact current SourceThreadBinding projection."
      );
    }

    if (String(evidence.revision) !== "1") {
      addIssue(
        context,
        ["evidence", "revision"],
        "Provider roster evidence is an immutable revision-1 fact."
      );
    }

    if (
      String(evidence.adapterContractVersion) !==
      String(adapterContract.contractVersion)
    ) {
      addIssue(
        context,
        ["evidence", "adapterContractVersion"],
        "Roster evidence must pin the adapter version from the current binding capability snapshot."
      );
    }

    if (
      commit.authority.trustedServiceId !==
      adapterContract.loadedByTrustedServiceId
    ) {
      addIssue(
        context,
        ["authority", "trustedServiceId"],
        "Roster materialization must use the trusted service pinned by the current binding adapter snapshot."
      );
    }

    if (commit.authority.authorizedAt !== commit.materializedAt) {
      addIssue(
        context,
        ["authority", "authorizedAt"],
        "Roster authorization and materialization must share one commit boundary."
      );
    }

    for (const [path, timestamp, boundary, message] of [
      [
        ["evidence", "observedAt"],
        evidence.observedAt,
        commit.materializedAt,
        "Roster materialization cannot precede its provider observation."
      ],
      [
        ["currentBindingProjection", "binding", "updatedAt"],
        binding.updatedAt,
        commit.materializedAt,
        "Roster materialization cannot use a binding projection from the future."
      ],
      [
        [
          "currentBindingProjection",
          "binding",
          "capabilities",
          "adapterContract",
          "loadedAt"
        ],
        adapterContract.loadedAt,
        evidence.observedAt,
        "Roster observation cannot predate its trusted adapter snapshot."
      ]
    ] as const) {
      if (!isInboxV2TimestampOrderValid(timestamp, boundary)) {
        addIssue(context, path, message);
      }
    }

    const memberIds = new Set<string>();
    const sourceIdentityIds = new Set<string>();

    for (const [index, member] of commit.members.entries()) {
      if (member.tenantId !== commit.tenantId) {
        addIssue(
          context,
          ["members", index, "tenantId"],
          "Roster materialization members must share one tenant."
        );
      }

      if (
        member.rosterEvidence.tenantId !== evidence.tenantId ||
        String(member.rosterEvidence.id) !== String(evidence.id)
      ) {
        addIssue(
          context,
          ["members", index, "rosterEvidence"],
          "Roster member evidence must reference the exact materialized roster evidence."
        );
      }

      if (String(member.revision) !== "1") {
        addIssue(
          context,
          ["members", index, "revision"],
          "Provider roster member evidence is an immutable revision-1 fact."
        );
      }

      if (member.observedAt !== evidence.observedAt) {
        addIssue(
          context,
          ["members", index, "observedAt"],
          "Roster member observation time must equal its roster evidence observation time."
        );
      }

      const memberId = String(member.id);
      if (memberIds.has(memberId)) {
        addIssue(
          context,
          ["members", index, "id"],
          "Roster member evidence IDs must be unique in one materialization commit."
        );
      }
      memberIds.add(memberId);

      const sourceIdentityKey = `${member.sourceExternalIdentity.tenantId}\u0000${String(member.sourceExternalIdentity.id)}`;
      if (sourceIdentityIds.has(sourceIdentityKey)) {
        addIssue(
          context,
          ["members", index, "sourceExternalIdentity"],
          "One roster materialization cannot repeat a source identity."
        );
      }
      sourceIdentityIds.add(sourceIdentityKey);
    }
  });

export const inboxV2ProviderRosterMaterializationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_PROVIDER_ROSTER_MATERIALIZATION_COMMIT_SCHEMA_ID,
    INBOX_V2_PROVIDER_ROSTER_MATERIALIZATION_SCHEMA_VERSION,
    inboxV2ProviderRosterMaterializationCommitSchema
  );

export type InboxV2ProviderRosterMaterializationAuthority = z.infer<
  typeof inboxV2ProviderRosterMaterializationAuthoritySchema
>;
export type InboxV2ProviderRosterMaterializationCommit = z.infer<
  typeof inboxV2ProviderRosterMaterializationCommitSchema
>;

function addIssue(
  context: z.RefinementCtx,
  path: readonly PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path: [...path], message });
}
