# RBAC Admin Guidance

This document explains how company administrators should model access in Hulee
once scoped RBAC is enabled. Inbox V2's normative responsibility and permission
model is ADR 0013; implementation status remains in
`docs/product/inbox-v2-backlog.md`.

## Access Model

Effective access is the sum of:

- tenant role bindings;
- direct permission grants.

Each grant combines a permission and a scope. A permission answers what the employee can do. A scope answers where the employee can do it.

## Scope Types

Use the narrowest scope that matches the job:

| Scope                  | Meaning                                                       | Typical Use                                                 |
| ---------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| `tenant`               | Whole company tenant.                                         | Company admin, global integration admin, full audit viewer. |
| `org_unit`             | Exact department/branch, or an explicitly configured subtree. | Sales supervisor for one department.                        |
| `team`                 | Explicit target servicing/access binding to one Team.         | Team-scoped work or Employee management.                    |
| `queue`                | Current work queue.                                           | Lead intake, claims, support queues.                        |
| `assigned`             | V1 compatibility scope; Employee or team assignment.          | Do not use for new Inbox V2 responsibility rules.           |
| `own`                  | V1 compatibility scope with resource-specific meaning.        | Do not use as a generic Inbox V2 ownership shortcut.        |
| `client`               | One concrete client.                                          | Temporary coverage for a key account.                       |
| `conversation`         | One concrete conversation.                                    | Temporary help in a single case.                            |
| `work_item`            | One concrete WorkItem.                                        | Temporary work supervision/coverage.                        |
| `source_account`       | One concrete tenant SourceAccount.                            | Permission to use a selected external sending account.      |
| `responsible`          | Current primary responsible on one WorkItem.                  | Operator actions on their current work.                     |
| `collaborator`         | Current explicit Hulee collaborator relation.                 | Read/staff-note assistance when the permission allows it.   |
| `internal_participant` | Current Hulee-origin internal-chat membership.                | Internal read/send according to membership role.            |
| `client_owner`         | Current owner of exactly one Client.                          | CRM actions for owned Clients, never Conversation access.   |

Permissions restrict which scopes are legal. For example, `modules.manage`, `integrations.manage`, `branding.manage`, `api_keys.manage` and `webhooks.manage` are tenant-wide permissions and should not be assigned to queue or assigned scopes.

The scope above is a target-resource boundary, not a substitute for the
permission. Likewise, membership/relation is not a grant. A queue member still
needs `work.claim`; a responsible Employee still needs reply/close permissions;
an internal participant still needs internal read/send permissions.
Role-binding subject membership decides who receives a grant; `team` scope
matches the target resource's explicit team relation. These are not the same
fact and neither is inferred from the other.

## Inbox V2 Security Boundaries

- `client` scope authorizes only that Client. It never opens linked
  Conversations, Messages or files; each Client/contact in a group is checked
  independently.
- Conversation access does not grant Client contacts/PII, CRM edit or report
  drilldown. Those permissions are separate.
- External reply, internal-chat send and staff-only note read/create are
  different permissions. Staff-only content never has a provider route.
- Watcher is notification state, not access. Collaborator and primary
  responsible remain different temporal relations.
- Provider roster/admin status and SourceExternalIdentity claims never grant
  Hulee access or internal membership.
- Internal chat content is available through current Hulee membership. Broad
  tenant/org/team/queue roles do not open private chats; exceptional read uses
  time-limited audited break-glass and cannot send.
- A supervisor is a role template, not a bypass. Override combines the ordinary
  operation permission with scoped `work.override`, a reason and audit.
- Aggregate reports do not imply drilldown, PII or export. Each layer has its
  own permission and underlying resource checks.
- Server actions must evaluate permission and scope against a server-loaded
  target. Checking only that an Employee has a permission is insufficient.

## Role Templates

Role templates are starting points. Admins can create custom tenant roles from the permission catalog when a template is too broad or too narrow.

