import { existsSync } from "node:fs";
import { relative } from "node:path";
import { cwd } from "node:process";

import { readText, walkFiles } from "./file-walk.mjs";

const requiredFiles = ["apps/mobile/src/index.ts", "apps/desktop/src/index.ts"];
const missing = requiredFiles.filter((file) => !existsSync(file));

if (missing.length > 0) {
  console.error("Missing native app scaffold files:");
  for (const file of missing) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

const files = await walkFiles(cwd(), {
  extensions: new Set([".ts", ".tsx"])
});
const failures = [];

for (const file of files) {
  const rel = relative(cwd(), file);

  if (
    !rel.startsWith("apps\\mobile") &&
    !rel.startsWith("apps/mobile") &&
    !rel.startsWith("apps\\desktop") &&
    !rel.startsWith("apps/desktop")
  ) {
    continue;
  }

  const text = await readText(file);

  if (
    /from\s+["']next(?:\/|["'])/.test(text) ||
    /import\(["']next(?:\/|["'])/.test(text)
  ) {
    failures.push(rel);
  }
}

if (failures.length > 0) {
  console.error("Native apps must not import server-only Next.js behavior:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("native:check passed");
