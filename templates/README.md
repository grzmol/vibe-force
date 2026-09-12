# Salesforce project scaffolding (vibe-force templates)

Files copied into a consumer Salesforce DX project by `/vf-init`. Everything here is starter
content: adjust org aliases, package directories and gates, then commit.

## What gets copied

| Template | Destination | Overwrite on re-init |
| --- | --- | --- |
| `sfdx-project.json` | `<project>/sfdx-project.json` | no, only when missing |
| `.forceignore` | `<project>/.forceignore` | no, only when missing |
| `package.json` | `<project>/package.json` | no, only when missing |
| `jest.config.js` | `<project>/jest.config.js` | no, only when missing |
| `.vibeforce/config.json` | `<project>/.vibeforce/config.json` | no, only when missing |
| `scripts/apex/smoke.apex` | `<project>/scripts/apex/smoke.apex` | no, only when missing |
| `.github/workflows/ci.yml` | `<project>/.github/workflows/ci.yml` | no, only when missing |

Lint, format and analyzer configuration stays in the plugin under `config/` and is referenced by
the check runner. Copy `config/eslint/eslint.config.mjs` and `config/prettier/.prettierrc` into the
project root when you want editor integration: ESLint and prettier resolve plugins relative to the
configuration file, so a config inside the plugin directory cannot load the project's
`node_modules`.

## First run

```bash
npm install
sf org login web --alias my-dev-org
node "$CLAUDE_PLUGIN_ROOT/scripts/checks/vf-check.mjs" local
node "$CLAUDE_PLUGIN_ROOT/scripts/checks/vf-check.mjs" apex --target-org my-dev-org
```

## Configuration you must edit

| File | Key | Why |
| --- | --- | --- |
| `sfdx-project.json` | `name` | replace `REPLACE_WITH_PROJECT_NAME` |
| `sfdx-project.json` | `sourceApiVersion` | must match `apiVersion` in `.vibeforce/config.json` (`67.0`) |
| `.vibeforce/config.json` | `orgs.*` | real org aliases; `REPLACE-dev` and friends are placeholders |
| `.vibeforce/config.json` | `productionAliases` | every alias that must be guarded |
| `.vibeforce/config.json` | `gates.*` | coverage floors and analyzer severity for this codebase |
| `.vibeforce/config.json` | `smoke.queries[]` | SOQL probes that prove your release landed |
| `scripts/apex/smoke.apex` | `requiredObjects` | objects and fields the release depends on |
| `.github/workflows/ci.yml` | secrets | `SF_JWT_KEY`, `SF_DEVHUB_USERNAME`, `SF_CONSUMER_KEY` |

## Ignore these paths in the consumer repository

Add to `.gitignore`:

```gitignore
.vibeforce/reports/
.vibeforce/state/
.sfdx/
.sf/
node_modules/
coverage/
```

`.vibeforce/config.json` is committed; reports and state are per-machine.

## Apex API version note

`sourceApiVersion` is `67.0`. At API version 67.0 and later Apex runs in user mode by default,
`WITH SECURITY_ENFORCED` is not allowed in an Apex SOQL query, and a class without a sharing
declaration behaves as `with sharing`. Write `WITH USER_MODE`, `as user` or `as system` explicitly.
See the Apex Developer Guide,
[Apex Security and Sharing Model](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_security_sharing_chapter.htm).