| Template                 | Recommended Scope | Purpose                                                                     |
| ------------------------ | ----------------- | --------------------------------------------------------------------------- |
| `tenant_admin`           | `tenant`          | Full company administration. Use sparingly.                                 |
| `supervisor`             | `org_unit`        | Department-level employee, inbox, client, file, report and audit work.      |
| `lead_intake`            | `queue`           | Intake queue processing, lead classification, qualification and assignment. |
| `sales_representative`   | `responsible`     | Work on the Employee's current primary WorkItems; Client CRM is separate.   |
| `sales_supervisor`       | `org_unit`        | Sales department visibility, routing and reporting.                         |
| `claims_agent`           | `queue`           | Claims queue replies, case closing/reopening and file work.                 |
| `measurement_specialist` | `responsible`     | Measurement work where the specialist is current primary responsible.       |
| `support_agent`          | `queue`           | Support queue replies and case lifecycle.                                   |

Operational teams should usually start with these patterns:

- lead intake users get a queue-scoped role for the intake queue;
- sales representatives get responsible-scoped WorkItem access and separate
  Client permissions when their job needs CRM data;
- sales supervisors get org-unit-scoped access for their sales department;
- claims and support agents get queue-scoped access;
- measurement specialists get responsible-scoped access.

## Role Design Rules

- Prefer a small number of job roles over one role per employee.
- Keep administrative permissions separate from operational inbox permissions.
- Avoid tenant-wide scope unless the employee genuinely administers the whole company.
- Use `org_unit`, `team` or `queue` scopes for supervisors and department leads.
- Treat `assigned` as V1 compatibility only. For Inbox V2 use explicit queue/responsible/
  collaborator/Client-owner scopes according to the job; do not infer one
  relation from another.
- Do not use direct grants as a permanent role system.
- Review role permissions after adding new modules, because modules may introduce new permission domains.

## Direct Grant Governance

Direct grants are temporary exceptions for one employee. They are useful for vacation coverage, urgent escalation, onboarding support or temporary access to a client/conversation.

Every direct grant must have a reason because audit must answer why the exception existed. A reason should identify the business context, such as `vacation coverage for sales queue` or `temporary escalation for client ABC`.

Every direct grant should have an expiry. Without expiry, temporary access becomes invisible role drift: the employee keeps access after the incident, handoff or assignment has ended. Expiry makes the exception self-cleaning and keeps least-privilege reviews small.

Runtime authorization enforces the exact start/expiry boundary from the server
clock; cleanup jobs are maintenance only and are not the security boundary.

Governance rules:

- require scoped `direct_grants.manage`; target Employee, requested permission
  and requested scope must all be within the administrator's delegable authority;
- deny self-escalation and keep internal-chat break-glass on its separate
  approval permission/workflow;
- require a concrete reason;
- set the shortest practical expiry;
- prefer `client`, `conversation` or `work_item` scope for one-off help, but do
  not assume one scope grants the other resources;
- prefer a scoped role binding when the access repeats for the same job;
- do not grant access broader than the admin can manage;
- review active direct grants during access audits;
- revoke direct grants as soon as the temporary need ends.

## Access Review Checklist

For each employee, review:

- active role bindings;
- direct grants without expiry;
- direct grants expiring far in the future;
- tenant-wide administrative permissions;
- access to queues, teams or org units the employee no longer belongs to;
- expired grants and bindings visible in audit/history.

For each role, review:

- whether every permission is still needed;
- whether the recommended scope is still valid;
- whether `roles.manage`, `employees.manage`, `audit.view`, `integrations.manage`, `modules.manage`, `api_keys.manage` or `webhooks.manage` are only present in administrative roles;
- whether operational roles can still perform their intended inbox and routing tasks.

## Legacy Employee Roles

Scoped RBAC is the only authorization source for company access. Legacy employee roles such as `tenant_admin`, `supervisor` and `agent` may still appear in older employee records during migration cleanup, but they do not grant effective permissions by themselves.

Company admins should manage access with tenant role bindings and direct grants. If an employee has only a legacy employee role and no scoped role binding or direct grant, the employee should be treated as having no company access.

New employee invitations do not carry an access role. After the employee accepts an invitation, company admins should assign the required tenant role binding or direct grant from the access management UI.
