import { readFile } from "node:fs/promises";

const supportedMajor = 6;
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const declaredVersion = packageJson.devDependencies?.typescript;
const declaredMajor = declaredVersion?.match(/\d+/)?.[0];

if (Number(declaredMajor) !== supportedMajor) {
  console.error(
    `Unsupported TypeScript range ${String(declaredVersion)}. ` +
      `Bonds currently requires TypeScript ${supportedMajor}.x because its compiler configuration and typescript-eslint integration are not compatible with TypeScript 7.`,
  );
  process.exit(1);
}
