"use server";

import type {
  ClientId,
  ConversationId,
  EmployeeId,
  EventId,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import {
  assertPermissionScopeAllowed,
  assertPermissionsAllowedForScope,
  createRbacEvent,
  isPermission,
  normalizePermissionScope,
  prepareCustomTenantRole,
  resolveEffectivePermissionGrants,
  type EffectivePermissionGrant,
  type Permission,
  type PermissionActor,
  type PermissionResourceContext,
  type PermissionScope,
  type PermissionRoleBinding,
  type PermissionRoleBindingSubject,
  type PreparedCustomTenantRole,
  type RbacEventType
} from "@hulee/core";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlDomainEventRepository,
  createSqlOrgStructureRepository,
  createSqlSecurityAuditRepository,
  createSqlTenantRbacRepository,
  type AccessAuditAction,
  type SecurityAuditEntityType,
  type TenantRoleRecord
} from "@hulee/db";
import { createTranslator, resolveLocale } from "@hulee/i18n";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { assertWebActionRequest } from "./action-security";
import { getWebDatabase, isEmailNotVerifiedError } from "./session";
import type { WebAccessSession } from "./access";
import {
  assertCanGrantScopedPermissions,
  assertCanManageScopedAccess
} from "./rbac-least-privilege";
import { isPrivilegedActionReauthRequiredError } from "./privileged-action-policy";
import { roleActionFailureStatus } from "./role-action-status";
import { findRoleTemplate, uniqueRoleTemplateName } from "./role-templates";
import {
  assertWebDbBackedAdminCommandBoundary,
  webDbBackedAdminCommandBoundaries
} from "./web-admin-command-boundary";

