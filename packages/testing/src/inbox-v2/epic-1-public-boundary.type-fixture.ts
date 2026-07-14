import {
  inboxV2AtomicMutationCommitSchema,
  inboxV2ConversationParticipantSetSchema,
  inboxV2ConversationSchema,
  inboxV2MessageSchema,
  type InboxV2AtomicMutationCommit,
  type InboxV2Conversation,
  type InboxV2ConversationParticipant,
  type InboxV2Message
} from "@hulee/contracts";
import {
  evaluateInboxV2AuthorizationPlan,
  type InboxV2AuthorizationDecision,
  type InboxV2AuthorizationPlanInput,
  type InboxV2CanonicalScopeFact,
  type InboxV2PermissionScope,
  type InboxV2PolicyGuardEvidence
} from "@hulee/core";
import {
  createInboxV2ScenarioWorld,
  executeInboxV2ScenarioStep,
  inboxV2ScenarioConversation,
  inboxV2ScenarioMessage,
  inboxV2ScenarioParticipant,
  type InboxV2ScenarioSeedRecord,
  type InboxV2ScenarioStep,
  type InboxV2ScenarioStepResult,
  type InboxV2ScenarioWorld
} from "@hulee/testing";

export type InboxV2Epic1PublicBoundaryFixture = Readonly<{
  contracts: Readonly<{
    conversation: InboxV2Conversation;
    participant: InboxV2ConversationParticipant;
    message: InboxV2Message;
    commit: InboxV2AtomicMutationCommit;
  }>;
  policy: Readonly<{
    input: InboxV2AuthorizationPlanInput;
    decision: InboxV2AuthorizationDecision;
    scope: InboxV2PermissionScope;
    scopeFact: InboxV2CanonicalScopeFact;
    guard: InboxV2PolicyGuardEvidence;
  }>;
  scenario: Readonly<{
    world: InboxV2ScenarioWorld;
    seed: InboxV2ScenarioSeedRecord;
    step: InboxV2ScenarioStep;
    result: InboxV2ScenarioStepResult;
  }>;
}>;

const inboxV2Epic1PublicBoundaryValues = Object.freeze({
  inboxV2ConversationSchema,
  inboxV2ConversationParticipantSetSchema,
  inboxV2MessageSchema,
  inboxV2AtomicMutationCommitSchema,
  evaluateInboxV2AuthorizationPlan,
  createInboxV2ScenarioWorld,
  executeInboxV2ScenarioStep,
  inboxV2ScenarioConversation,
  inboxV2ScenarioParticipant,
  inboxV2ScenarioMessage
});

void inboxV2Epic1PublicBoundaryValues;
