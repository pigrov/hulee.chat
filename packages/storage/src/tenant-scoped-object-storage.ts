import {
  ObjectStorageError,
  type ObjectStorageTenantScope,
  type TenantScopedVersionAwareObjectStorage,
  type VersionAwareObjectStorage
} from "./contracts";

const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

/**
 * Narrows a global provider adapter to one trusted tenant/root prefix. The
 * returned capability validates every key and list/probe prefix before the
 * underlying provider sees it.
 */
export function createTenantScopedVersionAwareObjectStorage(
  storage: VersionAwareObjectStorage,
  scopeInput: ObjectStorageTenantScope
): TenantScopedVersionAwareObjectStorage {
  const scope = normalizeScope(scopeInput);
  const key = (storageKey: string, immutableWrite = false) => {
    assertScopedKey(scope, storageKey, false, immutableWrite);
    return storageKey;
  };
  const prefix = (value: string) => {
    assertScopedKey(scope, value, true);
    return value;
  };

  return {
    scope,
    capabilities: storage.capabilities,
    async putObject(input) {
      return storage.putObject({
        ...input,
        storageKey: key(input.storageKey, true)
      });
    },
    async getObject(input) {
      return storage.getObject({ ...input, storageKey: key(input.storageKey) });
    },
    async putObjectImmutable(input) {
      return storage.putObjectImmutable({
        ...input,
        storageKey: key(input.storageKey, true)
      });
    },
    async getObjectVersion(input) {
      return storage.getObjectVersion({
        ...input,
        identity: {
          ...input.identity,
          storageKey: key(input.identity.storageKey)
        }
      });
    },
    async headObjectVersion(input) {
      return storage.headObjectVersion({
        identity: {
          ...input.identity,
          storageKey: key(input.identity.storageKey)
        }
      });
    },
    async listObjectVersions(input) {
      return storage.listObjectVersions({
        ...input,
        prefix: prefix(input.prefix)
      });
    },
    async deleteObjectVersion(input) {
      return storage.deleteObjectVersion({
        identity: {
          ...input.identity,
          storageKey: key(input.identity.storageKey)
        }
      });
    },
    async quarantineObjectVersion(input) {
      return storage.quarantineObjectVersion({
        ...input,
        identity: {
          ...input.identity,
          storageKey: key(input.identity.storageKey)
        }
      });
    },
    async probeCapabilities(input = {}) {
      const requestedPrefix = input.prefix ?? `${scope.keyPrefix}__probe__/`;
      return storage.probeCapabilities({ prefix: prefix(requestedPrefix) });
    }
  };
}

function normalizeScope(
  input: ObjectStorageTenantScope
): ObjectStorageTenantScope {
  assertBoundedIdentifier(input.tenantId, "tenantId");
  assertBoundedIdentifier(input.storageRootId, "storageRootId");
  if (
    input.keyPrefix.length < 2 ||
    input.keyPrefix.length > 1_024 ||
    !input.keyPrefix.endsWith("/") ||
    CONTROL_CHARACTER_PATTERN.test(input.keyPrefix)
  ) {
    throw invalidScope(
      "keyPrefix must be a bounded control-free prefix ending in '/'."
    );
  }
  return Object.freeze({ ...input });
}

function assertScopedKey(
  scope: ObjectStorageTenantScope,
  value: string,
  allowPrefix = false,
  immutableWrite = false
): void {
  if (
    value.length > 2_048 ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    !value.startsWith(scope.keyPrefix) ||
    (!allowPrefix && value.length === scope.keyPrefix.length)
  ) {
    throw new ObjectStorageError(
      "object_storage.invalid_argument",
      `Object storage address is outside tenant ${scope.tenantId} root ${scope.storageRootId}.`,
      immutableWrite
        ? { writeDisposition: "definitely_not_written" }
        : undefined
    );
  }
}

function assertBoundedIdentifier(value: string, field: string): void {
  if (
    value.length < 3 ||
    value.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u.test(value)
  ) {
    throw invalidScope(`${field} is not a bounded identifier.`);
  }
}

function invalidScope(message: string): ObjectStorageError {
  return new ObjectStorageError("object_storage.invalid_argument", message);
}
