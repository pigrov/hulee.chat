import type { z } from "zod";

import type { InboxV2SourceOccurrence } from "./external-message-reference";
import type { InboxV2ExternalThreadMapping } from "./external-thread";
import type {
  InboxV2OutboundDispatch,
  InboxV2OutboundDispatchAttempt
} from "./outbound-dispatch";
import type { InboxV2OutboundRoute } from "./outbound-route";
import type {
  InboxV2MaterializationVerifiedSourceAccountIdentity,
  InboxV2SourceOccurrenceBindingMaterialization,
  InboxV2SourceOccurrenceMaterializationAuthority,
  InboxV2SourceOccurrenceMaterializationCommit
} from "./source-occurrence-materialization";
import { inboxV2SourceOccurrenceMaterializationCommitSchema } from "./source-occurrence-materialization";
import type { InboxV2SourceThreadBindingCurrentProjection } from "./source-thread-binding";

declare const occurrence: InboxV2SourceOccurrence;
declare const mapping: InboxV2ExternalThreadMapping;
declare const projection: InboxV2SourceThreadBindingCurrentProjection;
declare const verifiedIdentity: InboxV2MaterializationVerifiedSourceAccountIdentity;
declare const attempt: InboxV2OutboundDispatchAttempt;
declare const dispatch: InboxV2OutboundDispatch;
declare const route: InboxV2OutboundRoute;
declare const commit: InboxV2SourceOccurrenceMaterializationCommit;

const _verifiedState: "verified" = commit.sourceAccountIdentity.state;
const _boundedOccurrence: InboxV2SourceOccurrence = commit.occurrence;
const _nullableAttempt: InboxV2OutboundDispatchAttempt | null =
  commit.outboundDispatchAttempt;
const _nullableDispatch: InboxV2OutboundDispatch | null =
  commit.outboundDispatch;
const _nullableRoute: InboxV2OutboundRoute | null = commit.outboundRoute;

if (commit.bindingMaterialization.kind === "created") {
  const _creationAuthority: InboxV2SourceOccurrenceMaterializationAuthority =
    commit.bindingMaterialization.creationAuthority;
} else {
  const _absentCreationAuthority: null =
    commit.bindingMaterialization.creationAuthority;
}

const validInput: z.input<
  typeof inboxV2SourceOccurrenceMaterializationCommitSchema
> = {
  tenantId: "tenant:tenant-1",
  occurrence,
  bindingMaterialization: {
    kind: "existing",
    currentProjection: projection,
    creationAuthority: null
  },
  externalThreadMapping: mapping,
  sourceAccountIdentity: verifiedIdentity,
  outboundDispatchAttempt: null,
  outboundDispatch: null,
  outboundRoute: null,
  authority: {
    kind: "trusted_service",
    trustedServiceId: "core:source-runtime",
    authorizationToken: "authorization:materialization-1",
    authorizedAt: "2026-07-11T09:00:00.000Z"
  },
  materializedAt: "2026-07-11T09:00:00.000Z"
};

const providerResponseInput: z.input<
  typeof inboxV2SourceOccurrenceMaterializationCommitSchema
> = {
  ...validInput,
  outboundDispatchAttempt: attempt,
  outboundDispatch: dispatch,
  outboundRoute: route
};

const _invalidBindingKind: InboxV2SourceOccurrenceBindingMaterialization = {
  // @ts-expect-error Lifetime is not a bounded binding materialization mode.
  kind: "lifetime",
  currentProjection: projection,
  creationAuthority: null
};

// @ts-expect-error Existing binding mode cannot claim creation authority.
const _invalidExistingCreationAuthority: InboxV2SourceOccurrenceBindingMaterialization =
  {
    kind: "existing",
    currentProjection: projection,
    creationAuthority: commit.authority
  };

// @ts-expect-error The bounded commit deliberately exposes no lifetime aggregate.
const _lifetimeOccurrences = commit.allOccurrences;

// @ts-expect-error A verified materialization identity cannot be provisional.
const _provisionalState: "provisional" = commit.sourceAccountIdentity.state;

void providerResponseInput;
