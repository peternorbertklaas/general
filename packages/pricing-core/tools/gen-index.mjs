#!/usr/bin/env node
/**
 * Print `src/index.ts` with every `export * from "<module>"` line expanded into an
 * explicit named export list (values first, then `type` exports), using the
 * TypeScript compiler API (ADR-024 / N4-03: curated public surface instead of
 * wildcard re-exports). Lines that are already explicit are kept verbatim.
 *
 *   node tools/gen-index.mjs > /tmp/index.ts && diff src/index.ts /tmp/index.ts
 *
 * The output is a starting point for curation – review it, then paste.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = resolve(root, "src/index.ts");
const lines = readFileSync(indexPath, "utf8").split("\n");
const program = ts.createProgram([indexPath], {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
});
const checker = program.getTypeChecker();
const out = [];
for (const line of lines) {
  const m = /^export \* from "(.+)";$/.exec(line);
  if (!m) {
    out.push(line);
    continue;
  }
  const rel = m[1];
  const sf = program.getSourceFile(resolve(root, "src", rel.replace(/\.js$/, ".ts")));
  if (!sf) throw new Error(`gen-index: source file for ${rel} not found`);
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  const values = [];
  const types = [];
  for (const e of checker.getExportsOfModule(moduleSymbol)) {
    const s = e.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(e) : e;
    ((s.flags & ts.SymbolFlags.Value) === 0 ? types : values).push(e.name);
  }
  values.sort();
  types.sort();
  out.push(`export { ${[...values, ...types.map((t) => `type ${t}`)].join(", ")} } from "${rel}";`);
}
process.stdout.write(out.join("\n"));
