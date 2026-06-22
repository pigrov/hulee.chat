import { relative } from "node:path";
import { cwd } from "node:process";

import { readText, walkFiles } from "./file-walk.mjs";

const files = await walkFiles(cwd(), {
  extensions: new Set([".ts", ".tsx"])
});

const allowedPathFragments = [
  "packages\\i18n\\messages",
  "packages/i18n/messages",
  ".test.ts",
  ".test.tsx"
];

const failures = [];

for (const file of files) {
  const rel = relative(cwd(), file);

  if (allowedPathFragments.some((fragment) => rel.includes(fragment))) {
    continue;
  }

  const text = await readText(file);

  if (/[А-Яа-яЁё]/.test(text)) {
    failures.push(rel);
  }
}

if (failures.length > 0) {
  console.error("Hardcoded Cyrillic text found outside allowed locations:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("i18n:check passed");
