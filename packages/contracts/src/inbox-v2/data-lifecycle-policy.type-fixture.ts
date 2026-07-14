import type { z } from "zod";

import type {
  InboxV2DataLifecyclePolicy,
  InboxV2EffectiveTenantPolicy,
  InboxV2LifecycleEvaluationInput,
  InboxV2PolicyTemplate
} from "./data-lifecycle-policy";
import {
  inboxV2EffectiveTenantPolicySchema,
  inboxV2PolicyTemplateSchema
} from "./data-lifecycle-policy";

declare const template: InboxV2PolicyTemplate;
declare const effectivePolicy: InboxV2EffectiveTenantPolicy;

const _templateUnion: InboxV2DataLifecyclePolicy = template;
const _effectiveUnion: InboxV2DataLifecyclePolicy = effectivePolicy;

// @ts-expect-error A tenant-less template is never an executable tenant policy.
const _templateAsEffective: InboxV2EffectiveTenantPolicy = template;

const _validTemplateInput: z.input<typeof inboxV2PolicyTemplateSchema> = {
  kind: "template",
  id: "core:message-policy-template",
  version: "1",
  templateHash: `sha256:${"a".repeat(64)}`,
  deploymentProfile: "saas_shared",
  jurisdictionProfiles: [{ id: "core:jurisdiction-eu", version: "1" }],
  effectiveAt: "2026-01-01T00:00:00.000Z",
  reviewAt: "2027-01-01T00:00:00.000Z",
  rules: [
    {
      id: "core:message-rule",
      revision: "1",
      dataClassId: "core:message_content_blocks",
      purposeId: "core:customer_service_history",
      retentionAnchorId: "core:canonical_item_time",
      baselineWindow: {
        kind: "fixed_after_anchor",
        period: { kind: "elapsed", seconds: 86_400 }
      },
      actionAtExpiry: "purge_content_keep_tombstone",
      backupMaximum: { kind: "elapsed", seconds: 35 * 86_400 },
      legalMinimum: null,
      legalMaximum: null,
      allowTenantShorter: true,
      allowTenantLonger: false,
      holdEligible: true
    }
  ]
};

const _invalidTemplateAction: z.input<typeof inboxV2PolicyTemplateSchema> = {
  ..._validTemplateInput,
  rules: [
    {
      ..._validTemplateInput.rules[0]!,
      // @ts-expect-error Legal hold is an evaluator outcome, not an expiry action.
      actionAtExpiry: "hold_no_purge"
    }
  ]
};

const _invalidEffectivePolicy: z.input<
  typeof inboxV2EffectiveTenantPolicySchema
> = {
  // @ts-expect-error Executable policies require effective_tenant discriminator.
  kind: "template",
  tenantId: "tenant:tenant-1",
  id: "core:tenant-message-policy",
  version: "1",
  policyHash: `sha256:${"b".repeat(64)}`,
  dataLifecycleCatalogVersion: "v1",
  registryCompositionHash: `sha256:${"d".repeat(64)}`,
  templateRefs: [
    {
      id: "core:message-policy-template",
      version: "1",
      templateHash: `sha256:${"a".repeat(64)}`
    }
  ],
  governanceContextRef: {
    tenantId: "tenant:tenant-1",
    id: "core:governance-profile",
    version: "1",
    contextHash: `sha256:${"c".repeat(64)}`
  },
  deploymentProfile: "saas_shared",
  effectiveAt: "2026-01-01T00:00:00.000Z",
  rules: []
};

declare const evaluationInput: InboxV2LifecycleEvaluationInput;
// @ts-expect-error Templates cannot substitute for executable policy input.
evaluationInput.policy = template;
