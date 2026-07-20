# ADR 0013: Inbox V2 Responsibility, Collaboration And RBAC

## Status

Accepted.

This ADR completes `INB2-ARCH-006`. It passed independent security, product and
cross-document/backlog consistency review plus repository quality gates. It
depends on ADR 0009 domain boundaries, ADR 0010 identity/authorship, ADR 0011
external routing and ADR 0012 transactional revisions/realtime recovery.

## Date

2026-07-10.

## Context

Inbox V2 is both a customer-service work surface and a communication client.
It must authorize private and group conversations from direct messenger
accounts, internal employee direct/group chats, queues with one responsible
operator, staff-only notes, client CRM, source routes and manager reports.
Those concerns overlap in the UI but do not confer authority on one another.

The following examples must all remain valid:

- an unassigned customer request is visible to an intake queue and exactly one
  of two simultaneous claim attempts wins;
- a provider group contains several clients and several employees, while every
  Client card and contact is authorized independently;
- an employee-only provider group stays external and uses a provider route but
  receives no synthetic Client or WorkItem by default;
- an internal employee group has no client, provider route or WorkItem, and a
  supervisor outside the group cannot read it merely because of their title;
- a collaborator can help with context and staff notes without silently
  becoming the primary responsible or client owner;
- a watcher can request notifications without becoming an access grant;
- aggregate reports can be visible without exposing messages, participant
  rosters, contacts or other personally identifiable information (PII).

The current Hulee scoped-RBAC implementation is a useful foundation: it has a
permission catalog, temporal role bindings and direct grants, active Employee
and membership loading, pure effective-grant resolution and server-built
Conversation resource context. The newer effective-access path does not use
legacy Employee role names; a V1 compatibility path can still derive template
permissions and is explicitly forbidden in Inbox V2 enforcement/cutover.

It is not safe to reuse unchanged for Inbox V2:

- `client` is currently a legal scope for `inbox.read`, `conversation.read`,
  `message.reply` and files. Access to Client A could therefore disclose a
  multi-client Conversation containing Clients B and C;
- `assigned` can match an Employee or a team and cannot express exactly one
  current WorkItem primary responsible;
- `message.reply`, `conversation.assign` and `reports.view` combine operations
  that require different visibility, route, concurrency and PII rules;
- WorkItem, collaborator, watcher, trusted internal membership, SourceAccount
  route, staff-only visibility and identity-claim relations are absent from the
  resource context;
- Conversation routing is a last-write-wins update of nullable queue, Employee
  and team fields with no expected revision, assignment history or target
  eligibility fence;
- Employee deactivation revokes sessions but does not release or requeue work;
- some web/admin surfaces check only that an effective permission exists and
  ignore its scope before tenant-wide Employee, org-structure or audit access;
- role/grant/membership mutations, audit, access invalidation and events do not
  share one transaction, and the database does not enforce every tenant edge;
- Inbox V1 paginates a tenant-wide list before in-memory authorization and
  reloads effective access repeatedly, which is neither safe pagination nor a
  viable high-load access plan.

The RIK direct-messenger matrix is retained as capability/regression evidence
for private/group transport behavior. Its functional `OK` status never proves
that a Hulee action has the required authorization boundary.

## Decision

Hulee uses default-deny, relation-aware scoped RBAC. A domain relation narrows
where a permission can apply; the relation is never a permission by itself.
Every command, query, stream batch, notification, file read and export uses one
authoritative server-side policy path.

### Authorization equation

An operation is allowed only when every required term is true:

```text
active authenticated principal
AND tenant boundary is valid
AND session/composite authorization epoch is current
AND every required permission is effective
AND each permission scope matches server-loaded canonical resources/relations
AND command-specific state and expected-revision guards pass
AND every secondary resource is independently authorized
AND hard visibility, route and provider-capability invariants pass
```

Failure of one term denies the operation. The client may name a desired
resource, target or route, but it cannot supply trusted actor, tenant,
membership, queue, assignment, Client link, scope-match or capability facts.
The server loads those facts from tenant-safe repositories.

Authorization is a conjunction, not the most permissive of several checks. For
example, external reply requires Conversation authority, WorkItem state/relation
authority when work exists, exact SourceAccount use authority and a valid
binding/capability. Passing one check cannot replace another.

### Principals and non-principals

| Subject                                        | Workforce Inbox principal | Rule                                                                                                |
| ---------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| Active authenticated Employee principal        | yes                       | Acts only in the authenticated tenant with current server-side grants and authorization epoch.      |
| Registered trusted service principal           | yes, explicitly           | Has a closed list of service actions/scopes and never receives human authorship or response credit. |
| Future authenticated ClientPrincipal           | separate contract         | Is not part of workforce RBAC and is out of scope for this ADR.                                     |
| Employee record without a valid active session | no                        | Can remain an assignee/author in history but cannot issue a command.                                |
| ConversationParticipant                        | no                        | Preserves authorship/membership; it is not an authenticated authority.                              |
| Client or ClientContact                        | no                        | Is a CRM resource, not a workforce principal.                                                       |
| SourceExternalIdentity or claim target         | no                        | Is provider identity/resolution metadata and never a login or grant.                                |
| Provider owner/admin/member                    | no                        | Is source evidence only, even when the identity is claimed to an Employee.                          |
| Bot participant                                | no, by default            | Acts only through a separately registered trusted service principal.                                |
| SourceAccount, binding or route                | no                        | Is a tenant-owned transport resource.                                                               |

`appActor` is stamped by trusted server code from the authenticated principal.
Authorship, provider sender and current responsible are never accepted as proof
of authority.

### Grants, role-binding subjects and resource scopes

The model keeps three questions separate:

1. A role-binding subject decides whether an Employee receives a grant.
2. A permission decides what operation the grant permits.
3. A permission scope plus canonical relation decides where it applies.

An active role binding may target an Employee, team, org unit or queue. Team,
org-unit and queue bindings apply only through current active membership. A
direct grant applies directly to its Employee and can intentionally provide
temporary coverage without adding membership. Membership alone grants nothing.

Inbox V2 defines these scopes:

| Scope                  | Canonical match                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `tenant`               | The current tenant. It never overrides an internal-chat privacy or staff-only hard boundary.                                  |
| `org_unit`             | An exact org unit, or its explicit `subtree` mode through an authoritative acyclic closure. Migrated scopes default to exact. |
| `team`                 | The current server-loaded team relation for the resource/fact.                                                                |
| `queue`                | The WorkItem's current queue, or the immutable event-time queue dimension for an aggregate fact.                              |
| `client`               | Exactly one Client resource. It never matches a Conversation, WorkItem, Message or file merely because that Client is linked. |
| `conversation`         | Exactly one Conversation and its authorized content boundary. It does not grant access to every linked Client/contact.        |
| `work_item`            | Exactly one WorkItem. It does not automatically cover a later sequential WorkItem for the same Conversation.                  |
| `source_account`       | Exactly one tenant-owned SourceAccount. The binding and route still require independent state/capability checks.              |
| `responsible`          | The current active WorkItem primary responsible Employee only. Team assignment, Client owner and participant are excluded.    |
| `collaborator`         | A current temporal Hulee collaborator relation on this Conversation/WorkItem.                                                 |
| `internal_participant` | A current Hulee-origin internal membership episode and its internal role. Provider roster membership can never match it.      |
| `client_owner`         | The current temporal owner of exactly one Client. It never matches WorkItem responsibility or Conversation access.            |

The V1 `assigned` and generic `own` scopes remain compatibility-only until V1
removal. New Inbox V2 permissions do not allow them. In particular, team
assignment cannot satisfy primary-responsible operations.

An org-unit scope declares `exact` or `subtree` explicitly. A subtree match uses
a tenant-scoped closure/index, rejects cycles and changes its authorization dependency revision
when hierarchy or membership changes. No caller-provided ancestor list is
trusted.

Structural scope is never inferred from participants, linked Clients, Client
owner, provider roster or the responsible Employee's memberships:

