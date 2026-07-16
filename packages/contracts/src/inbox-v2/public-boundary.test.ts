import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import * as publicContracts from "../index";

const inboxV2Directory = dirname(fileURLToPath(import.meta.url));
const contractsSourceDirectory = resolve(inboxV2Directory, "..");
const contractsPackageDirectory = resolve(contractsSourceDirectory, "..");
const allowedSharedContractFiles = new Set([
  resolve(contractsSourceDirectory, "base-ids.ts"),
  resolve(contractsSourceDirectory, "brand.ts")
]);

function productionSources(directory = inboxV2Directory): string[] {
  const sources: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      sources.push(...productionSources(entryPath));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".type-fixture.ts")
    ) {
      sources.push(entryPath);
    }
  }

  return sources;
}

function parseTypeScript(sourcePath: string, source?: string) {
  return ts.createSourceFile(
    sourcePath,
    source ?? readFileSync(sourcePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];

  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      const [argument] = node.arguments;

      if (argument && ts.isStringLiteral(argument)) {
        specifiers.push(argument.text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function resolveTypeScriptModule(
  sourcePath: string,
  specifier: string
): string | undefined {
  const candidate = resolve(dirname(sourcePath), specifier);
  const candidates = extname(candidate)
    ? [candidate]
    : [`${candidate}.ts`, join(candidate, "index.ts")];

  return candidates.find((item) => existsSync(item) && statSync(item).isFile());
}

function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);

  return (
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}

function importGraphViolations(): string[] {
  const violations: string[] = [];
  const queue = [...productionSources()];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const sourcePath = queue.pop();

    if (!sourcePath || visited.has(sourcePath)) {
      continue;
    }

    visited.add(sourcePath);

    for (const specifier of moduleSpecifiers(parseTypeScript(sourcePath))) {
      if (
        specifier === "zod" ||
        specifier === "@noble/hashes/hmac.js" ||
        specifier === "@noble/hashes/sha2.js" ||
        specifier === "@noble/hashes/utils.js"
      ) {
        continue;
      }

      if (!specifier.startsWith(".")) {
        violations.push(`${sourcePath}: external import ${specifier}`);
        continue;
      }

      const target = resolveTypeScriptModule(sourcePath, specifier);

      if (!target) {
        violations.push(`${sourcePath}: unresolved import ${specifier}`);
        continue;
      }

      if (
        !isInside(inboxV2Directory, target) &&
        !allowedSharedContractFiles.has(target)
      ) {
        violations.push(`${sourcePath}: non-contract import ${specifier}`);
        continue;
      }

      queue.push(target);
    }
  }

  return violations;
}

function isClientStageName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("client") && normalized.includes("stage");
}

function isStringLiteralVocabulary(typeNode: ts.TypeNode): boolean {
  const members = ts.isUnionTypeNode(typeNode) ? typeNode.types : [typeNode];

  return (
    members.length > 0 &&
    members.every(
      (member) =>
        ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)
    )
  );
}

function isZodEnumCall(node: ts.Expression | undefined): boolean {
  return Boolean(
    node &&
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "z" &&
    node.expression.name.text === "enum"
  );
}

function forbiddenClientStageDeclarations(sourceFile: ts.SourceFile): string[] {
  const violations: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isEnumDeclaration(node) && isClientStageName(node.name.text)) {
      violations.push(`${sourceFile.fileName}:${node.name.text}: enum`);
    } else if (
      ts.isTypeAliasDeclaration(node) &&
      isClientStageName(node.name.text) &&
      isStringLiteralVocabulary(node.type)
    ) {
      violations.push(`${sourceFile.fileName}:${node.name.text}: string union`);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isClientStageName(node.name.text) &&
      isZodEnumCall(node.initializer)
    ) {
      violations.push(`${sourceFile.fileName}:${node.name.text}: z.enum`);
    } else if (
      ts.isExportSpecifier(node) &&
      isClientStageName(node.name.text) &&
      /stage$/i.test(node.name.text)
    ) {
      violations.push(`${sourceFile.fileName}:${node.name.text}: re-export`);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function isConversationPurposeName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("conversation") && normalized.includes("purpose");
}

