import { z } from "zod";

import type { InboxV2CatalogId } from "./catalog";
import {
  createInboxV2CoreCatalogRegistrationSchema,
  createInboxV2ModuleCatalogRegistrationSchema
} from "./catalog";

declare const permissionId: InboxV2CatalogId<"permission">;
declare const errorId: InboxV2CatalogId<"error">;

const _validPermissionId: InboxV2CatalogId<"permission"> = permissionId;

// @ts-expect-error Catalog IDs retain their catalog type at compile time.
const _errorFromPermission: InboxV2CatalogId<"error"> = permissionId;

// @ts-expect-error Error IDs cannot substitute for permission IDs.
const _permissionFromError: InboxV2CatalogId<"permission"> = errorId;

const _coreSchema = createInboxV2CoreCatalogRegistrationSchema({
  catalog: "permission",
  definitionSchema: z.object({ titleKey: z.string() }).strict()
});
const _moduleSchema = createInboxV2ModuleCatalogRegistrationSchema({
  catalog: "permission",
  moduleId: "channel-telegram",
  definitionSchema: z.object({ titleKey: z.string() }).strict()
});

declare const coreRegistration: z.output<typeof _coreSchema>;
declare const moduleRegistration: z.output<typeof _moduleSchema>;

const _exactCoreOwner: { kind: "core" } = coreRegistration.payload.owner;
const _exactModuleOwner: {
  kind: "module";
  moduleId: "channel-telegram";
} = moduleRegistration.payload.owner;

// @ts-expect-error Core registration output cannot contain a module owner.
const _moduleFromCore: { kind: "module"; moduleId: string } =
  coreRegistration.payload.owner;

// @ts-expect-error Module registration retains the exact module ID literal.
const _wrongModuleLiteral: "channel-other" =
  moduleRegistration.payload.owner.moduleId;
