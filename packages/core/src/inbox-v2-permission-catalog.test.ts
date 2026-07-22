import { describe, expect, it } from "vitest";

import {
  INBOX_V2_PERMISSION_SCOPE_CATALOG_SCHEMA_ID,
  INBOX_V2_PERMISSION_SCOPE_CATALOG_VERSION,
  createInboxV2ModulePermissionCatalogRegistrationSchema,
  evaluateInboxV2PermissionScopePairLegality,
  inboxV2PermissionCatalog,
  inboxV2PermissionCatalogRegistrationSchema,
  inboxV2PermissionGuardProfileCatalogRegistrationSchema,
  inboxV2PermissionGuardProfileIds,
  inboxV2PermissionGuardProfiles,
  inboxV2PermissionScopeCatalog,
  inboxV2PermissionScopeCatalogSchema,
  inboxV2PermissionScopeTypes,
  inboxV2ScopeCatalog,
  inboxV2ScopeCatalogRegistrationSchema,
  isInboxV2PermissionScopePairLegal,
  parseInboxV2PermissionScope
} from "./index";

const expectedScopeMatrix = {
  "core:tenant.manage": ["tenant"],
  "core:employee.directory.view": ["tenant", "org_unit", "team"],
  "core:employee.invite": ["tenant", "org_unit"],
  "core:employee.profile.manage": ["tenant", "org_unit", "team"],
  "core:employee.deactivate": ["tenant"],
  "core:roles.define": ["tenant"],
  "core:roles.bind": ["tenant", "org_unit", "team", "queue"],
  "core:direct_grants.manage": ["tenant", "org_unit", "team", "queue"],
  "core:org_unit.manage": ["tenant", "org_unit"],
  "core:team.manage": ["tenant", "org_unit", "team"],
  "core:queue.manage": ["tenant", "org_unit", "queue"],
  "core:inbox.read": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "internal_participant",
    "conversation"
  ],
  "core:conversation.read": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "conversation"
  ],
  "core:conversation.internal.read": ["internal_participant"],
  "core:conversation.internal.create": ["tenant", "org_unit", "team"],
  "core:conversation.internal.members.manage": ["internal_participant"],
  "core:conversation.internal.owner_recover": ["conversation"],
  "core:conversation.internal.break_glass_read": ["conversation"],
  "core:conversation.internal.break_glass.issue": ["tenant", "conversation"],
  "core:conversation.access_binding.manage": [
    "tenant",
    "org_unit",
    "team",
    "conversation"
  ],
  "core:conversation.access_binding.apply_policy": [
    "tenant",
    "org_unit",
    "team",
    "conversation"
  ],
  "core:conversation.timeline_append_system": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "conversation"
  ],
  "core:conversation.collaborators.manage": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "conversation",
    "work_item"
  ],
  "core:notification.watch.self": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "internal_participant",
    "conversation",
    "work_item"
  ],
  "core:notification.watchers.manage": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "conversation",
    "work_item"
  ],
  "core:notification.preferences.manage_self": ["tenant"],
  "core:notification.endpoints.manage_self": ["tenant"],
  "core:message.reply_external": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "conversation",
    "work_item"
  ],
  "core:message.send_internal": ["internal_participant"],
  "core:message.staff_note.read": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "conversation",
    "work_item"
  ],
  "core:message.staff_note.create": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "conversation",
    "work_item"
  ],
  "core:message.edit_own": [
    "responsible",
    "collaborator",
    "internal_participant",
    "conversation"
  ],
  "core:message.delete_own": [
    "responsible",
    "collaborator",
    "internal_participant",
    "conversation"
  ],
  "core:message.react": [
    "responsible",
    "collaborator",
    "internal_participant",
    "conversation"
  ],
  "core:message.moderate_external": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "conversation"
  ],
  "core:message.moderate_internal": ["internal_participant"],
  "core:message.forward_external": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "conversation",
    "work_item"
  ],
  "core:work.read": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "work_item",
    "conversation"
  ],
  "core:work.claim": ["tenant", "org_unit", "team", "queue", "work_item"],
  "core:work.assign": ["tenant", "org_unit", "team", "queue", "work_item"],
  "core:work.servicing_team.manage": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "work_item"
  ],
  "core:work.release_self": ["responsible"],
  "core:work.release_other": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "work_item"
  ],
  "core:work.transfer": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "work_item"
  ],
  "core:work.close": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "work_item"
  ],
  "core:work.reopen": ["tenant", "org_unit", "team", "queue", "work_item"],
  "core:work.override": ["tenant", "org_unit", "team", "queue", "work_item"],
  "core:source_account.view": ["tenant", "org_unit", "source_account"],
  "core:source_account.diagnostics.view": [
    "tenant",
    "org_unit",
    "source_account"
  ],
  "core:source_account.use": ["tenant", "org_unit", "source_account"],
  "core:source.route_policy.manage": ["tenant", "org_unit", "source_account"],
  "core:source.dispatch.reroute": ["tenant", "org_unit", "source_account"],
  "core:source.multi_send": ["tenant", "org_unit"],
  "core:source_item.reply": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "conversation",
    "work_item"
  ],
  "core:source_item.open_external": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "conversation"
  ],
  "core:call.initiate": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "client",
    "conversation"
  ],
  "core:call.recording.view": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "client",
    "conversation"
  ],
  "core:call.transcript.view": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "client",
    "conversation"
  ],
  "core:file.view": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "internal_participant",
    "client",
    "conversation",
    "work_item"
  ],
  "core:file.upload": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "internal_participant",
    "client",
    "conversation",
    "work_item"
  ],
  "core:file.delete": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "internal_participant",
    "client",
    "conversation",
    "work_item"
  ],
  "core:participant.pii.view": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "collaborator",
    "conversation"
  ],
  "core:client.view": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "client_owner",
    "client"
  ],
  "core:client.contacts.view": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "client_owner",
    "client"
  ],
  "core:client.edit": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "client_owner",
    "client"
  ],
  "core:client.pipeline.transition": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "client_owner",
    "client"
  ],
  "core:client.fields.view_sensitive": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "client_owner",
    "client"
  ],
  "core:client.fields.edit": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "client_owner",
    "client"
  ],
  "core:client.owner.assign": ["tenant", "org_unit", "team", "client"],
  "core:client.access_binding.manage": ["tenant", "org_unit", "team", "client"],
  "core:conversation.clients.manage": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "responsible",
    "conversation"
  ],
  "core:client.link.manage": [
    "tenant",
    "org_unit",
    "team",
    "client_owner",
    "client"
  ],
  "core:identity.employee_claim.manage": ["tenant", "org_unit", "team"],
  "core:identity.client_contact_claim.manage": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "client"
  ],
  "core:identity.source_identity.use": [
    "tenant",
    "org_unit",
    "source_account",
    "conversation"
  ],
  "core:identity.evidence.view": [
    "tenant",
    "org_unit",
    "source_account",
    "conversation"
  ],
  "core:identity.auto_resolve": ["tenant", "org_unit", "source_account"],
  "core:identity.claim.revoke": [
    "tenant",
    "org_unit",
    "team",
    "queue",
    "client"
  ],
  "core:identity.merge": ["tenant", "org_unit"],
  "core:identity.observation.review": ["tenant", "org_unit", "team", "queue"],
  "core:reports.view": ["tenant", "org_unit", "team", "queue"],
  "core:reports.workforce_dimension.view": [
    "tenant",
    "org_unit",
    "team",
    "queue"
  ],
  "core:reports.drilldown": ["tenant", "org_unit", "team", "queue"],
  "core:reports.export": ["tenant", "org_unit", "team", "queue"],
  "core:reports.pii.view": ["tenant", "org_unit", "team", "queue"],
  "core:reports.pii.export": ["tenant", "org_unit", "team", "queue"],
  "core:audit.view": ["tenant", "org_unit", "team", "queue"],
  "core:privacy.policy.view": ["tenant"],
  "core:privacy.policy.manage": ["tenant"],
  "core:privacy.request.view": ["tenant"],
  "core:privacy.request.decide": ["tenant"],
  "core:privacy.request.execute": ["tenant"],
  "core:privacy.subject_evidence.view": ["tenant"],
  "core:privacy.hold.view": ["tenant"],
  "core:privacy.hold.issue": ["tenant"],
  "core:privacy.hold.release": ["tenant"],
  "core:privacy.tenant_export": ["tenant"],
  "core:privacy.deletion.preview": ["tenant"],
  "core:privacy.deletion.approve": ["tenant"],
  "core:privacy.deletion.execute": ["tenant"],
  "core:audit.privacy.view": ["tenant", "org_unit", "team", "queue"],
  "core:audit.privacy.export": ["tenant", "org_unit", "team", "queue"]
} as const;