export async function createCustomTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission(formData);
  const now = new Date();
  const repository = createSqlTenantRbacRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const roleId = `role:${session.tenantId}:custom:${randomUUID()}`;
    const role = prepareCustomTenantRole({
      name: readRequiredFormString(formData, "name"),
      description: readOptionalFormString(formData, "description"),
      permissions: readFormStringList(formData, "permissions")
    });

    await repository.createRoleWithPermissions({
      id: roleId,
      tenantId: session.tenantId,
      name: role.name,
      description: role.description,
      isSystem: false,
      createdByEmployeeId: session.employeeId,
      createdAt: now,
      permissions: role.permissions
    });

    await recordAccessMutation({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "role.created",
      entityType: "role",
      entityId: roleId,
      metadata: {
        roleId,
        name: role.name,
        permissions: role.permissions,
        permissionCount: role.permissions.length
      },
      occurredAt: now,
      event: createRbacEvent({
        id: createRbacEventId(session.tenantId, "role.created"),
        tenantId: session.tenantId,
        type: "role.created",
        occurredAt: now.toISOString(),
        payload: {
          roleId,
          actorEmployeeId: session.employeeId,
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          permissionCount: role.permissions.length,
          isSystem: false
        }
      })
    });

    destination = roleActionDestination(formData, "created");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function createRoleFromTemplateAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission(formData);
  const now = new Date();
  const repository = createSqlTenantRbacRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const templateId = readRequiredFormString(formData, "templateId");
    const template = findRoleTemplate(templateId);

    if (template === undefined) {
      throw new Error("Role template was not found.");
    }

    const { t } = createTranslator(
      resolveLocale(readOptionalFormString(formData, "locale"))
    );
    const roles = await repository.listRoleDefinitions({
      tenantId: session.tenantId
    });
    const roleName = uniqueRoleTemplateName(
      roles.map((role) => role.name),
      t(template.nameKey)
    );
    const role = prepareCustomTenantRole({
      name: roleName,
      description: t(template.descriptionKey),
      permissions: template.permissions
    });
    const roleId = `role:${session.tenantId}:template:${template.id}:${randomUUID()}`;

    await repository.createRoleWithPermissions({
      id: roleId,
      tenantId: session.tenantId,
      name: role.name,
      description: role.description,
      isSystem: false,
      createdByEmployeeId: session.employeeId,
      createdAt: now,
      permissions: role.permissions
    });

    await recordAccessMutation({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "role.created",
      entityType: "role",
      entityId: roleId,
      metadata: {
        roleId,
        name: role.name,
        templateId: template.id,
        recommendedScopeType: template.recommendedScopeType,
        permissions: role.permissions,
        permissionCount: role.permissions.length
      },
      occurredAt: now,
      event: createRbacEvent({
        id: createRbacEventId(session.tenantId, "role.created"),
        tenantId: session.tenantId,
        type: "role.created",
        occurredAt: now.toISOString(),
        payload: {
          roleId,
          actorEmployeeId: session.employeeId,
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          permissionCount: role.permissions.length,
          isSystem: false,
          templateId: template.id,
          recommendedScopeType: template.recommendedScopeType
        }
      })
    });

    destination = roleActionDestination(formData, "template_created");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function updateCustomTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission(formData);
  const now = new Date();
  const repository = createSqlTenantRbacRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const roleId = readRequiredFormString(formData, "roleId");
    const role = prepareCustomTenantRole({
      name: readRequiredFormString(formData, "name"),
      description: readOptionalFormString(formData, "description"),
      permissions: readFormStringList(formData, "permissions")
    });
    const [roles, bindings] = await Promise.all([
      repository.listRoleDefinitions({ tenantId: session.tenantId }),
      repository.listRoleBindings({ tenantId: session.tenantId, at: now })
    ]);
    const existingRole = roles.find((candidate) => candidate.id === roleId);

    assertCustomRole(existingRole);
    assertRoleUpdateDoesNotRemoveOwnRoleManagement({
      bindings,
      currentEmployeeId: session.employeeId,
      existingRole,
      nextRole: role
    });
    const permissionsDelta = permissionDiff(
      existingRole.permissions,
      role.permissions
    );

    await repository.updateCustomRoleWithPermissions({
      tenantId: session.tenantId,
      roleId,
      name: role.name,
      description: role.description,
      updatedAt: now,
      permissions: role.permissions
    });

    await recordAccessMutation({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "role.updated",
      entityType: "role",
      entityId: roleId,
      metadata: {
        roleId,
        previousName: existingRole.name,
        nextName: role.name,
        previousDescription: existingRole.description,
        nextDescription: role.description,
        previousPermissions: existingRole.permissions,
        nextPermissions: role.permissions,
        ...permissionsDelta
      },
      occurredAt: now,
      event: createRbacEvent({
        id: createRbacEventId(session.tenantId, "role.updated"),
        tenantId: session.tenantId,
        type: "role.updated",
        occurredAt: now.toISOString(),
        payload: {
          roleId,
          actorEmployeeId: session.employeeId,
          previousName: existingRole.name,
          nextName: role.name,
          previousDescription: existingRole.description,
          nextDescription: role.description,
          previousPermissions: existingRole.permissions,
          nextPermissions: role.permissions,
          addedPermissions: permissionsDelta.addedPermissions,
          removedPermissions: permissionsDelta.removedPermissions
        }
      })
    });

    destination = roleActionDestination(formData, "updated");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function archiveCustomTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission(formData);
  const now = new Date();
  const repository = createSqlTenantRbacRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const roleId = readRequiredFormString(formData, "roleId");
    const [roles, bindings] = await Promise.all([
      repository.listRoleDefinitions({ tenantId: session.tenantId }),
      repository.listRoleBindings({ tenantId: session.tenantId, at: now })
    ]);
    const role = roles.find((candidate) => candidate.id === roleId);

    assertCustomRole(role);

    if (
      isRoleAssignedToEmployee(bindings, roleId, session.employeeId) &&
      role.status === "active"
    ) {
      throw new Error("Current employee custom role cannot be archived.");
    }

    await repository.setCustomRoleStatus({
      tenantId: session.tenantId,
      roleId,
      status: "archived",
      updatedAt: now
    });

    await recordAccessMutation({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "role.archived",
      entityType: "role",
      entityId: roleId,
      metadata: {
        roleId,
        name: role.name,
        status: "archived"
      },
      occurredAt: now,
      event: createRbacEvent({
        id: createRbacEventId(session.tenantId, "role.archived"),
        tenantId: session.tenantId,
        type: "role.archived",
        occurredAt: now.toISOString(),
        payload: {
          roleId,
          actorEmployeeId: session.employeeId,
          name: role.name,
          status: "archived"
        }
      })
    });

    destination = roleActionDestination(formData, "archived");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function restoreCustomTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission(formData);
  const now = new Date();
  const repository = createSqlTenantRbacRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const roleId = readRequiredFormString(formData, "roleId");
    const roles = await repository.listRoleDefinitions({
      tenantId: session.tenantId
    });
    const role = roles.find((candidate) => candidate.id === roleId);

    assertCustomRole(role);

    await repository.setCustomRoleStatus({
      tenantId: session.tenantId,
      roleId,
      status: "active",
      updatedAt: now
    });

    await recordAccessMutation({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "role.restored",
      entityType: "role",
      entityId: roleId,
      metadata: {
        roleId,
        name: role.name,
        status: "active"
      },
      occurredAt: now,
      event: createRbacEvent({
        id: createRbacEventId(session.tenantId, "role.restored"),
        tenantId: session.tenantId,
        type: "role.restored",
        occurredAt: now.toISOString(),
        payload: {
          roleId,
          actorEmployeeId: session.employeeId,
          name: role.name,
          status: "active"
        }
      })
    });

    destination = roleActionDestination(formData, "restored");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function assignTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission(formData);
  const subject = readRoleBindingSubject(formData);
  const roleId = readRequiredFormString(formData, "roleId");
  const scope = normalizePermissionScope({
    type: readRequiredFormString(formData, "scopeType"),
    id: readOptionalFormString(formData, "scopeId")
  });
  const now = new Date();
  const rbacRepository = createSqlTenantRbacRepository(getWebDatabase());
  const employeeRepository =
    createSqlEmployeeDirectoryRepository(getWebDatabase());
  const orgStructureRepository =
    createSqlOrgStructureRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const [roles, bindings] = await Promise.all([
      rbacRepository.listRoleDefinitions({ tenantId: session.tenantId }),
      rbacRepository.listRoleBindings({
        tenantId: session.tenantId,
        at: now
      })
    ]);
    const role = roles.find((candidate) => candidate.id === roleId);
    const existingBinding = bindings.find((binding) => {
      return (
        binding.roleId === roleId &&
        binding.subject.type === subject.type &&
        binding.subject.id === subject.id &&
        areScopesEqual(binding.scope, scope)
      );
    });

    if (role === undefined || role.status !== "active") {
      throw new Error("Role is not assignable.");
    }

    assertPermissionsAllowedForScope(role.permissions, scope.type);
    await assertAssignableRoleBindingSubject({
      tenantId: session.tenantId,
      subject,
      employeeRepository,
      orgStructureRepository
    });
    const [targetResource, actorPrivilege] = await Promise.all([
      resolveKnownScopeResource(session.tenantId, scope),
      resolveRoleManagementActorPrivilege({
        session,
        employeeRepository,
        rbacRepository,
        roles,
        roleBindings: bindings,
        now
      })
    ]);

    assertCanGrantScopedPermissions({
      actor: actorPrivilege.actor,
      effectiveGrants: actorPrivilege.effectiveGrants,
      target: {
        permissions: role.permissions,
        resource: targetResource
      }
    });

    if (existingBinding === undefined) {
      const bindingId = `role_binding:${session.tenantId}:${subject.type}:${randomUUID()}`;

      await rbacRepository.createRoleBinding({
        id: bindingId,
        tenantId: session.tenantId,
        roleId,
        subject,
        scope,
        createdByEmployeeId: session.employeeId,
        createdAt: now
      });

      await recordAccessMutation({
        tenantId: session.tenantId,
        actorEmployeeId: session.employeeId,
        action: "role_binding.created",
        entityType: "role_binding",
        entityId: bindingId,
        metadata: {
          roleId,
          ...roleBindingSubjectMetadata(subject),
          ...scopeMetadata(scope)
        },
        occurredAt: now,
        event: createRbacEvent({
          id: createRbacEventId(session.tenantId, "role_binding.created"),
          tenantId: session.tenantId,
          type: "role_binding.created",
          occurredAt: now.toISOString(),
          payload: {
            bindingId,
            roleId,
            actorEmployeeId: session.employeeId,
            subject: roleBindingSubjectEventPayload(subject),
            scope: permissionScopeEventPayload(scope),
            ...(subject.type === "employee"
              ? { targetEmployeeId: subject.id }
              : {})
          }
        })
      });
    }

    destination = roleActionDestination(formData, "assigned");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function revokeTenantRoleBindingAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission(formData);
  const bindingId = readRequiredFormString(formData, "bindingId");
  const now = new Date();
  const rbacRepository = createSqlTenantRbacRepository(getWebDatabase());
  const employeeRepository =
    createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const [roles, bindings] = await Promise.all([
      rbacRepository.listRoleDefinitions({ tenantId: session.tenantId }),
      rbacRepository.listRoleBindings({
        tenantId: session.tenantId,
        at: now
      })
    ]);
    const binding = bindings.find((candidate) => candidate.id === bindingId);

    if (binding === undefined) {
      throw new Error("Role binding not found.");
    }

    if (
      binding.subject.type === "employee" &&
      binding.subject.id === session.employeeId
    ) {
      throw new Error("Self role revocation is not allowed.");
    }

    const [targetResource, actorPrivilege] = await Promise.all([
      resolveKnownScopeResource(session.tenantId, binding.scope, {
        activeOnly: false
      }),
      resolveRoleManagementActorPrivilege({
        session,
        employeeRepository,
        rbacRepository,
        roles,
        roleBindings: bindings,
        now
      })
    ]);

    assertCanManageScopedAccess({
      actor: actorPrivilege.actor,
      effectiveGrants: actorPrivilege.effectiveGrants,
      target: {
        resource: targetResource
      }
    });

    await rbacRepository.revokeRoleBinding({
      tenantId: session.tenantId,
      bindingId,
      revokedAt: now
    });

    await recordAccessMutation({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "role_binding.revoked",
      entityType: "role_binding",
      entityId: bindingId,
      metadata: {
        roleId: binding.roleId,
        subjectType: binding.subject.type,
        subjectId: binding.subject.id,
        ...(binding.subject.type === "employee"
          ? { targetEmployeeId: binding.subject.id }
          : {}),
        ...scopeMetadata(binding.scope)
      },
      occurredAt: now,
      event: createRbacEvent({
        id: createRbacEventId(session.tenantId, "role_binding.revoked"),
        tenantId: session.tenantId,
        type: "role_binding.revoked",
        occurredAt: now.toISOString(),
        payload: {
          bindingId,
          roleId: binding.roleId,
          actorEmployeeId: session.employeeId,
          subject: roleBindingSubjectEventPayload(binding.subject),
          scope: permissionScopeEventPayload(binding.scope),
          ...(binding.subject.type === "employee"
            ? { targetEmployeeId: binding.subject.id }
            : {})
        }
      })
    });

    destination = roleActionDestination(formData, "revoked");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function createDirectPermissionGrantAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission(formData);
  const now = new Date();
  const rbacRepository = createSqlTenantRbacRepository(getWebDatabase());
  const employeeRepository =
    createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const employeeId = readRequiredFormString(
      formData,
      "employeeId"
    ) as EmployeeId;
    const permission = readPermissionFormValue(formData, "permission");
    const scope = normalizePermissionScope({
      type: readRequiredFormString(formData, "scopeType"),
      id: readOptionalFormString(formData, "scopeId")
    });
    const reason = readRequiredLimitedFormString(formData, "reason", 500);
    const expiresAt = readOptionalFormDate(formData, "expiresAt");

    assertPermissionScopeAllowed(permission, scope.type);
    const targetResource = await resolveKnownScopeResource(
      session.tenantId,
      scope
    );

    if (expiresAt !== undefined && expiresAt.getTime() <= now.getTime()) {
      throw new Error("Direct grant expiry must be in the future.");
    }

    const [target, grants, roles, roleBindings] = await Promise.all([
      employeeRepository.findEmployee({
        tenantId: session.tenantId,
        employeeId
      }),
      rbacRepository.listDirectGrantsForEmployee({
        tenantId: session.tenantId,
        employeeId,
        at: now
      }),
      rbacRepository.listRoleDefinitions({ tenantId: session.tenantId }),
      rbacRepository.listRoleBindings({
        tenantId: session.tenantId,
        at: now
      })
    ]);

    if (target === null || target.deactivatedAt !== null) {
      throw new Error("Employee is not assignable.");
    }

    const actorPrivilege = await resolveRoleManagementActorPrivilege({
      session,
      employeeRepository,
      rbacRepository,
      roles,
      roleBindings,
      now
    });

    assertCanGrantScopedPermissions({
      actor: actorPrivilege.actor,
      effectiveGrants: actorPrivilege.effectiveGrants,
      target: {
        permissions: [permission],
        resource: targetResource
      }
    });

    const existingGrant = grants.find((grant) => {
      return (
        grant.permission === permission && areScopesEqual(grant.scope, scope)
      );
    });

    if (existingGrant === undefined) {
      const grantId = `direct_grant:${session.tenantId}:${employeeId}:${randomUUID()}`;

      await rbacRepository.createDirectGrant({
        id: grantId,
        tenantId: session.tenantId,
        employeeId,
        permission,
        scope,
        reason,
        expiresAt: expiresAt?.toISOString(),
        createdByEmployeeId: session.employeeId,
        createdAt: now
      });

      await recordAccessMutation({
        tenantId: session.tenantId,
        actorEmployeeId: session.employeeId,
        action: "direct_grant.created",
        entityType: "direct_grant",
        entityId: grantId,
        metadata: {
          targetEmployeeId: employeeId,
          permission,
          reason,
          expiresAt: expiresAt?.toISOString(),
          ...scopeMetadata(scope)
        },
        occurredAt: now,
        event: createRbacEvent({
          id: createRbacEventId(session.tenantId, "direct_grant.created"),
          tenantId: session.tenantId,
          type: "direct_grant.created",
          occurredAt: now.toISOString(),
          payload: {
            grantId,
            actorEmployeeId: session.employeeId,
            targetEmployeeId: employeeId,
            permission,
            scope: permissionScopeEventPayload(scope),
            reason,
            expiresAt: expiresAt?.toISOString()
          }
        })
      });
    }

    destination = roleActionDestination(formData, "direct_grant_created");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function revokeDirectPermissionGrantAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission(formData);
  const grantId = readRequiredFormString(formData, "grantId");
  const now = new Date();
  const rbacRepository = createSqlTenantRbacRepository(getWebDatabase());
  const employeeRepository =
    createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const [grants, roles, roleBindings] = await Promise.all([
      rbacRepository.listDirectGrants({
        tenantId: session.tenantId,
        at: now
      }),
      rbacRepository.listRoleDefinitions({ tenantId: session.tenantId }),
      rbacRepository.listRoleBindings({
        tenantId: session.tenantId,
        at: now
      })
    ]);
    const grant = grants.find((candidate) => candidate.id === grantId);

    if (grant === undefined || grant.id === undefined) {
      throw new Error("Direct grant not found.");
    }

    if (grant.employeeId === session.employeeId) {
      throw new Error("Self direct grant revocation is not allowed.");
    }

    const [targetResource, actorPrivilege] = await Promise.all([
      resolveKnownScopeResource(session.tenantId, grant.scope, {
        activeOnly: false
      }),
      resolveRoleManagementActorPrivilege({
        session,
        employeeRepository,
        rbacRepository,
        roles,
        roleBindings,
        now
      })
    ]);

    assertCanManageScopedAccess({
      actor: actorPrivilege.actor,
      effectiveGrants: actorPrivilege.effectiveGrants,
      target: {
        resource: targetResource
      }
    });

    await rbacRepository.revokeDirectGrant({
      tenantId: session.tenantId,
      grantId,
      revokedAt: now
    });

    await recordAccessMutation({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "direct_grant.revoked",
      entityType: "direct_grant",
      entityId: grantId,
      metadata: {
        targetEmployeeId: grant.employeeId,
        permission: grant.permission,
        reason: grant.reason,
        ...scopeMetadata(grant.scope)
      },
      occurredAt: now,
      event: createRbacEvent({
        id: createRbacEventId(session.tenantId, "direct_grant.revoked"),
        tenantId: session.tenantId,
        type: "direct_grant.revoked",
        occurredAt: now.toISOString(),
        payload: {
          grantId,
          actorEmployeeId: session.employeeId,
          targetEmployeeId: grant.employeeId,
          permission: grant.permission,
          scope: permissionScopeEventPayload(grant.scope),
          reason: grant.reason
        }
      })
    });

    destination = roleActionDestination(formData, "direct_grant_revoked");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

