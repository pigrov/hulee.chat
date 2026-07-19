import { once } from "node:events";
import { get, type IncomingHttpHeaders, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createApiNodeServer } from "./node-server";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve()))
      )
  );
});

describe("API Node server streaming responses", () => {
  it("writes an async byte body as a binary stream instead of JSON", async () => {
    const server = createApiNodeServer({
      handler: {
        async handle() {
          return {
            status: 200,
            headers: {
              "content-type": "application/octet-stream",
              "content-length": "3",
              "cache-control": "private, no-store"
            },
            body: chunks(new Uint8Array([1]), new Uint8Array([2, 3]))
          };
        }
      }
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected an ephemeral TCP port.");
    }

    const response = await readResponse(address.port);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(response.headers["content-length"]).toBe("3");
    expect(response.body).toEqual([1, 2, 3]);
  });
});

async function* chunks(...values: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const value of values) {
    yield value;
  }
}

function readResponse(port: number): Promise<{
  status: number | undefined;
  headers: IncomingHttpHeaders;
  body: number[];
}> {
  return new Promise((resolve, reject) => {
    const request = get(
      { hostname: "127.0.0.1", port, path: "/download" },
      (response) => {
        const body: number[] = [];
        response.on("data", (chunk: Buffer) => body.push(...chunk));
        response.once("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body
          })
        );
        response.once("error", reject);
      }
    );
    request.once("error", reject);
  });
}
