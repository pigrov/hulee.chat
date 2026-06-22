import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";

export async function walkFiles(root, options = {}) {
  const ignoreDirs = new Set(
    options.ignoreDirs ?? [
      "node_modules",
      "dist",
      "coverage",
      ".next",
      ".turbo",
      ".git"
    ]
  );
  const extensions = new Set(options.extensions ?? []);
  const result = [];

  async function visit(current) {
    const currentStat = await stat(current);

    if (currentStat.isDirectory()) {
      const entries = await readdir(current);

      for (const entry of entries) {
        if (ignoreDirs.has(entry)) {
          continue;
        }

        await visit(join(current, entry));
      }

      return;
    }

    if (extensions.size === 0 || extensions.has(extname(current))) {
      result.push(current);
    }
  }

  await visit(root);

  return result;
}

export async function readText(filePath) {
  return readFile(filePath, "utf8");
}