async function recordAccessMutation(input: {
  readonly tenantId: TenantId;
  readonly actorEmployeeId: EmployeeId;
  readonly action: AccessAuditAction;
  readonly entityType: Exclude<SecurityAuditEntityType, "session">;
  readonly entityId: string;
  readonly metadata: Record<string, unknown>;
  readonly occurredAt: Date;
  readonly event: PlatformEvent;
}): Promise<void> {
  const database = getWebDatabase();

  await createSqlSecurityAuditRepository(database).record({
    id: `audit:${input.tenantId}:${input.action}:${randomUUID()}`,
    tenantId: input.tenantId,
    actorEmployeeId: input.actorEmployeeId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata,
    occurredAt: input.occurredAt
  });
  await createSqlDomainEventRepository(database).append({
    tenantId: input.tenantId,
    events: [input.event]
  });
}

async function assertVerifiedRolesPermission(
  formData: FormData
): Promise<WebAccessSession> {
  try {
    return await assertWebDbBackedAdminCommandBoundary(
      webDbBackedAdminCommandBoundaries.roleAccess
    );
  } catch (error) {
    if (isEmailNotVerifiedError(error)) {
      redirect(roleActionDestination(formData, "email_verification_required"));
    }

    if (isPrivilegedActionReauthRequiredError(error)) {
      redirect(roleActionDestination(formData, "reauth_required"));
    }

    throw error;
  }
}

