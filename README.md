<div align="center">

<img src="assets/logo.png" alt="VibeForce. Salesforce delivery harness for Claude Code." width="620">

<h1>Salesforce delivery harness for Claude Code</h1>

<p><b>Salesforce delivery, on rails.</b></p>

<p>VibeForce turns Claude into a Salesforce delivery team: parallel Apex, LWC, metadata and
integration agents, documentation-grounded skills, deterministic hooks, and check gates that refuse
to let broken work through - while reading metadata by selector instead of by the file, so the
context window goes to the work rather than to XML.</p>

<p>
<img alt="Claude Code plugin" src="https://img.shields.io/badge/Claude%20Code-plugin-5A4FCF">
<img alt="Salesforce CLI v2" src="https://img.shields.io/badge/Salesforce%20CLI-v2-00A1E0">
<img alt="Node 20+" src="https://img.shields.io/badge/Node-20%2B-3C873A">
<img alt="Zero dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen">
<img alt="MIT" src="https://img.shields.io/badge/license-MIT-black">
</p>

</div>

---

## What you get

Asking an assistant for "a trigger and a test" gets you code. It does not get you a feature that
survives a deploy, and it spends your context window on XML nobody reads.

- **A feature, not a snippet.** Apex, LWC, metadata and integration agents build at the same time
  over disjoint paths. A hook denies any write outside an agent's slice, so they cannot collide.
- **Broken work cannot ship.** Format, lint, Code Analyzer, Jest, Apex coverage and deploy
  validation are exit codes, not reminders. The session cannot end while the local gate is red.
- **Production is protected mechanically.** Direct deploys to a production alias, destructive
  operations on production and secrets on the command line are blocked - over Bash and over MCP.
- **A green deploy is not the finish line.** After the deploy, agents probe the real org: smoke
  Apex, verification queries, limits, fresh error logs.
- **~19x less context spent reading metadata.** `vf-xml` indexes a metadata file by byte range, so
  a story reads an outline plus the single node it edits: the permission set that costs 12 386
  tokens as a whole file costs 260. Method and measurements:
  [`xml-token-economy.md`](skills/sf-project-structure/references/xml-token-economy.md).

## Install

```
/plugin marketplace add grzmol/vibe-force
/plugin install vibe-force@vibe-force
```

Send the two lines as separate prompts, then restart the session.

You need Node 20+, Salesforce CLI v2 (`sf`) and git. Full list, local checkout instructions and
project dev dependencies: [docs/installation.md](docs/installation.md).

## Quick start

```
/vf-init                                  # set the project up, discover org aliases
/vf-story "Add renewal reminders to Opportunity"
```

`/vf-story` runs the whole thing:

```
scout -> design -> contract -> parallel build -> parallel checks -> validate + quick deploy -> org verification
wave 0                        wave 1            wave 2             wave 3                     wave 4
```

You stay in control: the contract is shown before any code is written, and the deploy asks before
it touches a shared org.

## Commands

| Command | What it does |
| --- | --- |
| `/vf-init` | Sets a project up: `sfdx-project.json`, `.forceignore`, Jest config, org aliases, npm scripts |
| `/vf-story "<story>"` | The full five-wave workflow, from impact map to verified deploy |
| `/vf-check [check]` | Runs one gate and turns the findings into a minimal fix set |
| `/vf-deploy [org]` | Safe deploy: local gate, validation, your confirmation, quick deploy |
| `/vf-verify [org]` | Post-deploy verification, plus a forward-fix or rollback recommendation |
| `/vf-review [base]` | Parallel quality and security review of a diff, deduplicated |
| `/vf-org [sub]` | Org context: list, use, limits, open, login, health |
| `/vf-xml [sub]` | Reads and patches metadata XML by selector instead of loading whole files |
| `/vf-migrate-workflow` | Classifies workflow rules and converts the mechanical ones to before-save flows |
| `/vf-migrate-process` | Classifies Process Builder criteria nodes and converts the mechanical ones to before-save flows |
| `/vf-setup [sub]` | Setup changes with no metadata route: deploy-first gate, one single-use browser hand-off, SetupAuditTrail proof |

