# Inbox V2 Data Lifecycle, Privacy, Export, Deletion And Audit Policy

Status: approved architecture baseline  
Date: 2026-07-10  
Owner task: `INB2-ARCH-007`  
Stable decision: `docs/adr/0015-inbox-v2-data-lifecycle-privacy-and-audit.md`

## Decision

Inbox V2 uses one versioned, tenant-scoped data-lifecycle policy for shared
SaaS, isolated SaaS and on-prem data planes. Retention is decided independently
for each data class and processing purpose. It is not one Conversation-level
TTL and is never inferred from a tariff alone.

The architecture separates:

- immutable technical history from removable personal/content payloads;
- operational delete, provider message delete and privacy erasure;
- pseudonymization from irreversible anonymization;
- legal hold from processing restriction and from ordinary retention;
- tenant export, report export and verified data-subject export;
- primary data, derived copies, external recipients and backup residuals;
- domain history, security audit and sensitive evidence.

No production profile may mean “keep everything forever”. Every data class has
an explicit purpose, retention anchor, action at expiry, backup treatment and
hold behavior. A legal hold or another unresolved preservation condition is
never an expiry action or an unreviewed forever flag: it requires an approved
basis, owner, exact scope, end condition and review date. A legal hold is an
explicit evaluator blocker with its own case and revision.

This document is an engineering policy baseline, not legal advice. Deployment-
specific regime roles, jurisdictions, contractual obligations and exact
production periods require the approvals listed in
`docs/product/open-questions.md`. Missing legal configuration blocks production
compliance sign-off; it does not authorize silent infinite retention or an
unsafe best-effort deletion.

## Binding Principles

1. Tenant boundary applies to policy, subject links, holds, requests, jobs,
   exports, deletion evidence, object keys, audit and backups.
2. Purpose and data class are orthogonal. The same Message may have operational,
   contractual and legal-claim purposes with different deadlines.
3. Collect once, reference many. Raw provider payload, Message content, file or
   transcript is not copied into generic events, outbox, diagnostics, audit,
   notification, analytics or logs.
4. Immutable means that accepted facts cannot be rewritten to invent history.
   It does not mean that raw PII or content must remain embedded forever.
5. A technical skeleton may outlive content only when it is minimized, has an
   approved purpose and cannot resolve to removed PII without a separately
   retained lawful mapping.
6. Pseudonymized data remains personal data while Hulee or the tenant can
   re-identify it. Only irreversible, tested anonymization leaves the personal-
   data policy.
7. A provider timestamp never determines retention eligibility. Canonical
   received/created/terminal time and a versioned retention anchor do.
8. Replay-stream pruning uses a contiguous tenant/generation position boundary
   from ADR 0012, never a timestamp-only delete.
9. For hold-eligible classes, legal hold prevents purge, content-key destruction
   and object-version deletion but grants no read, search, export or reply
   authority. Live credentials, passwords, access tokens, session material and
   auth challenges are never made hold-eligible.
10. Deletion is a durable workflow with discovery, policy decision, execution,
    verification and evidence. A failed handler cannot produce “completed”.
11. Every derived or cached copy must be invalidated or deleted. A primary-row
    delete alone is not completion.
12. External/provider copies are reported honestly. Hulee records a deletion
    request/outcome where supported and never claims that an unsupported remote
    copy was erased.
13. Restoring a backup cannot resurrect data into active service. The deletion
    ledger is reapplied before access or processing resumes.
14. Plan expiry, quota or non-payment never silently deletes business data,
    blocks an already-authorized export or shortens a legal/contractual minimum.
15. Control-plane receives no customer content, subject index, export artifact
    or deletion payload. Data lifecycle executes locally in the data plane.

## Legal And Product Boundary

Hulee must record, per processing purpose and deployment profile:

- the regime-specific responsibility role, without treating different legal
  vocabularies as interchangeable: for example EU controller, joint controller,
  processor, recipient and subprocessor; or Russian personal-data operator,
  person processing on the operator's instruction, recipient and subcontractor;
- tenant/customer instructions when Hulee processes data on its instruction;
- applicable jurisdictions and residency constraints;
- lawful purpose/basis reference owned by the tenant/legal process;
- disclosure/subprocessor categories;
- retention rule or criteria;
- data-subject request behavior and exceptions;
- legal/contractual minimum and maximum, if known;
- policy owner and review date.

The deployment stores a versioned `DataGovernanceContext` containing these
roles, jurisdictions, residency regions, cross-border routes, applicable request
SLAs/extensions, industry profile and policy version. It is local data-plane
configuration; it is not inferred from an IP address or sent with customer
content to the control plane.

The product does not decide a legal basis from an event payload. A module cannot
mark data “consented” merely because a provider delivered it. Consent, contract,
legitimate-interest, legal-obligation and claim-defense records are explicit
purpose evidence managed by the responsible organization.

Shared SaaS commonly acts as a processor for tenant communication data and as a
controller for Hulee's own account, security and billing data, but the contract
and actual processing purpose remain authoritative. On-prem does not remove
tenant obligations: the customer operates the data plane, while the package
must still supply policy, export, delete, evidence and restore controls.

## Independent Classification Axes

Every storage root and module manifest declares all relevant axes. One enum is
not overloaded to represent them.

### Sensitivity

| Class                    | Examples                                                                    | Default handling                                                      |
| ------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `secret`                 | passwords, provider tokens, session material, private keys                  | encrypted/vaulted; never export/log/audit; shortest lifecycle         |
| `restricted_content`     | messages, staff notes, files, recordings, transcripts, raw provider payload | parent-bound authorization, encryption and content-specific retention |
| `sensitive_personal`     | special-category data, biometric/health-like content when present           | explicit purpose/profile; no generic extraction or analytics          |
| `personal_identifier`    | phone, email, provider identity, contact/custom fields, IP/device evidence  | field-level permissions, purpose and subject links                    |
| `personal_operational`   | assignments, read state, notification feed, detailed person-level facts     | scoped access and finite operational retention                        |
| `security_evidence`      | privileged audit, access evidence, denial/security signal                   | minimized, tamper-evident, separately restricted                      |
| `non_personal_aggregate` | proven anonymous counts with no stable person/resource key                  | business retention; re-identification tests still apply               |

Sensitivity drives access and handling, not the retention duration by itself.

### Processing purpose

Minimum purpose families are:

- `communication_delivery`;
- `customer_service_history`;
- `work_management`;
- `crm_relationship`;
- `source_replay_and_diagnostics`;
- `security_and_fraud_prevention`;
- `contract_and_billing_evidence`;
- `legal_claim_or_regulatory_duty`;
- `product_notification`;
- `manager_reporting`;
- `ai_or_transcription`;
- `data_subject_request_execution`.

Modules may add a versioned purpose through the module contract. They cannot
reuse a broad purpose to retain unrelated data or extend an existing purpose
silently.

### Lifecycle action

Allowed expiry actions are explicit:

- `hard_delete`;
- `purge_content_keep_tombstone`;
- `remove_identity_resolution_keep_subjectless_fact`;
- `pseudonymize`;
- `anonymize_and_reaggregate`;
- `compact_to_safe_skeleton`;
- `external_delete_request_then_track`.

`pseudonymize` is never reported as erasure or anonymization.
`blocked_by_legal_hold` is a policy-evaluation outcome carrying the exact hold
case, revision and review time. It is forbidden as a persisted expiry action.

### Versioned core data-class catalog

`DataClass` is a versioned registry ID, not a free string. `core:*` is reserved
for the shared core. A module may register `module:<moduleId>:<class>` only when
its manifest declares the parent/root class, sensitivity, allowed purposes,
subject-link behavior, export projection and every delete/verification handler.
A data-storing module cannot be enabled, disabled or uninstalled while this
declaration or a compatible handler is missing.

A module purpose must map directly to a core purpose as its safety ceiling and
cannot weaken the parent's responsibility-role or subject-discovery
requirements. Every module data class must pin exactly one finite or
parent-inherited retention rule, at an exact revision, for every allowed
purpose. The rule must keep the parent class's purpose/action/hold ceiling and
bind the declared lifecycle, delete and absence-verification handlers. A
purpose without a class/rule/data-use attachment, a stale rule reference or a
read-only locally materialized root makes registry composition fail closed.

For S3-compatible storage, live object data and retained versions/backups are
separate logical lifecycle surfaces even when one physical service stores both.
The live surface is an `object` root that must enumerate and delete every object
version. A finite version/backup tail is a `backup` root using
`core:backup_copy_or_object_version` (or a compatible module child) and an
expiry ledger. A live attachment class cannot be relabeled as a backup, and a
backup class cannot be attached to the live object root.