const tenantId = "tenant:tenant-1";

const validScopeByType = {
  tenant: { type: "tenant", tenantId },
  org_unit: {
    type: "org_unit",
    tenantId,
    id: "org_unit:support",
    mode: "exact"
  },
  team: { type: "team", tenantId, id: "team:support" },
  queue: { type: "queue", tenantId, id: "work_queue:support" },
  client: { type: "client", tenantId, id: "client:customer-1" },
  conversation: {
    type: "conversation",
    tenantId,
    id: "conversation:case-1"
  },
  work_item: { type: "work_item", tenantId, id: "work_item:case-1" },
  source_account: {
    type: "source_account",
    tenantId,
    id: "source_account:primary"
  },
  responsible: { type: "responsible", tenantId },
  collaborator: { type: "collaborator", tenantId },
  internal_participant: { type: "internal_participant", tenantId },
  client_owner: { type: "client_owner", tenantId }
} as const;

const privacyGuardExpectations = [
  {
    permissionIds: ["core:privacy.policy.view", "core:privacy.policy.manage"],
    guardProfileId: "core:rbac.guard.privacy_policy_revision",
    requiredFenceIds: [
      "core:rbac.fence.exact_governance_context_revision",
      "core:rbac.fence.policy_preview_expected_revision_approval",
      "core:rbac.fence.no_content_authority"
    ]
  },
  {
    permissionIds: [
      "core:privacy.request.view",
      "core:privacy.request.decide",
      "core:privacy.request.execute"
    ],
    guardProfileId: "core:rbac.guard.privacy_request_roots_revision",
    requiredFenceIds: [
      "core:rbac.fence.exact_verified_case_roots_revision",
      "core:rbac.fence.request_decide_execute_separation",
      "core:rbac.fence.requester_not_resource_authority"
    ]
  },
  {
    permissionIds: ["core:privacy.subject_evidence.view"],
    guardProfileId: "core:rbac.guard.privacy_subject_evidence_roots",
    requiredFenceIds: [
      "core:rbac.fence.exact_case_subject_evidence_roots",
      "core:rbac.fence.third_party_masking_evidence_purpose"
    ]
  },
  {
    permissionIds: [
      "core:privacy.hold.view",
      "core:privacy.hold.issue",
      "core:privacy.hold.release"
    ],
    guardProfileId: "core:rbac.guard.privacy_hold_manifest_revision",
    requiredFenceIds: [
      "core:rbac.fence.authentic_frozen_hold_manifest_revision",
      "core:rbac.fence.hold_issue_release_separation",
      "core:rbac.fence.hold_no_read_export_authority"
    ]
  },
  {
    permissionIds: ["core:privacy.tenant_export"],
    guardProfileId: "core:rbac.guard.privacy_tenant_export_high_water",
    requiredFenceIds: [
      "core:rbac.fence.current_tenant_graph_pinned_high_water",
      "core:rbac.fence.two_person_approval",
      "core:rbac.fence.secrets_excluded"
    ]
  },
  {
    permissionIds: [
      "core:privacy.deletion.preview",
      "core:privacy.deletion.approve",
      "core:privacy.deletion.execute"
    ],
    guardProfileId: "core:rbac.guard.privacy_deletion_plan_revisions",
    requiredFenceIds: [
      "core:rbac.fence.exact_deletion_plan_roots_handlers_revisions",
      "core:rbac.fence.preview_approve_execute_separation",
      "core:rbac.fence.cooling_period_recheck"
    ]
  },
  {
    permissionIds: ["core:audit.privacy.view", "core:audit.privacy.export"],
    guardProfileId: "core:rbac.guard.privacy_audit_facets",
    requiredFenceIds: [
      "core:rbac.fence.privacy_actor_target_scope_facets",
      "core:rbac.fence.privacy_audit_no_implicit_pii",
      "core:rbac.fence.audit_access_is_audited"
    ]
  }
] as const;

