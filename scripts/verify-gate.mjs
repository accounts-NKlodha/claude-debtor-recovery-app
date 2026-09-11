#!/usr/bin/env node
/**
 * Stop-hook verification gate. Runs typecheck + lint + test + build and blocks
 * session handoff on any failure (exit 2 => Claude Code treats it as blocking).
 * Skips gracefully if node_modules is missing (fresh clone).
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync("node_modules")) {
  console.error("verify-gate: node_modules missing — run `npm install` first.");
  process.exit(0);
}

const steps = [
  ["typecheck", "npm run -s typecheck"],
  ["lint", "npm run -s lint"],
  ["test", "npm run -s test"],
  ["build", "npm run -s build"],
];

const failed = [];
for (const [name, cmd] of steps) {
  process.stderr.write(`verify-gate: ${name}... `);
  try {
    execSync(cmd, { stdio: ["ignore", "ignore", "pipe"] });
    process.stderr.write("ok\n");
  } catch (e) {
    process.stderr.write("FAIL\n");
    const tail = String(e.stderr ?? e.stdout ?? e.message).split("\n").slice(-25).join("\n");
    failed.push(`### ${name}\n${tail}`);
  }
}

if (failed.length) {
  console.error(
    `\nBLOCKED: verification gate failed (${failed.map((f) => f.split("\n")[0].replace("### ", "")).join(", ")}).\n\n` +
      failed.join("\n\n") +
      "\n\nFix these before handing off.",
  );
  process.exit(2);
}
console.error("verify-gate: all checks passed.");
process.exit(0);
