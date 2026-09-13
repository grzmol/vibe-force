# External Salesforce skills inside the wave model

The vibe-force marketplace also lists eleven plugins published by Salesforce in
`forcedotcom/sf-skills`. They are optional, they are fetched from Salesforce rather than vendored
here, and they change nothing about how a story runs. Installation, licensing and the full
selection rationale: `docs/salesforce-skills.md`.

This reference answers one question: when an external plugin is installed, who decides what.

## The rule

**vibe-force owns the workflow. An external plugin is a domain expert called inside a wave.**

| Concern | Owner | Never overridden by |
| --- | --- | --- |
| Wave membership, dispatch batching | `sf-orchestrator` | any external skill |
| Path ownership and collision denial | `pre-edit-guard`, `scripts/lib/sf-paths.js` | any external skill |
| Local gate, org gate, validation gate, verification gate | `vf-check` | an external skill's own "deploy now" step |
| Production safety | `pre-bash-guard` | an external skill's deploy command |
| Domain knowledge vibe-force has no skill for | external plugin | - |

An external skill that proposes `sf project deploy start` against a production alias is denied by
the hook exactly like a hand-typed command. An external skill that proposes retired `sfdx force:*`
syntax is denied too. Neither is a special case; the guards do not know where a command came from.

## Wave placement

| Plugin | Wave | Called by | Produces | Gated by |
| --- | --- | --- | --- | --- |
| `integration` | 1 | `sf-integration-engineer` | `namedCredentials/`, `externalCredentials/`, `externalServiceRegistrations/`, `externalClientApps/`, `platformEventChannels/` | `vf-check static --changed`, then wave 2 |
| `platform-trust-security` | 0 or 1 | `sf-security-reviewer` (advice), `sf-metadata-engineer` (edits) | encrypted field settings, archive configuration | `vf-check local --changed` |
| `platform-lightning-widgets` | 1 | `sf-lwc-engineer` | `lwc/`, Lightning Type bundles | `vf-check jest --files ...` |
| `experience-react` | 1 | `sf-lwc-engineer` | `uiBundles/**` | its own toolchain; see "Unowned paths" |
| `experience-cms` | 1 or 4 | `sf-metadata-engineer` | CMS content, media | org-side, verified in wave 4 |
| `service-engagement` | 1 | `sf-metadata-engineer` | messaging channel and deployment metadata | `vf-check local --changed` |
| `mobile-development` | outside | a separate session | a mobile app repository | not a Salesforce metadata gate |
| `commerce-b2b` | 1 | `sf-lwc-engineer` | storefront site metadata | `vf-check local --changed` |
| `dx-devops` | 3 | human or `sf-deploy-engineer` | DevOps Center pipeline state | see "Two deploy paths" |
| `platform-observability` | 1 | `sf-metadata-engineer` | `settings/` | `vf-check local --changed` |
| `dx-isv-partner` | 4 or outside | `sf-org-verifier` | analytics query requests | read-only |

The pattern is always the same: **an external skill generates or advises, a vibe-force agent owns
the resulting files, and a vibe-force gate decides whether they ship.**

## Generated metadata is still metadata

Nothing changes because a file was produced by an external skill:

1. It lands in a wave-1 agent's owned slice and is claimed in `.vibeforce/state/ownership.json`.
2. `post-edit-check` classifies it and runs the relevant narrow check.
3. It goes through `vf-check local --changed` in wave 2 like every hand-written file.
4. It is deployed through validate + quick deploy in wave 3, never directly.

A generated Named Credential with a hard-coded secret is caught by the `pre-edit-guard` secret
patterns. A generated Apex action without CRUD/FLS enforcement is caught by `sf-security-reviewer`
and by `vf-check analyzer`. Provenance buys no exemption.

## Unowned paths

`scripts/lib/sf-paths.js` classifies four slices: `apex`, `lwc`, `metadata`, `integration`. Paths
outside them - `uiBundles/**` from `experience-react`, a mobile app tree, CMS content - classify as
`slice: null`, which means **no agent owns them and the collision guard has nothing to enforce**.

Rules for those paths:

| Situation | Do |
| --- | --- |
| One agent touches the tree | assign it explicitly in the wave-0 contract under `## Ownership` |
| Two agents would touch it | serialise: one owner, the other reads |
| The tree becomes a routine part of delivery | add a slice to `SLICES`, a test in `tests/hooks.test.mjs`, and a row in `references/ownership-matrix.md` - all three, in one change |

Do not assume an unowned path is safe to share because the hook stays quiet there.

## Two deploy paths

`dx-devops` drives DevOps Center: work items, pipeline stages, promotions through the Salesforce
UI and its API. vibe-force wave 3 drives the Salesforce CLI: `deploy-validate` records a job id in
`.vibeforce/state/deploy-jobs.json`, `deploy-quick` deploys it.

Pick one per project and write the choice into the wave-0 contract. Mixing them per story loses
the only property both give you - a single auditable path from source to org:

| If the project's source of truth is | Then |
| --- | --- |
| Git plus the Salesforce CLI | vibe-force wave 3; `dx-devops` for reading pipeline state only |
| DevOps Center work items | `dx-devops` for promotion; keep `vf-check local` and `vf-check verify` as the quality gates around it |

In both cases wave 2 and wave 4 are unchanged: the local gate still has to pass before promotion,
and the org still has to be verified after it.

## Trigger collisions

Two skill sets answering the same request route by coin flip. The marketplace therefore omits the
upstream plugins that overlap the vibe-force core (`salesforce-development`, `experience-lwc`,
`dx-org-lifecycle`, `salesforce-test-drive`); `docs/salesforce-skills.md` lists the reason per
plugin and how to install them anyway.

If a project does install an overlapping plugin, resolve it in the wave-0 contract, not per turn:

```markdown
## Skill routing
- Apex, LWC, tests, deploy: vibe-force skills only.
- Named Credentials and External Services metadata: plugin `integration`.
- Anything Mobile SDK: plugin `mobile-development`, separate session.
```

## Domains vibe-force covers itself

No external plugin exists for these upstream, and vibe-force ships its own skill:

| Domain | Skill |
| --- | --- |
| Agentforce agents, actions, agent testing | `sf-agentforce-development` |
| Data Cloud modelling, ingestion, querying | `sf-data-cloud` |

## The copying boundary

Upstream is Apache-2.0 in `LICENSE.txt` and CC-BY-NC-4.0 in the npm package that publishes the same
`skills/` tree. vibe-force therefore links and never copies. Skills in this repository are written
from official Salesforce documentation fetched while writing them.

```bash
git clone --depth 1 https://github.com/forcedotcom/sf-skills /tmp/sf-skills
node scripts/dev/skill-originality.mjs --corpus /tmp/sf-skills
```

Exit 1 with a file, a line and the shared text means text was copied, whatever the intent. Fix by
rewriting from the documentation, not by extending the allowlist: `scripts/dev/originality-allow.txt`
holds reviewed facts only - published limits, enumerations, official document titles.

## Verification

```bash
# the marketplace still resolves after editing its entries
claude plugin validate .
jq -r '.plugins[] | "\(.name)\t\(.source | if type == "string" then . else .repo + "/" + .path end)"' .claude-plugin/marketplace.json

# an external skill did not smuggle a retired command past the guard
echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"sfdx force:source:deploy -p force-app"}}' \
  | node scripts/hooks/pre-bash-guard.js | jq -r '.hookSpecificOutput.permissionDecision'
# -> deny

# generated metadata is owned and gated like any other file
node scripts/checks/vf-check.mjs static --changed
```