The table below is the minimum core catalog. Window labels refer to the
illustrative development profile in the next section: `E1H`, `E24H`, `E7D`, `E30D`,
`E90D`, `E365D` and `E35D` are elapsed periods; `C3Y` is three calendar years;
`parent` means no later than every still-live parent/purpose; `profile_required`
means production activation is rejected until the governance profile supplies
a finite or reviewed condition-based rule. Each row remains independently
configurable even where defaults currently match.

| DataClass ID                                      | Canonical anchor                       | Development window           | Expiry action                                      | Hold | Subject/tenant export behavior                         |
| ------------------------------------------------- | -------------------------------------- | ---------------------------- | -------------------------------------------------- | ---- | ------------------------------------------------------ |
| `core:raw_event_envelope`                         | terminal processing                    | `E90D`                       | `compact_to_safe_skeleton`                         | yes  | normalized subject projection / tenant manifest        |
| `core:raw_provider_payload`                       | terminal processing                    | `E30D`                       | `hard_delete`                                      | yes  | normalized in-scope projection, never blind raw dump   |
| `core:raw_provider_allowed_headers`               | terminal processing                    | `E30D`                       | `hard_delete`                                      | yes  | normalized in-scope projection, secrets never included |
| `core:normalized_event_envelope`                  | materialization/final failure          | `E90D`                       | `compact_to_safe_skeleton`                         | yes  | in-scope normalized fields / tenant manifest           |
| `core:normalized_event_payload`                   | materialization/final failure          | `E90D`                       | `hard_delete`                                      | yes  | in-scope normalized fields                             |
| `core:source_delivery_dedupe_skeleton`            | terminal processing                    | `profile_required`           | `hard_delete`                                      | no   | omit; describe dedupe outcome                          |
| `core:domain_event_commit_envelope`               | tenant commit                          | `profile_required`           | `compact_to_safe_skeleton`                         | yes  | relevant decision facts / tenant manifest              |
| `core:domain_event_content_or_evidence_ref`       | parent commit                          | `parent`                     | `hard_delete`                                      | yes  | resolved through authorized parent projection          |
| `core:outbox_dispatch_envelope`                   | terminal outcome                       | `E90D`                       | `compact_to_safe_skeleton`                         | yes  | safe outcome / tenant manifest                         |
| `core:outbox_webhook_dispatch_body`               | terminal outcome                       | `E30D`                       | `hard_delete`                                      | yes  | in-scope normalized projection, not delivery dump      |
| `core:replay_sync_delta`                          | committed stream position              | `E90D`                       | `hard_delete` by contiguous position prefix        | yes  | represented by canonical snapshot                      |
| `core:timeline_item_envelope`                     | canonical item commit                  | `profile_required`           | `compact_to_safe_skeleton`                         | yes  | relevant technical facts                               |
| `core:message_content_blocks`                     | canonical item time                    | `E365D`                      | `purge_content_keep_tombstone`                     | yes  | authorized content with third-party redaction          |
| `core:staff_note_content_blocks`                  | canonical item time                    | `E365D`                      | `purge_content_keep_tombstone`                     | yes  | no blanket exclusion; case-specific legal redaction    |
| `core:timeline_tombstone`                         | content purge/revision                 | `profile_required`           | `compact_to_safe_skeleton` or `hard_delete`        | yes  | deletion fact without removed content                  |
| `core:source_account_identity_and_alias`          | account replacement/relationship end   | `profile_required`           | `remove_identity_resolution_keep_subjectless_fact` | yes  | relevant account identity/alias proof                  |
| `core:external_thread_identity_and_alias`         | thread relationship end                | `profile_required`           | `remove_identity_resolution_keep_subjectless_fact` | yes  | relevant thread identity/alias proof                   |
| `core:source_thread_binding`                      | unbind/source termination              | `profile_required`           | `remove_identity_resolution_keep_subjectless_fact` | yes  | relevant source relationship / tenant manifest         |
| `core:source_occurrence_and_external_reference`   | terminal occurrence/resolution         | `profile_required`           | `compact_to_safe_skeleton`                         | yes  | safe provider occurrence/reference facts               |
| `core:outbound_route_and_policy`                  | route/policy replacement               | `profile_required`           | `compact_to_safe_skeleton`                         | yes  | authorized immutable route/policy facts                |
| `core:outbound_dispatch_attempt_and_artifact`     | terminal dispatch/artifact outcome     | `profile_required`           | `compact_to_safe_skeleton`                         | yes  | safe provider attempt/artifact facts                   |
| `core:outbound_dispatch_reconciliation`           | terminal reconciliation decision       | `profile_required`           | `compact_to_safe_skeleton`                         | yes  | safe uncertainty/decision evidence                     |
| `core:conversation_state`                         | conversation terminal/relationship end | `profile_required`           | `compact_to_safe_skeleton` or `hard_delete`        | yes  | authorized conversation state                          |
| `core:work_item_state`                            | WorkItem terminal time                 | `profile_required`           | `compact_to_safe_skeleton` or `hard_delete`        | yes  | authorized work/SLA state                              |
| `core:work_assignment_history`                    | assignment interval close              | `profile_required`           | `compact_to_safe_skeleton` or `hard_delete`        | yes  | in-scope responsibility history                        |
| `core:employee_conversation_read_state`           | Employee/Conversation relation end     | `E90D`                       | `hard_delete`                                      | no   | in-scope personal operational state                    |
| `core:participant_membership`                     | membership end                         | `profile_required`           | `remove_identity_resolution_keep_subjectless_fact` | yes  | requester membership; protect other participants       |
| `core:source_external_identity`                   | unlink/relationship end                | `profile_required`           | `remove_identity_resolution_keep_subjectless_fact` | yes  | aliases/identifiers where legally in scope             |
| `core:client_contact_profile`                     | relationship end                       | `profile_required`           | `remove_identity_resolution_keep_subjectless_fact` | yes  | subject/client projection                              |
| `core:crm_value_and_history`                      | relationship/case end                  | `profile_required`           | `remove_identity_resolution_keep_subjectless_fact` | yes  | in-scope values/history with provenance                |
| `core:conversation_client_link_history`           | link episode/relationship end          | `profile_required`           | `remove_identity_resolution_keep_subjectless_fact` | yes  | authorized link history; protect other group subjects  |
| `core:client_merge_node_state`                    | Client/merge relationship end          | `profile_required`           | `remove_identity_resolution_keep_subjectless_fact` | yes  | authorized current resolution; never an access grant   |
| `core:client_merge_redirect_history`              | source/canonical relationship end      | `profile_required`           | `remove_identity_resolution_keep_subjectless_fact` | yes  | authorized redirect/current-resolution history         |
| `core:file_metadata`                              | all parent links/purposes end          | `parent`                     | `hard_delete`                                      | yes  | authorized metadata / manifest                         |
| `core:file_original_binary`                       | all parent links/purposes end          | `parent`                     | `hard_delete` all versions                         | yes  | authorized file, otherwise omission/redaction          |
| `core:file_derived_binary`                        | source/last required use               | earlier of `parent` / `E30D` | `hard_delete`                                      | yes  | normally regenerated/omitted                           |
| `core:call_metadata`                              | call completion                        | `E365D`                      | `compact_to_safe_skeleton`                         | yes  | in-scope call facts                                    |
| `core:call_recording`                             | call completion                        | `E90D`                       | `purge_content_keep_tombstone`                     | yes  | profile-specific reviewed export                       |
| `core:call_transcript`                            | call completion                        | `E90D`                       | `purge_content_keep_tombstone`                     | yes  | profile-specific reviewed export                       |
| `core:ai_prompt_output_embedding`                 | source parent/last required use        | `parent`                     | `hard_delete`                                      | yes  | explicit in-scope inference; embedding is not portable |
| `core:notification_endpoint`                      | revoke/deactivation                    | `E30D`                       | `hard_delete`                                      | no   | endpoint facts only when legally in scope              |
| `core:notification_preview_payload`               | source/creation                        | earlier of `parent` / `E7D`  | `hard_delete`                                      | yes  | canonical source projection, not copied preview        |
| `core:notification_feed_delivery`                 | creation/terminal outcome              | `E90D`                       | `hard_delete` or safe outcome compaction           | no   | relevant delivery facts                                |
| `core:analytics_person_fact`                      | event time                             | `E365D`                      | `remove_identity_resolution_keep_subjectless_fact` | yes  | in-scope fact/decision                                 |
| `core:analytics_subject_bridge`                   | source fact/relationship end           | `E365D`                      | `hard_delete`                                      | yes  | discovery bridge only, never an auth grant             |
| `core:analytics_anonymous_rollup`                 | rollup window close                    | `profile_required`           | `anonymize_and_reaggregate` or `hard_delete`       | no   | no subject lookup after proven anonymization           |
| `core:domain_audit_skeleton`                      | action time                            | `C3Y`                        | approved compaction or `hard_delete`               | yes  | relevant safe decision facts                           |
| `core:privileged_security_audit_skeleton`         | action time                            | `C3Y`                        | approved compaction or `hard_delete`               | yes  | restricted relevant facts                              |
| `core:security_denial_signal`                     | signal time                            | `E30D`                       | `anonymize_and_reaggregate` or `hard_delete`       | no   | aggregate/decision facts where legally in scope        |
| `core:platform_audit_skeleton`                    | action time                            | `C3Y`                        | approved compaction or `hard_delete`               | yes  | no customer content; tenant manifest if relevant       |
| `core:privacy_sensitive_evidence`                 | case completion/release                | `profile_required`           | `hard_delete`                                      | yes  | dedicated reviewed response, never generic export      |
| `core:external_deletion_residual_evidence`        | final external outcome                 | `C3Y`                        | approved compaction or `hard_delete`               | yes  | status/evidence reference, not external content        |
| `core:export_partial_artifact`                    | cancel/failure                         | `E1H`                        | `hard_delete` all versions                         | no   | never downloadable                                     |
| `core:export_ready_artifact`                      | ready                                  | `E24H`                       | `hard_delete` all versions                         | no   | authorized one-use/revocable download                  |
| `core:export_manifest_evidence`                   | artifact expiry/request completion     | `profile_required`           | approved compaction or `hard_delete`               | yes  | counts, omissions and safe evidence                    |
| `core:operational_log_trace_diagnostic`           | creation                               | `E30D`                       | `hard_delete`                                      | no   | never exported as a raw log dump                       |
| `core:support_bundle`                             | support case close                     | `E7D`                        | `hard_delete` all versions                         | no   | opt-in tenant artifact only                            |
| `core:auth_credential_session_challenge_secret`   | revoke/expiry/completion               | immediate or `E24H`          | `hard_delete`/verified key destruction             | no   | never                                                  |
| `core:auth_security_outcome`                      | revoke/expiry/completion               | `E30D`                       | `compact_to_safe_skeleton` or `hard_delete`        | no   | safe outcome only when legally in scope                |
| `core:source_account_connector_metadata`          | disconnect/account termination         | `profile_required`           | `hard_delete` or safe outcome compaction           | yes  | authorized configuration without secrets               |
| `core:access_grant_invitation_membership_history` | revoke/expiry/membership end           | `profile_required`           | `compact_to_safe_skeleton` or `hard_delete`        | yes  | relevant access facts                                  |
| `core:webhook_config_and_delivery_metadata`       | disable/delete/terminal outcome        | `profile_required`           | `hard_delete` or safe outcome compaction           | yes  | authorized tenant config, secrets excluded             |
| `core:usage_billing_entitlement_fact`             | billing/contract period close          | `profile_required`           | `compact_to_safe_skeleton` or `hard_delete`        | yes  | separate account/contract export                       |
| `core:tenant_brand_asset`                         | replacement/tenant termination         | `parent`                     | `hard_delete` all versions                         | yes  | tenant export, subject export only if legally in scope |
| `core:backup_copy_or_object_version`              | backup/version creation                | `E35D` maximum               | expire/`hard_delete`                               | yes  | never restored merely to answer a request              |
| `core:erasure_hold_restore_ledger`                | completion/release                     | `profile_required`           | approved compaction or `hard_delete`               | yes  | safe evidence only                                     |

