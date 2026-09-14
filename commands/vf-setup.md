---
description: Change Salesforce Setup when the Metadata API has no route for it - metadata-first gate, one single-use browser hand-off that never prints a credential, then SetupAuditTrail as evidence.
argument-hint: "[list|check|do|audit] [destination] [org]"
allowed-tools: Read, Grep, Glob, Bash(node:*), Bash(sf org display:*), Bash(sf org list:*), Bash(sf data query:*), Bash(sf project retrieve start:*), mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_type, mcp__playwright__browser_fill_form, mcp__playwright__browser_select_option, mcp__playwright__browser_wait_for, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_close
---

# vf-setup - Setup configuration with a deploy-first gate

Raw arguments: `$ARGUMENTS`

`SUB` = the first bare token, default `list`. `DEST` = a catalog key or a navigation path. `ALIAS` =
the org, or the `dev` entry in `<project>/.vibeforce/config.json` `orgs` when none was given. Always
pass `--target-org <ALIAS>` explicitly.

This command exists for the remainder: configuration with **no** Metadata API route. Everything the
API covers stays on the deploy path, because a click in Setup produces a change no branch contains.
Skill: `sf-setup-automation`.

## 0. Preconditions

| Check | How | Fail action |
| --- | --- | --- |
| Project initialised | `<project>/.vibeforce/config.json` exists | Continue read-only; say `/vf-init` is pending |
| Org reachable | `sf org display --target-org <ALIAS> --json` | Stop, report the auth error |
| Browser server present | `/mcp` lists `playwright` | Stop: say the browser tools are off and print the enable line from [docs/mcp.md](../docs/mcp.md) |

A production `ALIAS` is refused by the tool and by the MCP guard. There is no override inside this
command; `VF_ALLOW_PROD=1` plus an explicit alias is the user's decision to make in their shell.

## 1. `list`

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/vf-setup.js" list
```

Prints the destinations this project knows and the route each one takes: `deploy <Type>` (the
Metadata API owns it), `read-only`, or `browser`. Add a destination for the project by writing
`setup.destinations.<key>` into `.vibeforce/config.json` - never by guessing a node name.

## 2. `check` - the gate that decides whether a browser is allowed at all

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/vf-setup.js" check <DEST> --target-org <ALIAS>
```

The tool asks the org what it can deploy (`sf org list metadata-types`, cached 24 h, `--refresh` to
re-ask) and compares that with what the destination declares.

| Verdict | Exit | What you do |
| --- | --- | --- |
| `deploy` | 1 | **Stop.** Retrieve the type, edit the XML with `/vf-xml`, deploy with `/vf-deploy`. Report the type it named. |
| `browser` | 0 | Proceed to step 3 |
| `unknown` | 0 | State in one line what the change is and confirm against the [Metadata Coverage Report](https://developer.salesforce.com/docs/metadata-coverage) before proceeding |

The verdict is recorded in `.vibeforce/state/setup-gate.json`. The MCP guard reads that file: a
Setup URL with no gate record gets a note on every browser navigation.

## 3. `do` - one hand-off, then drive the page

Never navigate to a frontdoor URL. `sf org open --url-only` prints a security warning saying the URL
"will expose sensitive information that allows for subsequent activity using your current
authenticated session", and a tool argument is transcript. The guard denies it.

Run the hand-off in the background, because it stays alive until the browser spends it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/vf-setup.js" serve <DEST> --target-org <ALIAS> --ttl 180 --json
```

It prints `{"handoff": "http://127.0.0.1:<port>/vf-setup/<token>", ...}` and nothing secret. Then:

1. `browser_navigate` to the `handoff` URL. It redirects once; a second attempt fails by design.
2. `browser_snapshot`. Work from the accessibility tree, not from a screenshot.
3. `browser_click`, `browser_fill_form`, `browser_select_option` for the change. One field at a time,
   snapshot between steps - Lightning re-renders and invalidates refs.
4. `browser_take_screenshot` of the saved state. That file is the evidence for step 4.
5. `browser_close`.

If the hand-off expires unused the tool exits 1: a frontdoor URL was minted and never spent. Mint a
new one rather than reusing anything.

Classic Setup pages render inside an iframe; `browser_snapshot` shows the frame and refs resolve
inside it. Patterns and the waiting rules: `skills/sf-setup-automation/references/browser-loop.md`.

## 4. `audit` - the change is not done until the org says so

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/vf-setup.js" audit --target-org <ALIAS> --since 30m
```

Reads `SetupAuditTrail` - `Action`, `Section`, `Display`, `CreatedBy.Username`. Exit 1 means the org
recorded nothing in the window, which means the click did not take. Do not report success on a
screenshot alone.

Then close the loop on the source of truth: if the setting has any metadata representation at all,
`sf project retrieve start --metadata <Type> --target-org <ALIAS>` and commit the diff, so the next
org gets it from a deploy instead of a second manual session.

## 5. Report

| Field | Value |
| --- | --- |
| Destination / path | |
| Org | |
| Gate verdict | `browser` or `unknown` (a `deploy` verdict never reaches here) |
| Change made | field, old value, new value |
| SetupAuditTrail | `Action` + `Display` + timestamp |
| Screenshot | path under `.vibeforce/state/browser/` |
| Follow-up | retrieved metadata to commit, or "no metadata representation" |

## Guardrails

| Rule | Reason |
| --- | --- |
| Never print or paste a frontdoor, `sid`, `singleaccess` or `access_token` URL | It is equivalent to logging someone in as you; the MCP guard denies it |
| Never use `browser_evaluate` or `browser_run_code_unsafe` to make the change | Arbitrary script in a page holding an admin session, and it leaves no auditable action |
| Never reuse a hand-off URL | Frontdoor URLs are single-use; the server closes after one redirect |
| Never click what the org can deploy | `check` exits 1 for exactly that case |
| Never claim success without `SetupAuditTrail` | A saved-looking page is not a saved setting |
| Production is not a target | Sandbox first, then deploy; `VF_ALLOW_PROD=1` is the user's call, not the agent's |
