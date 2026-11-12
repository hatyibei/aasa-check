/**
 * GitHub Action entry. Reads INPUT_* env vars set by the runner,
 * runs `check`, writes the exit-code output, and exits with that code.
 */
import { appendFileSync } from "node:fs";
import { EXIT_CDN_MISMATCH, run } from "./main.js";

async function main(): Promise<void> {
  const domain = process.env.INPUT_DOMAIN ?? "";
  const testFile = process.env.INPUT_TEST_FILE || "links.test.yml";
  const aasaFile = process.env.INPUT_AASA_FILE ?? "";
  const noCdn = (process.env.INPUT_NO_CDN ?? "false").toLowerCase() === "true";

  const args = ["check", "--test-file", testFile];
  if (domain) args.push("--domain", domain);
  if (aasaFile) args.push("--aasa", aasaFile);
  if (noCdn) args.push("--no-cdn");

  const code = await run(args, {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    fetch: (url, init) => fetch(url, init),
    cwd: process.env.GITHUB_WORKSPACE || process.cwd(),
  });

  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `exit-code=${code}\n`);
  }

  if (code === EXIT_CDN_MISMATCH) {
    process.stdout.write("::warning::aasa-check: site AASA and Apple CDN AASA do not match (exit code 2)\n");
  }

  process.exit(code);
}

void main();
