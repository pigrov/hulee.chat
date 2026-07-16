import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("source connection create form", () => {
  it("keeps mutation-id generation on the server page boundary", () => {
    const clientSource = readFileSync(
      new URL("./source-connection-create-form.tsx", import.meta.url),
      "utf8"
    );
    const serverPage = readFileSync(
      new URL("../app/admin/integrations/page.tsx", import.meta.url),
      "utf8"
    );

    expect(clientSource).toContain("readonly clientMutationId: string;");
    expect(clientSource).toContain('name="clientMutationId"');
    expect(clientSource).toContain("value={clientMutationId}");
    expect(clientSource).not.toContain("randomUUID");
    expect(clientSource).not.toContain("crypto.");
    expect(serverPage).toContain(
      "clientMutationId={createSourceConnectionClientMutationId()}"
    );
  });
});
