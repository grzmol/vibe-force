# MCP

vibe-force ships two MCP servers: the official [Salesforce DX MCP Server](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_mcp.htm)
(`@salesforce/mcp`, Apache-2.0, published by Salesforce) for org work, and Microsoft's
[Playwright MCP Server](https://github.com/microsoft/playwright-mcp) (`@playwright/mcp`) for the
Setup pages no Metadata API type covers. Both are guarded by the same rules that guard the shell.

## What is enabled

`.mcp.json` in the plugin root:

```json
{
  "mcpServers": {
    "salesforce-dx": {
      "command": "npx",
      "args": [
        "-y", "@salesforce/mcp",
        "--orgs", "${VF_MCP_ORGS:-DEFAULT_TARGET_ORG}",
        "--toolsets", "${VF_MCP_TOOLSETS:-core,data,code-analysis,testing}",
        "--no-telemetry"
      ]
    }
  }
}
```

| Choice | Why |
| --- | --- |
| `--orgs DEFAULT_TARGET_ORG` | The server may reach only the org the project already defaults to. `ALLOW_ALL_ORGS` hands every authorised org, production included, to the model. |
| `--toolsets core,data,code-analysis,testing` | Read and analyse. The `metadata` toolset - `deploy_metadata`, `retrieve_metadata` - is **off by default**, so deploys stay on the gated CLI path. |
| `--no-telemetry` | The server reports usage to Salesforce by default. Remove the flag to opt back in. |
| No `--allow-non-ga-tools` | Non-GA tools change without notice; a gate built on them is not deterministic. |

Tune per shell, no file edit needed:

```bash
export VF_MCP_TOOLSETS="core,data,metadata,testing"   # opt into deploy and retrieve tools
export VF_MCP_ORGS="acme-dev,acme-uat"                # pin to explicit aliases
```

Turn either server off entirely with `/mcp` in a session, or by disabling the plugin.

The DX server needs `npx` and a locally authorised org (`sf org login web`).

### The browser server

`/vf-setup` needs a browser, and only for the Setup pages no metadata type covers:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "-y", "@playwright/mcp@latest",
        "--headless",
        "--isolated",
        "--browser", "${VF_BROWSER:-chrome}",
        "--output-dir", ".vibeforce/state/browser",
        "--timeout-navigation", "90000",
        "--viewport-size", "1440x900"
      ]
    }
  }
}
```

| Choice | Why |
| --- | --- |
| `--isolated` | The profile lives in memory, so a Salesforce session dies with the browser instead of persisting on disk. |
| `--browser ${VF_BROWSER:-chrome}` | Uses the Chrome the user already has, so nothing is downloaded. `VF_BROWSER=chromium` after `npx playwright install chromium` switches to Playwright's own build. |
| `--headless` | A session is not a desk. Screenshots are the evidence, not a visible window. |
| `--output-dir .vibeforce/state/browser` | Screenshots and traces land with the rest of the session state, inside the project. |
| `--timeout-navigation 90000` | Lightning Setup pages routinely take longer than the 60 s default to settle. |
| No `--allow-unrestricted-file-access` | That flag lifts the workspace-root restriction on file reads. The hand-off is a loopback redirect instead, minted by `vf-setup serve`. |

The browser server contributes 24 tools to a session at default capabilities - the largest single
context cost in the plugin. Turn it off with `/mcp` when the work is not org configuration.

`npx` fetches both servers in the user's environment, never inside a check: the plugin's own hooks
and checks stay dependency-free Node.

## Why the tools are guarded

An MCP server talks to the org directly. Nothing about it goes through Bash, so `pre-bash-guard`
never sees it: with the `metadata` toolset enabled, `deploy_metadata` would push to production
without a validated job id, and `retrieve_metadata` would overwrite files without passing the edit
guard that enforces wave-1 path ownership.

`pre-mcp-guard` (matcher `mcp__.*`, rules in `scripts/lib/mcp-guards.js`) closes both:

| Rule | Tool | Decision |
| --- | --- | --- |
| `mcp-prod-deploy` | `deploy_metadata` naming a production alias | **deny** - use `vf-check deploy-validate` then `deploy-quick`; `VF_ALLOW_PROD=1` downgrades it to a prompt |
| `mcp-deploy-bypasses-gate` | `deploy_metadata` to any other org with no passing local gate this session | note: run `vf-check local --changed` first |
| `mcp-retrieve-ignores-ownership` | `retrieve_metadata` | note: it writes files without the edit guard; retrieve between waves |
| `mcp-prod-mutation` | `assign_permission_set`, `create_org_snapshot`, `enrich_metadata` on production | ask |
| `mcp-prod-org-delete` | `delete_org`, any `*_delete_*` / `*_destroy_*` tool on production | **deny** |
| `mcp-prod-test-run` | `run_apex_test`, `run_agent_test` on production | ask |
| `browser-credential-url` | any `browser_*` carrying a `sid`, frontdoor, `singleaccess` or `access_token` URL | **deny** - use `vf-setup serve`, which never prints the credential |
| `browser-prod-target` | any `browser_*` naming a production alias | **deny**; `ask` when `VF_ALLOW_PROD=1` relaxes the block |
| `browser-setup-ungated` | a `lightning/setup/` URL on an org host with no matching record in `.vibeforce/state/setup-gate.json` | note: run `vf-setup check` first |
| `browser-page-script` | `browser_run_code_unsafe`, or `browser_evaluate` while a Setup gate record is live | ask |

The production alias is matched against every string in the tool arguments, at any nesting depth,
rather than one argument name: tool schemas differ per tool and change between releases.

Setup gate records come from `vf-setup check`: the rule reads them, never writes them, and an
unreadable file is an empty list, so a browser call is annotated rather than blocked.

Read-only tools - `run_soql_query`, `list_all_orgs`, `get_username`, `browser_snapshot`, the Code
Analyzer and LWC guidance tools - pass untouched.

`hooks.mode` applies as everywhere else: `off` disables the guard, `minimal` keeps the denials and
drops the notes, `standard` and `strict` run all of it.

## How agents should use it

MCP tools are for reading and analysing while work is in flight; the gates stay on `vf-check`.

| Task | Use |
| --- | --- |
| Inspect org data mid-story | `run_soql_query` |
| Explain a Code Analyzer rule, filter a results file | `describe_code_analyzer_rule`, `query_code_analyzer_results` |
| Decide the gate verdict | `vf-check analyzer`, never the MCP scan on its own - the gate's severity threshold lives in `.vibeforce/config.json` |
| Run the test gate | `vf-check apex --target-org <alias>`, which applies the coverage thresholds; `run_apex_test` reports but gates nothing |
| Deploy | wave 3: `vf-check deploy-validate` then `vf-check deploy-quick` |
| Configure a Setup page no metadata type covers | `/vf-setup`: `vf-setup check` first, then the browser tools on a `vf-setup serve` hand-off |

A check writes a JSON report to `.vibeforce/reports/` and returns an exit code. An MCP tool returns
prose to the model. Anything that decides whether work ships must be the former.

## Verify

```bash
# the guard denies a production deploy over MCP
echo '{"hook_event_name":"PreToolUse","tool_name":"mcp__salesforce-dx__deploy_metadata",
       "tool_input":{"usernameOrAlias":"acme-prod","sourceDir":"force-app"}}' \
  | node "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/pre-mcp-guard.js" | jq -r '.hookSpecificOutput.permissionDecision'
# -> deny

# a read-only tool is untouched (no output, exit 0)
echo '{"hook_event_name":"PreToolUse","tool_name":"mcp__salesforce-dx__run_soql_query",
       "tool_input":{"query":"SELECT Id FROM Account"}}' \
  | node "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/pre-mcp-guard.js"

# a frontdoor URL handed to the browser is denied, and the reply does not echo the session id
echo '{"hook_event_name":"PreToolUse","tool_name":"mcp__playwright__browser_navigate",
       "tool_input":{"url":"https://acme.my.salesforce.com/secur/frontdoor.jsp?sid=x"}}' \
  | node "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/pre-mcp-guard.js" | jq -r '.hookSpecificOutput.permissionDecision'
# -> deny

# the rules are asserted without a session
node --test tests/

# the server starts and lists its tools
npx -y @salesforce/mcp --orgs DEFAULT_TARGET_ORG --toolsets core,data --help
```

In a session, `/mcp` lists `salesforce-dx` and `playwright` with their connection state.
