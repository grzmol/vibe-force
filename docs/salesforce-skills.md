# Salesforce-authored skills

The vibe-force marketplace lists eleven plugins published by Salesforce in
[`forcedotcom/sf-skills`](https://github.com/forcedotcom/sf-skills) alongside vibe-force itself.
They are **pointers, not copies**: the entries in `.claude-plugin/marketplace.json` reference the
upstream repository by path, Claude Code fetches them from Salesforce, and no upstream byte lives
in this repository.

## Why pointers and not a fork

Upstream states two different licences for the same tree:

| Artefact | Declared licence | Where |
| --- | --- | --- |
| The repository | Apache-2.0, (c) 2026 Salesforce, Inc. | `LICENSE.txt`, GitHub repository metadata |
| npm package `@salesforce/afv-skills`, which publishes exactly `skills/` | **CC-BY-NC-4.0** | `package.json` `"license"`, mirrored in `package-lock.json` |

CC-BY-NC-4.0 forbids commercial use. Until Salesforce resolves that contradiction, copying any of
that text into an MIT-licensed plugin would push the ambiguity onto every consumer of vibe-force.
Apache-2.0 alone would still forbid relicensing the copied files as MIT and would require carrying
the notice and a statement of changes per file.

Linking is not copying, so the marketplace entries carry none of that risk, and they track upstream
instead of drifting from it - upstream's own README warns that skills are renamed, restructured and
removed between releases.

Two consequences for contributors:

1. **Never paste upstream text into this repository**, including reference tables, scripts and
   example code. Skills here are written from official Salesforce documentation fetched while
   writing them, as `CLAUDE.md` already requires.
2. `scripts/dev/skill-originality.mjs` mechanically proves the separation - see
   [Originality gate](#originality-gate).

## What is listed, and why those

Upstream ships 228 skills. Loading all of them costs roughly 45k tokens of skill descriptions
before a session does any work; vibe-force's 29 skills cost about 6.8k. Bundling everything would
make the plugin unusable, so the marketplace lists only the eleven domain plugins that cover ground
vibe-force deliberately does not, and whose skill triggers do not collide with ours.

| Plugin | Covers | vibe-force counterpart |
| --- | --- | --- |
| `dx-devops` | DevOps Center pipelines, work items, test stages | none; wave 3 deploys through the Salesforce CLI |
| `integration` | Named Credentials, External Services, Connected and External Client Apps, CDC, platform event subscriptions | `sf-integration-patterns` covers the Apex side only |
| `platform-trust-security` | Shield Platform Encryption, Salesforce Archive | `sf-security-model`, `sf-org-security-audit` stop at CRUD/FLS and sharing |
| `platform-observability` | `EventSettings`, Agentforce platform tracing | `sf-debugging-logs` covers debug logs only |
| `platform-lightning-widgets` | Custom Lightning Types, Agentforce and MCP result widgets | none |
| `experience-react` | React UI bundles on Digital Experience sites | `sf-lwc-development` owns LWC, not React bundles |
| `experience-cms` | Experience Cloud CMS content and media | none |
| `mobile-development` | Mobile SDK apps, SmartStore, MobileSync | none |
| `service-engagement` | Messaging channels, digital engagement, Agentforce service channels | none |
| `commerce-b2b` | B2B Commerce Open Code storefront | none |
| `dx-isv-partner` | App Analytics, partner offers | `sf-packaging-release` stops at package creation |

### Deliberately not listed

| Upstream plugin | Reason |
| --- | --- |
| `salesforce-development` | 37 skills over Apex, metadata, deploy and security - the same ground as the vibe-force core. Two competing skill sets on one trigger produce coin-flip routing. It also ships its own MCP servers and an Apex language server. |
| `experience-lwc` | Overlaps `sf-lwc-development` and `sf-lwc-jest-testing`. |
| `dx-org-lifecycle` | Overlaps `sf-scratch-orgs-sandboxes` and `sf-cli-operations`. |
| `salesforce-test-drive` | A guided demo engine; `/vf-story` owns end-to-end orchestration here. |

Install them anyway if you want Salesforce's routing rather than ours - add the upstream
marketplace directly and disable the colliding vibe-force skills, or use a separate project:

```
/plugin marketplace add forcedotcom/sf-skills
/plugin install salesforce-development@salesforce
```

Agentforce and Data Cloud skills exist upstream only as loose skills, not as a bundled plugin, so
there is nothing to point at. vibe-force covers those with its own `sf-agentforce-development` and
`sf-data-cloud`.

## Install

```
/plugin marketplace add grzmol/vibe-force
/plugin install vibe-force@vibe-force
/plugin install integration@vibe-force
/plugin install dx-devops@vibe-force
```

One command per prompt. Install only the domains a project actually touches: every installed plugin
spends context on skill descriptions in every session.

To pin a plugin to an immutable upstream commit instead of `main`, add `"ref"` to its entry in
`.claude-plugin/marketplace.json`:

```json
{
  "name": "integration",
  "source": {
    "source": "github",
    "repo": "forcedotcom/sf-skills",
    "path": "plugins/builder/integration",
    "ref": "80e068df8b06cbba9fc1f11c800f3e9a299be787"
  }
}
```

## How agents route between the two sets

vibe-force keeps the workflow: waves, gates, hooks, path ownership. An upstream skill is a
domain expert called inside a wave, never a replacement for a gate.

| Situation | Owner |
| --- | --- |
| Which wave the work belongs to, who owns which path | vibe-force (`sf-workflow-orchestration`) |
| Writing Apex, LWC, metadata, tests | vibe-force build skills |
| Generating a Named Credential or an External Client App | `integration`, then the vibe-force gate runs over the generated metadata |
| Deploying, validating, verifying | vibe-force checks; upstream deploy advice does not bypass `deploy-validate` |
| Anything in a domain vibe-force has no skill for | upstream plugin |

Generated metadata is still metadata: it lands in an agent's owned slice, the `pre-edit-guard`
hook applies, and `vf-check local --changed` gates it like hand-written files. Full routing table:
`skills/sf-workflow-orchestration/references/external-skills.md`.

## Originality gate

```bash
# clone the upstream corpus once, anywhere outside this repository
git clone --depth 1 https://github.com/forcedotcom/sf-skills /tmp/sf-skills

node scripts/dev/skill-originality.mjs --corpus /tmp/sf-skills
```

The script shingles every `skills/**/*.md` in this repository into 8-word sequences and fails on
any sequence that also appears in the corpus, listing file, line and the offending text. Without
`--corpus` it reports `skipped` and exits 0, so it never blocks a contributor who has not cloned
upstream.

Exit codes match the `vf-check` contract: `0` pass, `1` shared sequences found, `2` corpus path
unusable.

## Upstream facts, as checked

| Fact | Value |
| --- | --- |
| Repository | `forcedotcom/sf-skills` |
| Commit inspected | `80e068d`, 2026-09-11 |
| Skills in `skills/` | 228 |
| Plugins in `plugins/builder/` | 15, listed in the upstream marketplace `salesforce` |
| Repository licence | Apache-2.0 |
| npm package licence | CC-BY-NC-4.0 |
