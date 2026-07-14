import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createInboxV2CoreCatalogRegistrationSchema,
  createInboxV2ModuleCatalogRegistrationSchema,
  defineInboxV2CatalogRegistrations,
  INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID,
  inboxV2CatalogIdSchema,
  inboxV2NamespaceSchema,
  parseInboxV2NamespacedId
} from "../index";

const definitionSchema = z
  .object({
    titleKey: z.string().min(1),
    metadata: z
      .object({ flags: z.array(z.string()) })
      .strict()
      .optional()
  })
  .strict();

const coreRegistrationSchema = createInboxV2CoreCatalogRegistrationSchema({
  catalog: "contract-test",
  definitionSchema
});

const moduleRegistrationSchema = createInboxV2ModuleCatalogRegistrationSchema({
  catalog: "contract-test",
  moduleId: "channel-telegram",
  definitionSchema
});

function registrationEnvelope(payload: unknown) {
  return {
    schemaId: INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID,
    schemaVersion: "v1",
    payload
  };
}

describe("Inbox V2 catalog namespaces and registrations", () => {
  it("accepts only core and module namespaces", () => {
    expect(inboxV2NamespaceSchema.parse("core")).toBe("core");
    expect(inboxV2NamespaceSchema.parse("module:channel-telegram")).toBe(
      "module:channel-telegram"
    );
    expect(inboxV2CatalogIdSchema.parse("core:conversation.read")).toBe(
      "core:conversation.read"
    );
    expect(
      inboxV2CatalogIdSchema.parse("module:channel-telegram:conversation.reply")
    ).toBe("module:channel-telegram:conversation.reply");

    expect(inboxV2CatalogIdSchema.safeParse("conversation.read").success).toBe(
      false
    );
    expect(inboxV2CatalogIdSchema.safeParse("vendor:read").success).toBe(false);
    expect(inboxV2CatalogIdSchema.safeParse("core:").success).toBe(false);
    expect(inboxV2CatalogIdSchema.safeParse("module:core:read").success).toBe(
      false
    );
    expect(inboxV2CatalogIdSchema.safeParse("module:module:read").success).toBe(
      false
    );
    expect(inboxV2CatalogIdSchema.safeParse("Core:read").success).toBe(false);
    expect(inboxV2CatalogIdSchema.safeParse("core:read ").success).toBe(false);
  });

  it("parses namespace ownership without guessing", () => {
    expect(parseInboxV2NamespacedId("core:conversation.read")).toEqual({
      namespace: "core",
      localId: "conversation.read"
    });
    expect(
      parseInboxV2NamespacedId("module:channel-telegram:conversation.reply")
    ).toEqual({
      namespace: "module:channel-telegram",
      moduleId: "channel-telegram",
      localId: "conversation.reply"
    });
  });

  it("accepts core IDs only in a core registration", () => {
    expect(
      coreRegistrationSchema.parse(
        registrationEnvelope({
          catalog: "contract-test",
          owner: { kind: "core" },
          entries: [
            {
              id: "core:conversation.read",
              definition: { titleKey: "permissions.conversation.read" }
            }
          ]
        })
      )
    ).toMatchObject({
      payload: {
        owner: { kind: "core" },
        entries: [{ id: "core:conversation.read" }]
      }
    });

    expect(
      coreRegistrationSchema.safeParse(
        registrationEnvelope({
          catalog: "contract-test",
          owner: { kind: "core" },
          entries: [
            {
              id: "module:channel-telegram:conversation.read",
              definition: { titleKey: "permissions.conversation.read" }
            }
          ]
        })
      ).success
    ).toBe(false);
  });

  it("binds a module registration to the trusted module ID", () => {
    expect(
      moduleRegistrationSchema.parse(
        registrationEnvelope({
          catalog: "contract-test",
          owner: { kind: "module", moduleId: "channel-telegram" },
          entries: [
            {
              id: "module:channel-telegram:conversation.reply",
              definition: { titleKey: "permissions.conversation.reply" }
            }
          ]
        })
      )
    ).toMatchObject({
      payload: {
        owner: { kind: "module", moduleId: "channel-telegram" }
      }
    });

    for (const input of [
      registrationEnvelope({
        catalog: "contract-test",
        owner: { kind: "module", moduleId: "channel-other" },
        entries: [
          {
            id: "module:channel-telegram:conversation.reply",
            definition: { titleKey: "permissions.conversation.reply" }
          }
        ]
      }),
      registrationEnvelope({
        catalog: "contract-test",
        owner: { kind: "module", moduleId: "channel-telegram" },
        entries: [
          {
            id: "module:channel-other:conversation.reply",
            definition: { titleKey: "permissions.conversation.reply" }
          }
        ]
      }),
      registrationEnvelope({
        catalog: "contract-test",
        owner: { kind: "module", moduleId: "channel-telegram" },
        entries: [
          {
            id: "core:conversation.reply",
            definition: { titleKey: "permissions.conversation.reply" }
          }
        ]
      })
    ]) {
      expect(moduleRegistrationSchema.safeParse(input).success).toBe(false);
    }
  });

  it("rejects duplicate catalog IDs within and across registrations", () => {
    const duplicatePayload = registrationEnvelope({
      catalog: "contract-test",
      owner: { kind: "core" },
      entries: [
        {
          id: "core:conversation.read",
          definition: { titleKey: "permissions.conversation.read" }
        },
        {
          id: "core:conversation.read",
          definition: { titleKey: "permissions.conversation.readDuplicate" }
        }
      ]
    });

    expect(coreRegistrationSchema.safeParse(duplicatePayload).success).toBe(
      false
    );

    const first = coreRegistrationSchema.parse(
      registrationEnvelope({
        catalog: "contract-test",
        owner: { kind: "core" },
        entries: [
          {
            id: "core:conversation.read",
            definition: { titleKey: "permissions.conversation.read" }
          }
        ]
      })
    );
    const second = coreRegistrationSchema.parse(
      registrationEnvelope({
        catalog: "contract-test",
        owner: { kind: "core" },
        entries: [
          {
            id: "core:conversation.read",
            definition: { titleKey: "permissions.conversation.readAgain" }
          }
        ]
      })
    );

    expect(() => defineInboxV2CatalogRegistrations([first, second])).toThrow(
      "Duplicate Inbox V2 catalog ID"
    );
  });

  it("returns an immutable registration list without global registry state", () => {
    const registration = coreRegistrationSchema.parse(
      registrationEnvelope({
        catalog: "contract-test",
        owner: { kind: "core" },
        entries: [
          {
            id: "core:conversation.read",
            definition: {
              titleKey: "permissions.conversation.read",
              metadata: { flags: ["audited"] }
            }
          }
        ]
      })
    );
    const registrations = defineInboxV2CatalogRegistrations([registration]);

    expect(registrations).toHaveLength(1);
    expect(Object.isFrozen(registrations)).toBe(true);
    expect(Object.isFrozen(registrations[0])).toBe(true);
    expect(Object.isFrozen(registrations[0]?.payload.entries)).toBe(true);
    expect(
      Object.isFrozen(registrations[0]?.payload.entries[0]?.definition)
    ).toBe(true);
    expect(
      Object.isFrozen(
        registrations[0]?.payload.entries[0]?.definition.metadata?.flags
      )
    ).toBe(true);

    registration.payload.entries[0]!.definition.titleKey = "mutated.after";
    registration.payload.entries[0]!.definition.metadata!.flags.push("mutated");

    expect(registrations[0]?.payload.entries[0]?.definition).toEqual({
      titleKey: "permissions.conversation.read",
      metadata: { flags: ["audited"] }
    });
  });

  it("revalidates envelope and owner structure when composing registrations", () => {
    const valid = coreRegistrationSchema.parse(
      registrationEnvelope({
        catalog: "contract-test",
        owner: { kind: "core" },
        entries: [
          {
            id: "core:conversation.read",
            definition: { titleKey: "permissions.conversation.read" }
          }
        ]
      })
    );
    const wrongVersion = {
      ...valid,
      schemaVersion: "v99"
    } as unknown as typeof valid;
    const wrongOwner = {
      ...valid,
      payload: {
        ...valid.payload,
        entries: [
          {
            id: "module:channel-telegram:conversation.read",
            definition: { titleKey: "permissions.conversation.read" }
          }
        ]
      }
    } as unknown as typeof valid;

    expect(() => defineInboxV2CatalogRegistrations([wrongVersion])).toThrow();
    expect(() => defineInboxV2CatalogRegistrations([wrongOwner])).toThrow(
      "does not belong to its declared owner"
    );
  });
});
