# RBAC Admin Guidance

This document explains how company administrators should model access in Hulee once scoped RBAC is enabled.

## Access Model

Effective access is the sum of:

- tenant role bindings;
- direct permission grants.

Each grant combines a permission and a scope. A permission answers what the employee can do. A scope answers where the employee can do it.

## Scope Types

Use the narrowest scope that matches the job:

| Scope          | Meaning                                                     | Typical Use                                                 |
| -------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| `tenant`       | Whole company tenant.                                       | Company admin, global integration admin, full audit viewer. |
| `org_unit`     | Department or branch.                                       | Sales supervisor for one department.                        |
| `team`         | Team membership and team-owned work.                        | Team lead or team-specific employee management.             |
| `queue`        | Current work queue.                                         | Lead intake, claims, support queues.                        |
| `assigned`     | Conversation/client assigned to the employee or their team. | Sales representative or measurement specialist.             |
| `own`          | Resource owned by the employee.                             | Personal client or own-profile access.                      |
| `client`       | One concrete client.                                        | Temporary coverage for a key account.                       |
| `conversation` | One concrete conversation.                                  | Temporary help in a single case.                            |

Permissions restrict which scopes are legal. For example, `modules.manage`, `integrations.manage`, `branding.manage`, `api_keys.manage` and `webhooks.manage` are tenant-wide permissions and should not be assigned to queue or assigned scopes.

## Role Templates

Role templates are starting points. Admins can create custom tenant roles from the permission catalog when a template is too broad or too narrow.

| Template                 | Recommended Scope | Purpose                                                                     |
| ------------------------ | ----------------- | --------------------------------------------------------------------------- |
| `tenant_admin`           | `tenant`          | Full company administration. Use sparingly.                                 |
| `supervisor`             | `org_unit`        | Department-level employee, inbox, client, file, report and audit work.      |
| `lead_intake`            | `queue`           | Intake queue processing, lead classification, qualification and assignment. |
| `sales_representative`   | `assigned`        | Work only on assigned clients and conversations.                            |
| `sales_supervisor`       | `org_unit`        | Sales department visibility, routing and reporting.                         |
| `claims_agent`           | `queue`           | Claims queue replies, case closing/reopening and file work.                 |
| `measurement_specialist` | `assigned`        | Measurement work assigned to the specialist or their team.                  |
| `support_agent`          | `queue`           | Support queue replies and case lifecycle.                                   |

Operational teams should usually start with these patterns:

- lead intake users get a queue-scoped role for the intake queue;
- sales representatives get assigned-scoped access;
- sales supervisors get org-unit-scoped access for their sales department;
- claims and support agents get queue-scoped access;
- measurement specialists get assigned-scoped access.

## Role Design Rules

- Prefer a small number of job roles over one role per employee.
- Keep administrative permissions separate from operational inbox permissions.
- Avoid tenant-wide scope unless the employee genuinely administers the whole company.
- Use `org_unit`, `team` or `queue` scopes for supervisors and department leads.
- Use `assigned` for employees who should only work on assigned leads, clients or conversations.
- Do not use direct grants as a permanent role system.
- Review role permissions after adding new modules, because modules may introduce new permission domains.

## Direct Grant Governance

Direct grants are temporary exceptions for one employee. They are useful for vacation coverage, urgent escalation, onboarding support or temporary access to a client/conversation.

Every direct grant must have a reason because audit must answer why the exception existed. A reason should identify the business context, such as `vacation coverage for sales queue` or `temporary escalation for client ABC`.

Every direct grant should have an expiry. Without expiry, temporary access becomes invisible role drift: the employee keeps access after the incident, handoff or assignment has ended. Expiry makes the exception self-cleaning and keeps least-privilege reviews small.

Governance rules:

- require a concrete reason;
- set the shortest practical expiry;
- prefer `client` or `conversation` scope for one-off help;
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
