# Contributing to graph-context-kit

Thanks for your interest in improving graph-context-kit! This guide covers everything you need to make a contribution.

## Local setup

1. Install **Node.js 20+**. Docker is optional; you only need it for Neo4j integration tests.
2. Fork the repository and clone your fork:
   ```bash
   git clone https://github.com/<your-username>/claryer-graph-toolkit.git
   cd claryer-graph-toolkit
   npm install
   cp .env.example .env   # placeholders only; fill in your own values locally
   ```
3. Check that everything works:
   ```bash
   npm run check     # typecheck + lint + unit tests
   npm run example   # offline demo (in-memory graph + mock LLM)
   ```
4. Optional: run Neo4j locally for integration tests:
   ```bash
   docker compose --env-file .env -f docker/docker-compose.yml up -d
   npm run test:integration   # needs NEO4J_* in .env; uses ids prefixed "it-"
   ```

## Creating branches

Never commit directly to `main`. Create a branch from an up-to-date `main`, named after the change:

| Prefix | Use for | Example |
| --- | --- | --- |
| `feat/` | New functionality | `feat/anthropic-provider` |
| `fix/` | Bug fixes | `fix/context-budget-overflow` |
| `docs/` | Documentation only | `docs/graph-model-diagram` |
| `refactor/` | Code changes with no behavior change | `refactor/split-cypher-queries` |
| `test/` | Tests only | `test/neo4j-decision-topics` |
| `chore/` | Tooling, dependencies | `chore/bump-neo4j-driver` |

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, for example `feat: add Anthropic provider` or `fix: keep newest messages when trimming context`. Keep each commit focused on one change.

## Coding standards

- **TypeScript strict mode.** Avoid `any`. Export public types from `src/types` or the module that owns them, and re-export them from `src/index.ts`.
- **Match the existing style:** small modules, named exports, ESM `.js` import suffixes, and `import type` for type-only imports. ESLint enforces the basics.
- **Keep the public API small.** Add new capabilities through the existing interfaces (`GraphStore`, `LLMProvider`) where possible, rather than adding new options to the client.
- **Parameterize every Cypher query.** Never interpolate input into query strings.
- **Keep backends consistent.** A behavior change in one `GraphStore` must also be made in the other, and the integration test that compares them must still pass.
- **Never invent external APIs.** Integrations (such as N-ATLAS) must follow official, verifiable documentation. If documentation isn't available, ship a clearly marked template instead.
- **Never commit secrets,** real credentials, or real personal or conversation data. Fixtures and examples must be fictional.

## Testing

- Add or update tests for every behavior change. Tests live in `tests/` and use [Vitest](https://vitest.dev/).
- Unit tests must not need network access or a database. Use `InMemoryGraphStore`, `MockProvider`, a mocked `fetch`, or the fake driver in `tests/neo4jGraphStore.test.ts`.
- If you change Cypher, run `npm run test:integration` against a local Neo4j before opening the PR.
- `npm run check` must pass.

## Pull requests

1. Rebase your branch on the latest `main`.
2. Run `npm run check`, and also `npm run example` if you touched the client or the example.
3. Open a PR against `main` that explains:
   - **what** changed and **why**
   - how you tested it
   - any breaking changes to the public API
4. Update `README.md` if you change public behavior, configuration, or the graph model.
5. Keep PRs small and focused, since they are easier to review and merge. A maintainer will review your PR. Please respond to feedback by adding commits (don't force-push during review).

## Reporting issues

Use GitHub Issues.

- **Bugs:** include your Node.js version, your Neo4j version (if relevant), which LLM provider type you used, minimal steps or code to reproduce, the expected and actual behavior, and the full error message. **Remove any API keys, credentials, and real conversation data** before posting.
- **Feature requests:** describe the use case first, then the proposed API.
- **Security vulnerabilities:** please do **not** open a public issue. Contact the maintainers privately (for example, through GitHub's "Report a vulnerability" feature on the repository's Security tab).

## Code of conduct

Be respectful, constructive, and inclusive. We want everyone to feel welcome to contribute.
