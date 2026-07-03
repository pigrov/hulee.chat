import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const localBrandAssetStoragePrefix = "local:";
const localBrandAssetRootPath = [".hulee", "brand-assets"] as const;

export function canUseLocalBrandAssetStorage(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function isLocalBrandAssetStorageKey(storageKey: string): boolean {
  return storageKey.startsWith(localBrandAssetStoragePrefix);
}

export function toLocalBrandAssetStorageKey(storageKey: string): string {
  return `${localBrandAssetStoragePrefix}${storageKey}`;
}

export async function putLocalBrandAsset(input: {
  storageKey: string;
  body: Uint8Array;
  rootDir?: string;
}): Promise<void> {
  const filePath = resolveLocalBrandAssetFilePath(
    input.storageKey,
    input.rootDir
  );

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, input.body);
}

export async function getLocalBrandAsset(input: {
  storageKey: string;
  rootDir?: string;
}): Promise<Uint8Array> {
  return readFile(
    resolveLocalBrandAssetFilePath(input.storageKey, input.rootDir)
  );
}

export function resolveLocalBrandAssetFilePath(
  storageKey: string,
  rootDir = process.cwd()
): string {
  if (!isLocalBrandAssetStorageKey(storageKey)) {
    throw new Error("Invalid local brand asset storage key.");
  }

  const relativeKey = storageKey.slice(localBrandAssetStoragePrefix.length);
  const normalizedRelativeKey = path.normalize(relativeKey);

  if (
    relativeKey.length === 0 ||
    path.isAbsolute(normalizedRelativeKey) ||
    normalizedRelativeKey === ".." ||
    normalizedRelativeKey.startsWith(`..${path.sep}`)
  ) {
    throw new Error("Invalid local brand asset path.");
  }

  const root = path.resolve(rootDir, ...localBrandAssetRootPath);
  const filePath = path.resolve(root, normalizedRelativeKey);

  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid local brand asset path.");
  }

  return filePath;
}
