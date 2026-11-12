/** CLI entry: `node dist/cli.cjs <command> ...` (or `npx tsx src/cli.ts` during development). */
import { run } from "./main.js";

async function main(): Promise<void> {
  const code = await run(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    fetch: (url, init) => fetch(url, init),
    cwd: process.cwd(),
  });
  process.exitCode = code;
}

void main();