describe("Inbox V2 permission/scope catalog", () => {
  it("publishes one immutable versioned catalog with all 102 ADR permissions and 12 scope families", () => {
    expect(INBOX_V2_PERMISSION_SCOPE_CATALOG_SCHEMA_ID).toBe(
      "core:inbox-v2.permission-scope-catalog"
    );
    expect(INBOX_V2_PERMISSION_SCOPE_CATALOG_VERSION).toBe("v1");
    expect(inboxV2PermissionScopeCatalog).toMatchObject({
      schemaId: INBOX_V2_PERMISSION_SCOPE_CATALOG_SCHEMA_ID,
      schemaVersion: INBOX_V2_PERMISSION_SCOPE_CATALOG_VERSION,
      payload: { registrations: expect.any(Array) }
    });
    expect(inboxV2PermissionScopeCatalog.payload.registrations).toHaveLength(3);

    expect(inboxV2PermissionCatalog).toHaveLength(102);
    expect(inboxV2ScopeCatalog).toHaveLength(12);
    expect(inboxV2PermissionCatalog.map(({ id }) => id)).toEqual(
      Object.keys(expectedScopeMatrix)
    );
    expect(inboxV2ScopeCatalog.map(({ type }) => type)).toEqual(
      Object.keys(validScopeByType)
    );
    expect(new Set(inboxV2PermissionCatalog.map(({ id }) => id)).size).toBe(
      102
    );
    expect(Object.isFrozen(inboxV2PermissionScopeCatalog)).toBe(true);
    expect(Object.isFrozen(inboxV2PermissionScopeCatalog.payload)).toBe(true);
    expect(
      Object.isFrozen(inboxV2PermissionScopeCatalog.payload.registrations)
    ).toBe(true);
    expect(Object.isFrozen(inboxV2PermissionCatalog)).toBe(true);
    expect(Object.isFrozen(inboxV2ScopeCatalog)).toBe(true);
    expect(Object.isFrozen(inboxV2PermissionScopeTypes)).toBe(true);
    expect(Object.isFrozen(inboxV2PermissionGuardProfileIds)).toBe(true);
    expect(
      inboxV2PermissionCatalog.every(
        (entry) =>
          Object.isFrozen(entry) && Object.isFrozen(entry.allowedScopes)
      )
    ).toBe(true);
    expect(
      inboxV2PermissionGuardProfiles.every(
        (profile) =>
          Object.isFrozen(profile) && Object.isFrozen(profile.requiredFenceIds)
      )
    ).toBe(true);
  });

  it("composes three core-owned frozen CON-001 catalog registrations", () => {
    const registrations = inboxV2PermissionScopeCatalog.payload.registrations;

    expect(
      registrations.map(({ payload }) => [
        payload.catalog,
        payload.entries.length
      ])
    ).toEqual([
      ["inbox-v2-permission", 102],
      ["inbox-v2-permission-scope", 12],
      ["inbox-v2-permission-guard-profile", 21]
    ]);

    for (const registration of registrations) {
      expect(registration.payload.owner).toEqual({ kind: "core" });
      expect(Object.isFrozen(registration)).toBe(true);
      expect(Object.isFrozen(registration.payload)).toBe(true);
      expect(Object.isFrozen(registration.payload.owner)).toBe(true);
      expect(Object.isFrozen(registration.payload.entries)).toBe(true);
      expect(
        registration.payload.entries.every(
          (entry) => Object.isFrozen(entry) && Object.isFrozen(entry.definition)
        )
      ).toBe(true);
    }
  });

  it("rejects malformed specific and aggregate catalog envelopes", () => {
    const [permissionRegistration, scopeRegistration, guardRegistration] =
      inboxV2PermissionScopeCatalog.payload.registrations;

    const specificSchemasAndRegistrations = [
      [inboxV2PermissionCatalogRegistrationSchema, permissionRegistration],
      [inboxV2ScopeCatalogRegistrationSchema, scopeRegistration],
      [
        inboxV2PermissionGuardProfileCatalogRegistrationSchema,
        guardRegistration
      ]
    ] as const;

    for (const [schema, registration] of specificSchemasAndRegistrations) {
      expect(schema.safeParse(registration).success).toBe(true);
      expect(
        schema.safeParse({ ...registration, schemaVersion: "v999" }).success
      ).toBe(false);
    }

    const firstPermissionEntry = permissionRegistration.payload.entries[0]!;
    expect(
      inboxV2PermissionCatalogRegistrationSchema.safeParse({
        ...permissionRegistration,
        payload: {
          ...permissionRegistration.payload,
          entries: [
            {
              ...firstPermissionEntry,
              id: "module:channel-telegram:tenant.manage"
            },
            ...permissionRegistration.payload.entries.slice(1)
          ]
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2PermissionCatalogRegistrationSchema.safeParse({
        ...permissionRegistration,
        payload: {
          ...permissionRegistration.payload,
          entries: [
            ...permissionRegistration.payload.entries,
            firstPermissionEntry
          ]
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2PermissionCatalogRegistrationSchema.safeParse({
        ...permissionRegistration,
        payload: {
          ...permissionRegistration.payload,
          entries: [
            {
              ...firstPermissionEntry,
              definition: {
                ...firstPermissionEntry.definition,
                allowedScopes: ["queue"]
              }
            },
            ...permissionRegistration.payload.entries.slice(1)
          ]
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2PermissionCatalogRegistrationSchema.safeParse({
        ...permissionRegistration,
        payload: {
          ...permissionRegistration.payload,
          entries: [
            {
              ...firstPermissionEntry,
              definition: {
                ...firstPermissionEntry.definition,
                allowedScopes: ["provider"]
              }
            },
            ...permissionRegistration.payload.entries.slice(1)
          ]
        }
      }).success
    ).toBe(false);

    expect(
      inboxV2PermissionScopeCatalogSchema.safeParse({
        ...inboxV2PermissionScopeCatalog,
        schemaVersion: "v999"
      }).success
    ).toBe(false);
    expect(
      inboxV2PermissionScopeCatalogSchema.safeParse({
        ...inboxV2PermissionScopeCatalog,
        unexpected: true
      }).success
    ).toBe(false);
    expect(
      inboxV2PermissionScopeCatalogSchema.safeParse({
        ...inboxV2PermissionScopeCatalog,
        payload: {
          ...inboxV2PermissionScopeCatalog.payload,
          unexpected: true
        }
      }).success
    ).toBe(false);
  });

  it("binds each privacy family to exact roots/revisions, separation-of-duties and no-content fences", () => {
    const permissionById = new Map(
      inboxV2PermissionCatalog.map((entry) => [entry.id, entry])
    );
    const guardProfileById = new Map(
      inboxV2PermissionGuardProfiles.map((profile) => [profile.id, profile])
    );

    expect(
      privacyGuardExpectations.flatMap(({ permissionIds }) => permissionIds)
    ).toHaveLength(15);

    for (const expectation of privacyGuardExpectations) {
      expect(
        guardProfileById.get(expectation.guardProfileId)?.requiredFenceIds
      ).toEqual(expectation.requiredFenceIds);

      for (const permissionId of expectation.permissionIds) {
        expect(permissionById.get(permissionId)?.guardProfileId).toBe(
          expectation.guardProfileId
        );
      }
    }
  });

  it("lets modules add namespaced actions without inventing provider authority scopes", () => {
    const schema =
      createInboxV2ModulePermissionCatalogRegistrationSchema(
        "channel-telegram"
      );
    const registration = (id: string, allowedScopes: readonly string[]) => ({
      schemaId: "core:inbox-v2.catalog-registration",
      schemaVersion: "v1",
      payload: {
        catalog: "inbox-v2-permission",
        owner: { kind: "module", moduleId: "channel-telegram" },
        entries: [
          {
            id,
            definition: {
              allowedScopes,
              allowedPrincipalKinds: ["employee", "trusted_service"],
              guardProfileId: "core:rbac.guard.canonical_resource"
            }
          }
        ]
      }
    });

    expect(
      schema.safeParse(
        registration("module:channel-telegram:conversation.export", [
          "conversation"
        ])
      ).success
    ).toBe(true);
    expect(
      schema.safeParse(
        registration("module:channel-telegram:provider-admin.export", [
          "provider_admin"
        ])
      ).success
    ).toBe(false);
    expect(
      schema.safeParse(
        registration("core:conversation.export", ["conversation"])
      ).success
    ).toBe(false);
  });

  it("matches every legal and illegal ADR permission/scope pair", () => {
    for (const permission of inboxV2PermissionCatalog) {
      const expectedScopes =
        expectedScopeMatrix[permission.id as keyof typeof expectedScopeMatrix];

      expect(permission.allowedScopes, permission.id).toEqual(expectedScopes);

      for (const scopeDefinition of inboxV2ScopeCatalog) {
        const expectedAllowed = expectedScopes.some(
          (scopeType) => scopeType === scopeDefinition.type
        );
        const input = {
          permissionId: permission.id,
          scope: validScopeByType[scopeDefinition.type],
          principalKind: permission.allowedPrincipalKinds[0]
        };

        expect(
          isInboxV2PermissionScopePairLegal(input),
          `${permission.id} on ${scopeDefinition.type}`
        ).toBe(expectedAllowed);

        const decision = evaluateInboxV2PermissionScopePairLegality(input);
        expect(
          decision.kind,
          `${permission.id} on ${scopeDefinition.type}`
        ).toBe(expectedAllowed ? "legal" : "rejected");
        if (!expectedAllowed && decision.kind === "rejected") {
          expect(decision.reason).toBe("illegal_scope");
        }
      }
    }
  });

  it("parses exact/subtree org scopes and rejects cross-kind or synthetic scopes", () => {
    expect(
      parseInboxV2PermissionScope({
        type: "org_unit",
        tenantId,
        id: "org_unit:support",
        mode: "exact"
      })
    ).toEqual({
      type: "org_unit",
      tenantId,
      id: "org_unit:support",
      mode: "exact"
    });
    expect(
      parseInboxV2PermissionScope({
        type: "org_unit",
        tenantId,
        id: "org_unit:support",
        mode: "subtree"
      })
    ).toEqual({
      type: "org_unit",
      tenantId,
      id: "org_unit:support",
      mode: "subtree"
    });

    expect(
      parseInboxV2PermissionScope({
        type: "org_unit",
        tenantId,
        id: "team:support",
        mode: "exact"
      })
    ).toBeUndefined();
    expect(
      parseInboxV2PermissionScope({
        type: "org_unit",
        tenantId,
        id: "org_unit:support"
      })
    ).toBeUndefined();
    expect(
      parseInboxV2PermissionScope({
        type: "conversation",
        tenantId,
        id: "client:customer-1"
      })
    ).toBeUndefined();
    expect(
      parseInboxV2PermissionScope({
        type: "client",
        tenantId,
        id: "conversation:case-1"
      })
    ).toBeUndefined();
    expect(parseInboxV2PermissionScope({ type: "tenant" })).toBeUndefined();
    expect(
      parseInboxV2PermissionScope({
        type: "tenant",
        tenantId: "employee:employee-1"
      })
    ).toBeUndefined();

    for (const type of [
      "provider",
      "provider_member",
      "identity_claim",
      "watcher",
      "assigned",
      "own"
    ]) {
      expect(parseInboxV2PermissionScope({ type, tenantId })).toBeUndefined();
    }

    expect(
      parseInboxV2PermissionScope({
        type: "responsible",
        tenantId,
        id: "employee:employee-1"
      })
    ).toBeUndefined();
  });

  it("keeps provider, claim and watcher evidence outside principal authority", () => {
    for (const principalKind of [
      "provider_owner",
      "provider_admin",
      "provider_member",
      "source_identity_claim",
      "watcher",
      "conversation_participant",
      "client"
    ]) {
      expect(
        evaluateInboxV2PermissionScopePairLegality({
          permissionId: "core:conversation.read",
          scope: validScopeByType.conversation,
          principalKind
        })
      ).toEqual({ kind: "rejected", reason: "illegal_principal" });
    }
  });

  it("reserves policy application and automatic identity resolution for trusted services", () => {
    for (const permissionId of [
      "core:conversation.access_binding.apply_policy",
      "core:conversation.timeline_append_system",
      "core:identity.auto_resolve"
    ]) {
      expect(
        evaluateInboxV2PermissionScopePairLegality({
          permissionId,
          scope: validScopeByType.tenant,
          principalKind: "employee"
        })
      ).toEqual({ kind: "rejected", reason: "illegal_principal" });
      expect(
        evaluateInboxV2PermissionScopePairLegality({
          permissionId,
          scope: validScopeByType.tenant,
          principalKind: "trusted_service"
        }).kind
      ).toBe("legal");
    }

    expect(
      evaluateInboxV2PermissionScopePairLegality({
        permissionId: "core:conversation.read",
        scope: validScopeByType.conversation,
        principalKind: "trusted_service"
      }).kind
    ).toBe("legal");
  });

  it("preserves internal, break-glass and privacy hard boundaries", () => {
    expect(
      isInboxV2PermissionScopePairLegal({
        permissionId: "core:conversation.internal.read",
        scope: validScopeByType.internal_participant,
        principalKind: "employee"
      })
    ).toBe(true);
    expect(
      isInboxV2PermissionScopePairLegal({
        permissionId: "core:conversation.internal.read",
        scope: validScopeByType.tenant,
        principalKind: "employee"
      })
    ).toBe(false);
    expect(
      isInboxV2PermissionScopePairLegal({
        permissionId: "core:conversation.read",
        scope: validScopeByType.internal_participant,
        principalKind: "employee"
      })
    ).toBe(false);
    expect(
      isInboxV2PermissionScopePairLegal({
        permissionId: "core:conversation.internal.break_glass_read",
        scope: validScopeByType.conversation,
        principalKind: "employee"
      })
    ).toBe(true);
    expect(
      isInboxV2PermissionScopePairLegal({
        permissionId: "core:conversation.internal.break_glass_read",
        scope: validScopeByType.tenant,
        principalKind: "employee"
      })
    ).toBe(false);

    for (const permissionId of [
      "core:privacy.policy.manage",
      "core:privacy.request.execute",
      "core:privacy.subject_evidence.view",
      "core:privacy.hold.issue",
      "core:privacy.hold.release",
      "core:privacy.tenant_export",
      "core:privacy.deletion.preview",
      "core:privacy.deletion.approve",
      "core:privacy.deletion.execute"
    ]) {
      expect(
        isInboxV2PermissionScopePairLegal({
          permissionId,
          scope: validScopeByType.tenant,
          principalKind: "employee"
        })
      ).toBe(true);
      expect(
        isInboxV2PermissionScopePairLegal({
          permissionId,
          scope: validScopeByType.conversation,
          principalKind: "employee"
        })
      ).toBe(false);
    }

    expect(
      isInboxV2PermissionScopePairLegal({
        permissionId: "core:audit.privacy.view",
        scope: validScopeByType.queue,
        principalKind: "employee"
      })
    ).toBe(true);
  });

  it("does not propagate Client authority to a linked Conversation", () => {
    expect(
      isInboxV2PermissionScopePairLegal({
        permissionId: "core:client.view",
        scope: validScopeByType.client,
        principalKind: "employee"
      })
    ).toBe(true);
    expect(
      isInboxV2PermissionScopePairLegal({
        permissionId: "core:client.view",
        scope: validScopeByType.conversation,
        principalKind: "employee"
      })
    ).toBe(false);
    expect(
      isInboxV2PermissionScopePairLegal({
        permissionId: "core:conversation.read",
        scope: validScopeByType.client,
        principalKind: "employee"
      })
    ).toBe(false);
  });

  it("returns stable rejection reasons for malformed catalog inputs", () => {
    expect(
      evaluateInboxV2PermissionScopePairLegality({
        permissionId: "core:unknown.permission",
        scope: validScopeByType.tenant,
        principalKind: "employee"
      })
    ).toEqual({ kind: "rejected", reason: "unknown_permission" });
    expect(
      evaluateInboxV2PermissionScopePairLegality({
        permissionId: "core:conversation.read",
        scope: {
          type: "conversation",
          tenantId,
          id: "client:customer-1"
        },
        principalKind: "employee"
      })
    ).toEqual({ kind: "rejected", reason: "invalid_scope" });
    expect(
      evaluateInboxV2PermissionScopePairLegality({
        permissionId: "core:conversation.read",
        scope: validScopeByType.client,
        principalKind: "employee"
      })
    ).toEqual({ kind: "rejected", reason: "illegal_scope" });
  });
});
