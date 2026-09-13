# MCP

vibe-force ships the official [Salesforce DX MCP Server](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_mcp.htm)
(`@salesforce/mcp`, Apache-2.0, published by Salesforce) and guards it with the same rules that
guard the shell.

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

Turn the server off entirely with `/mcp` in a session, or by disabling the plugin.

The server needs `npx` and a locally authorised org (`sf org login web`). It is the only npm
package vibe-force ever runs, and it runs in the user's environment, not inside a check: the
plugin's own hooks and checks remain dependency-free Node.

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

The production alias is matched against every string in the tool arguments, at any nesting depth,
rather than one argument name: tool schemas differ per tool and change between releases.

Read-only tools - `run_soql_query`, `list_all_orgs`, `get_username`, the Code Analyzer and LWC
guidance tools - pass untouched.

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

# the rules are asserted without a session
node --test tests/

# the server starts and lists its tools
npx -y @salesforce/mcp --orgs DEFAULT_TARGET_ORG --toolsets core,data --help
```

In a session, `/mcp` lists `salesforce-dx` and its connection state.