## What ships inside

| | |
| --- | --- |
| **12 agents** | An orchestrator, a scout, a technical architect, four build engineers on disjoint paths, test, quality, security, deploy and org-verification specialists |
| **34 skills** | Apex, async Apex, governor limits, SOQL/SOSL, LWC, Jest, Flow, Process Builder migration, security model, deployment, packaging, data, debugging, verification, org security audit, technical debt audit, Setup automation, UI test automation, Agentforce and Data Cloud - plus five on fflib / Apex Enterprise Patterns |
| **13 checks** | One runner, one contract: `format`, `lint`, `analyzer`, `pairing`, `jest`, `static`, `local`, `apex`, `deploy-validate`, `deploy-quick`, `smoke`, `verify`, `all` |
| **8 hooks** | Session context, Bash guard, edit guard, MCP guard, post-edit checks, claim release, stop gate, compaction notes |
| **3 metadata tools** | `vf-xml` reads and patches metadata XML by byte range; `vf-workflow-to-flow` and `vf-process-to-flow` convert the workflow rules and processes they can convert and report the rest |
| **1 Setup tool** | `vf-setup` gates a Setup change on the org's own `describeMetadata`, hands a browser one single-use session instead of a credential, and reads `SetupAuditTrail` back as proof |

Every skill is grounded in official Salesforce documentation and ships reference tables, not just
prose. Nothing invents a limit, a flag or a rule id.

