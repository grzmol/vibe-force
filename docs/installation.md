# Installation

## Prerequisites

| Requirement | Why | Check |
| --- | --- | --- |
| Node.js >= 20 | Hook handlers and the check runner are Node scripts | `node -v` |
| Node on the non-interactive PATH | Hooks are spawned without a login shell (relevant for nvm and Nix users) | `env -i "$HOME/.local/bin/node" -v` or `bash -lc 'which node'` vs `bash -c 'which node'` |
| Salesforce CLI v2 | Every org operation | `sf --version` |
| Git | Change detection for `--changed` | `git --version` |
| jq (optional) | The command bodies and docs use it to read `--json` output | `jq --version` |

Project-side dev dependencies for the full local gate:

```bash
npm i -D prettier prettier-plugin-apex eslint @salesforce/eslint-config-lwc @lwc/eslint-plugin-lwc @salesforce/sfdx-lwc-jest
sf plugins install code-analyzer
```

Missing tools are not fatal: a check that cannot find its tool reports `status: skipped` with an
install hint, and exits 2 only when that check was requested explicitly.

## Install the plugin

### From the marketplace

```
/plugin marketplace add grzmol/vibe-force
/plugin install vibe-force@vibe-force
```

Send the two commands as separate prompts. Restart the session afterwards so the `SessionStart`
hook and the agent definitions load.

### From a local checkout

```bash
git clone https://github.com/grzmol/vibe-force ~/src/vibe-force
```

```
/plugin marketplace add ~/src/vibe-force
/plugin install vibe-force@vibe-force
```

Useful while developing the plugin: `claude plugin validate ~/src/vibe-force` reports manifest,
agent and skill problems, and `/reload-plugins` picks up changes without a restart (hook
*configuration* changes still need a restart; handler script changes do not).

## Initialise a Salesforce project

```
/vf-init
```

What it does:

1. Detects `sfdx-project.json`, or scaffolds a project when there is none.
2. Copies missing scaffolding from `templates/`: `.forceignore`, `jest.config.js`, prettier and
   eslint config, `scripts/apex/smoke.apex`, CI workflow. Existing files are diffed, never
   overwritten silently.
3. Writes `.vibeforce/config.json` from the template, filling org aliases from
   `sf org list --json` and marking production aliases.
4. Adds `.vibeforce/state/` and `.vibeforce/reports/` to `.gitignore`.
5. Appends npm scripts (`test:unit`, `lint`, `format`, `vf:local`, `vf:verify`).
6. Prints the resulting gate configuration and the next command.

Commit `.vibeforce/config.json`; keep `.vibeforce/state/` and `.vibeforce/reports/` out of git.

## Authenticate the orgs

```bash
sf org login web --alias acme-dev --set-default
sf org login web --alias acme-uat
sf org login web --alias acme-prod            # production: alias must be listed in productionAliases
sf org list --json | jq -r '.result.nonScratchOrgs[] | "\(.alias)\t\(.instanceUrl)"'
```

For CI, use JWT with a key that never enters the repository (skill `sf-cli-operations`,
`references/auth-and-ci.md`). The `pre-bash-guard` hook denies writing an sfdx auth URL file
into the working tree and prompts on credentials passed as command-line flags.

## Verify the installation

```bash
# hooks respond to a synthetic event
echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"sfdx force:source:deploy -p force-app"}}' \
  | node "$(claude plugin path vibe-force 2>/dev/null || echo ~/src/vibe-force)/scripts/hooks/pre-bash-guard.js" | jq -r '.hookSpecificOutput.permissionDecision'
# -> deny

# the runner is reachable and the check table renders
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" --help

# the local gate runs in the project
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local --changed
```

In a session, `/vf-org show` should print the default org, and the `SessionStart` context block
should list your package directories, api version and gate thresholds.

## CI wiring

`templates/.github/workflows/ci.yml` ships two jobs:

| Job | Runs | Needs an org |
| --- | --- | --- |
| `local-gate` | `npm ci`, `vf-check local --json` | no |
| `org-gate` | JWT auth, scratch org create, source push, `vf-check apex`, `vf-check deploy-validate`, scratch org delete | yes |

Upload `.vibeforce/reports/*.json` as build artefacts: they are the machine-readable record of
why a gate failed.

## Uninstall

```
/plugin uninstall vibe-force@vibe-force
```

Nothing is left behind in the project except `.vibeforce/`, which can be deleted. No org state
is ever modified by installing or removing the plugin.
