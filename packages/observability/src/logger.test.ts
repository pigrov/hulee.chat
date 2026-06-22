import { describe, expect, it } from "vitest";

import {
  createJsonLogger,
  createLevelFilteredLogger,
  serializeError
} from "./index";

class TestError extends Error {
  readonly code = "validation.failed";

  constructor() {
    super("bad input");
    this.name = "TestError";
  }
}

describe("json logger", () => {
  it("writes structured JSON with service and default context", () => {
    const lines: string[] = [];
    const logger = createJsonLogger({
      service: "api",
      defaultContext: { deploymentType: "on_prem" },
      now: () => new Date("2026-06-22T07:00:00.000Z"),
      sink: (line) => lines.push(line)
    });

    logger.info("started", { port: 3000 });

    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      timestamp: "2026-06-22T07:00:00.000Z",
      service: "api",
      level: "info",
      message: "started",
      context: {
        deploymentType: "on_prem",
        port: 3000
      }
    });
  });

  it("serializes platform-like error codes", () => {
    expect(serializeError(new TestError())).toEqual({
      name: "TestError",
      message: "bad input",
      code: "validation.failed",
      stack: undefined
    });
  });

  it("filters records below the configured minimum level", () => {
    const lines: string[] = [];
    const logger = createLevelFilteredLogger(
      createJsonLogger({
        service: "worker",
        now: () => new Date("2026-06-22T07:00:00.000Z"),
        sink: (line) => lines.push(line)
      }),
      "warn"
    );

    logger.info("ignored");
    logger.warn("kept");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      service: "worker",
      level: "warn",
      message: "kept"
    });
  });
});
