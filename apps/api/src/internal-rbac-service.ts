import type {
  ClientId,
  ConversationId,
  EmployeeId,
  EventId,
  InternalAccessDecisionScope,
  InternalRbacDirectGrant,
  InternalRbacDirectGrantCreateRequest,
  InternalRbacDirectGrantResponse,
  InternalRbacDirectGrantsResponse,
  InternalRbacRevokeResponse,
  InternalRbacRole,
  InternalRbacRoleBinding,
  InternalRbacRoleBindingCreateRequest,
  InternalRbacRoleBindingResponse,
  InternalRbacRoleBindingsResponse,
  InternalRbacRoleMutationRequest,
  InternalRbacRoleResponse,
  InternalRbacRolesResponse,
  InternalRbacRoleSubject,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import {
  CoreError,
  assertPermissionScopeAllowed,
  assertPermissionsAllowedForScope,
  canAccess,
  createRbacEvent,
  isPermission,
  normalizePermissionScope,
  prepareCustomTenantRole,
  resolveEffectivePermissionGrants,
  type DirectPermissionGrant,
  type EffectivePermissionGrant,
  type Permission,
  type PermissionActor,
  type PermissionResourceContext,
  type PermissionRoleBinding,
  type PermissionRoleBindingSubject,
  type PermissionScope,
  type PreparedCustomTenantRole,
  type RbacEventType
} from "@hulee/core";
import type {
  AccessAuditAction,
  DomainEventRepository,
  EmployeeDirectoryRepository,
  OrgStructureRepository,
  SecurityAuditEntityType,
  SecurityAuditRepository,
  TenantEmployeeRecord,
  TenantRbacRepository,
  TenantRoleRecord
} from "@hulee/db";
import { randomUUID } from "node:crypto";

export type InternalRbacContext = {
  requestId: string;
  tenantId: TenantId;
  employeeId: EmployeeId;
};

export type InternalRbacService = {
  listRoles(context: InternalRbacContext): Promise<InternalRbacRolesResponse>;
  createRole(
    context: InternalRbacContext,
    request: InternalRbacRoleMutationRequest
  ): Promise<InternalRbacRoleResponse>;
  updateRole(
    context: InternalRbacContext,
    input: {
      readonly roleId: string;
      readonly request: InternalRbacRoleMutationRequest;
    }
  ): Promise<InternalRbacRoleResponse>;
  archiveRole(
    context: InternalRbacContext,
    input: { readonly roleId: string }
  ): Promise<InternalRbacRoleResponse>;
  restoreRole(
    context: InternalRbacContext,
    input: { readonly roleId: string }
  ): Promise<InternalRbacRoleResponse>;
  listRoleBindings(
    context: InternalRbacContext
  ): Promise<InternalRbacRoleBindingsResponse>;
  createRoleBinding(
    context: InternalRbacContext,
    request: InternalRbacRoleBindingCreateRequest
  ): Promise<InternalRbacRoleBindingResponse>;
  revokeRoleBinding(
    context: InternalRbacContext,
    input: { readonly bindingId: string }
  ): Promise<InternalRbacRevokeResponse>;
  listDirectGrants(
    context: InternalRbacContext
  ): Promise<InternalRbacDirectGrantsResponse>;
  createDirectGrant(
    context: InternalRbacContext,
    request: InternalRbacDirectGrantCreateRequest
  ): Promise<InternalRbacDirectGrantResponse>;
  revokeDirectGrant(
    context: InternalRbacContext,
    input: { readonly grantId: string }
  ): Promise<InternalRbacRevokeResponse>;
};

export type InternalRbacServiceOptions = {
  rbacRepository: Pick<
    TenantRbacRepository,
    | "createRoleWithPermissions"
    | "updateCustomRoleWithPermissions"
    | "setCustomRoleStatus"
    | "createRoleBinding"
    | "revokeRoleBinding"
    | "createDirectGrant"
    | "revokeDirectGrant"
    | "listRoleDefinitions"
    | "listRoleBindings"
    | "listCurrentAndScheduledRoleBindings"
    | "listDirectGrants"
    | "listCurrentAndScheduledDirectGrants"
    | "listDirectGrantsForEmployee"
  >;
  employeeRepository: Pick<EmployeeDirectoryRepository, "findEmployee">;
  orgStructureRepository: Pick<
    OrgStructureRepository,
    "listOrgUnits" | "listTeams" | "listWorkQueues"
  >;
  audit?: Pick<SecurityAuditRepository, "record">;
  events?: Pick<DomainEventRepository, "append">;
  now?: () => Date;
  idFactory?: () => string;
};

type RoleManagementActorPrivilege = {
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
};

type TemporalWindow = {
  readonly startsAt?: string;
  readonly expiresAt?: string;
};

export function createInternalRbacService(
  options: InternalRbacServiceOptions
): InternalRbacService {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => randomUUID());

  return {
    async listRoles(context) {
      const at = now();
      const [roles, roleBindings] = await Promise.all([
        options.rbacRepository.listRoleDefinitions({
          tenantId: context.tenantId
        }),
        options.rbacRepository.listRoleBindings({
          tenantId: context.tenantId,
          at
        })
      ]);

      await assertTenantRoleManagement({
        context,
        rbacRepository: options.rbacRepository,
        employeeRepository: options.employeeRepository,
        roles,
        roleBindings,
        at
      });

      return {
        roles: roles.map(mapRole)
      };
    },

    async createRole(context, request) {
      const at = now();
      const role = prepareCustomTenantRole(request);
      const [roles, roleBindings] = await Promise.all([
        options.rbacRepository.listRoleDefinitions({
          tenantId: context.tenantId
        }),
        options.rbacRepository.listRoleBindings({
          tenantId: context.tenantId,
          at
        })
      ]);

      await assertTenantRoleManagement({
        context,
        rbacRepository: options.rbacRepository,
        employeeRepository: options.employeeRepository,
        roles,
        roleBindings,
        at
      });

      const roleId = `role:${context.tenantId}:custom:${idFactory()}`;

      await options.rbacRepository.createRoleWithPermissions({
        id: roleId,
        tenantId: context.tenantId,
        name: role.name,
        description: role.description,
        isSystem: false,
        createdByEmployeeId: context.employeeId,
        createdAt: at,
        permissions: role.permissions
      });

      await recordAccessMutation({
        context,
        audit: options.audit,
        events: options.events,
        action: "role.created",
        entityType: "role",
        entityId: roleId,
        metadata: {
          roleId,
          name: role.name,
          permissions: role.permissions,
          permissionCount: role.permissions.length,
          authorizationScopes: [{ type: "tenant" }]
        },
        occurredAt: at,
        event: createRbacEvent({
          id: createRbacEventId(context.tenantId, "role.created", idFactory),
          tenantId: context.tenantId,
          type: "role.created",
          occurredAt: at.toISOString(),
          payload: {
            roleId,
            actorEmployeeId: context.employeeId,
            name: role.name,
            description: role.description,
            permissions: role.permissions,
            permissionCount: role.permissions.length,
            isSystem: false
          }
        })
      });

      return {
        role: await loadRoleOrFail(options.rbacRepository, context, roleId)
      };
    },

    async updateRole(context, input) {
      const at = now();
      const role = prepareCustomTenantRole(input.request);
      const [roles, bindings, currentAndScheduledBindings] = await Promise.all([
        options.rbacRepository.listRoleDefinitions({
          tenantId: context.tenantId
        }),
        options.rbacRepository.listRoleBindings({
          tenantId: context.tenantId,
          at
        }),
        options.rbacRepository.listCurrentAndScheduledRoleBindings({
          tenantId: context.tenantId,
          at
        })
      ]);
      const existingRole = roles.find(
        (candidate) => candidate.id === input.roleId
      );

      const actorPrivilege = await assertTenantRoleManagement({
        context,
        rbacRepository: options.rbacRepository,
        employeeRepository: options.employeeRepository,
        roles,
        roleBindings: bindings,
        at
      });
      assertCustomRole(existingRole);
      assertRoleUpdateDoesNotRemoveOwnRoleManagement({
        actorPrivilege,
        bindings,
        existingRole,
        nextRole: role
      });

      const permissionsDelta = permissionDiff(
        existingRole.permissions,
        role.permissions
      );

      await assertRoleUpdateBindingSafety({
        actorPrivilege,
        addedPermissions: permissionsDelta.addedPermissions,
        bindings: currentAndScheduledBindings.filter(
          (binding) => binding.roleId === input.roleId
        ),
        nextPermissions: role.permissions,
        tenantId: context.tenantId,
        employeeRepository: options.employeeRepository,
        orgStructureRepository: options.orgStructureRepository
      });
      const authorizationScopes = await resolveRoleMutationAuthorizationScopes({
        tenantId: context.tenantId,
        bindings: currentAndScheduledBindings.filter(
          (binding) => binding.roleId === input.roleId
        ),
        employeeRepository: options.employeeRepository,
        orgStructureRepository: options.orgStructureRepository
      });

      await options.rbacRepository.updateCustomRoleWithPermissions({
        tenantId: context.tenantId,
        roleId: input.roleId,
        name: role.name,
        description: role.description,
        updatedAt: at,
        permissions: role.permissions
      });

      await recordAccessMutation({
        context,
        audit: options.audit,
        events: options.events,
        action: "role.updated",
        entityType: "role",
        entityId: input.roleId,
        metadata: {
          roleId: input.roleId,
          previousName: existingRole.name,
          nextName: role.name,
          previousDescription: existingRole.description,
          nextDescription: role.description,
          previousPermissions: existingRole.permissions,
          nextPermissions: role.permissions,
          authorizationScopes,
          ...permissionsDelta
        },
        occurredAt: at,
        event: createRbacEvent({
          id: createRbacEventId(context.tenantId, "role.updated", idFactory),
          tenantId: context.tenantId,
          type: "role.updated",
          occurredAt: at.toISOString(),
          payload: {
            roleId: input.roleId,
            actorEmployeeId: context.employeeId,
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

      return {
        role: await loadRoleOrFail(
          options.rbacRepository,
          context,
          input.roleId
        )
      };
    },

    async archiveRole(context, input) {
      const at = now();
      const [roles, bindings, currentAndScheduledBindings] = await Promise.all([
        options.rbacRepository.listRoleDefinitions({
          tenantId: context.tenantId
        }),
        options.rbacRepository.listRoleBindings({
          tenantId: context.tenantId,
          at
        }),
        options.rbacRepository.listCurrentAndScheduledRoleBindings({
          tenantId: context.tenantId,
          at
        })
      ]);
      const role = roles.find((candidate) => candidate.id === input.roleId);

      const actorPrivilege = await assertTenantRoleManagement({
        context,
        rbacRepository: options.rbacRepository,
        employeeRepository: options.employeeRepository,
        roles,
        roleBindings: bindings,
        at
      });
      assertCustomRole(role);

      if (
        role.status === "active" &&
        bindings.some(
          (binding) =>
            binding.roleId === input.roleId &&
            roleBindingSubjectAppliesToActor(
              actorPrivilege.actor,
              binding.subject
            )
        )
      ) {
        throw new CoreError("permission.denied");
      }
      const authorizationScopes = await resolveRoleMutationAuthorizationScopes({
        tenantId: context.tenantId,
        bindings: currentAndScheduledBindings.filter(
          (binding) => binding.roleId === input.roleId
        ),
        employeeRepository: options.employeeRepository,
        orgStructureRepository: options.orgStructureRepository
      });

      await options.rbacRepository.setCustomRoleStatus({
        tenantId: context.tenantId,
        roleId: input.roleId,
        status: "archived",
        updatedAt: at
      });

      await recordAccessMutation({
        context,
        audit: options.audit,
        events: options.events,
        action: "role.archived",
        entityType: "role",
        entityId: input.roleId,
        metadata: {
          roleId: input.roleId,
          name: role.name,
          status: "archived",
          authorizationScopes
        },
        occurredAt: at,
        event: createRbacEvent({
          id: createRbacEventId(context.tenantId, "role.archived", idFactory),
          tenantId: context.tenantId,
          type: "role.archived",
          occurredAt: at.toISOString(),
          payload: {
            roleId: input.roleId,
            actorEmployeeId: context.employeeId,
            name: role.name,
            status: "archived"
          }
        })
      });

      return {
        role: await loadRoleOrFail(
          options.rbacRepository,
          context,
          input.roleId
        )
      };
    },

    async restoreRole(context, input) {
      const at = now();
      const [roles, roleBindings, currentAndScheduledBindings] =
        await Promise.all([
          options.rbacRepository.listRoleDefinitions({
            tenantId: context.tenantId
          }),
          options.rbacRepository.listRoleBindings({
            tenantId: context.tenantId,
            at
          }),
          options.rbacRepository.listCurrentAndScheduledRoleBindings({
            tenantId: context.tenantId,
            at
          })
        ]);
      const role = roles.find((candidate) => candidate.id === input.roleId);

      const actorPrivilege = await assertTenantRoleManagement({
        context,
        rbacRepository: options.rbacRepository,
        employeeRepository: options.employeeRepository,
        roles,
        roleBindings,
        at
      });
      assertCustomRole(role);

      if (role.status === "archived") {
        await assertRoleUpdateBindingSafety({
          actorPrivilege,
          addedPermissions: role.permissions,
          bindings: currentAndScheduledBindings.filter(
            (binding) => binding.roleId === input.roleId
          ),
          nextPermissions: role.permissions,
          tenantId: context.tenantId,
          employeeRepository: options.employeeRepository,
          orgStructureRepository: options.orgStructureRepository
        });
      }
      const authorizationScopes = await resolveRoleMutationAuthorizationScopes({
        tenantId: context.tenantId,
        bindings: currentAndScheduledBindings.filter(
          (binding) => binding.roleId === input.roleId
        ),
        employeeRepository: options.employeeRepository,
        orgStructureRepository: options.orgStructureRepository
      });

      await options.rbacRepository.setCustomRoleStatus({
        tenantId: context.tenantId,
        roleId: input.roleId,
        status: "active",
        updatedAt: at
      });

      await recordAccessMutation({
        context,
        audit: options.audit,
        events: options.events,
        action: "role.restored",
        entityType: "role",
        entityId: input.roleId,
        metadata: {
          roleId: input.roleId,
          name: role.name,
          status: "active",
          authorizationScopes
        },
        occurredAt: at,
        event: createRbacEvent({
          id: createRbacEventId(context.tenantId, "role.restored", idFactory),
          tenantId: context.tenantId,
          type: "role.restored",
          occurredAt: at.toISOString(),
          payload: {
            roleId: input.roleId,
            actorEmployeeId: context.employeeId,
            name: role.name,
            status: "active"
          }
        })
      });

      return {
        role: await loadRoleOrFail(
          options.rbacRepository,
          context,
          input.roleId
        )
      };
    },

    async listRoleBindings(context) {
      const at = now();
      const [roles, roleBindings] = await Promise.all([
        options.rbacRepository.listRoleDefinitions({
          tenantId: context.tenantId
        }),
        options.rbacRepository.listRoleBindings({
          tenantId: context.tenantId,
          at
        })
      ]);

      await assertTenantRoleManagement({
        context,
        rbacRepository: options.rbacRepository,
        employeeRepository: options.employeeRepository,
        roles,
        roleBindings,
        at
      });

      return {
        roleBindings: roleBindings.map(mapRoleBinding)
      };
    },

    async createRoleBinding(context, request) {
      const at = now();
      const scope = toPermissionScope(request.scope);
      const subject = toRoleBindingSubject(request.subject);
      const temporalWindow = normalizeTemporalWindow(request, at);
      const [roles, roleBindings, currentAndScheduledBindings] =
        await Promise.all([
          options.rbacRepository.listRoleDefinitions({
            tenantId: context.tenantId
          }),
          options.rbacRepository.listRoleBindings({
            tenantId: context.tenantId,
            at
          }),
          options.rbacRepository.listCurrentAndScheduledRoleBindings({
            tenantId: context.tenantId,
            at
          })
        ]);
      const role = roles.find((candidate) => candidate.id === request.roleId);
      const existingBinding = currentAndScheduledBindings.find((binding) => {
        return (
          binding.roleId === request.roleId &&
          binding.subject.type === subject.type &&
          binding.subject.id === subject.id &&
          areScopesEqual(binding.scope, scope)
        );
      });
      const actorPrivilege = await resolveRoleManagementActorPrivilege({
        context,
        employeeRepository: options.employeeRepository,
        rbacRepository: options.rbacRepository,
        roles,
        roleBindings,
        at
      });

      const [subjectResources, targetResource] = await Promise.all([
        resolveRoleBindingSubjectResources({
          tenantId: context.tenantId,
          subject,
          employeeRepository: options.employeeRepository,
          orgStructureRepository: options.orgStructureRepository,
          activeOnly: true
        }),
        resolveKnownScopeResource({
          tenantId: context.tenantId,
          scope,
          orgStructureRepository: options.orgStructureRepository
        })
      ]);

      assertRoleBindingDoesNotApplyToActor(actorPrivilege.actor, subject);
      assertCanManageRoleTarget({
        actorPrivilege,
        resources: subjectResources
      });
      assertCanManageResolvedScope({
        actorPrivilege,
        scope,
        resource: targetResource
      });

      if (role === undefined || role.status !== "active") {
        throw new CoreError("permission.denied");
      }

      assertPermissionsAllowedForScope(role.permissions, scope.type);
      assertCanGrantScopedPermissions({
        actor: actorPrivilege.actor,
        effectiveGrants: actorPrivilege.effectiveGrants,
        target: {
          permissions: role.permissions,
          resource: targetResource
        }
      });

      if (existingBinding !== undefined) {
        return {
          roleBinding: mapRoleBinding(existingBinding)
        };
      }

      const bindingId = `role_binding:${context.tenantId}:${subject.type}:${idFactory()}`;
      const createdBinding: PermissionRoleBinding = {
        id: bindingId,
        tenantId: context.tenantId,
        roleId: request.roleId,
        subject,
        scope,
        ...temporalWindow
      };

      await options.rbacRepository.createRoleBinding({
        ...createdBinding,
        createdByEmployeeId: context.employeeId,
        createdAt: at
      });

      await recordAccessMutation({
        context,
        audit: options.audit,
        events: options.events,
        action: "role_binding.created",
        entityType: "role_binding",
        entityId: bindingId,
        metadata: {
          roleId: request.roleId,
          ...roleBindingSubjectMetadata(subject),
          ...scopeMetadata(scope),
          authorizationScopes: rbacMutationAuthorizationScopes({
            scope,
            resources: [...subjectResources, targetResource]
          })
        },
        occurredAt: at,
        event: createRbacEvent({
          id: createRbacEventId(
            context.tenantId,
            "role_binding.created",
            idFactory
          ),
          tenantId: context.tenantId,
          type: "role_binding.created",
          occurredAt: at.toISOString(),
          payload: {
            bindingId,
            roleId: request.roleId,
            actorEmployeeId: context.employeeId,
            subject: roleBindingSubjectEventPayload(subject),
            scope: permissionScopeEventPayload(scope),
            ...(subject.type === "employee"
              ? { targetEmployeeId: subject.id }
              : {})
          }
        })
      });

      return {
        roleBinding: mapRoleBinding(createdBinding)
      };
    },

    async revokeRoleBinding(context, input) {
      const at = now();
      const [roles, roleBindings, currentAndScheduledBindings] =
        await Promise.all([
          options.rbacRepository.listRoleDefinitions({
            tenantId: context.tenantId
          }),
          options.rbacRepository.listRoleBindings({
            tenantId: context.tenantId,
            at
          }),
          options.rbacRepository.listCurrentAndScheduledRoleBindings({
            tenantId: context.tenantId,
            at
          })
        ]);
      const binding = currentAndScheduledBindings.find(
        (candidate) => candidate.id === input.bindingId
      );
      const actorPrivilege = await resolveRoleManagementActorPrivilege({
        context,
        employeeRepository: options.employeeRepository,
        rbacRepository: options.rbacRepository,
        roles,
        roleBindings,
        at
      });

      if (binding === undefined || binding.id === undefined) {
        throw new CoreError("permission.denied");
      }

      const [subjectResources, targetResource] = await Promise.all([
        resolveRoleBindingSubjectResources({
          tenantId: context.tenantId,
          subject: binding.subject,
          employeeRepository: options.employeeRepository,
          orgStructureRepository: options.orgStructureRepository,
          activeOnly: false
        }),
        resolveKnownScopeResource({
          tenantId: context.tenantId,
          scope: binding.scope,
          orgStructureRepository: options.orgStructureRepository,
          activeOnly: false
        })
      ]);

      assertRoleBindingDoesNotApplyToActor(
        actorPrivilege.actor,
        binding.subject
      );
      assertCanManageRoleTarget({
        actorPrivilege,
        resources: subjectResources
      });
      assertCanManageResolvedScope({
        actorPrivilege,
        scope: binding.scope,
        resource: targetResource,
        allowUnresolvedExactScopeForTenantCleanup: true
      });

      await options.rbacRepository.revokeRoleBinding({
        tenantId: context.tenantId,
        bindingId: input.bindingId,
        revokedAt: at
      });

      await recordAccessMutation({
        context,
        audit: options.audit,
        events: options.events,
        action: "role_binding.revoked",
        entityType: "role_binding",
        entityId: input.bindingId,
        metadata: {
          roleId: binding.roleId,
          ...roleBindingSubjectMetadata(binding.subject),
          ...scopeMetadata(binding.scope),
          authorizationScopes: rbacMutationAuthorizationScopes({
            scope: binding.scope,
            resources: [...subjectResources, targetResource]
          })
        },
        occurredAt: at,
        event: createRbacEvent({
          id: createRbacEventId(
            context.tenantId,
            "role_binding.revoked",
            idFactory
          ),
          tenantId: context.tenantId,
          type: "role_binding.revoked",
          occurredAt: at.toISOString(),
          payload: {
            bindingId: input.bindingId,
            roleId: binding.roleId,
            actorEmployeeId: context.employeeId,
            subject: roleBindingSubjectEventPayload(binding.subject),
            scope: permissionScopeEventPayload(binding.scope),
            ...(binding.subject.type === "employee"
              ? { targetEmployeeId: binding.subject.id }
              : {})
          }
        })
      });

      return {
        revoked: true
      };
    },

    async listDirectGrants(context) {
      const at = now();
      const [roles, roleBindings, directGrants] = await Promise.all([
        options.rbacRepository.listRoleDefinitions({
          tenantId: context.tenantId
        }),
        options.rbacRepository.listRoleBindings({
          tenantId: context.tenantId,
          at
        }),
        options.rbacRepository.listDirectGrants({
          tenantId: context.tenantId,
          at
        })
      ]);

      await assertTenantRoleManagement({
        context,
        rbacRepository: options.rbacRepository,
        employeeRepository: options.employeeRepository,
        roles,
        roleBindings,
        at
      });

      return {
        directGrants: directGrants.map(mapDirectGrant)
      };
    },

    async createDirectGrant(context, request) {
      const at = now();
      const permission = toPermission(request.permission);
      const scope = toPermissionScope(request.scope);
      const reason = normalizeReason(request.reason);
      const temporalWindow = normalizeTemporalWindow(request, at);
      const targetEmployeeId = request.employeeId as EmployeeId;
      const [roles, roleBindings] = await Promise.all([
        options.rbacRepository.listRoleDefinitions({
          tenantId: context.tenantId
        }),
        options.rbacRepository.listRoleBindings({
          tenantId: context.tenantId,
          at
        })
      ]);
      const actorPrivilege = await resolveRoleManagementActorPrivilege({
        context,
        employeeRepository: options.employeeRepository,
        rbacRepository: options.rbacRepository,
        roles,
        roleBindings,
        at
      });
      const [target, targetResource] = await Promise.all([
        options.employeeRepository.findEmployee({
          tenantId: context.tenantId,
          employeeId: targetEmployeeId
        }),
        resolveKnownScopeResource({
          tenantId: context.tenantId,
          scope,
          orgStructureRepository: options.orgStructureRepository
        })
      ]);

      assertActiveEmployee(target);
      const targetEmployeeResources = employeePermissionResources(target);
      assertPermissionScopeAllowed(permission, scope.type);
      assertEmployeeIsNotActor(actorPrivilege.actor, target);
      assertCanManageRoleTarget({
        actorPrivilege,
        resources: targetEmployeeResources
      });
      assertCanManageResolvedScope({
        actorPrivilege,
        scope,
        resource: targetResource
      });
      assertCanGrantScopedPermissions({
        actor: actorPrivilege.actor,
        effectiveGrants: actorPrivilege.effectiveGrants,
        target: {
          permissions: [permission],
          resource: targetResource
        }
      });
      const grants =
        await options.rbacRepository.listCurrentAndScheduledDirectGrants({
          tenantId: context.tenantId,
          at
        });

      const existingGrant = grants.find((grant) => {
        return (
          grant.employeeId === targetEmployeeId &&
          grant.permission === permission &&
          areScopesEqual(grant.scope, scope)
        );
      });

      if (existingGrant !== undefined) {
        return {
          directGrant: mapDirectGrant(existingGrant)
        };
      }

      const grantId = `direct_grant:${context.tenantId}:${targetEmployeeId}:${idFactory()}`;
      const createdGrant: DirectPermissionGrant = {
        id: grantId,
        tenantId: context.tenantId,
        employeeId: targetEmployeeId,
        permission,
        scope,
        reason,
        ...temporalWindow
      };

      await options.rbacRepository.createDirectGrant({
        ...createdGrant,
        createdByEmployeeId: context.employeeId,
        createdAt: at
      });

      await recordAccessMutation({
        context,
        audit: options.audit,
        events: options.events,
        action: "direct_grant.created",
        entityType: "direct_grant",
        entityId: grantId,
        metadata: {
          targetEmployeeId,
          permission,
          reason,
          expiresAt: temporalWindow.expiresAt,
          ...scopeMetadata(scope),
          authorizationScopes: rbacMutationAuthorizationScopes({
            scope,
            resources: [...targetEmployeeResources, targetResource]
          })
        },
        occurredAt: at,
        event: createRbacEvent({
          id: createRbacEventId(
            context.tenantId,
            "direct_grant.created",
            idFactory
          ),
          tenantId: context.tenantId,
          type: "direct_grant.created",
          occurredAt: at.toISOString(),
          payload: {
            grantId,
            actorEmployeeId: context.employeeId,
            targetEmployeeId,
            permission,
            scope: permissionScopeEventPayload(scope),
            reason,
            expiresAt: temporalWindow.expiresAt
          }
        })
      });

      return {
        directGrant: mapDirectGrant(createdGrant)
      };
    },

    async revokeDirectGrant(context, input) {
      const at = now();
      const [roles, roleBindings, directGrants] = await Promise.all([
        options.rbacRepository.listRoleDefinitions({
          tenantId: context.tenantId
        }),
        options.rbacRepository.listRoleBindings({
          tenantId: context.tenantId,
          at
        }),
        options.rbacRepository.listCurrentAndScheduledDirectGrants({
          tenantId: context.tenantId,
          at
        })
      ]);
      const grant = directGrants.find(
        (candidate) => candidate.id === input.grantId
      );
      const actorPrivilege = await resolveRoleManagementActorPrivilege({
        context,
        employeeRepository: options.employeeRepository,
        rbacRepository: options.rbacRepository,
        roles,
        roleBindings,
        at
      });

      if (grant === undefined || grant.id === undefined) {
        throw new CoreError("permission.denied");
      }

      const [target, targetResource] = await Promise.all([
        options.employeeRepository.findEmployee({
          tenantId: context.tenantId,
          employeeId: grant.employeeId
        }),
        resolveKnownScopeResource({
          tenantId: context.tenantId,
          scope: grant.scope,
          orgStructureRepository: options.orgStructureRepository,
          activeOnly: false
        })
      ]);

      assertEmployeeExists(target);
      const targetEmployeeResources = employeePermissionResources(target);
      assertEmployeeIsNotActor(actorPrivilege.actor, target);
      assertCanManageRoleTarget({
        actorPrivilege,
        resources: targetEmployeeResources
      });
      assertCanManageResolvedScope({
        actorPrivilege,
        scope: grant.scope,
        resource: targetResource,
        allowUnresolvedExactScopeForTenantCleanup: true
      });

      await options.rbacRepository.revokeDirectGrant({
        tenantId: context.tenantId,
        grantId: input.grantId,
        revokedAt: at
      });

      await recordAccessMutation({
        context,
        audit: options.audit,
        events: options.events,
        action: "direct_grant.revoked",
        entityType: "direct_grant",
        entityId: input.grantId,
        metadata: {
          targetEmployeeId: grant.employeeId,
          permission: grant.permission,
          reason: grant.reason,
          ...scopeMetadata(grant.scope),
          authorizationScopes: rbacMutationAuthorizationScopes({
            scope: grant.scope,
            resources: [...targetEmployeeResources, targetResource]
          })
        },
        occurredAt: at,
        event: createRbacEvent({
          id: createRbacEventId(
            context.tenantId,
            "direct_grant.revoked",
            idFactory
          ),
          tenantId: context.tenantId,
          type: "direct_grant.revoked",
          occurredAt: at.toISOString(),
          payload: {
            grantId: input.grantId,
            actorEmployeeId: context.employeeId,
            targetEmployeeId: grant.employeeId,
            permission: grant.permission,
            scope: permissionScopeEventPayload(grant.scope),
            reason: grant.reason
          }
        })
      });

      return {
        revoked: true
      };
    }
  };
}

async function assertTenantRoleManagement(input: {
  readonly context: InternalRbacContext;
  readonly rbacRepository: Pick<
    TenantRbacRepository,
    "listDirectGrantsForEmployee"
  >;
  readonly employeeRepository: Pick<
    EmployeeDirectoryRepository,
    "findEmployee"
  >;
  readonly roles: readonly TenantRoleRecord[];
  readonly roleBindings?: readonly PermissionRoleBinding[];
  readonly at: Date;
}): Promise<RoleManagementActorPrivilege> {
  const actorPrivilege = await resolveRoleManagementActorPrivilege(input);

  assertCanManageScopedAccess({
    actor: actorPrivilege.actor,
    effectiveGrants: actorPrivilege.effectiveGrants,
    target: {
      resource: {
        tenantId: input.context.tenantId
      }
    }
  });

  return actorPrivilege;
}

async function resolveRoleManagementActorPrivilege(input: {
  readonly context: InternalRbacContext;
  readonly employeeRepository: Pick<
    EmployeeDirectoryRepository,
    "findEmployee"
  >;
  readonly rbacRepository: Pick<
    TenantRbacRepository,
    "listDirectGrantsForEmployee"
  >;
  readonly roles: readonly TenantRoleRecord[];
  readonly roleBindings?: readonly PermissionRoleBinding[];
  readonly at: Date;
}): Promise<RoleManagementActorPrivilege> {
  const [employee, directGrants] = await Promise.all([
    input.employeeRepository.findEmployee({
      tenantId: input.context.tenantId,
      employeeId: input.context.employeeId
    }),
    input.rbacRepository.listDirectGrantsForEmployee({
      tenantId: input.context.tenantId,
      employeeId: input.context.employeeId,
      at: input.at
    })
  ]);

  assertActiveEmployee(employee);

  const actor: PermissionActor = {
    tenantId: input.context.tenantId,
    employeeId: input.context.employeeId,
    orgUnitIds: employee.orgUnitIds,
    queueIds: employee.queueIds,
    teamIds: employee.teamIds
  };

  return {
    actor,
    effectiveGrants: resolveEffectivePermissionGrants({
      actor,
      roles: input.roles,
      roleBindings: input.roleBindings ?? [],
      directGrants,
      at: input.at
    })
  };
}

function assertCanGrantScopedPermissions(input: {
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
  readonly target: {
    readonly permissions: readonly Permission[];
    readonly resource: PermissionResourceContext;
  };
}): void {
  assertCanManageScopedAccess(input);

  for (const permission of input.target.permissions) {
    const decision = canAccess({
      actor: input.actor,
      effectiveGrants: input.effectiveGrants,
      permission,
      resource: input.target.resource
    });

    if (!decision.allowed) {
      throw new CoreError("permission.denied");
    }
  }
}

function assertCanManageScopedAccess(input: {
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
  readonly target: Pick<
    {
      readonly resource: PermissionResourceContext;
    },
    "resource"
  >;
}): void {
  const decision = canAccess({
    actor: input.actor,
    effectiveGrants: input.effectiveGrants,
    permission: "roles.manage",
    resource: input.target.resource
  });

  if (!decision.allowed) {
    throw new CoreError("permission.denied");
  }
}

async function resolveRoleBindingSubjectResources(input: {
  readonly tenantId: TenantId;
  readonly subject: PermissionRoleBindingSubject;
  readonly employeeRepository: Pick<
    EmployeeDirectoryRepository,
    "findEmployee"
  >;
  readonly orgStructureRepository: Pick<
    OrgStructureRepository,
    "listOrgUnits" | "listTeams" | "listWorkQueues"
  >;
  readonly activeOnly: boolean;
}): Promise<readonly PermissionResourceContext[]> {
  switch (input.subject.type) {
    case "employee": {
      const target = await input.employeeRepository.findEmployee({
        tenantId: input.tenantId,
        employeeId: input.subject.id
      });

      if (input.activeOnly) {
        assertActiveEmployee(target);
      } else {
        assertEmployeeExists(target);
      }

      return employeePermissionResources(target);
    }
    case "org_unit": {
      const orgUnits = await input.orgStructureRepository.listOrgUnits({
        tenantId: input.tenantId,
        activeOnly: input.activeOnly
      });
      const orgUnit = orgUnits.find(
        (candidate) => candidate.id === input.subject.id
      );

      if (orgUnit === undefined) {
        throw new CoreError("permission.denied");
      }

      return [
        {
          tenantId: orgUnit.tenantId,
          orgUnitId: orgUnit.id,
          orgUnitIds: [orgUnit.id]
        }
      ];
    }
    case "team": {
      const teams = await input.orgStructureRepository.listTeams({
        tenantId: input.tenantId
      });
      const team = teams.find((candidate) => candidate.id === input.subject.id);

      if (team === undefined) {
        throw new CoreError("permission.denied");
      }

      return [
        {
          tenantId: team.tenantId,
          teamId: team.id,
          teamIds: [team.id]
        }
      ];
    }
    case "queue": {
      const workQueues = await input.orgStructureRepository.listWorkQueues({
        tenantId: input.tenantId,
        activeOnly: input.activeOnly
      });
      const workQueue = workQueues.find(
        (candidate) => candidate.id === input.subject.id
      );

      if (workQueue === undefined) {
        throw new CoreError("permission.denied");
      }

      return [
        {
          tenantId: workQueue.tenantId,
          orgUnitId: workQueue.owningOrgUnitId ?? undefined,
          queueId: workQueue.id
        }
      ];
    }
  }
}

function assertCanManageRoleTarget(input: {
  readonly actorPrivilege: RoleManagementActorPrivilege;
  readonly resources: readonly PermissionResourceContext[];
}): void {
  const allowed = input.resources.some(
    (resource) =>
      canAccess({
        actor: input.actorPrivilege.actor,
        effectiveGrants: input.actorPrivilege.effectiveGrants,
        permission: "roles.manage",
        resource
      }).allowed
  );

  if (!allowed) {
    throw new CoreError("permission.denied");
  }
}

function assertCanManageResolvedScope(input: {
  readonly actorPrivilege: RoleManagementActorPrivilege;
  readonly scope: PermissionScope;
  readonly resource: PermissionResourceContext;
  readonly allowUnresolvedExactScopeForTenantCleanup?: boolean;
}): void {
  if (input.scope.type === "client" || input.scope.type === "conversation") {
    if (!input.allowUnresolvedExactScopeForTenantCleanup) {
      throw new CoreError("permission.denied");
    }

    assertCanManageScopedAccess({
      actor: input.actorPrivilege.actor,
      effectiveGrants: input.actorPrivilege.effectiveGrants,
      target: {
        resource: { tenantId: input.actorPrivilege.actor.tenantId }
      }
    });
  }

  assertCanManageScopedAccess({
    actor: input.actorPrivilege.actor,
    effectiveGrants: input.actorPrivilege.effectiveGrants,
    target: { resource: input.resource }
  });
}

function assertEmployeeIsNotActor(
  actor: PermissionActor,
  target: TenantEmployeeRecord
): void {
  if (actor.employeeId === target.employeeId) {
    throw new CoreError("permission.denied");
  }
}

function assertRoleBindingDoesNotApplyToActor(
  actor: PermissionActor,
  subject: PermissionRoleBindingSubject
): void {
  if (roleBindingSubjectAppliesToActor(actor, subject)) {
    throw new CoreError("permission.denied");
  }
}

function roleBindingSubjectAppliesToActor(
  actor: PermissionActor,
  subject: PermissionRoleBindingSubject
): boolean {
  switch (subject.type) {
    case "employee":
      return subject.id === actor.employeeId;
    case "org_unit":
      return actor.orgUnitIds?.includes(subject.id) ?? false;
    case "team":
      return actor.teamIds?.includes(subject.id) ?? false;
    case "queue":
      return actor.queueIds?.includes(subject.id) ?? false;
  }
}

function employeePermissionResources(
  employee: TenantEmployeeRecord
): readonly PermissionResourceContext[] {
  const baseResource: PermissionResourceContext = {
    tenantId: employee.tenantId,
    orgUnitIds: employee.orgUnitIds,
    teamIds: employee.teamIds
  };

  return [
    baseResource,
    ...employee.queueIds.map((queueId) => ({
      ...baseResource,
      queueId
    }))
  ];
}

async function assertRoleUpdateBindingSafety(input: {
  readonly actorPrivilege: RoleManagementActorPrivilege;
  readonly addedPermissions: readonly Permission[];
  readonly bindings: readonly PermissionRoleBinding[];
  readonly nextPermissions: readonly Permission[];
  readonly tenantId: TenantId;
  readonly employeeRepository: Pick<
    EmployeeDirectoryRepository,
    "findEmployee"
  >;
  readonly orgStructureRepository: Pick<
    OrgStructureRepository,
    "listOrgUnits" | "listTeams" | "listWorkQueues"
  >;
}): Promise<void> {
  for (const binding of input.bindings) {
    assertPermissionsAllowedForScope(input.nextPermissions, binding.scope.type);

    if (input.addedPermissions.length === 0) {
      continue;
    }

    assertRoleBindingDoesNotApplyToActor(
      input.actorPrivilege.actor,
      binding.subject
    );

    const [subjectResources, targetResource] = await Promise.all([
      resolveRoleBindingSubjectResources({
        tenantId: input.tenantId,
        subject: binding.subject,
        employeeRepository: input.employeeRepository,
        orgStructureRepository: input.orgStructureRepository,
        activeOnly: false
      }),
      resolveKnownScopeResource({
        tenantId: input.tenantId,
        scope: binding.scope,
        orgStructureRepository: input.orgStructureRepository,
        activeOnly: false
      })
    ]);

    assertCanManageRoleTarget({
      actorPrivilege: input.actorPrivilege,
      resources: subjectResources
    });
    assertCanManageResolvedScope({
      actorPrivilege: input.actorPrivilege,
      scope: binding.scope,
      resource: targetResource
    });
    assertCanGrantScopedPermissions({
      actor: input.actorPrivilege.actor,
      effectiveGrants: input.actorPrivilege.effectiveGrants,
      target: {
        permissions: input.addedPermissions,
        resource: targetResource
      }
    });
  }
}

async function resolveRoleMutationAuthorizationScopes(input: {
  readonly tenantId: TenantId;
  readonly bindings: readonly PermissionRoleBinding[];
  readonly employeeRepository: Pick<
    EmployeeDirectoryRepository,
    "findEmployee"
  >;
  readonly orgStructureRepository: Pick<
    OrgStructureRepository,
    "listOrgUnits" | "listTeams" | "listWorkQueues"
  >;
}): Promise<readonly InternalAccessDecisionScope[]> {
  const scopes: InternalAccessDecisionScope[] = [{ type: "tenant" }];

  for (const binding of input.bindings) {
    const [subjectResources, targetResource] = await Promise.all([
      resolveRoleBindingSubjectResources({
        tenantId: input.tenantId,
        subject: binding.subject,
        employeeRepository: input.employeeRepository,
        orgStructureRepository: input.orgStructureRepository,
        activeOnly: false
      }),
      resolveKnownScopeResource({
        tenantId: input.tenantId,
        scope: binding.scope,
        orgStructureRepository: input.orgStructureRepository,
        activeOnly: false
      })
    ]);

    scopes.push(
      ...rbacMutationAuthorizationScopes({
        scope: binding.scope,
        resources: [...subjectResources, targetResource]
      })
    );
  }

  return normalizeRbacAuthorizationScopes(scopes);
}

async function resolveKnownScopeResource(input: {
  readonly tenantId: TenantId;
  readonly scope: PermissionScope;
  readonly orgStructureRepository: Pick<
    OrgStructureRepository,
    "listOrgUnits" | "listTeams" | "listWorkQueues"
  >;
  readonly activeOnly?: boolean;
}): Promise<PermissionResourceContext> {
  const scope = input.scope;

  switch (scope.type) {
    case "tenant":
    case "assigned":
    case "own":
      return {
        tenantId: input.tenantId
      };
    case "client":
      return {
        tenantId: input.tenantId,
        clientId: scope.id as ClientId
      };
    case "conversation":
      return {
        tenantId: input.tenantId,
        conversationId: scope.id as ConversationId
      };
    case "org_unit": {
      const orgUnits = await input.orgStructureRepository.listOrgUnits({
        tenantId: input.tenantId,
        activeOnly: input.activeOnly ?? true
      });

      if (!orgUnits.some((orgUnit) => orgUnit.id === scope.id)) {
        throw new CoreError("permission.denied");
      }

      return {
        tenantId: input.tenantId,
        orgUnitId: scope.id,
        orgUnitIds: [scope.id]
      };
    }
    case "team": {
      const teams = await input.orgStructureRepository.listTeams({
        tenantId: input.tenantId
      });

      if (!teams.some((team) => team.id === scope.id)) {
        throw new CoreError("permission.denied");
      }

      return {
        tenantId: input.tenantId,
        teamId: scope.id,
        teamIds: [scope.id]
      };
    }
    case "queue": {
      const workQueues = await input.orgStructureRepository.listWorkQueues({
        tenantId: input.tenantId,
        activeOnly: input.activeOnly ?? true
      });
      const workQueue = workQueues.find(
        (candidate) => candidate.id === scope.id
      );

      if (workQueue === undefined) {
        throw new CoreError("permission.denied");
      }

      return {
        tenantId: input.tenantId,
        orgUnitId: workQueue.owningOrgUnitId ?? undefined,
        queueId: scope.id
      };
    }
  }
}

function assertActiveEmployee(
  employee: TenantEmployeeRecord | null
): asserts employee is TenantEmployeeRecord {
  if (employee === null || employee.deactivatedAt !== null) {
    throw new CoreError("permission.denied");
  }
}

function assertEmployeeExists(
  employee: TenantEmployeeRecord | null
): asserts employee is TenantEmployeeRecord {
  if (employee === null) {
    throw new CoreError("permission.denied");
  }
}

function assertCustomRole(
  role: TenantRoleRecord | undefined
): asserts role is TenantRoleRecord {
  if (role === undefined || role.isSystem) {
    throw new CoreError("validation.failed");
  }
}

function assertRoleUpdateDoesNotRemoveOwnRoleManagement(input: {
  readonly actorPrivilege: RoleManagementActorPrivilege;
  readonly bindings: readonly PermissionRoleBinding[];
  readonly existingRole: TenantRoleRecord;
  readonly nextRole: PreparedCustomTenantRole;
}): void {
  if (
    !input.existingRole.permissions.includes("roles.manage") ||
    input.nextRole.permissions.includes("roles.manage")
  ) {
    return;
  }

  if (
    !input.bindings.some(
      (binding) =>
        binding.roleId === input.existingRole.id &&
        binding.scope.type === "tenant" &&
        roleBindingSubjectAppliesToActor(
          input.actorPrivilege.actor,
          binding.subject
        )
    )
  ) {
    return;
  }

  const tenantRoleManagement = input.actorPrivilege.effectiveGrants.find(
    (grant) =>
      grant.permission === "roles.manage" && grant.scope.type === "tenant"
  );
  const hasIndependentSource = tenantRoleManagement?.sources.some(
    (source) =>
      source.type === "direct_grant" || source.roleId !== input.existingRole.id
  );

  if (!hasIndependentSource) {
    throw new CoreError("permission.denied");
  }
}

function toPermission(value: string): Permission {
  if (!isPermission(value)) {
    throw new CoreError("validation.failed");
  }

  return value;
}

function toPermissionScope(
  scope: InternalAccessDecisionScope
): PermissionScope {
  return normalizePermissionScope({
    type: scope.type,
    id: "id" in scope ? scope.id : undefined
  });
}

function toRoleBindingSubject(
  subject: InternalRbacRoleSubject
): PermissionRoleBindingSubject {
  switch (subject.type) {
    case "employee":
      return {
        type: subject.type,
        id: subject.id as EmployeeId
      };
    case "org_unit":
    case "queue":
    case "team":
      return {
        type: subject.type,
        id: subject.id
      };
  }
}

function normalizeTemporalWindow(
  input: { readonly startsAt?: string; readonly expiresAt?: string },
  now: Date
): TemporalWindow {
  const startsAt = optionalTimestamp(input.startsAt);
  const expiresAt = optionalTimestamp(input.expiresAt);

  if (expiresAt !== undefined && expiresAt.getTime() <= now.getTime()) {
    throw new CoreError("validation.failed");
  }

  if (
    startsAt !== undefined &&
    expiresAt !== undefined &&
    expiresAt.getTime() <= startsAt.getTime()
  ) {
    throw new CoreError("validation.failed");
  }

  return {
    startsAt: startsAt?.toISOString(),
    expiresAt: expiresAt?.toISOString()
  };
}

function optionalTimestamp(value: string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new CoreError("validation.failed");
  }

  return date;
}

function normalizeReason(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > 500) {
    throw new CoreError("validation.failed");
  }

  return normalized;
}

async function loadRoleOrFail(
  repository: Pick<TenantRbacRepository, "listRoleDefinitions">,
  context: InternalRbacContext,
  roleId: string
): Promise<InternalRbacRole> {
  const roles = await repository.listRoleDefinitions({
    tenantId: context.tenantId
  });
  const role = roles.find((candidate) => candidate.id === roleId);

  if (role === undefined) {
    throw new CoreError("validation.failed");
  }

  return mapRole(role);
}

function mapRole(record: TenantRoleRecord): InternalRbacRole {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    status: record.status ?? "active",
    isSystem: record.isSystem,
    permissions: [...record.permissions],
    createdByEmployeeId: record.createdByEmployeeId,
    archivedAt: record.archivedAt
  };
}

function mapRoleBinding(
  record: PermissionRoleBinding
): InternalRbacRoleBinding {
  return {
    id: requiredRecordId(record.id),
    roleId: record.roleId,
    subject: {
      type: record.subject.type,
      id: record.subject.id
    },
    scope: permissionScopeEventPayload(record.scope),
    startsAt: record.startsAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt
  };
}

function mapDirectGrant(
  record: DirectPermissionGrant
): InternalRbacDirectGrant {
  return {
    id: requiredRecordId(record.id),
    employeeId: record.employeeId,
    permission: record.permission,
    scope: permissionScopeEventPayload(record.scope),
    reason: record.reason,
    startsAt: record.startsAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt
  };
}

function requiredRecordId(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new CoreError("validation.failed");
  }

  return value;
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

function scopeMetadata(scope: PermissionScope): Record<string, unknown> {
  const id = scopeId(scope);

  return id === undefined
    ? {
        scopeType: scope.type,
        authorizationScopes: [permissionScopeEventPayload(scope)]
      }
    : {
        scopeType: scope.type,
        scopeId: id,
        authorizationScopes: [permissionScopeEventPayload(scope)]
      };
}

function rbacMutationAuthorizationScopes(input: {
  readonly scope: PermissionScope;
  readonly resources: readonly PermissionResourceContext[];
}): readonly InternalAccessDecisionScope[] {
  const literalScope = permissionScopeEventPayload(input.scope);
  const scopes: InternalAccessDecisionScope[] = [literalScope];

  for (const resource of input.resources) {
    for (const orgUnitId of resourceIds(
      resource.orgUnitId,
      resource.orgUnitIds
    )) {
      scopes.push({ type: "org_unit", id: orgUnitId });
    }

    for (const teamId of resourceIds(resource.teamId, resource.teamIds)) {
      scopes.push({ type: "team", id: teamId });
    }

    if (resource.queueId !== undefined) {
      scopes.push({ type: "queue", id: resource.queueId });
    }
  }

  return normalizeRbacAuthorizationScopes(scopes);
}

function normalizeRbacAuthorizationScopes(
  input: readonly InternalAccessDecisionScope[]
): readonly InternalAccessDecisionScope[] {
  const scopes = new Map<string, InternalAccessDecisionScope>();

  for (const scope of input) {
    scopes.set("id" in scope ? `${scope.type}:${scope.id}` : scope.type, scope);
  }

  const order: Record<InternalAccessDecisionScope["type"], number> = {
    tenant: 0,
    org_unit: 1,
    team: 2,
    queue: 3,
    assigned: 4,
    own: 5,
    client: 6,
    conversation: 7
  };

  return [...scopes.values()].sort(
    (left, right) =>
      order[left.type] - order[right.type] ||
      ("id" in left && "id" in right ? left.id.localeCompare(right.id) : 0)
  );
}

function resourceIds(
  scalarId: string | undefined,
  ids: readonly string[] | undefined
): readonly string[] {
  return [
    ...new Set([...(scalarId === undefined ? [] : [scalarId]), ...(ids ?? [])])
  ];
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

function permissionScopeEventPayload(
  scope: PermissionScope
): InternalAccessDecisionScope {
  switch (scope.type) {
    case "tenant":
      return { type: "tenant" };
    case "assigned":
      return { type: "assigned" };
    case "own":
      return { type: "own" };
    case "org_unit":
      return { type: "org_unit", id: scope.id };
    case "team":
      return { type: "team", id: scope.id };
    case "queue":
      return { type: "queue", id: scope.id };
    case "client":
      return { type: "client", id: scope.id };
    case "conversation":
      return { type: "conversation", id: scope.id };
  }
}

function roleBindingSubjectEventPayload(
  subject: PermissionRoleBindingSubject
): { readonly type: string; readonly id: string } {
  return {
    type: subject.type,
    id: subject.id
  };
}

async function recordAccessMutation(input: {
  readonly context: InternalRbacContext;
  readonly audit?: Pick<SecurityAuditRepository, "record">;
  readonly events?: Pick<DomainEventRepository, "append">;
  readonly action: AccessAuditAction;
  readonly entityType: Exclude<SecurityAuditEntityType, "session">;
  readonly entityId: string;
  readonly metadata: Record<string, unknown>;
  readonly occurredAt: Date;
  readonly event: PlatformEvent;
}): Promise<void> {
  await input.audit?.record({
    id: `audit:${input.context.tenantId}:${input.action}:${randomUUID()}`,
    tenantId: input.context.tenantId,
    actorEmployeeId: input.context.employeeId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata,
    occurredAt: input.occurredAt
  });
  await input.events?.append({
    tenantId: input.context.tenantId,
    events: [input.event]
  });
}

function createRbacEventId(
  tenantId: TenantId,
  eventType: RbacEventType,
  idFactory: () => string
): EventId {
  return `event:${tenantId}:${eventType}:${idFactory()}` as EventId;
}