`profile_required` is a fail-closed catalog rule, not permission to retain data
indefinitely. Contract/schema/module completeness tests enumerate every SQL
table/column carrying payload, JSON/blob/object/index/cache/log root and reject a
production build or module activation if it lacks catalog metadata, purpose,
anchor, subject behavior and registered lifecycle handlers.

Persistence mapping remains explicit: `INB2-DB-001` owns
`core:conversation_state`; `INB2-DB-004` owns `core:work_item_state` and
`core:work_assignment_history`; `INB2-DB-006` owns
`core:employee_conversation_read_state`. Matching default periods never permit
these roots to share one rule, anchor, subject behavior or hold decision.

## Canonical Policy Model

The contracts introduced by `INB2-CON-010` use the following conceptual model:

```ts
type ResponsibilityRole =
  | {
      regime: "eu";
      role:
        | "controller"
        | "joint_controller"
        | "processor"
        | "recipient"
        | "subprocessor";
    }
  | {
      regime: "ru_152_fz";
      role:
        | "personal_data_operator"
        | "processor_on_operator_instruction"
        | "recipient"
        | "subcontractor";
    }
  | {
      regime: "approved_extension";
      regimeId: `extension:${string}`;
      roleId: `extension:${string}`;
      approvedProfileRef: string;
    };

type RetentionPeriod =
  | { kind: "elapsed"; seconds: number }
  | {
      kind: "calendar";
      years?: number;
      months?: number;
      days?: number;
    }
  | {
      kind: "business_days";
      days: number;
      calendarId: string;
    };

type DataGovernanceContext = {
  id: string;
  tenantId: string;
  version: number;
  rolesByPurpose: Record<ProcessingPurpose, ResponsibilityRole[]>;
  jurisdictionProfileIds: string[];
  residencyRegionIds: string[];
  crossBorderRouteIds: string[];
  timezone: string;
  businessCalendarIds: string[];
  requestSlaProfileId: string;
  industryProfileIds: string[];
  approvedAt: string;
  reviewAt: string;
};

type DataLifecycleRule = {
  dataClass: DataClass;
  purpose: ProcessingPurpose;
  retentionAnchor: RetentionAnchor;
  retentionWindow:
    | { kind: "fixed_after_anchor"; period: RetentionPeriod }
    | {
        kind: "until_condition_then_period";
        condition: RetentionEndCondition;
        period: RetentionPeriod;
        reviewPeriod: RetentionPeriod;
      };
  actionAtExpiry: LifecycleAction;
  backupMaximum: RetentionPeriod;
  legalMinimum?: RetentionPeriod;
  legalMaximum?: RetentionPeriod;
  allowTenantShorter: boolean;
  allowTenantLonger: boolean;
  holdEligible: boolean;
};

type PolicyTemplate = {
  kind: "template";
  id: string;
  version: number;
  deploymentProfile: "saas_shared" | "saas_isolated" | "on_prem";
  jurisdictionProfileIds: string[];
  effectiveAt: string;
  rules: DataLifecycleRule[];
};

type EffectiveTenantPolicy = {
  kind: "effective_tenant";
  id: string;
  tenantId: string;
  version: number;
  templateRefs: Array<{ id: string; version: number }>;
  governanceContextRef: { id: string; version: number };
  effectiveAt: string;
  rules: DataLifecycleRule[];
};

type DataLifecyclePolicy = PolicyTemplate | EffectiveTenantPolicy;

type LifecycleEvaluation = {
  tenantId: string;
  policyRef: { id: string; version: number };
  governanceContextRef: { id: string; version: number };
} & (
  | {
      outcome: "eligible_for_action";
      action: LifecycleAction;
      eligibleAt: string;
    }
  | {
      outcome: "blocked_by_legal_hold";
      holdId: string;
      holdRevision: number;
      reviewAt: string;
    }
);
```

The persisted shape may normalize this model. It must retain the same semantics.
Calendar and business-day periods resolve using the timezone, holiday calendar
and boundary rules pinned by the jurisdiction/deployment profile. A template is
never applied directly to customer rows: every destructive evaluation requires
an `EffectiveTenantPolicy` with a non-empty `tenantId`.
Period validation rejects zero/negative/empty calendar values, an unversioned
business calendar and ambiguous local-time boundaries. The resolution records
the profile/calendar versions and computed UTC eligibility time as evidence.
Built-in `eu` and `ru_152_fz` role IDs are reserved. An extension must use its
approved namespaced IDs and cannot widen either closed built-in role vocabulary.

An end condition can be contract/account/relationship termination, case closure
or another versioned server-owned fact. It cannot be a free-text promise,
mutable last-view timestamp or provider/client clock. A condition that has not
resolved is reviewed at its configured interval; it cannot become an unnoticed
forever flag.

### Executable contract integrity and policy activation

The `INB2-CON-010` contract layer treats schema-valid input as untrusted wire
data, not as an executable policy decision. Governance contexts, the composed
core/module lifecycle registry, policy templates, effective tenant policies,
subject-discovery manifests, frozen privacy-scope manifests and deletion plans
are created through canonical constructors. Their domain-separated SHA-256
digests are recalculated from every semantic field while excluding the digest
field itself. The registry `compositionHash` additionally pins the exact
catalog, storage roots, data uses, external routes and compatible projection,
export, delete and absence-verification handlers.

Objects used as executable authority are deep-frozen and registered as
authentic constructor results. A caller-authored object that merely reproduces
the schema and digest cannot replace an authentic governance context, registry,
template/effective policy, discovery result, lifecycle evaluation, request,
deletion plan/run or export materialization at a boundary that requires one.
A canonical hash proves exact contract composition; it is not a signature,
authorization decision, persistence guarantee or reason to retain payload data.

