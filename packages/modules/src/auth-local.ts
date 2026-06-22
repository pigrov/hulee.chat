import type { AuthProvider, ModuleManifest } from "@hulee/contracts";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const hashVersion = "scrypt:v1";
const passwordHashBytes = 64;

export const localAuthManifest = {
  id: "auth-local",
  type: "auth",
  name: "Local auth",
  version: "0.0.0",
  capabilities: ["auth.email_password"],
  configSchema: {}
} satisfies ModuleManifest;

export type LocalAuthProvider = AuthProvider & {
  verifyPassword(input: {
    password: string;
    passwordHash: string | null | undefined;
  }): Promise<boolean>;
};

export function createLocalAuthProvider(): LocalAuthProvider {
  return {
    manifest: localAuthManifest,
    async verifyPassword(input) {
      return verifyLocalPassword(input.password, input.passwordHash);
    },
    async health() {
      return {
        status: "healthy",
        checkedAt: new Date().toISOString()
      };
    }
  };
}

export async function hashLocalPassword(
  password: string,
  salt = randomBytes(16).toString("base64url")
): Promise<string> {
  if (password.length === 0) {
    throw new Error("Password must not be empty.");
  }

  const derivedKey = (await scryptAsync(
    password,
    salt,
    passwordHashBytes
  )) as Buffer;

  return `${hashVersion}:${salt}:${derivedKey.toString("base64url")}`;
}

export async function verifyLocalPassword(
  password: string,
  passwordHash: string | null | undefined
): Promise<boolean> {
  const parsed = parseLocalPasswordHash(passwordHash);

  if (parsed === null) {
    return false;
  }

  const candidate = (await scryptAsync(
    password,
    parsed.salt,
    parsed.hash.length
  )) as Buffer;

  return (
    candidate.length === parsed.hash.length &&
    timingSafeEqual(candidate, parsed.hash)
  );
}

function parseLocalPasswordHash(
  passwordHash: string | null | undefined
): { salt: string; hash: Buffer } | null {
  if (passwordHash === null || passwordHash === undefined) {
    return null;
  }

  const [algorithm, version, salt, hash] = passwordHash.split(":");

  if (`${algorithm}:${version}` !== hashVersion || !salt || !hash) {
    return null;
  }

  try {
    return {
      salt,
      hash: Buffer.from(hash, "base64url")
    };
  } catch {
    return null;
  }
}
