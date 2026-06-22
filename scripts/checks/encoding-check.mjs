import { cwd } from "node:process";

import { readText, walkFiles } from "./file-walk.mjs";

const mojibakePatterns = [
  new RegExp("\\u0420\\u045F"),
  new RegExp("\\u0420\\u0459"),
  new RegExp("\\u0420\\u00B5\\u0421"),
  new RegExp("\\u0421\\u040F"),
  /\?{3,}/
];
const files = await walkFiles(cwd(), {
  extensions: new Set([
    ".md",
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".json",
    ".yml",
    ".yaml"
  ])
});

const failures = [];

for (const file of files) {
  const text = await readText(file);

  if (mojibakePatterns.some((pattern) => pattern.test(text))) {
    failures.push(file);
  }
}

if (failures.length > 0) {
  console.error("Broken Cyrillic/mojibake patterns found:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("encoding:check passed");
