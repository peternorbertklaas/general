#!/usr/bin/env node
/**
 * Entry-point tooling for the curated public surface (ADR-024 / N4-03 / N6-01).
 *
 *   node tools/gen-index.mjs [src/index.ts | src/internal.ts]
 *       Print the given entry file (default `src/index.ts`) with every
 *       `export * from "<module>"` line expanded into an explicit named export
 *       list (values first, then `type` exports) using the TypeScript compiler
 *       API. Lines that are already explicit are kept verbatim, so the script is
 *       idempotent on a curated file – the output is a starting point for
 *       curation: review it, then paste.
 *
 *   node tools/gen-index.mjs --check
 *       Verify the two entry points: every export of every module under `src`
 *       (non-test) must be reachable through exactly one of `src/index.ts`
 *       (public, SemVer) and `src/internal.ts` (`@deriva/pricing-core/internal`,
 *       no SemVer promise); no name may be exported by both; and every name the
 *       apps import from "@deriva/pricing-core" (`apps/(*)/src`, incl. tests)
 *       must be public. Prints the problems and exits 1 when there are any –
 *       `src/surface.test.ts` runs this as part of the test suite.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY_FILES = { public: "src/index.ts", internal: "src/internal.ts" };
const compilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
};

/** All `.ts` sources under `dir` (recursive) except tests and the entry files themselves. */
function moduleFiles(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...moduleFiles(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out.filter((p) => !Object.values(ENTRY_FILES).some((e) => resolve(root, e) === p));
}

/** Exported names of a source file: `{ values, types }` (aliases resolved to decide value vs type). */
function exportsOf(program, checker, file) {
  const sf = program.getSourceFile(file);
  if (!sf) throw new Error(`gen-index: source file ${file} not found`);
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  const values = [];
  const types = [];
  if (!moduleSymbol) return { values, types };
  for (const e of checker.getExportsOfModule(moduleSymbol)) {
    const s = e.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(e) : e;
    ((s.flags & ts.SymbolFlags.Value) === 0 ? types : values).push(e.name);
  }
  values.sort();
  types.sort();
  return { values, types };
}

/** Names imported from "@deriva/pricing-core" anywhere under `apps/(*)/src` (incl. tests); empty when no apps checkout. */
function appImports() {
  const appsDir = resolve(root, "../../apps");
  const imported = new Map();
  if (!existsSync(appsDir)) return imported;
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (f !== "node_modules" && f !== "dist") walk(p);
      } else if (/\.(ts|tsx|mts)$/.test(f)) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"@deriva\/pricing-core"/g)) {
          for (const raw of m[1].split(",")) {
            const name = raw
              .trim()
              .replace(/^type\s+/, "")
              .split(/\s+as\s+/)[0]
              .trim();
            if (name) imported.set(name, [...(imported.get(name) ?? []), relative(appsDir, p)]);
          }
        }
      }
    }
  };
  for (const app of readdirSync(appsDir)) {
    const src = join(appsDir, app, "src");
    if (existsSync(src) && statSync(src).isDirectory()) walk(src);
  }
  return imported;
}

function expand(entryRel) {
  const entryPath = resolve(root, entryRel);
  const lines = readFileSync(entryPath, "utf8").split("\n");
  const program = ts.createProgram([entryPath], compilerOptions);
  const checker = program.getTypeChecker();
  const out = [];
  for (const line of lines) {
    const m = /^export \* from "(.+)";$/.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const rel = m[1];
    const { values, types } = exportsOf(program, checker, resolve(root, "src", rel.replace(/\.js$/, ".ts")));
    out.push(`export { ${[...values, ...types.map((t) => `type ${t}`)].join(", ")} } from "${rel}";`);
  }
  process.stdout.write(out.join("\n"));
}

function check() {
  const entries = Object.fromEntries(Object.entries(ENTRY_FILES).map(([k, rel]) => [k, resolve(root, rel)]));
  const modules = moduleFiles(resolve(root, "src"));
  const program = ts.createProgram([...Object.values(entries), ...modules], compilerOptions);
  const checker = program.getTypeChecker();
  const names = (file) => {
    const { values, types } = exportsOf(program, checker, file);
    return new Set([...values, ...types]);
  };
  const pub = names(entries.public);
  const internal = names(entries.internal);
  const problems = [];
  for (const name of pub) if (internal.has(name)) problems.push(`exported by both entry points: ${name}`);
  for (const file of modules) {
    const { values, types } = exportsOf(program, checker, file);
    for (const name of [...values, ...types]) {
      if (!pub.has(name) && !internal.has(name)) problems.push(`not reachable from any entry point: ${name} (${relative(root, file)})`);
    }
  }
  const imported = appImports();
  for (const [name, where] of imported) {
    if (!pub.has(name)) problems.push(`imported by an app but not public: ${name} (${[...new Set(where)].join(", ")})`);
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  process.stdout.write(
    `OK: public ${pub.size} names, internal ${internal.size} names, ${modules.length} modules, ${imported.size} names imported by the apps\n`,
  );
}

const arg = process.argv[2];
if (arg === "--check") check();
else expand(arg ?? ENTRY_FILES.public);
