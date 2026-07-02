import { relative } from "node:path";
import { cwd } from "node:process";

import { readText, walkFiles } from "./file-walk.mjs";

const files = await walkFiles(cwd(), {
  extensions: new Set([".ts", ".tsx"])
});

const scannedRoots = [
  "apps\\web\\app",
  "apps/web/app",
  "apps\\web\\src",
  "apps/web/src",
  "apps\\site\\app",
  "apps/site/app",
  "apps\\site\\src",
  "apps/site/src",
  "apps\\mobile\\src",
  "apps/mobile/src",
  "apps\\desktop\\src",
  "apps/desktop/src",
  "packages\\ui",
  "packages/ui",
  "packages\\app-shell",
  "packages/app-shell"
];
const allowedFragments = [".test.ts", ".test.tsx"];
const failures = [];

for (const file of files) {
  const rel = relative(cwd(), file);

  if (!scannedRoots.some((root) => rel.startsWith(root))) {
    continue;
  }

  if (allowedFragments.some((fragment) => rel.includes(fragment))) {
    continue;
  }

  const text = await readText(file);

  if (
    /["'`]Hulee["'`]/.test(text) ||
    /logo(?:Light|Dark)?\s*[:=]\s*["'`]/.test(text)
  ) {
    failures.push(rel);
  }
}

if (failures.length > 0) {
  console.error(
    "Hardcoded product name or logo path found in UI/app-shell code:"
  );
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("branding:check passed");
