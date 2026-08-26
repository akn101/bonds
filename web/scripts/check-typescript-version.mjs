import { readFile } from "node:fs/promises";

const supportedMajor = 7;
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const declaredVersion = packageJson.devDependencies?.["@typescript/native"];
const declaredMajor = declaredVersion?.match(/\d+/)?.[0];

if (Number(declaredMajor) !== supportedMajor) {
  console.error(
    `Unsupported TypeScript compiler range ${String(declaredVersion)}. ` +
      `Bonds currently requires TypeScript ${supportedMajor}.x.`,
  );
  process.exit(1);
}