Policy resolution produces an immutable candidate, not an active destructive
policy. Activation requires a trusted complete impact-source proof and a
canonical preview bound to the candidate and the current activated policy. The
proof pins its source version, registry composition, stream/generation high-
water, prior policy, exact rule diff, rows/bytes, hold and backup impact and the
earliest destructive time. Omitting an affected class/root or presenting a
caller-composed preview fails closed.

The contract-level activation ledger performs a reviewed compare-and-set
transition against the current policy and activation reference. It requires:

- an explicit reviewed bootstrap when no policy exists, otherwise exact
  supersession of the current activation;
- different requester and approver principals;
- current exact-scope authorization at request, approval and activation time;
- ordered request/approval timestamps and a non-zero `notBefore` cooling fence;
- a fresh complete preview and a unique activation ID/revision;
- rollback as a new reviewed candidate that references the prior lineage, never
  mutation of a previously activated policy.

The activation compare-and-set also reloads the impact source at the exact
`activatedAt` boundary. Its stream/generation high-water, snapshot hash,
affected roots/bytes, holds, backups and earliest destructive time must still
equal the reviewed proof. Any post-review drift rejects activation and requires
a new complete preview and cooling cycle.

The lifecycle evaluator accepts only the currently activated authentic policy.
Its purpose, hold and restriction inputs come from a registered server-owned
complete-state source. The canonical source proof/snapshot pins all active
purposes for the target, all relevant current holds and restrictions, their set
revisions, registry/policy/target references and the exact high-water at the
evaluation time. A partial caller-supplied purpose/control array is not a valid
evaluation input.

Callbacks that can enumerate scope, evaluate a prospective matcher, package an
archive, resolve a fingerprint reset or persist a one-use export claim are
non-JSON composition-root capabilities. A service registers them during trusted
bootstrap against the exact registry/source identity and injects the returned
object. API payloads, deserialized callback lookalikes and arbitrary endpoint
functions are not executable authority.

These contracts define state-transition semantics and required registered
capabilities; they do not provide production persistence. Any in-memory/reference
ledger is test-only. Durable policy/activation state, transactional database CAS,
leases and worker recovery remain owned by `INB2-DB-009` and `INB2-OPS-006`;
this section does not claim that those production tasks are already implemented.

For every storage root, policy evaluation has:

- tenant and deployment profile;
- data class and sensitivity;
- one or more active purpose instances;
- canonical retention anchor;
- subject references when structurally known;
- source/parent references;
- policy version applied at collection and at decision time;
- current hold/restriction state;
- computed eligibility and lifecycle action.

When several lawful purposes apply, the record remains while at least one
purpose remains valid. The effective eligible time is the latest valid purpose
deadline, bounded by any legal maximum. A purpose extension is a new audited
decision; editing a policy cannot silently repurpose already-collected data.

### Policy precedence

The evaluator applies this order:

1. tenant/deployment and jurisdiction safety envelope;
2. active legal hold as a separate preservation blocker;
3. explicit legal/contractual purpose deadlines and legal maximum;
4. processing restriction as a limit on use, not an implicit retention
   extension;
5. tenant-selected duration within the approved envelope;
6. product baseline when no narrower approved tenant choice exists;
7. plan/entitlement allowance for optional longer storage.

A restriction does not by itself postpone expiry or override a legal maximum.
If the applicable regime requires storage-only preservation while a correction,
objection or dispute is unresolved, the decision creates a separately approved,
versioned storage-only purpose/condition with owner, scope, end condition and
review schedule. Otherwise ordinary expiry proceeds. A restriction never turns
into a generic hold.

An entitlement can offer a longer window or prevent selecting an unsupported
premium profile. It cannot override a hold, legal minimum/maximum, deletion
request decision or contractually required export access.

### Policy changes

A policy revision is immutable and audited. Before activation, the system shows
counts/bytes by class, rows newly eligible, held rows, affected backups and the
earliest destructive time. Shortening a window requires an approval/cooling
period and a fresh preview. Lengthening requires a documented continuing
purpose; a commercial upgrade alone is not a lawful purpose.

Unknown data classes cannot enter production as unbounded JSON. A provider or
company module declares field classification and redaction through its versioned
contract. Generic raw payload is always classified as restricted provider data;
unknown normalized fields fail validation or remain quarantined from core,
export, notification and analytics.

## Illustrative Development Profile

These periods are illustrative development defaults for contract tests, local
fixtures and policy previews. They are not a production SaaS compliance profile
and are not a claim that a deployment complies with a particular law or
industry. Production activation requires a reviewed governance profile and may
use different values.

| Data class / state                            | Baseline eligibility anchor and period                    | Expiry action                                           |
| --------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Active auth challenge secret payload          | creation + maximum 24 hours; terminal/revoke immediately  | make unusable and hard delete synchronously             |
| Session/API token verification material       | revoke/expiry immediately                                 | make unusable and hard delete; safe outcome is separate |
| Successful approved raw payload/header subset | terminal processing + 30 days                             | purge payload/headers; keep keyed dedupe skeleton       |
| Failed/DLQ raw payload                        | final review/resolution + 90 days                         | purge payload; keep diagnostic outcome                  |
| Normalized inbound payload                    | successful materialization/final failure + 90 days        | compact to source/canonical reference skeleton          |
| Outbox/webhook/dispatch body                  | terminal outcome + 30 days                                | purge body; keep safe result/idempotency skeleton       |
| Message/timeline content                      | canonical item time + 365 days                            | content purge plus revisioned tombstone                 |
| File/attachment original                      | all live parent/purpose deadlines                         | delete all object versions and metadata PII             |
| Derived thumbnail/transcode                   | earlier of source deadline or last required use + 30 days | hard delete                                             |
| Call recording and transcript content         | canonical call completion + 90 days                       | content purge; retain allowed call fact skeleton        |
| Call metadata/operational timeline            | canonical call completion + 365 days                      | subjectless/pseudonymous fact or tombstone              |
| Notification preview/push payload             | earlier of source deadline or creation + 7 days           | hard delete                                             |
| Logical notification feed                     | creation + 90 days                                        | delete content/state; keep bounded aggregate if needed  |
| Endpoint token hash/device metadata           | revoke/deactivation + 30 days                             | hard delete                                             |
| Person-level analytics fact                   | event time + 365 days                                     | erase subject bridge, rebuild/reaggregate               |
| Proven anonymous aggregate                    | product policy, reviewed annually                         | business delete/rollup; no subject request lookup       |
| Application logs/traces with safe identifiers | creation + 30 days                                        | hard delete                                             |
| Security denial detail                        | creation + 30 days                                        | aggregate or delete; bounded counters may remain        |
| Privileged/domain audit skeleton              | action time + 3 calendar years                            | delete/compact under approved audit profile             |
| Privacy/delete/hold evidence skeleton         | completion/release + 3 calendar years                     | delete/compact under approved evidence profile          |
| Ready export artifact                         | ready time + 24 hours                                     | delete every object version/key                         |
| Failed/cancelled partial export               | failure/cancel immediately, operational target <= 1 hour  | quarantine, then hard delete                            |
| Online backup/object deleted versions         | backup/version creation + maximum 35 days                 | expire/delete; restore must reapply erasure ledger      |

The baseline does not permit a child copy to outlive its parent merely because
it sits in another table, queue, cache, index or bucket. A separately approved
purpose is required. Tenant configuration may choose shorter periods when the
legal/deployment profile permits. Longer retention must be explicit and
reviewed; no universal maximum is asserted until legal/product owners approve
the target production profiles.

The Russian profile represents the destruction-evidence period from
Roskomnadzor Order No. 179 as a calendar `P3Y`, not as 1,095 elapsed days. The
selected jurisdiction profile remains authoritative for its applicability,
anchor and other evidence classes.

## Retention Anchors And Parent Rules

Allowed anchors are server-owned facts such as:

- `received_at` for raw ingress;
- `terminal_processing_at` for source/outbox/notification attempts;
- canonical `created_at`/`committed_at` for a TimelineItem;
- `completed_at` for a call/export/request;
- `revoked_at`/`expires_at` for session, grant, challenge or endpoint;
- `released_at` for a legal hold;
- tenant stream position for replay pruning.

Provider time, file EXIF time, client clock and mutable “last viewed” do not
extend retention. “Last Conversation activity” is not the default because one
new message would indefinitely retain every old message in a busy group.

Attachments, thumbnails, transcripts, notification previews, search documents,
embeddings and report bridges inherit their parent deadline or a shorter class
deadline. When one physical file/object has several parent links, deleting one
Message detaches only that relation. Physical bytes, versions and shared
metadata are deleted only after every live parent reference and purpose is
eligible and no applicable hold blocks the object. A separately approved purpose
may retain a minimized derivative, but must not retain the original content
through an accidental copy.