The same marketplace links eleven plugins published by Salesforce in
[`forcedotcom/sf-skills`](https://github.com/forcedotcom/sf-skills) - DevOps Center, integration
metadata, Shield, tracing, Lightning Types, Mobile SDK, B2B Commerce and more - covering the domains
vibe-force deliberately leaves alone. They are links, not copies: Claude Code fetches them from
Salesforce, and no upstream text lives here. Routing table and pinning:
[docs/salesforce-skills.md](docs/salesforce-skills.md).

## The checks

The same runner is used by agents, hooks, you, and CI:

| Check | Needs an org | What it runs |
| --- | --- | --- |
| `format` | no | `prettier --check` on Apex, LWC, XML, JS |
| `lint` | no | `eslint` on LWC and Aura JavaScript |
| `analyzer` | no | `sf code-analyzer run`, fails at `gates.analyzerFailSeverity` |
| `pairing` | no | every Apex class has a test, every LWC bundle a Jest spec |
| `jest` | no | `sfdx-lwc-jest` plus the `gates.jestCoverageMin` gate |
| `static` | no | format + lint + analyzer + pairing |
| `local` | no | static + jest - the full offline gate |
| `apex` | yes | `sf apex run test` plus the coverage gates |
| `deploy-validate` | yes | check-only deploy; records the quick-deploy job id |
| `deploy-quick` | yes | deploys a previously validated job id |
| `smoke` | yes | post-deploy probes: anonymous Apex, SOQL, limits, logs |
| `verify` | yes | apex + smoke |
| `all` | yes | local + apex + smoke |

`vf-check --help` prints the same list from the runner itself.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local --changed
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" apex --target-org acme-dev
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" verify --target-org acme-uat
```

Exit codes: `0` pass, `1` gate failed, `2` misconfiguration or missing tool, `3` org error.
Every run writes a JSON report to `.vibeforce/reports/`.

Missing a tool is not fatal. A check that cannot find its tool reports `skipped` with an install
hint, so you can adopt the plugin before you adopt every linter.

## Safety rails

| Blocked | Instead |
| --- | --- |
| `sf project deploy start` to a production alias | Validate, then quick deploy the recorded job id |
| Deleting production data or metadata | Explicit override with `VF_ALLOW_PROD=1` |
| Retired `sfdx force:*` syntax | `sf` v2 with an explicit `--target-org` |
| `--no-verify`, force push to a protected branch | Fix the gate |
| Credentials passed on the command line | Auth files and environment variables |
| Writes outside an agent's slice, or to a file another agent holds | Wait for the wave, or ask the owner |
| `deploy_metadata` to production over MCP, `delete_org` on a production alias | The same validate + quick-deploy path; MCP tools do not get a side door ([docs/mcp.md](docs/mcp.md)) |

Four modes - `off`, `minimal`, `standard` (default), `strict`. Per-shell overrides:
`VF_HOOK_MODE`, `VF_ALLOW_PROD=1`, `VF_SKIP_CHECKS=1`, `VF_DEBUG=1`.

## MCP

The plugin ships the official Salesforce DX MCP server (`@salesforce/mcp`), scoped to your default
org and to read-and-analyse toolsets. Deploy tools are off by default, so deploys stay on the gated
CLI path, and the MCP guard denies over MCP what the Bash guard denies in a shell.

```bash
export VF_MCP_TOOLSETS="core,data,metadata,testing"   # opt into deploy and retrieve
export VF_MCP_ORGS="acme-dev,acme-uat"                # pin to explicit aliases
```

Rules, tool table and verification: [docs/mcp.md](docs/mcp.md).

## Setup and browser tests

Some org configuration has no Metadata API route at all. `/vf-setup` covers that remainder without
letting it become drift: it asks the org what it can deploy and refuses the browser when a deploy
route exists, hands the browser one single-use loopback redirect instead of a frontdoor URL, and
reads `SetupAuditTrail` back as proof.

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-setup.js" check <dest> --target-org acme-dev   # exit 1: deploy it instead
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-setup.js" audit --target-org acme-dev --since 30m
```

> **Needs Playwright.** The browser tools come from Microsoft's Playwright MCP server, which Claude
> Code runs through `npx` in your environment. It uses the Chrome you already have; if you would
> rather it used its own Chromium, install the browser once with
> `npx playwright install chromium` and set `VF_BROWSER=chromium`. The server adds browser tools to
> every session - turn it off with `/mcp` when you are not configuring an org.

Committed UI tests are a different tier and a different skill: UTAM plus WebdriverIO with
Salesforce's own page objects, in `sf-ui-test-automation`.

## Configure

Defaults work out of the box. To tune, edit `.vibeforce/config.json` in your Salesforce project:

```json
{
  "apiVersion": "67.0",
  "orgs": { "dev": "acme-dev", "uat": "acme-uat", "prod": "acme-prod" },
  "productionAliases": ["acme-prod"],
  "gates": {
    "apexOrgCoverageMin": 85,
    "apexClassCoverageMin": 75,
    "jestCoverageMin": 80,
    "analyzerFailSeverity": 3
  },
  "hooks": { "mode": "standard", "stopGate": "static", "autoFormat": true }
}
```

Every key, with defaults and effects: [docs/configuration.md](docs/configuration.md).

## Docs

| | |
| --- | --- |
| [Installation](docs/installation.md) | Prerequisites, marketplace and local install, project setup |
| [Configuration](docs/configuration.md) | Config reference, gates, hook modes, environment overrides |
| [Architecture](docs/architecture.md) | Waves, path ownership, hook and check internals |
| [Salesforce-authored skills](docs/salesforce-skills.md) | The Salesforce plugins this marketplace links, what they cover, why nothing is copied |
| [MCP](docs/mcp.md) | The bundled Salesforce DX MCP server, its scope, and the guard over its tools |

## Contributing

```bash
node --test tests/                  # hook engine suite
node scripts/checks/vf-check.mjs --help
claude plugin validate .            # manifest, agents, skills, commands
node scripts/dev/skill-originality.mjs --corpus /tmp/sf-skills   # no copied external prose
```

The plugin has no npm dependencies and uses Node builtins only. Hooks fail open: a broken handler
never wedges a session. A new guard rule needs a test that fails without it.

## License

MIT