function forbiddenClosedConversationPurposeDeclarations(
  sourceFile: ts.SourceFile
): string[] {
  const violations: string[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isEnumDeclaration(node) &&
      isConversationPurposeName(node.name.text)
    ) {
      violations.push(`${sourceFile.fileName}:${node.name.text}: enum`);
    } else if (
      ts.isTypeAliasDeclaration(node) &&
      isConversationPurposeName(node.name.text) &&
      isStringLiteralVocabulary(node.type)
    ) {
      violations.push(`${sourceFile.fileName}:${node.name.text}: string union`);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isConversationPurposeName(node.name.text) &&
      isZodEnumCall(node.initializer)
    ) {
      violations.push(`${sourceFile.fileName}:${node.name.text}: z.enum`);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

describe("Inbox V2 public contract boundary", () => {
  it("is exported through the existing @hulee/contracts root surface", () => {
    expect(publicContracts.inboxV2TenantIdSchema).toBeDefined();
    expect(publicContracts.createInboxV2SchemaEnvelopeSchema).toBeTypeOf(
      "function"
    );
    expect(
      publicContracts.createInboxV2CoreCatalogRegistrationSchema
    ).toBeTypeOf("function");
    expect(
      publicContracts.createInboxV2ModuleCatalogRegistrationSchema
    ).toBeTypeOf("function");
    expect(publicContracts.inboxV2ConversationSchema).toBeDefined();
    expect(publicContracts.inboxV2ConversationEnvelopeSchema).toBeDefined();
    expect(publicContracts.inboxV2ConversationClientLinkSchema).toBeDefined();
    expect(
      publicContracts.inboxV2ConversationClientLinkSetHeadSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ConversationClientLinkTransitionSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ConversationClientCurrentLinkPageSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ConversationClientLinkHistoryFixtureSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2ClientMergeRedirectSchema).toBeDefined();
    expect(publicContracts.inboxV2ClientMergeCommitSchema).toBeDefined();
    expect(
      publicContracts.inboxV2ClientMergeCommitEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2ClientMergeNodeStateSchema).toBeDefined();
    expect(
      publicContracts.inboxV2ClientMergeResolutionPathSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ClientMergeResolutionBatchSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2CanonicalConversationClientLinkPageSchema
    ).toBeDefined();
    expect(publicContracts.resolveInboxV2CanonicalClientReference).toBeTypeOf(
      "function"
    );
    expect(
      publicContracts.resolveInboxV2CanonicalConversationClientLinkGroups
    ).toBeTypeOf("function");
    expect(publicContracts.deriveInboxV2ClientMergeCommit).toBeTypeOf(
      "function"
    );
    expect(publicContracts.INBOX_V2_CLIENT_MERGE_COMMIT_SCHEMA_ID).toBe(
      "core:inbox-v2.client-merge-commit"
    );
    expect(publicContracts.inboxV2SourceExternalIdentitySchema).toBeDefined();
    expect(publicContracts.inboxV2ConversationParticipantSchema).toBeDefined();
    expect(
      publicContracts.inboxV2ParticipantMembershipEpisodeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ParticipantMembershipTransitionSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ParticipantAuthorObservationSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2ProviderRosterEvidenceSchema).toBeDefined();
    expect(
      publicContracts.inboxV2ProviderRosterMemberEvidenceSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2SourceIdentityClaimSchema).toBeDefined();
    expect(
      publicContracts.inboxV2SourceIdentityClaimTransitionSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2SourceAccountIdentitySchema).toBeDefined();
    expect(
      publicContracts.inboxV2SourceAccountIdentityTransitionCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2SourceRegistryLifecycleBindingSchema
    ).toBeDefined();
    expect(
      publicContracts.defineInboxV2SourceRegistryLifecycleBinding
    ).toBeTypeOf("function");
    expect(
      publicContracts.inboxV2SourceConnectionRegistryStateSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2SourceAccountRegistryStateSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2SourceRegistryTransitionSchema).toBeDefined();
    expect(publicContracts.defineInboxV2SourceRegistryTransition).toBeTypeOf(
      "function"
    );
    expect(publicContracts.inboxV2SourceAdapterDeclarationSchema).toBeDefined();
    expect(publicContracts.defineInboxV2SourceAdapterDeclaration).toBeTypeOf(
      "function"
    );
    expect(publicContracts.inboxV2ExternalThreadSchema).toBeDefined();
    expect(
      publicContracts.inboxV2ExternalThreadAliasCommitSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2SourceThreadBindingSchema).toBeDefined();
    expect(
      publicContracts.inboxV2SourceThreadBindingTransitionCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2SourceThreadBindingCreationCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2SourceThreadBindingCurrentHeadSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2ExternalMessageReferenceSchema).toBeDefined();
    expect(publicContracts.inboxV2SourceOccurrenceSchema).toBeDefined();
    expect(
      publicContracts.inboxV2SourceOccurrenceResolutionCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2SourceOccurrenceMaterializationCommitSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2OutboundDispatchSchema).toBeDefined();
    expect(
      publicContracts.inboxV2OutboundDispatchAttemptCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2OutboundDispatchAttemptCommitEnvelopeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2OutboundDispatchReconciliationDecisionSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2OutboundDispatchOperatorRetryAuthorizationDecisionSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2OutboundDispatchReconciliationCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2OutboundDispatchRouteFailureCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2OutboundDispatchArtifactReferenceLinkSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2OutboundDispatchArtifactAssociationCommitSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2ThreadRoutePolicySchema).toBeDefined();
    expect(
      publicContracts.inboxV2ConversationRouteAuthorizationDecisionSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2SourceAccountRouteAuthorizationDecisionSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2OutboundRouteSchema).toBeDefined();
    expect(
      publicContracts.inboxV2OutboundRouteResolutionCommitSchema
    ).toBeDefined();
    expect(publicContracts.resolveInboxV2OutboundRoute).toBeTypeOf("function");
    expect(publicContracts.inboxV2WorkQueueSchema).toBeDefined();
    expect(
      publicContracts.inboxV2WorkQueueEligibilityDecisionSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2WorkItemSchema).toBeDefined();
    expect(publicContracts.inboxV2ConversationWorkItemSlotSchema).toBeDefined();
    expect(
      publicContracts.inboxV2WorkItemPrimaryAssignmentSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2WorkItemTransitionCommitSchema).toBeDefined();
    expect(
      publicContracts.inboxV2WorkItemServicingTeamCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2WorkItemCollaboratorCommitSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2WorkItemCollaboratorSlotSchema).toBeDefined();
    expect(publicContracts.inboxV2WorkItemWatcherTargetSchema).toBeDefined();
    expect(publicContracts.deriveInboxV2WorkItemResponsibility).toBeTypeOf(
      "function"
    );
    expect(publicContracts.inboxV2TimelineContentIdSchema).toBeDefined();
    expect(publicContracts.inboxV2StaffNoteIdSchema).toBeDefined();
    expect(publicContracts.inboxV2StaffNoteRevisionIdSchema).toBeDefined();
    expect(publicContracts.inboxV2SourceObjectIdSchema).toBeDefined();
    expect(publicContracts.inboxV2MessageRevisionIdSchema).toBeDefined();
    expect(publicContracts.inboxV2MessageReactionIdSchema).toBeDefined();
    expect(
      publicContracts.inboxV2MessageReactionTransitionIdSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageDeliveryObservationIdSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ProviderReceiptObservationIdSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageTransportOccurrenceLinkIdSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageProviderLifecycleOperationIdSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2DeferredMessageSourceActionIdSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2EventReferenceSchema).toBeDefined();
    expect(publicContracts.inboxV2TimelineItemSchema).toBeDefined();
    expect(publicContracts.inboxV2TimelineItemEnvelopeSchema).toBeDefined();
    expect(publicContracts.inboxV2TimelineItemPageSchema).toBeDefined();
    expect("inboxV2TimelineCreationCommitSchema" in publicContracts).toBe(
      false
    );
    expect(
      "inboxV2TimelineCreationCommitEnvelopeSchema" in publicContracts
    ).toBe(false);
    expect("inboxV2TimelineSequenceAllocationSchema" in publicContracts).toBe(
      false
    );
    expect(publicContracts.inboxV2TimelineContentSchema).toBeDefined();
    expect(publicContracts.inboxV2TimelineContentEnvelopeSchema).toBeDefined();
    expect(
      publicContracts.inboxV2TimelineContentTransitionCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2TimelineContentTransitionCommitEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2MessageSchema).toBeDefined();
    expect(publicContracts.inboxV2MessageEnvelopeSchema).toBeDefined();
    expect(publicContracts.inboxV2MessageCreationCommitSchema).toBeDefined();
    expect(
      publicContracts.inboxV2CanonicalMessageTargetSnapshotSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ExternalMessageTargetSnapshotSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ProviderReferenceSemanticEvidenceSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageCreationCommitEnvelopeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2SourceObjectInductionProofSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2SourceObjectInductionProofEnvelopeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2SourceObjectTimelineCreationCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2SourceObjectTimelineCreationCommitEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2StaffNoteSchema).toBeDefined();
    expect(publicContracts.inboxV2StaffNoteEnvelopeSchema).toBeDefined();
    expect(publicContracts.inboxV2StaffNoteCreationCommitSchema).toBeDefined();
    expect(
      publicContracts.inboxV2StaffNoteCreationCommitEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2StaffNoteRevisionSchema).toBeDefined();
    expect(
      publicContracts.inboxV2StaffNoteRevisionEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2StaffNoteRevisionPageSchema).toBeDefined();
    expect(publicContracts.inboxV2StaffNoteMutationCommitSchema).toBeDefined();
    expect(
      publicContracts.inboxV2StaffNoteMutationCommitEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2StaffNoteReadIntentSchema).toBeDefined();
    expect(
      publicContracts.inboxV2StaffNoteReadIntentEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2MessageRevisionSchema).toBeDefined();
    expect(publicContracts.inboxV2MessageRevisionEnvelopeSchema).toBeDefined();
    expect(publicContracts.inboxV2MessageMutationCommitSchema).toBeDefined();
    expect(
      publicContracts.inboxV2MessageMutationCommitEnvelopeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageProviderLifecycleOperationSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageProviderLifecycleOperationEnvelopeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageProviderLifecycleOperationCreationCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageProviderLifecycleOperationCreationCommitEnvelopeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageProviderLifecycleTransitionCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageProviderLifecycleTransitionCommitEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2MessageReactionSchema).toBeDefined();
    expect(publicContracts.inboxV2MessageReactionEnvelopeSchema).toBeDefined();
    expect(
      publicContracts.inboxV2MessageReactionTransitionSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageReactionTransitionEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2MessageReactionCommitSchema).toBeDefined();
    expect(
      publicContracts.inboxV2MessageReactionCommitEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2MessageReactionSlotHeadSchema).toBeDefined();
    expect(
      publicContracts.inboxV2MessageReactionSlotHeadEnvelopeSchema
    ).toBeDefined();
    expect("inboxV2MessageReactionSetHeadSchema" in publicContracts).toBe(
      false
    );
    expect(publicContracts.inboxV2MessageReactionPageSchema).toBeDefined();
    expect(
      publicContracts.inboxV2MessageTransportOccurrenceLinkSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageTransportOccurrenceLinkEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2MessageTransportLinkHeadSchema).toBeDefined();
    expect(
      publicContracts.inboxV2MessageTransportLinkHeadEnvelopeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageTransportAssociationCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageTransportAssociationCommitEnvelopeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageDeliveryObservationSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageDeliveryObservationEnvelopeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ProviderReceiptObservationSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ProviderReceiptObservationEnvelopeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageTransportFactCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageTransportFactEvidenceSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2MessageTransportFactCommitEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2MessageTransportFactPageSchema).toBeDefined();
    expect(publicContracts.inboxV2ProviderSemanticProofSchema).toBeDefined();
    expect(
      publicContracts.inboxV2ProviderSemanticProofEnvelopeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ProviderOperationResultProofSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ProviderSemanticOrderingHeadSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2ProviderSemanticOrderingCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2DeferredMessageSourceActionSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2DeferredMessageSourceActionEnvelopeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2DeferredMessageSourceActionCommitSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2DeferredMessageSourceActionCommitEnvelopeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2DeferredSourceActionIdempotencyKeySchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2DeferredSourceActionOrderingHeadSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2DeferredMessageSourceActionEffectProofSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2TimelineCommandIntentSchema).toBeDefined();
    expect(
      publicContracts.inboxV2TimelineCommandIntentEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2BigintCounterSchema).toBeDefined();
    expect(publicContracts.inboxV2AuthorizationEpochSchema).toBeDefined();
    expect(
      publicContracts.inboxV2TenantStreamCommitPositionSchema
    ).toBeDefined();
    expect(
      publicContracts.createInboxV2ClientCommandRequestEnvelopeSchema
    ).toBeTypeOf("function");
    expect(publicContracts.createInboxV2AuthorizedCommandContract).toBeTypeOf(
      "function"
    );
    expect(publicContracts.parseInboxV2VersionedEnvelope).toBeTypeOf(
      "function"
    );
    expect(
      publicContracts.inboxV2AuthorizedCommandEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2CommandResultEnvelopeSchema).toBeDefined();
    expect(publicContracts.decideInboxV2CommandIdempotency).toBeTypeOf(
      "function"
    );
    expect(publicContracts.inboxV2TenantStreamHeadSchema).toBeDefined();
    expect(publicContracts.inboxV2TenantStreamCommitSchema).toBeDefined();
    expect(publicContracts.inboxV2TenantStreamChangeSchema).toBeDefined();
    expect(publicContracts.inboxV2DomainEventSchema).toBeDefined();
    expect(publicContracts.inboxV2OutboxIntentSchema).toBeDefined();
    expect(
      publicContracts.inboxV2AtomicMutationCommitEnvelopeSchema
    ).toBeDefined();
    expect(publicContracts.decideInboxV2ImmutableRecordWrite).toBeTypeOf(
      "function"
    );
    expect(publicContracts.inboxV2ProjectionCheckpointHeadSchema).toBeDefined();
    expect(publicContracts.decideInboxV2ProjectionInput).toBeTypeOf("function");
    expect(publicContracts.inboxV2DataClassDefinitionSchema).toBeDefined();
    expect(publicContracts.INBOX_V2_CORE_DATA_CLASS_CATALOG).toBeDefined();
    expect(publicContracts.inboxV2CoreDataUseRegistrationSchema).toBeDefined();
    expect(publicContracts.defineInboxV2DataLifecycleRegistry).toBeTypeOf(
      "function"
    );
    expect(
      publicContracts.inboxV2ModuleDataGovernanceContributionSchema
    ).toBeDefined();
    expect(publicContracts.inboxV2DataGovernanceContextSchema).toBeDefined();
    expect(publicContracts.inboxV2PolicyTemplateSchema).toBeDefined();
    expect(publicContracts.inboxV2EffectiveTenantPolicySchema).toBeDefined();
    expect(publicContracts.resolveInboxV2EffectiveTenantPolicy).toBeTypeOf(
      "function"
    );
    expect(publicContracts.evaluateInboxV2Lifecycle).toBeTypeOf("function");
    expect(publicContracts.inboxV2SubjectDiscoveryManifestSchema).toBeDefined();
    expect(publicContracts.inboxV2PrivacyRequestSchema).toBeDefined();
    expect(publicContracts.inboxV2LegalHoldSchema).toBeDefined();
    expect(publicContracts.inboxV2ProcessingRestrictionSchema).toBeDefined();
    expect(publicContracts.inboxV2PrivacyExportJobSchema).toBeDefined();
    expect(publicContracts.inboxV2PrivacyExportManifestSchema).toBeDefined();
    expect(publicContracts.defineInboxV2PrivacyExportJob).toBeTypeOf(
      "function"
    );
    expect(publicContracts.inboxV2DeletionPlanSchema).toBeDefined();
    expect(publicContracts.inboxV2DeletionRunSchema).toBeDefined();
    expect(publicContracts.defineInboxV2DeletionPlan).toBeTypeOf("function");
    expect(publicContracts.defineInboxV2DeletionRun).toBeTypeOf("function");
    expect(publicContracts.deriveInboxV2DeletionCompletionResult).toBeTypeOf(
      "function"
    );
    expect(publicContracts.inboxV2SafeAuditRecordSchema).toBeDefined();
    expect(publicContracts.inboxV2PrivacyEvidenceSchema).toBeDefined();
    expect(publicContracts.inboxV2PrivacyEventSchema).toBeDefined();
    expect(publicContracts.inboxV2PrivacyDiagnosticSchema).toBeDefined();
    expect(
      publicContracts.inboxV2RecipientFingerprintKeyRingSchema
    ).toBeDefined();
    expect(publicContracts.createInboxV2RecipientSyncContracts).toBeTypeOf(
      "function"
    );
    expect(publicContracts.createInboxV2RecipientWireSyncContracts).toBeTypeOf(
      "function"
    );
    expect(publicContracts.defineInboxV2RecipientWireProjection).toBeTypeOf(
      "function"
    );
    expect(
      publicContracts.deriveInboxV2RecipientWireProjectionRegistrations
    ).toBeTypeOf("function");
    expect(
      publicContracts.createInboxV2RecipientWireEntityChangeSchema
    ).toBeTypeOf("function");
    expect(
      publicContracts.createInboxV2RecipientWireUpsertChangeSchema
    ).toBeTypeOf("function");
    expect(
      publicContracts.inboxV2RecipientWireSecurityPurgeChangeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2RecipientStateFingerprintSchema
    ).toBeDefined();
    expect(publicContracts.calculateInboxV2RecipientUpsertStateHash).toBeTypeOf(
      "function"
    );
    expect(publicContracts.verifyInboxV2RecipientUpsertStateHash).toBeTypeOf(
      "function"
    );
    expect(
      publicContracts.inboxV2RecipientInvalidateChangeSchema
    ).toBeDefined();
    expect(
      publicContracts.inboxV2RecipientSecurityPurgeChangeSchema
    ).toBeDefined();
    expect(publicContracts.validateInboxV2SnapshotPageCursorClaims).toBeTypeOf(
      "function"
    );
    expect(publicContracts.decideInboxV2SecurityPurgeApplication).toBeTypeOf(
      "function"
    );
    expect(publicContracts.inboxV2SyncCursorErrorCodeSchema).toBeDefined();
    expect(publicContracts.decideInboxV2EntityChangeApplication).toBeTypeOf(
      "function"
    );
  });

  it("does not expose deleted unbounded Client-link graph APIs", () => {
    expect(
      Object.hasOwn(publicContracts, "inboxV2ConversationClientLinkGraphSchema")
    ).toBe(false);
    expect(
      Object.hasOwn(publicContracts, "inboxV2ClientMergeRedirectGraphSchema")
    ).toBe(false);
    expect(
      Object.hasOwn(
        publicContracts,
        "inboxV2ExternalMessageScopedReferenceSchema"
      )
    ).toBe(false);
    expect(
      Object.hasOwn(publicContracts, "inboxV2ExternalThreadAliasGraphSchema")
    ).toBe(false);
    expect(
      Object.hasOwn(
        publicContracts,
        "inboxV2SourceAccountIdentityAliasGraphSchema"
      )
    ).toBe(false);
  });

  it("imports only Zod and an explicit recursive contract allowlist", () => {
    expect(importGraphViolations()).toEqual([]);
  });

  it("keeps the contracts runtime dependency surface provider-neutral", () => {
    const packageJson = JSON.parse(
      readFileSync(join(contractsPackageDirectory, "package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };

    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual([
      "@noble/hashes",
      "zod"
    ]);
  });

  it("does not predeclare an owner-specific closed Client-stage vocabulary", () => {
    const forbiddenRuntimeExports = Object.keys(publicContracts).filter(
      (exportName) =>
        isClientStageName(exportName) &&
        !exportName.toLowerCase().includes("id") &&
        !exportName.toLowerCase().includes("reference")
    );
    const forbiddenDeclarations = productionSources().flatMap((sourcePath) =>
      forbiddenClientStageDeclarations(parseTypeScript(sourcePath))
    );

    expect(forbiddenRuntimeExports).toEqual([]);
    expect(forbiddenDeclarations).toEqual([]);
  });

  it("detects alternate closed Client-stage enum spellings", () => {
    const syntheticSource = parseTypeScript(
      "closed-client-stage-fixture.ts",
      [
        'export type ClientStage = "lead" | "won";',
        "export enum InboxV2ClientPipelineStage { Lead, Won }",
        'export const inboxV2ClientPipelineStageSchema = z.enum(["lead", "won"]);',
        'export { ClientStage as InboxV2ClientPipelineStage } from "./legacy";'
      ].join("\n")
    );

    expect(forbiddenClientStageDeclarations(syntheticSource)).toHaveLength(4);
  });

  it("keeps Conversation purpose extensible through namespaced catalog IDs", () => {
    const forbiddenDeclarations = productionSources().flatMap((sourcePath) =>
      forbiddenClosedConversationPurposeDeclarations(
        parseTypeScript(sourcePath)
      )
    );

    expect(forbiddenDeclarations).toEqual([]);
  });

  it("detects closed Conversation-purpose vocabularies", () => {
    const syntheticSource = parseTypeScript(
      "closed-conversation-purpose-fixture.ts",
      [
        'export type ConversationPurpose = "chat" | "support";',
        "export enum InboxV2ConversationPurpose { Chat, Support }",
        'export const inboxV2ConversationPurposeSchema = z.enum(["chat", "support"]);'
      ].join("\n")
    );

    expect(
      forbiddenClosedConversationPurposeDeclarations(syntheticSource)
    ).toHaveLength(3);
  });
});