- for a WorkItem-bound resource, `org_unit` matches the Queue's explicit owning
  org unit and `team` matches only an explicit temporal servicing-team relation;
- for an external Conversation without a WorkItem, org/team matching requires a
  versioned temporal `ConversationAccessBinding` created by trusted source/
  routing policy or an authorized command. Without that binding, no org/team
  structural match exists;
- for a Client, org/team matching requires an explicit temporal
  `ClientAccessBinding`; linked Conversations, WorkItems and the Client owner's
  memberships never create a standalone structural Client match;
- for a SourceAccount, org matching uses the account's explicit administrative
  owner relation, not an account participant;
- for analytics, org/team/queue matching uses immutable event-time fact
  dimensions, while drilldown separately checks the current resource;
- `tenant`, exact-Conversation and explicit collaborator scopes remain
  available according to their permission, but cannot bypass hard visibility.

`ConversationAccessBinding`/`ClientAccessBinding` record tenant, exact resource,
structural target, validity interval, policy/actor, reason and revision. They are
authorization metadata, not participant membership, WorkItem routing, CRM
ownership or provider evidence.

A human binding command needs the matching `*.access_binding.manage`
permission on the exact resource and both old/new structural targets, expected
binding revision, reason and audit. Trusted routing/source policy uses the
service-only `conversation.access_binding.apply_policy` action and records its
policy version. A binding change advances the resource access revision; it does
not synchronously update every member of the target org/team.

`work.servicing_team.manage` is the only ordinary command that changes the
WorkItem servicing-team relation. It conjunctively authorizes the WorkItem,
old/new teams and current Queue, requires reason plus expected revisions, writes
temporal history/audit and advances the WorkItem resource access revision.
Team members are not synchronously revision-fanned out; current-policy checks
and shared/resource invalidation enforce the boundary.

### Canonical operational relations

The following relations remain independent and temporal:

| Relation                   | Meaning                                                                                          | What it does not mean                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Queue member               | Active Employee eligible under Queue policy.                                                     | Not permission to list, read, claim or reply.                                                  |
| Servicing team             | Explicit temporal team relation on one WorkItem used for routing/scope.                          | Not primary responsibility, team membership or a grant.                                        |
| Primary responsible        | The one active primary Employee assignment on the current WorkItem.                              | Not author, participant, watcher, collaborator or Client owner.                                |
| Scoped supervisor          | An Employee with explicit operation and override permissions in a matching structural scope.     | Not a magic role name or tenant-wide bypass.                                                   |
| Collaborator               | Explicit Hulee assistance relation with start/end, actor, reason and Conversation/WorkItem kind. | Not responsibility, provider membership or CRM ownership; external reply remains policy-gated. |
| Watcher                    | Notification subscription with start/end and preferences.                                        | Not read access or any command authority.                                                      |
| Internal participant       | Hulee-created internal membership with owner/admin/member/observer role.                         | Not provider roster membership and not WorkItem responsibility.                                |
| Client owner               | Temporal CRM ownership of one Client.                                                            | Not Conversation or WorkItem ownership.                                                        |
| Provider participant/admin | Adapter-observed source fact.                                                                    | No Hulee scope or principal match.                                                             |

A watcher may be added only while the target Employee independently has read
access. Losing read access suppresses/removes the subscription before another
payload is delivered. Self-watch and managing other watchers are separate
permissions. A watcher never appears as an access scope.

A `ConversationCollaborator` persists until revoked and can keep its explicitly
granted Conversation read/staff-note authority while a WorkItem exists. It can
qualify for external reply only when the Conversation is truly non-actionable
and has no WorkItem. A `WorkItemCollaborator` belongs to one exact WorkItem,
ends no later than its terminal transition and never applies to a later
sequential WorkItem. When active work exists, the Queue's versioned reply policy chooses `responsible_only` (default) or
`responsible_or_work_item_collaborator`; Conversation collaboration alone never
silently crosses that boundary.

Adding a collaborator requires an active same-tenant target and an applicable
role/direct grant containing the intended collaborator-scoped permissions; the
relation may therefore activate scoped read/note authority. It does not require
pre-existing Conversation read. Adding a watcher is different: watcher never
activates authority and requires the target to already have current read access.

The notification domain owns temporal `WatcherSubscription`, keyed by tenant,
Employee and target kind/ID (`conversation` or exact `work_item`). It records
self/managed source, actor/reason, validity interval and revision. A
Conversation watcher persists until revoke/expiry; a WorkItem watcher ends no
later than terminal state and never carries to a later WorkItem. Draining/
inactive target or lost read authority suppresses delivery immediately. Self
subscribe/unsubscribe uses `notification.watch.self`; managing another target
uses `notification.watchers.manage`. Mute/quiet-hour/channel preferences remain
separate per-Employee notification state.

### Inbox V2 permission catalog

These are the canonical V2 permission families. Contract implementation may
only rename them through a versioned migration that preserves the same split;
it must not collapse them back into V1 coarse permissions.

