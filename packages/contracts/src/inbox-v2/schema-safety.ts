import { z } from "zod";

/**
 * Registration-time guard for data that crosses a versioned Inbox boundary.
 * Safe branded transforms are allowed through a bounded input pipe; open JSON,
 * catchalls and runtime-defined container shapes are not.
 */
export function assertInboxV2ClosedJsonSchema(
  schema: z.ZodType,
  label = "Inbox V2 contract"
): void {
  if (containsOpenJsonSchema(schema)) {
    throw new Error(
      `${label} requires a closed registered schema; unknown/any/record/catchall payloads are forbidden.`
    );
  }
}

function containsOpenJsonSchema(
  schema: z.ZodType,
  visited = new Set<z.ZodType>(),
  root = true
): boolean {
  if (visited.has(schema)) {
    return false;
  }
  visited.add(schema);
  const definition = (
    schema as unknown as { _zod?: { def?: Record<string, unknown> } }
  )._zod?.def;
  const type = definition?.type;
  if (definition === undefined || typeof type !== "string") {
    return true;
  }
  if (
    [
      "unknown",
      "any",
      "record",
      "map",
      "set",
      "custom",
      "transform",
      "lazy"
    ].includes(type)
  ) {
    return true;
  }
  if (type === "pipe") {
    const input = definition.in;
    const output = definition.out;
    return (
      !isZodSchema(input) ||
      containsOpenJsonSchema(input, visited, root) ||
      !isIdentityOnlyTransform(output)
    );
  }
  if (type === "object") {
    const catchall = definition.catchall;
    if (isZodSchema(catchall) && zodSchemaType(catchall) !== "never") {
      return true;
    }
    const shape = definition.shape;
    if (shape === null || typeof shape !== "object") {
      return true;
    }
    return Object.values(shape).some(
      (child) =>
        !isZodSchema(child) || containsOpenJsonSchema(child, visited, false)
    );
  }
  if (type === "array") {
    const child = definition.element;
    return !isZodSchema(child) || containsOpenJsonSchema(child, visited, false);
  }
  if (type === "union") {
    const options = definition.options;
    return (
      !Array.isArray(options) ||
      options.some(
        (child) =>
          !isZodSchema(child) || containsOpenJsonSchema(child, visited, false)
      )
    );
  }
  if (type === "intersection") {
    return [definition.left, definition.right].some(
      (child) =>
        !isZodSchema(child) || containsOpenJsonSchema(child, visited, false)
    );
  }
  if (type === "tuple") {
    const items = definition.items;
    const rest = definition.rest;
    return (
      !Array.isArray(items) ||
      items.some(
        (child) =>
          !isZodSchema(child) || containsOpenJsonSchema(child, visited, false)
      ) ||
      (rest !== null &&
        rest !== undefined &&
        (!isZodSchema(rest) || containsOpenJsonSchema(rest, visited, false)))
    );
  }
  if (["optional", "nullable", "nonoptional", "readonly"].includes(type)) {
    const child = definition.innerType;
    return (
      (root && type === "optional") ||
      !isZodSchema(child) ||
      containsOpenJsonSchema(child, visited, false)
    );
  }
  if (["default", "prefault", "catch"].includes(type)) {
    // Their fallback is executable/output data which is not described by the
    // inner schema. Reject the wrapper instead of trying to inspect a closure.
    return true;
  }
  if (type === "literal") {
    const values = definition.values;
    return (
      !Array.isArray(values) ||
      values.some(
        (value) =>
          value !== null &&
          typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "boolean"
      )
    );
  }
  return !["string", "number", "boolean", "null", "enum", "never"].includes(
    type
  );
}

function isZodSchema(value: unknown): value is z.ZodType {
  return value !== null && typeof value === "object" && "_zod" in value;
}

function zodSchemaType(schema: z.ZodType): string | undefined {
  return (schema as unknown as { _zod?: { def?: { type?: string } } })._zod?.def
    ?.type;
}

function isIdentityOnlyTransform(value: unknown): boolean {
  if (!isZodSchema(value) || zodSchemaType(value) !== "transform") {
    return false;
  }
  const transform = (
    value as unknown as {
      _zod?: { def?: { transform?: unknown } };
    }
  )._zod?.def?.transform;
  if (typeof transform !== "function") {
    return false;
  }
  const compact = Function.prototype.toString
    .call(transform)
    .replace(/\s+/gu, "");
  const arrow = compact.match(/^\(?([A-Za-z_$][\w$]*)\)?=>\1$/u);
  if (arrow !== null) {
    return true;
  }
  const classic = compact.match(
    /^function(?:[A-Za-z_$][\w$]*)?\(([A-Za-z_$][\w$]*)\)\{return\1;?\}$/u
  );
  return classic !== null;
}