Authorization/cookie headers, passwords, tokens and provider session material
are stripped before raw-event persistence and are never justified as replay
evidence. Only an adapter-declared allowlisted header subset needed to validate
or diagnose an event may enter restricted raw evidence.

## PII Registry And Data-Subject Discovery

Inbox V2 uses a typed subject reference, not a generic email/phone search as an
identity model:

- Employee;
- ClientContact;
- SourceExternalIdentity;
- unresolved external subject scoped to provider realm/account;
- authenticated Account identity where Hulee is the controller.

`DataSubjectLink` connects a storage root to one or more subject references with
role and provenance: author, participant, contact, caller, recording speaker,
mentioned person, CRM subject, owner or security actor. It never creates a
principal, Client, participant, membership, WorkItem or authorization grant.

Group chats, calls and free text can contain several people and incidental PII.
Structured links provide deterministic discovery but cannot claim to find every
name written inside arbitrary content. A privacy request records discovery
coverage:

- exact structured links and identity aliases;
- provider/account-scoped identifiers;
- indexed/search-assisted candidate matches;
- attachments/recordings requiring manual review;
- external recipients and unsupported surfaces.

Search-assisted matches are candidates, not automatic identity claims or delete
authority. A reviewer confirms them under dedicated permission.

Executable discovery is resolved only through a registered server-owned
complete-state source. Its proof pins the registry composition, source
ID/version, exact sorted set of scanned subject-discovery handlers,
`streamEpoch`, `syncGeneration`, `completeThroughPosition`, manifest reference
and canonical root/subject/link/coverage set hashes. Every returned root must
have exact registered discovery lineage. An empty result is complete only with
canonical zero evidence over the same source, registry and high-water fences.
A raw subset, clone or caller-recomputed manifest/digest remains wire data and
cannot authorize a request.

## Privacy Request Workflow

Supported request intents are versioned:

- access/export;
- portability where applicable;
- correction;
- erasure;
- restriction of processing;
- objection;
- tenant termination/export-delete;
- internal administrative purge under policy.

The durable state machine is:

```text
received
  -> identity_verification
  -> scope_discovery
  -> policy_and_exception_review
  -> approved | partially_approved | rejected | blocked_by_legal_hold
  -> executing
  -> verification_pending
  -> completed
     | completed_with_external_residuals
     | primary_purged_backup_expiry_pending
     | verification_blocked_internal_residual
     | failed_retryable
```

Identity verification evidence is stored separately, minimized and never copied
into generic audit. Requester identity does not grant access to other people in
a group. A response/export must protect the rights, confidential content and
identifiers of other participants and employees.

Every decision records purpose, rule/profile version, scope, reviewer, reason,
exceptions, deadline, handler outcomes and external residuals. Stable errors do
not disclose hidden tenant/resource existence.

Advancing a request past decision requires the authentic current governance
context, the exact policy that is still current in its activation ledger, the
same registry/discovery completeness proof and a registered server authority
source. The decision pins exactly one current policy rule ID/revision for each
root-purpose pair and a responsibility role/jurisdiction valid in that
governance context. Claimed aliases must equal the verified-subject set and each
alias must also occur in discovery; discovered third parties are not silently
promoted to requester aliases. The authority result must bind the same reviewer
and be current at decision time.

The discovery assessment is also the source of truth for group protection.
Requester-only roots forbid invented redaction. Mixed roots can be approved
only with the exact discovered redaction, or omitted with the exact discovered
omission. Third-party-only and unresolved/review-required roots fail closed with
the matching policy/scope exception rather than treating `not_applicable` as an
approval shortcut.

The executable request result is also an authenticity boundary. It binds the
canonical immutable discovery manifest and the exact per-root decision set. A
destructive decision can complete only through the same-tenant chain
`authentic request -> canonical deletion plan -> authentic deletion run`: the
plan freezes the scope manifest, decision basis, lifecycle-evaluation hashes,
policy/governance revisions and required handlers; the run binds that exact
plan and its stage-one/physical/verification outcomes; the terminal request
references those exact authentic objects. Self-declared plan/run references or
proofs copied from another request, root or revision are rejected.

Tenant termination has an additional export-before-erase fence. Completion
requires one authentic, ready and unexpired tenant/deployment terminal bundle
whose exact job, manifest, artifact checksum, governance context, active policy
and canonical exported root set match the request. The normalized export handler
must precede erase for every approved internal root. A synthetic handler success,
schema-valid artifact reference, clone or bundle from another revision cannot
authorize terminal erase completion.

Tenant termination does not reuse subject discovery as deployment scope. A
registered complete-state source scans the exact current registry data-use set
at one tenant stream/generation high-water and records every observed root with
entity and lineage revisions. Each root is classified as
`export_then_erase`, `erase_without_export` (secrets, registry omissions and
backup copies) or `external_delete_and_track`. The export manifest must cover
the exact exportable subset, while the deletion plan covers the full root set.
Immediately before destructive I/O the source compare-and-sets the same
high-water/root hashes and seals new customer-data writes; drift requires a new
enumeration and export.

The terminal bundle is required as soon as tenant-termination execution exists,
not only when a request claims completion. Plan construction, execution-proof
resolution and run construction recheck the request decision, current
governance/policy activation, RBAC checkpoints, tenant-scope authority and the
artifact's ready/present/not-revoked state before any adapter I/O. Expiry is an
exclusive boundary: an artifact expiring exactly at the check time is invalid.

`completed_with_external_residuals` is reserved for copies outside the operated
data plane, such as a provider or recipient surface that Hulee cannot verify.
Known finite backup expiry after verified primary purge uses
`primary_purged_backup_expiry_pending`; an internal copy or restore path that
cannot be verified uses `verification_blocked_internal_residual`. `completed`
means the scoped platform workflow met every required verification in its pinned
profile; it is not a blanket legal assertion about undisclosed recipient copies.

### Restriction is not deletion

A processing restriction immediately prevents prohibited secondary use while
allowing only the approved storage/claim/legal operations. It does not silently
delete, and it is modeled separately from legal hold:

- restriction controls allowed processing;
- hold controls physical preservation;
- RBAC controls who may access;
- none of them creates another.

Restriction has an owner, exact processing scope, effective/end condition and
review schedule. It does not extend retention by itself. Storage beyond the last
ordinary purpose requires the explicit storage-only purpose described in policy
precedence or an active legal hold.

## Export Policy

There are three different products:

1. Tenant/deployment export for an authorized tenant administrator.
2. Manager/report export governed by ADR 0013 aggregate/drilldown/PII rules.
3. Verified data-subject access/portability export with third-party redaction.

They cannot share a permission-only “export everything” endpoint.

An export job:

- records tenant, actor/request case, normalized scope, purpose, fields, format,
  policy/schema version, authorization decision/epoch and content classes;
- takes a consistent versioned snapshot or explicit high-water mark;
- reauthorizes each bounded chunk and again before download;
- never includes secrets or usable auth/session material;
- does not treat an `internal-only` label or raw provider storage format as a
  blanket subject-access exception: in-scope requester personal data is projected
  into the normalized response unless a specific legal, security or third-party
  protection rule applies and records its reason; raw envelopes are not dumped;
- represents group data with third-party redaction/omission rules;
- emits a manifest, counts, omissions/reasons, checksums and external residuals;
- encrypts the artifact and uses a short-lived one-use/revocable download;
- quarantines then deletes every partial artifact on revoke/failure;
- deletes the ready artifact after its TTL, including object versions;
- records only a minimized evidence skeleton after artifact deletion.

Executable export authority is product-specific. Tenant/deployment export uses
its tenant-wide approval and current authority; manager/report export requires
an authentic report-scope proof containing every applicable aggregate,
drilldown and PII permission plus exact authorized roots; data-subject export
requires an authentic verified request/discovery/decision proof with exact
approved roots. One product's proof cannot be reused for another product.
Manager `aggregate` scope accepts only `anonymous_only` classes; aggregate and
drilldown proofs cannot authorize personal-identifier, sensitive-personal or
personal-operational classes. Such classes require the explicit PII report
scope and permissions from ADR 0013. A manager proof is also principal-bound:
its authority-source query, report-scope/root/lineage decisions, export job,
every materialization chunk and issue/consume receipt must name one exact
principal. Another employee's current PII proof cannot be reused with a generic
report-export decision.

Each materialized chunk binds one root, its expected entity and lineage
revisions, and authorization/restriction decisions current at the exact
`materializedAt` time. A zero-result export uses separately authorized canonical
zero evidence; an empty caller assertion is insufficient. The manifest
constructor derives totals, the canonical root set, continuous chunk boundary,
zero/completeness hashes and the final `manifestHash` rather than trusting
caller-provided counters or digests.

