import type { z } from "zod";

import type {
  InboxV2ProviderRosterEvidence,
  InboxV2ProviderRosterMemberEvidence
} from "./participant-identity";
import type {
  InboxV2ProviderRosterMaterializationAuthority,
  InboxV2ProviderRosterMaterializationCommit
} from "./provider-roster-materialization";
import { inboxV2ProviderRosterMaterializationCommitSchema } from "./provider-roster-materialization";
import type { InboxV2SourceThreadBindingCurrentProjection } from "./source-thread-binding";

declare const evidence: InboxV2ProviderRosterEvidence;
declare const member: InboxV2ProviderRosterMemberEvidence;
declare const projection: InboxV2SourceThreadBindingCurrentProjection;
declare const commit: InboxV2ProviderRosterMaterializationCommit;

const _evidence: InboxV2ProviderRosterEvidence = commit.evidence;
const _projection: InboxV2SourceThreadBindingCurrentProjection =
  commit.currentBindingProjection;
const _authority: InboxV2ProviderRosterMaterializationAuthority =
  commit.authority;
const _readonlyMembers: readonly InboxV2ProviderRosterMemberEvidence[] =
  commit.members;

const validInput: z.input<
  typeof inboxV2ProviderRosterMaterializationCommitSchema
> = {
  tenantId: "tenant:tenant-1",
  evidence,
  members: [member],
  currentBindingProjection: projection,
  authority: {
    kind: "trusted_service",
    trustedServiceId: "core:source-runtime",
    authorizationToken: "authorization:provider-roster-1",
    authorizedAt: "2026-07-11T09:02:00.000Z"
  },
  materializedAt: "2026-07-11T09:02:00.000Z"
};

// @ts-expect-error Parsed member evidence is a frozen bounded set.
commit.members.push(member);

const _invalidSideEffectCommand: z.input<
  typeof inboxV2ProviderRosterMaterializationCommitSchema
> = {
  ...validInput,
  // @ts-expect-error Roster materialization cannot carry membership side effects.
  membershipCommands: []
};

const _invalidAuthorityKind: InboxV2ProviderRosterMaterializationAuthority = {
  // @ts-expect-error Only a trusted service can authorize roster materialization.
  kind: "employee",
  trustedServiceId: commit.authority.trustedServiceId,
  authorizationToken: "authorization:provider-roster-1",
  authorizedAt: "2026-07-11T09:02:00.000Z"
};

void validInput;
