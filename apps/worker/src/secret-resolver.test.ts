import type { TenantId } from "@hulee/contracts";
import type { TenantSecretRepository } from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import {
  createEnvSecretResolver,
  createTenantSecretResolver
} from "./secret-resolver";

const tenantId = "tenant-secret-resolver" as TenantId;

describe("worker secret resolver", () => {
  it("resolves trimmed env references and rejects missing values", async () => {
    const resolver = createEnvSecretResolver({
      HULEE_TEST_TOKEN: "  token-value  ",
      HULEE_EMPTY_TOKEN: "   "
    });

    await expect(
      resolver.resolveSecret({
        tenantId,
        secretRef: "env:HULEE_TEST_TOKEN"
      })
    ).resolves.toBe("token-value");
    await expect(
      resolver.resolveSecret({ tenantId, secretRef: "HULEE_EMPTY_TOKEN" })
    ).resolves.toBeNull();
    await expect(
      resolver.resolveSecret({ tenantId, secretRef: "HULEE_MISSING_TOKEN" })
    ).resolves.toBeNull();
  });

  it("delegates tenant secret references without falling back to env", async () => {
    const resolveSecret = vi.fn(async () => "tenant-secret-value");
    const tenantSecrets = createTenantSecretRepository({ resolveSecret });
    const resolver = createTenantSecretResolver({
      env: {
        "secret:tenant-secret-resolver/channels/telegram/token":
          "unsafe-env-fallback"
      },
      tenantSecrets
    });
    const secretRef = "secret:tenant-secret-resolver/channels/telegram/token";

    await expect(resolver.resolveSecret({ tenantId, secretRef })).resolves.toBe(
      "tenant-secret-value"
    );
    expect(resolveSecret).toHaveBeenCalledWith({ tenantId, secretRef });
  });

  it("uses the env resolver only for non-tenant references", async () => {
    const resolveSecret = vi.fn(async () => null);
    const resolver = createTenantSecretResolver({
      env: { HULEE_TEST_TOKEN: "env-token" },
      tenantSecrets: createTenantSecretRepository({ resolveSecret })
    });

    await expect(
      resolver.resolveSecret({
        tenantId,
        secretRef: "env:HULEE_TEST_TOKEN"
      })
    ).resolves.toBe("env-token");
    expect(resolveSecret).not.toHaveBeenCalled();
  });
});

function createTenantSecretRepository(input: {
  resolveSecret: TenantSecretRepository["resolveSecret"];
}): TenantSecretRepository {
  return {
    async findSecret() {
      return null;
    },
    resolveSecret: input.resolveSecret,
    async upsertSecret() {}
  };
}