A ready archive is authentic only after materialization binds its encrypted
payload checksum, exact manifest, archive-composition hash and packaging proof.
The terminal bundle preserves exact job/product/scope/boundary/governance/
policy/format/manifest/artifact lineage. Download issuance then claims that
bundle once for one principal, and consumption compare-and-sets the authentic
issued receipt revision while rechecking current product and artifact
authorization. Reissue, double consumption, principal substitution, stale
revision and an expired/revoked artifact fail closed.

Issue and consume require a registered non-JSON claim-repository capability;
there is no process-local one-use ledger that is valid for production. The
canonical unique claim key covers tenant, artifact ID and artifact revision.
Issuance binds that claim to one tenant/principal/receipt and the exact
job/manifest/packaging lineage; consumption compare-and-swaps the issued receipt
revision while preserving the same bundle lineage. The durable claim also pins
the canonical hash of the issued receipt's immutable state, so a caller cannot
forge a different `before` value while retaining its ID/revision. Production implementations
must provide durable uniqueness and transactional CAS across processes and
restarts. The repository interface and fail-closed contract are owned by
`INB2-CON-010`; its database implementation, indexes, crash recovery and
artifact cleanup remain `INB2-DB-009` and `INB2-OPS-012` work.

Machine-readable JSON and CSV use versioned schemas. Files can be supplied in an
encrypted archive with a manifest. A data-subject export distinguishes data
provided by the subject, observed provider facts, Hulee/tenant decisions and
inferred/candidate matches. It does not claim portability for data outside the
applicable legal scope.

Access and portability are separate decisions. Access covers the personal data
and required processing information defined by the applicable profile, including
in-scope facts originating from internal/raw stores after normalization and
lawful redaction. Portability uses its narrower approved schema and does not
automatically include every inferred, internal decision or third-party field.

## Deletion And Erasure Semantics

Provider message deletion, employee UI delete, tenant retention expiry and a
privacy erasure request are distinct commands and audit reasons. A provider
delete capability cannot satisfy a privacy request by itself, and a local
retention purge cannot pretend the provider removed its copy.

### Two-stage local deletion

1. A transaction marks the target unavailable, advances revisions, creates
   tombstones/invalidations and persists the deletion plan/outbox intents.
2. Bounded handlers physically purge content tables, object versions,
   derivatives, indexes, vectors, caches, notification payloads, export copies
   and eligible identity mappings.

The user-facing read path stops returning approved content after stage one.
Completion is reported only after every required handler verifies its scope.
`hard_delete` means verified execution across every registered operated copy.
Cryptographic key destruction counts as a handler result only where the approved
profile accepts it, the target copies are encrypted solely under the destroyed
key and no plaintext/alternate key remains; it is not automatically described as
legally recognized destruction before `DG-009` is resolved.

The canonical deletion plan hash covers the frozen root manifest, decision
basis, exact lifecycle evaluations, revisions, hold/restriction fences,
approvals and required operated/backup/external checkpoints. A privacy-erasure
plan must bind the authentic approved request that authorized those destructive
roots. Every backup checkpoint is derived from the applicable purpose
deadline's `backupMaximumAt`; a deployment- or caller-selected later date is
rejected. Stage one and the terminal run must cover the plan exactly, so a
subset of roots or handlers cannot be reported as complete.

### Immutable history versus removable content

Timeline sequence, original participant-author anchor, provider occurrence,
revision history and security/domain audit remain stable technical facts while
their approved purpose remains. Content-bearing fields are separate purgeable
records or encrypted blobs. After content erasure:

- the sequence is not reused;
- a revisioned tombstone remains for synchronization while required;
- the original author is not replaced by another Client/Employee;
- direct PII resolution/display may be removed or pseudonymized;
- audit says that an erasure occurred without copying erased content/reason PII;
- reporting drops the subject bridge or rebuilds to a truly anonymous aggregate.

If no lawful purpose remains for the technical skeleton, it is deleted after
its own finite retention period. “Audit” is not an automatic forever exception.

### Group and shared records

One subject request does not automatically destroy a group record needed for
other participants, contractual service history or legal claims. The policy
engine decides per data element and purpose:

- remove subject profile/contact/identity mappings where approved;
- redact or purge elements containing the requester's personal data where
  required and lawful;
- protect third-party content and identifiers from the requester;
- retain only a minimized, restricted skeleton when another valid purpose
  remains;
- record partial approval/exception rather than a false all-or-nothing result.

### Dedupe and replay after purge

Raw payload deletion may leave a tenant-keyed HMAC/idempotency skeleton required
to prevent duplicate replay. It contains no raw payload, header, address or
low-entropy unsalted content hash. The HMAC key has its own lifecycle; destroying
it makes old skeletons non-linkable. The skeleton remains personal data while
re-identification is possible and has a finite purpose/period.
The replay/deduplication guarantee is explicitly bounded by the retained
skeleton and key window. After both expire, the adapter may no longer promise
historical duplicate detection and must rely on its documented snapshot/resync
and provider capability rather than an undisclosed weak fingerprint.

Recipient-state HMAC fingerprint rotation cannot change a fingerprint for the
same entity revision by assertion. A `syncGeneration` reset requires an
authentic current key ring and a proof resolved through a registered reset-ledger
capability. The proof binds tenant, exact before/after entity bindings, old/new
sync and key generations, the complete authority high-water manifest, key-ring
hash and atomic invalidation of the previous generation. Raw, cloned or
recomputed proof objects are rejected; without the proof the transition fails
closed and clients must not accept a silent reset.

## Legal Hold

A hold contains:

- tenant, case ID and type;
- owner, approver, reason/legal reference and review date;
- effective/released timestamps and revisions;
- data classes and date range;
- exact subject/conversation/source/file/request references or a versioned
  prospective predicate;
- frozen discovery manifest plus future-match behavior;
- storage locations, backup coverage and handler checkpoints.

Hold creation/release requires dedicated permissions, reason, separation of
duties by default and immutable audit. Self-approval is denied by default.

Secrets and live authentication material are not hold-eligible. A hold may keep
only a minimized security/audit outcome showing that a credential existed or
was revoked; it cannot keep usable or decryptable credential material alive.

The hold matcher is checked before logical purge, physical row/object deletion,
object-version expiry and key destruction. A hold does not bypass tenant/RBAC,
make hidden content searchable, pause security restrictions or allow export.
Release schedules normal policy reevaluation; it does not synchronously destroy
data in the release transaction.

Executable holds and restrictions require an authentic frozen scope manifest
and the authentic registry composition that owns every class/root/data use and
end-condition handler. Exact scope matching binds tenant, canonical root,
internal entity, expected entity revision and expected lineage revision; a
matching entity ID on a different root or revision does not match. Prospective
scope requires a registered composition-root matcher pinned to registry hash,
`scope_matcher` handler ID/version and predicate hash. Missing, cloned, stale or
throwing matchers produce `scope_ambiguous`, never a negative result that permits
deletion. Privacy evidence follows the same fail-closed lineage rule for exact
class, purpose, operated root and lifecycle handler.

## Audit Model

Inbox V2 keeps separate stores/contracts for:

- domain history: what business state changed;
- successful privileged/security audit: who authorized/did what and why;
- bounded denial/security signals: rate-limited evidence without stream/outbox
  amplification;
- privacy evidence: request, hold, export and destruction decisions/outcomes;
- platform audit: Hulee deployment/control actions without customer content.

The safe audit envelope includes stable tenant, actor/principal kind, action,
effective/delegating/support actor chain when applicable, target type plus opaque
reference, authorization facets, policy/rule version, before/after revision,
reason code, correlation/mutation/request IDs, outcome and time. It does not
include:

- Message/staff-note text;
- phone, email, full provider profile or contact/custom-field values;
- raw provider payload/headers;
- file/recording/transcript content or public object URL;
- tokens, cookies, credentials or secret config;
- arbitrary client/provider JSON;
- low-entropy raw hashes that reveal the original value.

Detailed evidence that is truly required lives in a separately authorized,
classified and purgeable evidence object referenced from the audit skeleton.
Audit access and export are themselves audited. Target-derived scope facets are
filtered before pagination/counting as required by ADR 0013.

Safe audit/event/diagnostic identifiers and evidence references are opaque,
bounded tokens rather than emails, phones, provider identifiers or low-entropy
content hashes. Successful/denied audit outcomes require coherent non-empty
authorization facets. A privacy-evidence object is accepted only through the
authentic lifecycle registry and must match the registered evidence class,
purpose, storage root and lifecycle handlers; arbitrary evidence JSON or an
unregistered root cannot enter the evidence contract. Evidence remains
separately authorized and finite even when its minimized audit skeleton is
tamper-evident.

