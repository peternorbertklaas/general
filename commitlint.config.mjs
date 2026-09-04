// Commit-message lint (Review R8, N6-03a rest): Conventional Commits with the scopes CONTRIBUTING.md names.
// Runs in CI on the pushed range (`github.event.before..github.sha`) and on the PR range (`base.sha..head.sha`)
// – never on the whole history, whose round-4…7 subjects predate this rule – and locally via `pnpm lint:commits`
// (`COMMITLINT_FROM=<sha>` widens the range). No git hook is installed: the CI job is the gate.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // CONTRIBUTING.md: "Betreff ≤ 72 Zeichen" (config-conventional allows 100).
    "header-max-length": [2, "always", 72],
    // Subjects are German (CONTRIBUTING „Sprache“) and capitalise nouns (`feat(core): Kalender-Register …`);
    // config-conventional's lower-case-only subject rule is an English convention and is switched off.
    "subject-case": [0, "always", "sentence-case"],
    // `type(scope): summary` – the scope names the package or area; several scopes are joined with a comma
    // (`feat(core,api): …`). An empty scope stays allowed for repo-wide chores (`chore: …`).
    "scope-enum": [2, "always", ["core", "api", "web", "ci", "docs", "quality", "repo", "deps", "release", "product", "compliance", "research"]],
    // Programme commits carry long bodies with tables and URLs – no body/footer line-length limit.
    "body-max-line-length": [0, "always", Infinity],
    "footer-max-line-length": [0, "always", Infinity],
  },
};
