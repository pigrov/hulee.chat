import { describe, expect, it, vi } from "vitest";

import { createSourceConnectionClientMutationId } from "./source-connection-client-mutation-id.server";

describe("source connection client mutation id", () => {
  it("creates a contract-valid id once from the server UUID source", () => {
    const uuidFactory = vi.fn(() => "123e4567-e89b-12d3-a456-426614174000");

    expect(createSourceConnectionClientMutationId(uuidFactory)).toBe(
      "client-mutation:source-123e4567-e89b-12d3-a456-426614174000"
    );
    expect(uuidFactory).toHaveBeenCalledOnce();
  });
});