Audit and privacy-evidence targets use only a provider-neutral `core:*` entity
type plus a random `internal-ref:<32-64 hex>` identifier resolved inside the
tenant data plane. Email, phone, provider user/thread ID, external business key
or another caller-selected value cannot be serialized as an audit target ID.

Tamper evidence may use append-only privileges, signed batches/hash chaining or
WORM object export according to the deployment compliance profile. A hash chain
does not justify retaining raw PII and must survive authorized content/evidence
purge through a tombstone/commitment design that does not reveal the content.

## Notifications, Analytics And AI

Notification payloads contain opaque deep-link/collapse identifiers and minimal
preview only when current policy and authority permit. Sensitive content is off
by default for push providers. Authorization loss, subject restriction or
content deletion invalidates pending payloads and endpoint caches.

Detailed analytics facts remain personal when they contain stable Employee,
Client, Conversation, Message or source-identity keys. They follow subject and
canonical content policy. An aggregate is anonymous only when the released
shape and retained internal keys cannot reasonably re-identify a person;
minimum-cell suppression alone does not automatically anonymize the stored fact.

AI prompts, outputs, embeddings and transcription artifacts are independent
data classes with source-parent links, provider/subprocessor record and delete
handler. A vector/index deletion is required when its source content is erased.
No module may retain an embedding as an undocumented substitute for deleted
text/audio.

## Backups, Replicas And Restore

Primary deletion cannot rewrite every immutable backup. The approved profile
therefore defines a finite backup/object-version maximum and requires:

- backups isolated from normal reads/analytics;
- access and restore audited;
- no restoration for ordinary subject access;
- an external/tamper-resistant erasure ledger and hold manifest newer than the
  restored backup;
- reapplication of deletions/restrictions and rotation of affected stream/cache
  epochs before serving traffic;
- verification that object versions, search, vectors and exports are covered;
- evidence of the final backup expiry date in the request result.

If a deployment cannot prove post-restore reapplication, the affected deletion
request remains `verification_blocked_internal_residual`. If primary deletion is
verified and only the known finite backup expiry tail remains, it is
`primary_purged_backup_expiry_pending`. Neither state is reported as fully
completed, and neither is mislabeled as an external provider residual.

Shared SaaS never restores the whole database for one tenant deletion defect.
Isolated/on-prem restore is deployment-scoped and follows the same ledger rule.
For versioned S3-compatible stores, restore/expiry evidence addresses the
separate backup/version root described by the registry; deleting the live object
root alone is not proof that noncurrent versions or backup copies expired.

## Retention-Aware Projection Rebuild

Stream retention does not invalidate ADR 0012's rebuild requirement. A new or
shadow current-state projector starts from a tenant-consistent canonical
snapshot/baseline at stream position `N`, containing the applicable tombstones,
policy/authorization epochs and erasure/hold/restriction ledger high-water, then
replays the retained tail strictly after `N`. The snapshot is created and
verified before the contiguous prefix becomes unavailable.

No projector may assume replay from position 1 after `minRetainedPosition`
advances. If a valid baseline is missing, pruning is blocked and the tenant is
degraded visibly. Analytics/reports rebuild only from still-eligible event-time
facts and anonymous rollups; a canonical snapshot cannot reintroduce purged
content, subject bridges or expired facts. Projection activation verifies the
same tenant, generation, policy and deletion-ledger fence before traffic switches.

## External Providers And Recipients

The data lineage registry records provider, webhook subscriber, push provider,
AI/transcription provider, export recipient and other subprocessor/disclosure
categories. For each adapter surface it records:

- which classes leave Hulee;
- purpose and contractual/DPA reference;
- region/residency and retention controls when known;
- delete/request capability and identifier needed to invoke it;
- status: `not_required`, `requested`, `confirmed`, `unsupported`, `unknown` or
  `failed_retryable`;
- last verification date and evidence reference.

An adapter capability is surface-specific. Deleting a Telegram/WhatsApp/MAX
Message through one binding does not prove deletion in another participant's
device, provider history, exported archive or another account binding.

## SaaS, Isolated And On-Prem Ownership

### Shared SaaS

- policy and jobs are tenant scoped;
- one tenant's hold/delete/export cannot lock or scan another tenant;
- global logs/metrics contain no customer content or stable subject keys;
- object keys and deletion manifests carry tenant scope;
- a tenant-local failure freezes/repairs that tenant, not the shared deployment.

### Isolated SaaS

- the same contracts/jobs run in the isolated data plane;
- customer-specific compliance profile, keys, backup and release window are
  allowed without a core fork;
- Hulee-managed operations remain audited and contract-bound.

### On-prem

- policy evaluation, subject discovery, hold, export/delete jobs and evidence run
  without permanent control-plane connectivity;
- the customer owns local legal configuration, object versioning, backup expiry,
  keys and operator approvals;
- Hulee ships commands, schemas, diagnostics and verification reports;
- license expiry does not disable read/export/delete/hold evidence operations;
- support bundles are redacted and opt-in, never an automatic customer-data copy
  to the SaaS control plane.

## Permissions And Separation Of Duties

ADR 0013 is extended with distinct permission families:

- `privacy.policy.view` / `privacy.policy.manage`;
- `privacy.request.view` / `privacy.request.decide` / `privacy.request.execute`;
- `privacy.subject_evidence.view`;
- `privacy.hold.view` / `privacy.hold.issue` / `privacy.hold.release`;
- `privacy.tenant_export`;
- `privacy.deletion.preview` / `privacy.deletion.approve` /
  `privacy.deletion.execute`;
- `audit.privacy.view` / `audit.privacy.export`.

Every permission uses tenant plus current resource/structural scope. Policy
management does not reveal content. Request/hold management does not grant
Conversation, Client, file, recording or staff-note read. Export additionally
requires the underlying resource/PII permissions unless it is a verified
data-subject workflow applying its dedicated redaction policy.

Destructive tenant-wide operations require preview, expected policy revision,
reason, separate approval by default and a cooling period. Break-glass read
cannot approve deletion or release a hold.

The minimum legal scope and guard matrix is:

| Permission family                          | Legal resource scope                                               | Mandatory guard                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `privacy.policy.view/manage`               | one tenant plus governance-context/profile revision                | manage reveals no content; activation requires preview, expected revision and approval                                  |
| `privacy.request.view/decide/execute`      | one verified case plus discovered roots and decision revision      | requester identity is not resource authority; decide and destructive execute are separated by default                   |
| `privacy.subject_evidence.view`            | one case and its explicitly linked subject/evidence roots          | third-party masking and evidence-purpose check before each page/object                                                  |
| `privacy.hold.view/issue/release`          | one tenant and exact/predicate scope frozen at a hold revision     | issue/release separation, reason/review date; no content read/export grant                                              |
| `privacy.tenant_export`                    | current tenant-wide resource graph at a pinned high-water          | current admin authority, two-person approval by default, secrets always excluded                                        |
| `privacy.deletion.preview/approve/execute` | exact deletion-plan roots, handler set and policy/entity revisions | preview cannot execute; approver differs from requester/executor by default; execute rechecks every fence after cooling |
| `audit.privacy.view/export`                | tenant plus actor/target/scope facets allowed by ADR 0013          | PII/evidence permissions remain separate; audit access/export is itself audited                                         |

Cross-tenant IDs, stale policy/entity revisions, lost resource scope or a changed
authorization epoch fail uniformly before counting, pagination, artifact access
or mutation. Platform support acts only through an explicit delegated/support
principal chain and never inherits tenant-wide privacy authority implicitly.

## Required Contracts And Persistence

`INB2-CON-010` owns versioned contracts for:

- data class, sensitivity, purpose and retention anchor;
- lifecycle policy/rule/resolution;
- typed subject links and discovery coverage;
- privacy request/decision/exception;
- legal hold and processing restriction;
- export manifest and artifact lifecycle;
- registered non-JSON export/fingerprint/matcher/source capabilities and the
  durable one-use claim-repository interface;
- deletion plan/run/handler outcome/external residual;
- safe audit/privacy evidence envelopes;
- stable events/errors/diagnostics.

`INB2-DB-009` owns tenant-safe persistence for policies, purpose instances,
subject links, holds, restrictions, request/export/delete runs, handler
checkpoints, unique export artifact claims, receipt CAS state and the
erasure/restore ledger. Data-bearing V2 tables also carry or
derive class, parent, anchor and policy eligibility without arbitrary JSON.

Content-heavy stores support separate content purge without rewriting sequence,
authorship or route facts. Object storage gains delete/delete-version/list-
version capability or an adapter-declared equivalent with contract tests.

## Operational Execution

Ownership is intentionally split:

- `INB2-OPS-006` owns the pure effective-policy resolver, governance/profile
  activation fences, legal-hold matcher and processing-restriction evaluator;