| Permission                                 | Legal scope families                                                                                            | Additional mandatory guard                                                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant.manage`                            | tenant                                                                                                          | Tenant settings only; never an internal-content or operation bypass.                                                                                                                         |
| `employee.directory.view`                  | tenant, org unit, team                                                                                          | Target Employee's explicit structural membership; predicate before pagination/search.                                                                                                        |
| `employee.invite`                          | tenant, org unit                                                                                                | Target org and permitted initial memberships; no implicit role grant.                                                                                                                        |
| `employee.profile.manage`                  | tenant, org unit, team                                                                                          | Target Employee relation; cannot change authority or tenant lifecycle.                                                                                                                       |
| `employee.deactivate`                      | tenant                                                                                                          | Global draining workflow only; narrower managers remove scoped memberships instead.                                                                                                          |
| `roles.define`                             | tenant                                                                                                          | Versioned role definition; cannot make active bindings illegal.                                                                                                                              |
| `roles.bind`                               | tenant, org unit, team, queue                                                                                   | Subject/target are server-loaded; actor cannot delegate permissions/scopes they cannot grant.                                                                                                |
| `direct_grants.manage`                     | tenant, org unit, team, queue                                                                                   | Target Employee plus exact permission/scope, reason/TTL and expected revision; no self-escalation or authority delegation beyond the actor.                                                  |
| `org_unit.manage`                          | tenant, org unit                                                                                                | Exact/subtree target, parent/cycle/archive guards and expected revision.                                                                                                                     |
| `team.manage`                              | tenant, org unit, team                                                                                          | Explicit Team org/access relation, target memberships and expected revision.                                                                                                                 |
| `queue.manage`                             | tenant, org unit, queue                                                                                         | Queue owner org, membership/routing impact and expected revision.                                                                                                                            |
| `inbox.read`                               | tenant, org unit, team, queue, responsible, collaborator, internal participant, conversation                    | Metadata-only entry eligibility; authorization is applied before pagination. It does not itself grant message/search preview or roster/attachment fields.                                    |
| `conversation.read`                        | tenant, org unit, team, queue, responsible, collaborator, conversation                                          | External/work Conversation content only; linked Client/contact PII is separate.                                                                                                              |
| `conversation.internal.read`               | internal participant                                                                                            | Current Hulee membership; observer is read-only. Structural scopes do not open private internal content.                                                                                     |
| `conversation.internal.create`             | tenant, org unit, team                                                                                          | Tenant policy and target-Employee visibility.                                                                                                                                                |
| `conversation.internal.members.manage`     | internal participant                                                                                            | Current owner/admin role, expected membership revision and topology invariants.                                                                                                              |
| `conversation.internal.owner_recover`      | conversation                                                                                                    | Metadata-only successor appointment with expected group/membership revision, active visible successor, reason, approver and audit; grants no content.                                        |
| `conversation.internal.break_glass_read`   | conversation                                                                                                    | Time-limited direct grant, reason and audit; read-only and never implicit send.                                                                                                              |
| `conversation.internal.break_glass.issue`  | tenant, conversation                                                                                            | Administrative metadata authority only; separate approver/target, exact Conversation, TTL, alarm and audit.                                                                                  |
| `conversation.access_binding.manage`       | tenant, org unit, team, conversation                                                                            | Authorize exact Conversation plus old/new structural targets, reason and expected binding revision.                                                                                          |
| `conversation.access_binding.apply_policy` | tenant, org unit, team, conversation                                                                            | Trusted service principal only with recorded routing/source policy version.                                                                                                                  |
| `conversation.collaborators.manage`        | tenant, org unit, team, queue, responsible, conversation, work item                                             | Target active/same-tenant with applicable collaborator-scoped grant; temporal history required.                                                                                              |
| `notification.watch.self`                  | tenant, org unit, team, queue, responsible, collaborator, internal participant, conversation, work item         | Existing target read authority is required.                                                                                                                                                  |
| `notification.watchers.manage`             | tenant, org unit, team, queue, responsible, conversation, work item                                             | Active same-tenant target must independently have read authority.                                                                                                                            |
| `notification.preferences.manage_self`     | tenant                                                                                                          | Only the authenticated Employee's preferences.                                                                                                                                               |
| `notification.endpoints.manage_self`       | tenant                                                                                                          | Only endpoints proven to belong to the authenticated principal/session.                                                                                                                      |
| `message.reply_external`                   | tenant, org unit, team, queue, responsible, collaborator, conversation, work item                               | WorkItem relation/state policy, exact route permission and binding capability all pass.                                                                                                      |
| `message.send_internal`                    | internal participant                                                                                            | Current member/owner/admin role; observer and break-glass reader cannot send.                                                                                                                |
| `message.staff_note.read`                  | tenant, org unit, team, queue, responsible, collaborator, conversation, work item                               | Requires the applicable Conversation read permission as a conjunction.                                                                                                                       |
| `message.staff_note.create`                | tenant, org unit, team, queue, responsible, collaborator, conversation, work item                               | Requires Conversation read; command accepts no external route and dispatch is forbidden.                                                                                                     |
| `message.edit_own`                         | responsible, collaborator, internal participant, conversation                                                   | Actor owns the Hulee-authored Message; expected revision; external propagation also requires `source_account.use` on its exact original binding/reference plus generation/window/capability. |
| `message.delete_own`                       | responsible, collaborator, internal participant, conversation                                                   | Actor owns the Hulee-authored Message; expected revision; external propagation also requires exact original account/binding/reference use and delete capability.                             |
| `message.react`                            | responsible, collaborator, internal participant, conversation                                                   | Conversation visibility/target revision; external action additionally requires exact original account/binding/reference use and reaction capability.                                         |
| `message.moderate_external`                | tenant, org unit, team, queue, conversation                                                                     | Explicit edit/delete moderation, reason/audit, exact original account/binding/reference use and capability; never reroutes.                                                                  |
| `message.moderate_internal`                | internal participant                                                                                            | Current internal owner/admin plus dedicated permission; no structural privacy bypass.                                                                                                        |
| `message.forward_external`                 | tenant, org unit, team, queue, responsible, collaborator, conversation, work item                               | New send requiring reply policy, destination route use and, for native forward, authorized exact source occurrence/reference portability; never a lifecycle shortcut.                        |
| `work.read`                                | tenant, org unit, team, queue, responsible, collaborator, work item, conversation                               | Does not itself reveal message content or Client PII.                                                                                                                                        |
| `work.claim`                               | tenant, org unit, team, queue, work item                                                                        | Self only, unassigned/claimable state, active Queue eligibility and expected revision.                                                                                                       |
| `work.assign`                              | tenant, org unit, team, queue, work item                                                                        | Target active/eligible; source and destination are authorized.                                                                                                                               |
| `work.servicing_team.manage`               | tenant, org unit, team, queue, work item                                                                        | Old/new team, reason, expected WorkItem/relation revision and audit; no responsibility change.                                                                                               |
| `work.release_self`                        | responsible                                                                                                     | Self-release to a valid queue and expected revision.                                                                                                                                         |
| `work.release_other`                       | tenant, org unit, team, queue, work item                                                                        | Requires `work.override`, reason and source/destination authorization.                                                                                                                       |
| `work.transfer`                            | tenant, org unit, team, queue, responsible, work item                                                           | Source and destination scopes, target eligibility and expected revision.                                                                                                                     |
| `work.close`                               | tenant, org unit, team, queue, responsible, work item                                                           | State transition and expected revision.                                                                                                                                                      |
| `work.reopen`                              | tenant, org unit, team, queue, work item                                                                        | Reopen policy selects a valid queue and optional eligible target.                                                                                                                            |
| `work.override`                            | tenant, org unit, team, queue, work item                                                                        | Must be combined with the requested operation permission and a reason; never bypasses tenant/state/hard invariants.                                                                          |
| `source_account.view`                      | tenant, org unit, source account                                                                                | Safe metadata through explicit administrative owner/access relation; no secret or send authority.                                                                                            |
| `source_account.diagnostics.view`          | tenant, org unit, source account                                                                                | Redacted health/diagnostics only; no raw payload, credential or message-content authority.                                                                                                   |
| `source_account.use`                       | tenant, org unit, source account                                                                                | Exact chosen account; binding generation, route token and capability are server-validated.                                                                                                   |
| `source.route_policy.manage`               | tenant, org unit, source account                                                                                | Changes future policy only; never mutates a pinned dispatch.                                                                                                                                 |
| `source.dispatch.reroute`                  | tenant, org unit, source account                                                                                | Explicit new dispatch decision before provider I/O, reason/audit and original-route history.                                                                                                 |
| `source.multi_send`                        | tenant, org unit                                                                                                | Explicit multi-destination command; never inferred from normal send.                                                                                                                         |
| `source_item.reply`                        | tenant, org unit, team, queue, responsible, collaborator, conversation, work item                               | Typed non-message reply plus exact source route/capability when native.                                                                                                                      |
| `source_item.open_external`                | tenant, org unit, team, queue, responsible, collaborator, conversation                                          | Opens only a server-approved URL/action descriptor.                                                                                                                                          |
| `call.initiate`                            | tenant, org unit, team, queue, responsible, client, conversation                                                | Exact telephony account/capability and target permissions.                                                                                                                                   |
| `call.recording.view`                      | tenant, org unit, team, queue, responsible, client, conversation                                                | Parent call visibility plus recording retention/PII policy.                                                                                                                                  |
| `call.transcript.view`                     | tenant, org unit, team, queue, responsible, client, conversation                                                | Parent call visibility plus transcript retention/PII policy.                                                                                                                                 |
| `file.view`                                | tenant, org unit, team, queue, responsible, collaborator, internal participant, client, conversation, work item | Conjunctive with the parent TimelineItem/content visibility.                                                                                                                                 |
| `file.upload`                              | tenant, org unit, team, queue, responsible, collaborator, internal participant, client, conversation, work item | Parent create/send authority, storage policy and source capability where external.                                                                                                           |
| `file.delete`                              | tenant, org unit, team, queue, responsible, collaborator, internal participant, client, conversation, work item | Parent visibility, uploader/moderator policy, expected revision and retention/legal-hold guard.                                                                                              |
| `participant.pii.view`                     | tenant, org unit, team, queue, responsible, collaborator, conversation                                          | Conjunctive with applicable Conversation read; phone, username, external ID and full provider profile/roster require it.                                                                     |
| `client.view`                              | tenant, org unit, team, queue, responsible, client owner, client                                                | Authorizes one Client at a time; queue/responsible require the contextual path below and no contacts/PII are implied.                                                                        |
| `client.contacts.view`                     | tenant, org unit, team, queue, responsible, client owner, client                                                | Separately authorizes contact/PII fields for one Client through the same contextual rule.                                                                                                    |
| `client.edit`                              | tenant, org unit, team, queue, responsible, client owner, client                                                | Non-pipeline/non-owner fields allowed by schema visibility and contextual rule.                                                                                                              |
| `client.pipeline.transition`               | tenant, org unit, team, queue, responsible, client owner, client                                                | Client revision, transition policy, reason and contextual rule.                                                                                                                              |
| `client.fields.view_sensitive`             | tenant, org unit, team, queue, responsible, client owner, client                                                | Conjunctive with `client.view`; only definitions explicitly visible to this permission/scope.                                                                                                |
| `client.fields.edit`                       | tenant, org unit, team, queue, responsible, client owner, client                                                | Field definition visibility/type policy, contextual rule and Client revision.                                                                                                                |
| `client.owner.assign`                      | tenant, org unit, team, client                                                                                  | Target eligibility and independent owner-history revision.                                                                                                                                   |
| `client.access_binding.manage`             | tenant, org unit, team, client                                                                                  | Exact Client plus old/new structural targets, reason and expected binding revision.                                                                                                          |
| `conversation.clients.manage`              | tenant, org unit, team, queue, responsible, conversation                                                        | Must be combined with `client.link.manage` on every target Client.                                                                                                                           |
| `client.link.manage`                       | tenant, org unit, team, client owner, client                                                                    | One target Client; linking never changes WorkItem or Client ownership.                                                                                                                       |
| `identity.employee_claim.manage`           | tenant, org unit, team                                                                                          | Employee target, verified evidence policy and claim revision.                                                                                                                                |
| `identity.client_contact_claim.manage`     | tenant, org unit, team, queue, client                                                                           | ClientContact target, contextual rule and claim revision.                                                                                                                                    |
| `identity.source_identity.use`             | tenant, org unit, source account, conversation                                                                  | Exact SourceExternalIdentity/observation side of a claim; no target authority.                                                                                                               |
| `identity.evidence.view`                   | tenant, org unit, source account, conversation                                                                  | Sensitive provider profile/evidence fields only.                                                                                                                                             |
| `identity.auto_resolve`                    | tenant, org unit, source account                                                                                | Trusted service principal only, approved policy/evidence version and no manual actor.                                                                                                        |
| `identity.claim.revoke`                    | tenant, org unit, team, queue, client                                                                           | Exact source identity plus existing Employee/ClientContact target are authorized independently.                                                                                              |
| `identity.merge`                           | tenant, org unit                                                                                                | Compatible identity realm/scope and conflict review.                                                                                                                                         |
| `identity.observation.review`              | tenant, org unit, team, queue                                                                                   | Review annotations only; cannot rewrite adapter evidence.                                                                                                                                    |
| `reports.view`                             | tenant, org unit, team, queue                                                                                   | Aggregate cells only; no stable row/person IDs, content, roster or contacts.                                                                                                                 |
| `reports.workforce_dimension.view`         | tenant, org unit, team, queue                                                                                   | Named Employee breakdown only with matching `employee.directory.view`; no content authority.                                                                                                 |
| `reports.drilldown`                        | tenant, org unit, team, queue                                                                                   | Also requires current underlying Conversation/Client/file/contact permissions for every returned row.                                                                                        |
| `reports.export`                           | tenant, org unit, team, queue                                                                                   | Aggregate export only unless the PII permissions below also pass.                                                                                                                            |
| `reports.pii.view`                         | tenant, org unit, team, queue                                                                                   | Conjunctive with drilldown and underlying resource permissions.                                                                                                                              |
| `reports.pii.export`                       | tenant, org unit, team, queue                                                                                   | Conjunctive with export, PII view and underlying permissions.                                                                                                                                |
| `audit.view`                               | tenant, org unit, team, queue                                                                                   | Target-derived immutable authorization facets are filtered before pagination/count; Message/Client PII is never implied.                                                                     |

The V1 `employees.manage` and `roles.manage` identifiers remain compatibility
permissions during migration, but every current handler must already apply the
same server-loaded target/scope guards. They map conservatively to the split V2
employee/role/direct-grant/org/team/Queue permissions and can never be checked
by presence alone. `direct_grants.manage` cannot issue internal break-glass,
which keeps its separate approval workflow. Global Employee deactivation remains tenant-scoped even when a manager
can edit/remove that Employee's membership inside one org/team.

Queue/responsible matches on a Client are contextual, not global Client scopes.
They match only the exact server-proven path
`Client <- ConversationClientLink -> Conversation <- current non-terminal WorkItem -> Queue/current primary responsible`.
The anchor is part of the command/query and cannot be caller-asserted. A
standalone Client profile needs structural, owner or exact-Client scope. The
authorization engine evaluates every Client separately in a group. A linked
Client without `client.view` is represented, if topology requires it at all, by
a redacted placeholder with no stable Client/contact identifier.

File authority is always conjunctive with its parent. A staff-note attachment
requires staff-note read, an external-message attachment requires Conversation
read and an internal attachment requires internal membership/read. Upload in an
external send additionally requires reply, exact route and source capability.
Download URLs are short-lived, actor/resource-bound where supported and issued
only after current authorization; revocation prevents renewal and invalidates
the application download path.

Inbox preview/search fields follow the same content policy. External message
text/attachment name requires `conversation.read`; internal text requires
`conversation.internal.read`; staff-note preview requires both Conversation and
staff-note read; provider roster identifiers require `participant.pii.view`.
If the newest head item is hidden, the projection selects the newest permitted
item or returns a safe opaque activity marker, never a redacted substring that
reveals hidden content.

Permission-only helpers are forbidden for enforcement. A capability hint for
UI can be derived from a completed server decision but cannot authorize the
subsequent command.

### WorkItem responsibility matrix

`Allowed` below always means the named permission still exists in a matching
scope and all state/revision guards pass. `Override` additionally requires
`work.override` and a non-empty audited reason. A role template named
`supervisor` is not sufficient.

| Action                                  | Primary responsible                                       | Active queue member                        | Scoped supervisor                                                  | Collaborator                                                      | Watcher           | Provider participant | Client owner                                 |
| --------------------------------------- | --------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------- | ----------------- | -------------------- | -------------------------------------------- |
| List/read external Conversation         | allowed through responsible scope                         | allowed only with queue-scoped read grant  | allowed in structural scope                                        | allowed with collaborator read grant                              | no implicit read  | no                   | no                                           |
| View WorkItem metadata                  | allowed with `work.read`                                  | allowed with queue-scoped `work.read`      | allowed in structural scope                                        | allowed with collaborator-scoped `work.read`                      | no                | no                   | no                                           |
| Claim unassigned work to self           | already assigned/no-op                                    | allowed with `work.claim` and eligibility  | allowed to self under the same rule                                | no                                                                | no                | no                   | no                                           |
| Assign another Employee                 | no implicit authority                                     | no implicit authority                      | allowed with `work.assign`                                         | no                                                                | no                | no                   | no                                           |
| Release assignment                      | own with `work.release_self`                              | n/a                                        | another Employee with `work.release_other` + override              | no                                                                | no                | no                   | no                                           |
| Transfer queue/responsible              | allowed with `work.transfer` to an authorized destination | no implicit authority                      | allowed; override when acting outside normal relation              | no                                                                | no                | no                   | no                                           |
| Close active work                       | allowed with `work.close`                                 | no before claim                            | allowed; override reason when bypassing responsibility policy      | no                                                                | no                | no                   | no                                           |
| Reopen                                  | only if resulting queue/policy grants it                  | allowed with queue-scoped `work.reopen`    | allowed in structural scope                                        | no                                                                | no                | no                   | no                                           |
| External reply while WorkItem is active | allowed with reply + route permissions                    | only through atomic `claimAndReply`        | override without hidden reassignment, or explicit assignment first | WorkItem collaborator only when Queue policy explicitly allows it | no                | no                   | no                                           |
| Staff-only note                         | allowed with read + note permission                       | allowed with queue read + note permissions | allowed in scope                                                   | allowed with collaborator note permission                         | no                | no                   | no                                           |
| Manage collaborators/watchers           | allowed only with manage permission                       | no implicit authority                      | allowed in scope                                                   | self-watch only if permitted                                      | self-unwatch only | no                   | no                                           |
| View/edit linked Client                 | only through separately matched Client permission         | separately authorized per Client           | separately authorized per Client                                   | separately authorized per Client                                  | no                | no                   | only for that Client and matching permission |

An ordinary reply never silently changes responsibility. The one convenience
operation is `claimAndReply`, which atomically validates `work.claim`,
`message.reply_external`, route authority and all revisions, claims the
unassigned WorkItem to the actor, creates the outbound Message/dispatch and
commits one result. If any term fails, neither claim nor Message is committed.

A supervisor reply without reassignment preserves both facts: the Message has
the actual Employee app actor/author and reporting retains the WorkItem primary
responsible at event time. It is an override, not impersonation.

A WorkItem collaborator reply is also never impersonation or hidden
responsibility. It requires collaborator-scoped `conversation.read` and
`message.reply_external`, exact route authority and Queue policy
`responsible_or_work_item_collaborator`; the actual author is recorded and the
primary responsible remains unchanged. Under the default `responsible_only`
policy it is denied.

### External reply by WorkItem state

| Canonical state                                             | Normal external-reply rule                                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active and assigned                                         | Primary responsible; allowed WorkItem collaborator by explicit Queue policy; or scoped supervisor override.                                                                     |
| Active and unassigned/claimable                             | Atomic `claimAndReply`; or scoped supervisor override that leaves an auditable unassigned response when policy permits.                                                         |
| Responsibility recovery pending                             | No normal reply. Complete/reassign recovery first; a hard operational emergency uses an explicit supervisor recovery/override command and reason.                               |
| Terminal actionable work                                    | Never treated as no-work. The command must reopen the WorkItem or create a new sequential WorkItem under tenant policy, or use a separately authorized proactive-send workflow. |
| Truly non-actionable external Conversation with no WorkItem | Trusted Conversation collaborator, structural `ConversationAccessBinding` or exact-Conversation scope may reply with reply + route permissions.                                 |

Closing a WorkItem therefore cannot be used to bypass responsibility/SLA and
reply as if the Conversation had never been actionable.

### Truly non-actionable external Conversations

Employee-only provider groups and other explicitly non-actionable external
Conversations may have no WorkItem. An external reply then requires:

- external Conversation read authority;
- `message.reply_external` matched by an explicit trusted Hulee collaborator,
  structural or exact-Conversation scope;
- `source_account.use` for the exact selected account;
- a current valid binding generation, route descriptor and capability.

Provider membership and an Employee identity claim cannot satisfy the trusted
Hulee collaborator relation. If a customer/actionable participant later makes
the Conversation actionable, policy creates/reopens a WorkItem and the active
WorkItem responsibility rules apply before further replies.

### External reply and staff-only note are different commands

`replyExternal` requires a selected canonical thread binding/route and persists
the pinned dispatch before provider I/O. It cannot accept a sender identity as
the destination and cannot use another account merely because the requested
route is unauthorized or unhealthy.

`createStaffNote` accepts no SourceAccount, binding, route or provider-reference
field. The domain, repository and dispatch worker each enforce that a
`staff_only` TimelineItem has no outbound dispatch, provider occurrence,
delivery or public/webhook/export visibility. Injecting route-like data fails
before persistence with `message.staff_only_route_forbidden`.

Staff-note read and create permissions are distinct. Conversation read alone
does not reveal notes, and staff-note permission without Conversation read does
not reveal the Conversation.

### Internal direct and group chats

Internal chats use only Hulee-origin membership episodes:

- an internal direct is created with exactly two distinct same-tenant Employee
  participant anchors, including the actor, and can never acquire a third
  anchor. Zero, one or two membership episodes may remain active after ordinary
  leave/lifecycle changes; entering Employee `draining` immediately closes that
  Employee's membership access. Topology/history always retain two anchors;
- create/find-direct never reveals an existing private direct to a caller who
  is not one of its anchors; deterministic lookup is server-side and returns a
  uniform non-disclosing result;
- an active internal group is created with at least two active same-tenant
  Employees, the creator becomes an active owner, and owner/admin/member/
  observer roles have temporal history;
- every added Employee is active, same-tenant and visible under the actor's
  target-Employee permission; guessed cross-scope Employee IDs do not disclose
  existence;
- owner/admin/member can send only with `message.send_internal`; observer is
  read-only; owner/admin can manage membership only with the dedicated
  permission and expected membership revision;
- moderating another member's content requires current owner/admin role plus
  `message.moderate_internal`; ordinary membership cannot edit another author;
- WorkItem and Client are absent by default; adding work does not make a queue
  member an internal participant;
- internal membership removal immediately fences read/send and preserves
  participant/authorship history;
- Employee deactivation removes app authority and active internal membership
  access but never rewrites authored messages;
- a tenant admin or supervisor outside the chat gets no content through tenant,
  org, team or queue scope.

An active internal group has at least one active owner. Removing/deactivating
the last owner requires an atomic active successor. If none is eligible, the
group enters explicit `owner_recovery` lifecycle: existing member content
access follows their memberships, but membership administration is frozen.
A dedicated recovery administrator can appoint an active successor using only
Conversation/member metadata; that workflow grants no message-content access.

Emergency internal read is a separate time-limited exact-Conversation
break-glass grant with `conversation.internal.break_glass_read`. Issuing it
requires separate `conversation.internal.break_glass.issue`, active issuer and
target, exact Conversation, reason, approver, maximum TTL, revocation/alarm and
audit. Self-approval is denied by default. The issuance workflow cannot grant
send, staff-note, route or membership permissions. Use is read-only; sending
still requires normal active membership, and break-glass cannot impersonate or
silently add a participant.

An employee-only Telegram/WhatsApp/MAX group remains external because it has a
provider binding. Provider owner/admin/member roles stay display evidence and
never become internal membership.

### Client CRM and multi-client groups

Conversation, WorkItem and Client authorization are evaluated independently:

- Conversation read can expose only an authorized safe participant/link
  summary; it does not expose Client contacts, sensitive custom fields, full
  provider roster/profile or stable external identifiers;
- `client.view` is evaluated for each linked Client; `client.contacts.view` is a
  further check for contact/PII fields;
- a mutation involving several Clients either authorizes every target and
  commits atomically, or fails without revealing which hidden Client failed;
- `conversation.clients.manage` on the Conversation and `client.link.manage` on
  every target Client are both required to add/remove links;
- pipeline transition, field edit and owner assignment use separate permissions
  and the Client's expected revision;
- Client owner changes append temporal history and never reassign WorkItem;
- WorkItem assignment/transfer never changes Client owner;
- linking or unlinking Clients never rewrites Message authors or report facts.

A grant scoped to Client A never authorizes the group Conversation or cards,
contacts and mutations for Clients B and C.

`client.view` returns only fields whose definitions are visible to the actor.
Restricted custom fields require `client.fields.view_sensitive`. Conversation
read may return a policy-safe participant display label, while phone, username,
stable provider ID and full roster/profile require `participant.pii.view` (and
`identity.evidence.view` for claim evidence). A hidden linked Client is a
redacted placeholder without stable Client/contact identifiers.

### Source identity claims and participant management

Employee and ClientContact claims are separate actions with separate
permissions. A generic contact-edit permission cannot change Employee
attribution. Every manual claim/revoke/unlink/reassign/merge conjunctively authorizes the
exact SourceExternalIdentity/observation side through
`identity.source_identity.use`, any sensitive evidence through
`identity.evidence.view`, the old target when present and the new Employee or
ClientContact target. Authority over a target cannot claim an arbitrary tenant
identity from an inaccessible source account/conversation.

Manual claim-to-self is forbidden: an Employee principal cannot claim a
SourceExternalIdentity to its own Employee target, including through a broad
admin role. This prevents self-attribution/report manipulation and is enforced
after the dedicated permission check. The denial creates an auditable review
request and returns `identity.claim_self_forbidden`; another active authorized
Employee can approve the reviewed claim. Break-glass cannot approve self-claim.
A single-admin/bootstrap/on-prem tenant may use only a trusted verified resolver
with `identity.auto_resolve` or a signed versioned migration/import policy. It
never converts the manual self-claim into an exception. Automatic resolution
records verified scope-correct evidence, service principal, policy version and
audit trail.

Claims use expected claim version and one-active-claim database constraints.
Concurrent claims have one winner; the loser receives
`identity.claim_conflict`. Reassignment authorizes revoke of the current target
and creation for the new target. A new claim to an inactive Employee is denied
unless a separately approved audited policy permits historical resolution.

Claim, unlink, reassign or merge never changes Account/session/RBAC, Hulee
membership, collaborator/watcher/read state, WorkItem or Message authorship.
Provider roster episodes can be changed only by adapter evidence; admin review
adds annotations and cannot rewrite provider facts.

### Notification recipient policy

Notification eligibility never grants access. Recipient resolution first
derives a reason, then reauthorizes that Employee for the exact visibility
boundary before persisting or delivering a preview.

| Event/reason                                                 | Eligible recipients before preferences                            | Mandatory authorization                                                                                                                                                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New inbound on unassigned work                               | Active Queue members selected by Queue policy                     | Matching `inbox.read` + `work.read` yields opaque new-work metadata; message preview additionally requires applicable Conversation/staff-note read. Membership alone is insufficient. |
| New inbound on assigned work                                 | Primary responsible; explicitly subscribed collaborators/watchers | Conversation/work read; watcher/collaborator relation alone is insufficient.                                                                                                          |
| Internal direct/group message                                | Other current active internal members                             | `conversation.internal.read`; sender excluded.                                                                                                                                        |
| Mention or reply                                             | Mentioned/replied Employee if otherwise eligible                  | Never bypasses Conversation read, internal privacy or staff-only visibility.                                                                                                          |
| Staff-only note                                              | Responsible/authorized collaborators/watchers selected by policy  | Conversation read + `message.staff_note.read`.                                                                                                                                        |
| Employee-only provider group                                 | Authorized trusted Hulee collaborators/structural recipients      | Provider membership/claim is ignored.                                                                                                                                                 |
| History import, replay, provider echo or own native outbound | none as client-inbound                                            | May update state but never creates a fresh-inbound alert.                                                                                                                             |

Mute, quiet hours and endpoint selection run after authorization; an allowed
mention may override mute only according to tenant/user policy, never access.
Access or relation loss suppresses pending delivery and invalidates preview
payloads before another endpoint receives them. Self preferences/endpoints use
`notification.preferences.manage_self` and
`notification.endpoints.manage_self`; managing another Employee's notification
configuration requires a future separate administrative permission.

### Aggregate reports, drilldown, export and PII

Report access is layered:

| Surface                   | Required authorization                                                                                                              | Allowed result                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Aggregate view            | `reports.view` in current structural scope                                                                                          | Counts/rates grouped by approved non-personal dimensions, without content, contacts, roster or stable person/row IDs. |
| Named workforce breakdown | aggregate view + `reports.workforce_dimension.view` + scoped `employee.directory.view`                                              | Approved Employee identity/dimensions only; no Message/Client content authority.                                      |
| Aggregate export          | `reports.view` + `reports.export`                                                                                                   | The same non-PII aggregate grain.                                                                                     |
| Row drilldown             | `reports.drilldown` plus current read permission for every underlying Conversation/WorkItem/Client/SourceAccount/file/call artifact | `source_account.view`, never send-use, and every other resource independently pass before pagination/counting.        |
| PII drilldown             | row drilldown + `reports.pii.view` + relevant `client.contacts.view`/content permission                                             | Only explicitly permitted fields.                                                                                     |
| PII export                | export + drilldown + PII view + `reports.pii.export`                                                                                | Audited, revocation-aware export.                                                                                     |

Aggregate facts retain immutable event-time author, responsible, queue, team,
org and Client-attribution snapshots. Current access grants decide what the
requester may query now; current assignee/owner never rewrites historical facts.
An aggregate queue scope filters by the event-time queue dimension. Drilldown
rechecks the current underlying resource and may therefore be denied even when
an aggregate cell remains visible.

Report permission does not reveal staff-note content. `audit.view` likewise
does not imply Message/Client PII.

Private internal Conversation membership/activity is excluded from manager
reports by default. A future compliance aggregate requires a dedicated
permission and tenant policy and still cannot grant internal content access.

ADR 0015 confirms that person-level facts remain personal data and that only a
tested irreversibly anonymous result may outlive their subject/purpose policy.
Aggregate queries continue to use only a fixed allow-list of dimensions/filters,
suppress cells smaller than five, apply consistent complementary suppression
and enforce per-actor query/export differencing budgets. A tenant may choose a
stricter threshold but not a weaker one. Narrow or combinable filters that can
isolate a person are treated as PII drilldown; minimum-cell suppression alone
does not classify the stored fact as anonymous.

An export job records actor, normalized filters, requested fields, permission
decision and authorization epoch. It revalidates access before each bounded chunk
and before download. Revocation cancels work, quarantines/deletes every partial
artifact and immediately invalidates any signed download URL. Any row containing
content, contact identifiers, participant roster or a per-event/Conversation/
Client/Message stable ID is drilldown/PII rather than a safe aggregate. The only
Employee-ID exception is the approved named-workforce aggregate authorized by
`reports.workforce_dimension.view` + `employee.directory.view`; it contains no
contributing fact/resource row IDs or content, uses fixed dimensions/minimum
period/cell/differencing controls and cannot accept arbitrary person-narrowing
filters. Approved Queue/team/source dimension keys may likewise identify only
the aggregate bucket.

### Concurrency and transaction fences

Every mutating command has a server-stamped principal, `clientMutationId`,
request hash and expected entity/authorization revisions. Idempotency is acquired
before domain locks; aggregate/resource locks use a canonical order; the tenant
stream head is allocated last as defined by ADR 0012.

Authorization uses a bounded composite dependency vector rather than updating
every affected Employee on a broad role change:

- `tenantRbacRevision` advances for permission catalog, role definition and
  role-binding changes. This is a shared security dependency and requires one
  tenant row update, not fan-out over all role subjects;
- `employeeAccessRevision` advances for direct grants, the Employee lifecycle/
  session boundary and that Employee's org/team/Queue membership changes;
- `employeeInboxRelationRevision` advances only for bounded old/new recipients
  of direct access-bearing responsibility, collaborator or internal membership
  changes. Watcher changes do not affect authority;
- `resourceAccessRevision` advances on a Conversation, Client, WorkItem or
  SourceAccount when a structural access/servicing-team binding changes. It can affect thousands of
  Employees but updates only the resource/shared dependency, never every member;
- every resource relation/aggregate also has its exact entity/relation revision
  for optimistic concurrency.

The server issues an opaque `authorizationEpoch` over the applicable tenant,
Employee and bounded direct-relation revisions plus a digest of the currently
effective temporal grant/relation IDs and interval generation. Session/cursor/
cache keys carry this epoch and an opaque `notAfter`, not a caller-readable list
of grants. A command transaction locks/compares the
bounded dependency rows and exact resource revisions that produced its
decision. A revocation that commits first makes the epoch/relation stale and
denies the command. A command that commits first remains a historically
authorized action; a later revocation does not rewrite it but prevents the next
command or payload.

Every authorization snapshot also has a server-computed
`nextAuthorizationBoundary`: the earliest session, direct grant, role binding,
collaboration, internal membership, watcher, structural binding or break-glass
`validFrom`/`validTo`/TTL boundary that can change the decision. Cache entries,
capabilities, exports and live connections are valid only until that instant.
At/before the boundary the server recomputes current time, revisions and
relations before returning another payload; future activation/expiry therefore
does not depend on a sweeper, notification delivery or row cleanup. Every
command/query also checks temporal validity directly from the trusted server
clock.
Crossing the boundary invalidates the old epoch even when no row revision was
written; recomputation produces a new temporal digest/not-after window. HTTP/
sync returns stable `sync.scope_changed`/resync semantics before any further
customer-data payload. Cleanup sweepers only archive expired rows.

| Race                                                  | Required outcome                                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| claim vs claim                                        | One active primary assignment. Same-valid-revision contender loses with `work.responsibility_conflict`; a request stale before contention gets `revision.conflict`. |
| claim vs assign                                       | Commit-order winner; loser observes a stale WorkItem revision and commits no partial state.                                                                         |
| transfer vs transfer                                  | One winner; assignment intervals never overlap.                                                                                                                     |
| transfer vs close                                     | One winner; the other receives stale revision or invalid-state outcome with no orphan history.                                                                      |
| assign/transfer to target vs target deactivation      | Eligibility fence chooses one order; no assignment can start after `draining` begins.                                                                               |
| deactivation recovery vs manual transfer/close        | Recovery uses CAS and never overwrites a newer valid manual result.                                                                                                 |
| role/grant/internal-membership revoke vs command/send | Composite authorization-epoch/relation-revision winner decides; stale actor commits nothing and receives no next unauthorized payload.                              |
| identity claim vs claim/reassign                      | Unique active claim plus expected claim version yields one winner.                                                                                                  |
| report export vs access revoke                        | Current chunk may finish only if it committed before revoke; later chunks/download are denied.                                                                      |

Direct relation changes atomically advance affected bounded recipient revisions
and produce add/remove/invalidate changes. Structural access-binding changes
advance the resource/shared revision and may enqueue asynchronous indexed
audience invalidation without member-row fan-out. Role/binding changes advance
the shared tenant RBAC revision; direct grants, membership and Employee-state
changes advance the Employee revision. Delivery fan-out and disconnect are
performance/convergence mechanisms, not the security boundary.

Before any HTTP targeted fetch, idempotent-result body, snapshot, SSE/poll
replay, live batch, file URL or notification preview is returned, the server
checks the current authorization epoch, resource access revision and exact
resource relation. Previously
materialized recipient payloads are not replayable after access loss, even if
their historical stream position precedes the later invalidate. The client gets
a scope change/resync signal without the hidden payload. Retrying a previously
successful mutation after revocation may return non-sensitive idempotency
status, but its canonical content/result body is reauthorized.

### Scalable Employee deactivation

Deactivation is one fenced workflow, not one unbounded atomic transaction. Its
canonical lifecycle is `active -> draining -> inactive` (`draining` may be
displayed as "deactivating"):

1. Entering `draining` atomically revokes sessions, app authority, notification
   eligibility and new assignment eligibility; advances Employee/relation
   security revisions; writes audit; and emits the durable fence change.
2. Existing assignment rows are immediately treated as _draining_, not as an
   active Employee authority. Their WorkItems project
   `responsibility_recovery_pending`, remain visible/escalated to their Queue
   and cannot use normal responsible-only reply/close commands. This is a
   derived safety overlay from the canonical Employee assignment fence, not an
   eventually consistent source of truth: every command reads the fence
   directly in its transaction before accepting the stored assignment.
3. A retryable coordinator releases/requeues WorkItems in bounded batches.
   Every individual transition is atomic, uses the WorkItem revision, closes
   temporal responsibility at the immutable fence time, writes events/history
   and never
   overwrites a newer manual supervisor transfer/close.
4. Separate bounded policies transfer or clear current Client ownership and
   close inactive internal memberships. A sole internal-group owner is replaced
   by an active successor or the group enters metadata-only `owner_recovery`;
   this never grants a recovery administrator message-content access.
5. The Employee becomes `inactive` only after locked/checkpointed queries prove
   there is no open effective primary assignment or current Client-owner/internal
   owner relation. Small sets may use a synchronous fast path with the same
   fences.

An inactive Employee therefore never remains an effective primary/owner, while
a large tenant does not lock an unbounded number of WorkItems/Clients/groups or
the tenant stream in one transaction. If no valid destination/successor exists,
the workflow remains diagnosably `draining`, alerts administrators and cannot
silently drop work or finalize invalid state. Participant, identity-claim and
authorship history is retained.

The coordinator persists idempotent checkpoints for registered recovery
handlers (WorkItem, Client owner, internal membership/owner, notifications and
future module-owned Employee relations). Finalization requires every mandatory
handler complete plus authoritative zero-relation checks. Modules extend the
versioned recovery-handler contract; provider/company conditionals are not
added to core.

### Supervisor override and break-glass

Supervisor is a configurable role template only. An override requires the
ordinary operation permission, `work.override`, matching source/destination
scope, a reason and atomic domain-history/security-audit records. It cannot
bypass tenant boundaries, inactive target, one-primary constraint, internal
privacy, staff-only dispatch prohibition or source route capability.

Break-glass is rarer, time-limited exceptional access. It uses a direct grant,
reason, expiry and dedicated permission. Normal queue supervision must not use
break-glass, and break-glass is never a generic tenant bypass.

### Audit and immutable history

Domain history and security audit are separate immutable records. A successful
privileged mutation commits its required audit with authorization revisions,
domain events, tenant-stream change and outbox intents; it fails closed if that
audit/event write fails.

Denied/guessed-ID/security attempts have no successful domain transaction.
They use a separate bounded security-audit path with safe redaction,
dedupe/rate-limit/aggregation and abuse counters. A denied request never
allocates an Inbox tenant-stream position, takes the stream-head lock or creates
a provider/domain outbox intent. High-risk denials such as manual self-claim can
also create a bounded review/alert record without leaking the target resource.

Audit is mandatory for:

- claim, assign, release, transfer, close and reopen;
- collaborator, watcher and internal participant membership changes;
- identity claim/revoke/reassign/merge, including denied manual self-claim;
- CRM pipeline, owner, field and Conversation-Client link changes;
- supervisor override and break-glass use;
- report PII drilldown and every export;
- Employee deactivation/requeue recovery;
- role/grant/membership changes; security-relevant denials follow the bounded
  denial path above.

Every successful audit event stores immutable target-derived authorization
facets for the org/team/Queue/resource dimensions affected at event time. Actor
membership, current responsible, Client owner and the grant used to perform the
action are audit metadata and never make the row visible. A cross-scope action
such as transfer has source and destination facets. A scoped viewer can receive
only a matching facet with foreign facet identifiers redacted; tenant audit can
receive the whole event. The facet predicate is applied before audit pagination,
search and counts. Reorganization or later assignment never rewrites facets.

The record includes tenant, principal kind/ID, Employee app actor when present,
action, resource references, before/after revisions, matched permissions/grant
sources/scopes, override reason, mutation/correlation IDs, outcome/error and
time. Raw evidence/contact/message PII is referenced or redacted according to
ADR 0015, not copied into generic audit payloads. The immutable audit skeleton
and any separately restricted evidence both have finite lifecycle rules.

### Stable errors and non-disclosure

The minimum stable V2 error families are:

- `auth.session_invalid`, `auth.employee_inactive`,
  `auth.access_revision_stale`;
- `resource.not_found`, `permission.denied`, `revision.conflict`,
  `command.idempotency_conflict`;
- `work.not_claimable`, `work.responsibility_conflict`,
  `work.assignee_ineligible`, `work.state_conflict`,
  `work.destination_forbidden`, `work.override_reason_required`;
- `identity.claim_self_forbidden`, `identity.claim_conflict`,
  `identity.claim_target_inactive`, `identity.scope_conflict`;
- `conversation.membership_conflict`,
  `conversation.direct_topology_violation`;
- `message.staff_only_route_forbidden`; ADR 0011 route failures remain
  `route.forbidden`, `route.inactive`, `route.binding_changed` and the rest of
  that canonical route namespace;
- `report.pii_forbidden`, `report.export_forbidden`,
  `report.access_changed`.

For guessed, cross-tenant or otherwise undisclosable identifiers, external APIs
return the same `resource.not_found` shape. A caller gets current revision or
specific state-conflict detail only after read authority for that resource has
already passed.

### Query and high-load access plan

Authorization is part of the query plan, not an in-memory filter after `LIMIT`:

- structural access is stored once as compact scope/resource indexes and joined
  to one actor effective-scope set; the design must not materialize a Cartesian
  `Employee x Conversation` table for tenant/wide-team grants;
- bounded per-recipient rows are used only for dynamic state/relations such as
  read, pin, responsibility, collaboration, internal membership and notification;
- list, search and counts apply the access predicate before keyset pagination;
- one request uses one versioned effective-access snapshot rather than loading
  roles/bindings/grants per row;
- caches are keyed by tenant, principal and opaque authorization epoch; revision
  dependency changes make old entries unreachable without broad cache scans;
- projections never materialize provider membership or identity claims as
  workforce access;
- realtime batches use the same policy and purge/invalidate lost access before
  sending another entity payload.

Load gates cover wide tenant/team/Queue grants, a role/binding revoke affecting
thousands of Employees, membership churn, reconnect storm and relation changes
on hot Conversations. Shared revision changes use jittered reconnect/resync and
bounded snapshot/catch-up; they do not require one transaction updating every
Employee or one synchronous per-Conversation fan-out.

The diagnostic access-decision endpoint may evaluate hypothetical resources for
an administrator, but it is not an enforcement oracle. Commands always reload
the actual resource context through the authoritative server-only resolver.

### Historical V1 compatibility mapping and current clean slate

The conservative mapping rules below were verified for the former preserve
path. ADR 0016 performs no V1 RBAC/business-row migration; they remain useful
negative rules for seeds, imports and future external migration tools. Current
V2 bootstrap creates the scoped model directly.

The V1 catalog is not broadened in place. Inbox V2 introduces a versioned
catalog/resource resolver and a conservative migration report:

- `reports.view` maps at most to aggregate `reports.view`; it does not grant
  drilldown, PII or export;
- `message.reply` does not grant internal send or staff-note access. A reviewed
  mapping may create external-reply grants only in scopes valid under V2;
- Client-scoped inbox/conversation/reply/file grants retain Client authority
  only and require explicit Conversation/collaborator grants for content;
- `conversation.assign` does not silently become every WorkItem operation;
- V1 `assigned`/`own` grants do not infer primary responsibility or client
  ownership; migration selects explicit V2 relation/structural scopes;
- incompatible role updates/bindings are rejected or staged through a
  versioned migration; an active role may never make its existing scope illegal;
- role templates are regenerated as reviewed permission bundles and never used
  directly by V2 runtime authorization. The V1 `assertEmployeeCan`/system-template
  compatibility path is blocked by tests and removed at cutover.

The retired preserve migration would have required a dry-run diff and manual
review. The clean-slate epoch instead deletes disposable V1 grants and never
auto-broadens access to reproduce a V1 screen.

## Required implementation boundaries

- `packages/core` owns versioned permission/scope/relation contracts and pure
  policy decisions. It receives authoritative facts and has no provider branch.
- `packages/db` enforces composite tenant edges, temporal relations, unique
  active claims/primary assignments, SourceAccount/Conversation structural
  ownership, shared/Employee/relation authorization revisions and atomic
  privileged mutation/audit/event/outbox persistence.
- `apps/api` owns the one server-side resource loader/authorization facade and
  invokes it inside command/query transaction boundaries.
- projections apply access before pagination and produce actor-scoped sync
  changes keyed by the opaque composite authorization epoch.
- web/mobile/desktop consume server capabilities only for UX. They never
  reproduce authorization or trust hidden buttons as enforcement.
- source adapters provide identity/roster/binding/capability evidence only and
  cannot add core grants or Hulee membership.

## Verification contract

Implementation must include generated/table-driven and adversarial tests for:

- principal x permission x scope x relation x resource x state decisions;
- scoped `employees.manage`/`audit.view` never becoming tenant-wide;
- authorization before list pagination and scoped counts;
- exact WorkItem/Conversation/Client/SourceAccount structural relationship paths
  and absence-of-binding denial;
- two simultaneous WorkItem claims, transfer/close and transfer/deactivate;
- target active/Queue eligibility and source/destination scope;
- supervisor override permission/reason/audit and hard-invariant denial;
- watcher, collaborator, responsible, queue member and internal participant
  outcomes as distinct cases;
- responsible-only versus collaborator-reply Queue policy, terminal WorkItem
  reopen/proactive-send and no-work employee-group outcomes;
- provider member/admin and Employee identity claim granting no Hulee access;
- separate Employee/ClientContact claims, manual self-claim denial and
  concurrent claim conflict;
- internal direct non-disclosure, group last-owner recovery, membership removal,
  deactivation and break-glass issue/use separation;
- external employee-only group reply without a synthetic WorkItem;
- staff-note route injection creating zero dispatch/outbox/provider calls;
- multi-client partial access, per-Client contact PII and owner/responsible
  independence;
- notification recipient matrix, watcher-without-access and pending-preview
  suppression after revoke;
- aggregate/workforce dimension versus drilldown/PII/export, small-cell/
  differencing suppression, internal-chat exclusion and revoke mid-export;
- shared role, Employee and resource-relation revision revoke closing HTTP,
  idempotent result, file URL, notification, SSE replay/cache before next payload;
- mass role/binding revoke and reconnect storm without per-Employee transaction
  fan-out or Cartesian access materialization;
- same-tenant composite constraints and uniform cross-tenant/guessed-ID denial;
- role update against incompatible active binding;
- identity claim source/old-target/new-target conjunction and evidence redaction;
- file parent-visibility conjunction, short URL expiry/revoke and staff-note
  attachment isolation;
- draining deactivation across WorkItem, Client owner and internal sole-owner
  recovery with crash/retry/batch capacity;
- bounded/rate-limited denial audit without tenant-stream/outbox amplification;
- V1 template-derived authorization cannot enter any V2 handler;
- idempotency same-ID/same-hash and same-ID/different-hash.

## Consequences

Positive:

- operational responsibility, communication membership, notifications, CRM
  ownership and provider identity can evolve independently;
- multi-client and internal group chats do not require security exceptions;
- one authorization model covers web, mobile, desktop, API, realtime, files,
  reports and future source types;
- concurrent assignment/deactivation and permission revocation have defined,
  testable outcomes;
- aggregate reporting can be broadly useful without implicitly exposing PII.

Costs:

- V2 needs a larger, versioned permission catalog and more explicit role
  templates;
- resource loading/projections need relation-aware access indexes and revision
  invalidation;
- migration cannot preserve every coarse V1 grant automatically;
- private internal chats require a distinct content boundary and audited
  break-glass workflow;
- Employee deactivation becomes an observable workflow for large assignments
  rather than a single boolean update.

## Alternatives rejected

### One coarse `message.reply`/`conversation.assign` permission

Rejected because external transport, internal send, staff note and WorkItem
responsibility have different routes, visibility and concurrency invariants.

### Treat role names such as supervisor or tenant admin as authority

Rejected because names cannot express resource scope, override reason or
company-specific least privilege and create hidden bypasses.

### Let queue membership, participant, watcher or identity claim grant access

Rejected because operational eligibility, authorship, notification intent and
identity resolution are not authorization decisions.

### Let Client access grant linked Conversation access

Rejected because a group can contain several independently protected Clients
and staff/internal content; one Client grant would leak unrelated data.

### Filter unauthorized rows after pagination

Rejected because it creates incomplete/unstable pages, leaks counts/timing and
does not scale to high-load tenants.

### Deactivate an Employee then repair assignments asynchronously

Rejected because it creates an invalid interval with an inactive primary
responsible. The `draining` eligibility/authority fence precedes bounded
recovery and `inactive` is reached only after recovery is complete.

### One unbounded deactivation transaction

Rejected because a high-volume Employee can lock too many WorkItems and the
tenant stream for an unbounded duration. Bounded CAS recovery provides the same
final invariant with diagnosable progress.

### Increment every affected Employee row on a broad role change

Rejected because a role/binding update can affect thousands of members and
would require an unbounded transaction or create a revocation window. A shared
tenant RBAC revision plus bounded Employee/relation revisions forms the security
epoch; delivery fan-out remains asynchronous convergence only.