function revalidateRoleAdminPaths(): void {
  revalidatePath("/admin/roles");
  revalidatePath("/admin/employees");
  revalidatePath("/admin/employees/[employeeId]/access", "page");
}

function roleActionDestination(formData: FormData, status: string): string {
  const returnTo = readOptionalFormString(formData, "returnTo");
  const path = isSafeRoleActionReturnTo(returnTo) ? returnTo : "/admin/roles";

  return `${path}?roleActionStatus=${encodeURIComponent(status)}`;
}

function isSafeRoleActionReturnTo(path: string | undefined): path is string {
  if (path === "/admin/roles") {
    return true;
  }

  return (
    path !== undefined && /^\/admin\/employees\/[^/?#]+\/access$/.test(path)
  );
}

function assertCustomRole(
  role: TenantRoleRecord | undefined
): asserts role is TenantRoleRecord {
  if (role === undefined || role.isSystem) {
    throw new Error("Custom tenant role was not found.");
  }
}

function assertRoleUpdateDoesNotRemoveOwnRoleManagement(input: {
  readonly bindings: readonly PermissionRoleBinding[];
  readonly currentEmployeeId: EmployeeId;
  readonly existingRole: TenantRoleRecord;
  readonly nextRole: PreparedCustomTenantRole;
}): void {
  if (
    !isRoleAssignedToEmployee(
      input.bindings,
      input.existingRole.id,
      input.currentEmployeeId
    )
  ) {
    return;
  }

  if (
    input.existingRole.permissions.includes("roles.manage") &&
    !input.nextRole.permissions.includes("roles.manage")
  ) {
    throw new Error("Current employee role management permission is required.");
  }
}

async function resolveKnownScopeResource(
  tenantId: TenantId,
  scope: PermissionScope,
  options: { readonly activeOnly?: boolean } = {}
): Promise<PermissionResourceContext> {
  if (!("id" in scope)) {
    return {
      tenantId
    };
  }

  if (scope.type === "client") {
    return {
      tenantId,
      clientId: scope.id as ClientId
    };
  }

  if (scope.type === "conversation") {
    return {
      tenantId,
      conversationId: scope.id as ConversationId
    };
  }

  const repository = createSqlOrgStructureRepository(getWebDatabase());

  if (scope.type === "org_unit") {
    const orgUnits = await repository.listOrgUnits({
      tenantId,
      activeOnly: options.activeOnly ?? true
    });

    if (!orgUnits.some((orgUnit) => orgUnit.id === scope.id)) {
      throw new Error("Org unit scope reference was not found.");
    }

    return {
      tenantId,
      orgUnitId: scope.id,
      orgUnitIds: [scope.id]
    };
  }

  if (scope.type === "team") {
    const teams = await repository.listTeams({
      tenantId
    });

    if (!teams.some((team) => team.id === scope.id)) {
      throw new Error("Team scope reference was not found.");
    }

    return {
      tenantId,
      teamId: scope.id,
      teamIds: [scope.id]
    };
  }

  if (scope.type === "queue") {
    const workQueues = await repository.listWorkQueues({
      tenantId,
      activeOnly: options.activeOnly ?? true
    });
    const workQueue = workQueues.find((candidate) => candidate.id === scope.id);

    if (workQueue === undefined) {
      throw new Error("Work queue scope reference was not found.");
    }

    return {
      tenantId,
      orgUnitId: workQueue.owningOrgUnitId ?? undefined,
      queueId: scope.id
    };
  }

  return {
    tenantId
  };
}

async function resolveRoleManagementActorPrivilege(input: {
  readonly session: WebAccessSession;
  readonly employeeRepository: ReturnType<
    typeof createSqlEmployeeDirectoryRepository
  >;
  readonly rbacRepository: ReturnType<typeof createSqlTenantRbacRepository>;
  readonly roles: readonly TenantRoleRecord[];
  readonly roleBindings: readonly PermissionRoleBinding[];
  readonly now: Date;
}): Promise<{
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
}> {
  const [employee, directGrants] = await Promise.all([
    input.employeeRepository.findEmployee({
      tenantId: input.session.tenantId,
      employeeId: input.session.employeeId
    }),
    input.rbacRepository.listDirectGrantsForEmployee({
      tenantId: input.session.tenantId,
      employeeId: input.session.employeeId,
      at: input.now
    })
  ]);

  if (employee === null || employee.deactivatedAt !== null) {
    throw new Error("Current employee is not active.");
  }

  const actor: PermissionActor = {
    tenantId: input.session.tenantId,
    employeeId: input.session.employeeId,
    orgUnitIds: employee.orgUnitIds,
    queueIds: employee.queueIds,
    teamIds: employee.teamIds
  };

  return {
    actor,
    effectiveGrants: resolveEffectivePermissionGrants({
      actor,
      roles: input.roles,
      roleBindings: input.roleBindings,
      directGrants,
      at: input.now
    })
  };
}

async function assertAssignableRoleBindingSubject(input: {
  readonly tenantId: TenantId;
  readonly subject: PermissionRoleBindingSubject;
  readonly employeeRepository: ReturnType<
    typeof createSqlEmployeeDirectoryRepository
  >;
  readonly orgStructureRepository: ReturnType<
    typeof createSqlOrgStructureRepository
  >;
}): Promise<void> {
  switch (input.subject.type) {
    case "employee": {
      const target = await input.employeeRepository.findEmployee({
        tenantId: input.tenantId,
        employeeId: input.subject.id
      });

      if (target === null || target.deactivatedAt !== null) {
        throw new Error("Employee is not assignable.");
      }

      return;
    }
    case "org_unit": {
      const orgUnits = await input.orgStructureRepository.listOrgUnits({
        tenantId: input.tenantId,
        activeOnly: true
      });

      if (!orgUnits.some((orgUnit) => orgUnit.id === input.subject.id)) {
        throw new Error("Org unit subject is not assignable.");
      }

      return;
    }
    case "queue": {
      const workQueues = await input.orgStructureRepository.listWorkQueues({
        tenantId: input.tenantId,
        activeOnly: true
      });

      if (!workQueues.some((workQueue) => workQueue.id === input.subject.id)) {
        throw new Error("Work queue subject is not assignable.");
      }

      return;
    }
    case "team": {
      const teams = await input.orgStructureRepository.listTeams({
        tenantId: input.tenantId
      });

      if (!teams.some((team) => team.id === input.subject.id)) {
        throw new Error("Team subject is not assignable.");
      }

      return;
    }
  }
}

function permissionDiff(
  previousPermissions: readonly Permission[],
  nextPermissions: readonly Permission[]
): {
  readonly addedPermissions: readonly Permission[];
  readonly removedPermissions: readonly Permission[];
} {
  return {
    addedPermissions: nextPermissions.filter(
      (permission) => !previousPermissions.includes(permission)
    ),
    removedPermissions: previousPermissions.filter(
      (permission) => !nextPermissions.includes(permission)
    )
  };
}

function isRoleAssignedToEmployee(
  bindings: readonly PermissionRoleBinding[],
  roleId: string,
  employeeId: EmployeeId
): boolean {
  return bindings.some((binding) => {
    return (
      binding.roleId === roleId &&
      binding.subject.type === "employee" &&
      binding.subject.id === employeeId
    );
  });
}

function areScopesEqual(
  left: PermissionScope,
  right: PermissionScope
): boolean {
  if (left.type !== right.type) {
    return false;
  }

  return scopeId(left) === scopeId(right);
}

function scopeId(scope: PermissionScope): string | undefined {
  return "id" in scope ? scope.id : undefined;
}

function scopeMetadata(scope: PermissionScope): Record<string, string> {
  const id = scopeId(scope);

  return id === undefined
    ? { scopeType: scope.type }
    : { scopeType: scope.type, scopeId: id };
}

function roleBindingSubjectMetadata(
  subject: PermissionRoleBindingSubject
): Record<string, string> {
  return subject.type === "employee"
    ? {
        targetEmployeeId: subject.id,
        subjectType: subject.type,
        subjectId: subject.id
      }
    : {
        subjectType: subject.type,
        subjectId: subject.id
      };
}

function permissionScopeEventPayload(scope: PermissionScope): {
  readonly type: string;
  readonly id?: string;
} {
  const id = scopeId(scope);

  return id === undefined
    ? { type: scope.type }
    : {
        type: scope.type,
        id
      };
}

function roleBindingSubjectEventPayload(
  subject: PermissionRoleBindingSubject
): { readonly type: string; readonly id: string } {
  return {
    type: subject.type,
    id: subject.id
  };
}

function createRbacEventId(
  tenantId: TenantId,
  eventType: RbacEventType
): EventId {
  return `event:${tenantId}:${eventType}:${randomUUID()}` as EventId;
}

function readRoleBindingSubject(
  formData: FormData
): PermissionRoleBindingSubject {
  const subjectType =
    readOptionalFormString(formData, "subjectType") ?? "employee";
  const subjectId =
    readOptionalFormString(formData, "subjectId") ??
    readRequiredFormString(formData, "employeeId");

  switch (subjectType) {
    case "employee":
      return {
        type: "employee",
        id: subjectId as EmployeeId
      };
    case "org_unit":
      return {
        type: "org_unit",
        id: subjectId
      };
    case "team":
      return {
        type: "team",
        id: subjectId
      };
    case "queue":
      return {
        type: "queue",
        id: subjectId
      };
    default:
      throw new Error("Role binding subject type is not supported.");
  }
}

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Form field ${name} is required.`);
  }

  return value.trim();
}

function readRequiredLimitedFormString(
  formData: FormData,
  name: string,
  maxLength: number
): string {
  const value = readRequiredFormString(formData, name);

  if (value.length > maxLength) {
    throw new Error(`Form field ${name} is too long.`);
  }

  return value;
}

function readOptionalFormString(
  formData: FormData,
  name: string
): string | undefined {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}

function readPermissionFormValue(formData: FormData, name: string): Permission {
  const value = readRequiredFormString(formData, name);

  if (!isPermission(value)) {
    throw new Error(`Form field ${name} must be a known permission.`);
  }

  return value;
}

function readOptionalFormDate(
  formData: FormData,
  name: string
): Date | undefined {
  const value = readOptionalFormString(formData, name);

  if (value === undefined) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Form field ${name} must be a date.`);
  }

  return date;
}

function readFormStringList(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