- `INB2-OPS-010` owns bounded retention, transactional unavailability/core-SQL
  purge dispatch and contiguous replay-prefix purge;
- `INB2-OPS-011` owns object-version/derivative/search/vector/cache/notification/
  analytics/provider handlers;
- `INB2-OPS-012` owns privacy-request, tenant-export and erasure orchestration;
- `INB2-OPS-013` owns typed audit and destruction-evidence lifecycle;
- `INB2-OPS-007` owns backup/restore ledger reapplication and offline restore
  proof.

Destructive runs are resumable and idempotent. Together these tasks ensure each
run:

- freezes a policy version/high-water mark;
- partitions by tenant/data class and uses lease-token fencing;
- evaluates hold/restriction immediately before destructive I/O;
- writes stage-one tombstone/invalidation transactionally;
- dispatches registered handlers for SQL, object store, search, vector, cache,
  notification, analytics, export, backup ledger and external provider;
- compares expected revision/generation before each delete;
- records counts/bytes/reasons, never content;
- retries only retryable outcomes and alerts permanent/unknown residuals;
- advances replay `minRetainedPosition` only with the deleted contiguous prefix;
- emits completion only after verification queries prove no required live copy.

Handlers are extension points keyed by data class, not provider-specific core
branches. Company/provider modules must register classification, lineage and
delete/export handlers through the versioned module API.

## Stable Events, Errors And Diagnostics

Minimum events include:

- `privacy.policy.revised` / `privacy.policy.activated`;
- `privacy.request.received` / `decided` / `completed`;
- `privacy.hold.issued` / `released`;
- `privacy.restriction.changed`;
- `privacy.export.started` / `ready` / `expired` / `revoked`;
- `privacy.deletion.started` / `handler_failed` / `completed`;
- `privacy.external_deletion.updated`;
- `retention.run.started` / `completed` / `blocked`;
- `retention.stream_prefix_advanced`.

Stable errors/diagnostics include:

- `privacy.policy_missing`;
- `privacy.data_class_unknown`;
- `privacy.identity_verification_required`;
- `privacy.scope_ambiguous`;
- `privacy.third_party_redaction_required`;
- `privacy.hold_active`;
- `privacy.restriction_active`;
- `privacy.legal_review_required`;
- `privacy.export_access_changed`;
- `privacy.export_expired`;
- `privacy.delete_handler_failed`;
- `privacy.external_residual`;
- `retention.parent_deadline_violation`;
- `retention.backup_expiry_unproven`;
- `retention.stream_prefix_blocked`.

Diagnostics expose safe IDs/counts/status/reason codes and operator hints, not
content, contact values, raw provider JSON or secrets.

## Required Verification Matrix

Implementation must prove at least:

1. Cross-tenant policy/request/hold/export/delete identifiers return uniform
   non-disclosing denial and mutate nothing.
2. Policy shortening previews exact rows/bytes, requires approval and cannot
   delete before activation/cooling period.
3. Parent Message purge removes its links and eligible thumbnail, search, vector,
   notification preview and export copies while keeping an authorized tombstone;
   shared physical file versions remain until every live parent/purpose is
   eligible and no hold applies, then are all removed.
4. A crash at every stage resumes idempotently; a stale lease/revision cannot
   delete newer data or mark completion.
5. A legal hold racing deletion wins before physical I/O; release merely
   reschedules evaluation and grants no access.
6. Processing restriction blocks secondary analytics/AI/export while preserving
   only approved storage/legal operations.
7. A data-subject export from a mixed client/employee provider group includes
   authorized subject data and protects every other person's content/identity.
8. Erasing a linked identity removes current PII resolution without changing the
   original participant author, sequence or inventing another author.
9. Provider message delete, local retention expiry and privacy erasure remain
   distinct outcomes and external residuals are visible.
10. Raw-event payload expiry leaves exact replay/dedupe behavior without a raw
    value or reversible low-entropy hash.
11. Notification, report facts, rollups and AI/vector derivatives converge after
    deletion and do not recreate content during rebuild.
12. Audit contains no copied Message/contact/provider/file/secret payload and is
    still sufficient to prove policy/hold/export/delete decisions.
13. Audit retention itself expires or compacts; no “forever” fallback exists.
14. Stream replay prunes only a contiguous prefix and atomically advances the
    retained minimum; expired clients resync from an authoritative snapshot.
15. Backup restore reapplies the erasure ledger before traffic, rotates affected
    epochs/caches and does not resurrect an export or provider side effect.
16. On-prem offline execution produces the same local evidence without calling
    SaaS control-plane APIs.
17. Plan/license expiry leaves existing read, verified export, legal hold and
    deletion operations usable.
18. Load tests cover many tenants, 50+ source accounts, millions of eligible
    rows, object versions and one hot hold scope with bounded locks/work.
19. A current-state shadow projection rebuilds from a tenant-consistent baseline
    at `N` plus retained tail `> N` after the earlier prefix/payloads were purged;
    analytics rebuild cannot resurrect ineligible facts.
20. Provider/UI delete under an active hold preserves the held local scope while
    recording the distinct remote/local outcome and granting no read authority.

## Current V1 Gap Inventory

The current code is not an implementation of this policy:

- raw/normalized payloads, events, outbox, notification payloads and audit JSON
  have no lifecycle class/purpose/expiry metadata;
- Message text and audit/event/outbox payloads can be copied into independent
  JSON/text rows without a purgeable content boundary;
- object storage exposes put/get only, with no delete/version enumeration;
- files have no deletion state machine, object-version evidence or legal-hold
  guard;
- current audit metadata is arbitrary JSON and not a typed safe envelope;
- current FKs default to `NO ACTION`, but there is no explicit ordered deletion
  graph or privacy tombstone model;
- no subject index, privacy request, hold/restriction, export artifact lifecycle,
  erasure ledger or post-restore replay exists;
- no retention worker or proof that derived/index/cache/provider copies are gone.

`INB2-MIG-001` inventoried the historical V1 payload copies and deployment
roots. On `2026-07-20` the product owner classified every current root as
disposable test state through ADR 0016, so none is migrated, exported or retained
as customer data. `INB2-CLEAN-002` stops writers/provider listeners and
`INB2-DB-011` recreates the schema epoch; `INB2-CLEAN-GATE` proves stale roots
cannot reconnect. This one pre-production authorization does not weaken the
lifecycle/export/delete obligations for future real data.

## Official Evidence Baseline

Checked on 2026-07-10:

- [EU GDPR, Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng):
  purpose/data minimization, storage limitation/accountability, access,
  rectification, erasure with exceptions, restriction, portability, records and
  security must be evaluated by the responsible organization.
- [EDPB basic processing principles](https://www.edpb.europa.eu/sme-data-protection-guide/faq-frequently-asked-questions/answer/what-are-basic-processing_en):
  personal data should be deleted or anonymized when no longer necessary and
  organizations need a retention policy/procedure.
- [Russian Federal Law No. 152-FZ, official legal information system](https://ips.pravo.gov.ru/api/ips/legislation/document?baseid=None&hash=98490812b3409e2a8d78a11ca9010f434ea3d9250a11dbbdb78690cd5551bdd6):
  processing purpose, storage limitation, destruction/anonymization, operator/
  processor duties, localization and request handling require a deployment-
  specific legal profile.
- [Roskomnadzor Order No. 179 of 28 October 2022](https://publication.pravo.gov.ru/Document/View/0001202211290008):
  destruction of personal data requires prescribed confirmation evidence.
- [Roskomnadzor Order No. 140 of 19 June 2025](https://publication.pravo.gov.ru/document/0001202508010002):
  current Russian anonymization requirements mean product “anonymized” claims
  need reviewed methods, not only removal of a display name.
- [EU ePrivacy Directive 2002/58/EC](https://eur-lex.europa.eu/legal-content/en/TXT/?uri=CELEX%3A32002L0058):
  communication confidentiality/recording and traffic-data rules reinforce the
  need for a separate recording/transcript purpose and retention profile.

These sources establish constraints, not universal Hulee retention periods.
Local counsel and customer contracts determine the production profile.

## Approval Checklist

- [x] Every acceptance data class has an independent policy rule.
- [x] Immutable history and removable PII/content are compatible.
- [x] Group/multi-subject export and erasure do not assume one Client.
- [x] Provider/local/privacy delete semantics and external residuals are distinct.
- [x] Legal hold, processing restriction, RBAC and retention are independent.
- [x] Audit is typed/minimized, finite and separate from sensitive evidence.
- [x] Backups, object versions, derived data and restore resurrection are covered.
- [x] SaaS/isolated/on-prem execute the same core policy locally.
- [x] Replay pruning remains position-safe under ADR 0012.
- [x] Exact unresolved legal/product decisions have owners/blocking impact.
- [x] Downstream contracts, schema, operations and acceptance tests are assigned.
