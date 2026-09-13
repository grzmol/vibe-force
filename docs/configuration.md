# Configuration

Resolution order, highest priority first:

1. `VF_*` environment variables
2. `<project>/.vibeforce/config.json`
3. `config/vibe-force.defaults.json` (shipped with the plugin)
4. the inline fallback in `scripts/lib/config.js` (used when the plugin's `config/` is missing)

Objects merge deeply; arrays are replaced wholesale.

## Reference

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `apiVersion` | string | `"67.0"` | Salesforce API version the project targets. The `post-edit-check` hook flags metadata declaring a different `<apiVersion>` |
| `packageDirectories` | string[] | `["force-app"]` | Roots for change detection, analyzer workspaces and metadata counts. Mirror `sfdx-project.json` |
| `orgs` | object | `{}` | Named aliases per environment (`dev`, `integration`, `uat`, `prod`). Commands resolve `--target-org` from here |
| `productionAliases` | string[] | `["prod","production"]` | Aliases treated as production by every guard. Matching is case-insensitive and substring-aware, so `release@acme-prod.com` matches `acme-prod` |
| `gates.apexOrgCoverageMin` | number | `85` | Minimum org-wide Apex coverage for `vf-check apex` |
| `gates.apexClassCoverageMin` | number | `75` | Minimum per-class coverage; 75 is the platform requirement for production deployment |
| `gates.jestCoverageMin` | number | `80` | Minimum Jest coverage for `vf-check jest` |
| `gates.analyzerFailSeverity` | number | `3` | Code Analyzer severity at which `vf-check analyzer` fails (1 highest) |
| `gates.requireTestForApexClass` | boolean | `true` | Static check and advisory note for an Apex class with no test class |
| `gates.requireJestForLwc` | boolean | `true` | Same for an LWC module with no `__tests__` file |
| `gates.previewBundlePattern` | string | `(?:Harness\|Fixtures)$` | Bundle names exempt from `requireJestForLwc`: preview scaffolding (skill `sf-local-development`, pattern 9). Every exemption is named in the check log. Narrow it when a shipped component's name collides |
| `testLevels.sandbox` | string | `"RunLocalTests"` | Test level for sandbox deploys |
| `testLevels.production` | string | `"RunLocalTests"` | Test level for production validation |
| `hooks.mode` | enum | `"standard"` | `off`, `minimal`, `standard`, `strict` |
| `hooks.stopGate` | string | `"static"` | Check the `Stop` hook runs over touched files; `none` disables it, `local` adds Jest |
| `hooks.stopTimeoutSec` | number | `240` | Timeout for the Stop gate; a timeout notes and passes rather than blocking |
| `hooks.blockProductionDeploy` | boolean | `true` | Deny `sf project deploy start` against a production alias |
| `hooks.blockDestructive` | boolean | `true` | Prompt before `sf project delete source` outside production (always denied on production) |
| `hooks.autoFormat` | boolean | `true` | Run the project's local `prettier --write` after a write |
| `hooks.enforceOwnership` | boolean | `true` | Deny writes to a file another live agent claimed |
| `xml.readMaxBytes` | number | `20000` | Size at which the `xml-bulk-read` guard denies a whole-file read or shell dump of metadata XML and hands back the `vf-xml` command instead. Bounded reads are never blocked. |
| `xml.outlineDepth` | number | `2` | Default nesting depth for `vf-xml outline`. |
| `smoke.queries` | string[] | defaults in `config/vibe-force.defaults.json` | Verification SOQL run by `vf-check smoke` |

## Environment variables

| Variable | Effect |
| --- | --- |
| `VF_HOOK_MODE` | Overrides `hooks.mode` for the shell (`off`, `minimal`, `standard`, `strict`) |
| `VF_XML_READ=1` | Lets one call read a metadata XML file whole, past `xml.readMaxBytes`. Prefer a narrower `vf-xml` selector or a bounded read first. |
| `VF_ALLOW_PROD=1` | Clears `hooks.blockProductionDeploy` and lets org-touching checks target a production alias. Intended for a human, per shell, per release |
| `VF_SKIP_CHECKS=1` | Skips the `Stop` gate. Use when the gate itself is broken, not to escape a finding |
| `VF_DEBUG=1` | Hook handlers print stack traces to stderr |
| `VF_MCP_ORGS` | Orgs the bundled Salesforce DX MCP server may reach; default `DEFAULT_TARGET_ORG`. Accepts aliases, usernames, `DEFAULT_TARGET_DEV_HUB`, or `ALLOW_ALL_ORGS` |
| `VF_MCP_TOOLSETS` | MCP toolsets to enable; default `core,data,code-analysis,testing`. Adding `metadata` enables `deploy_metadata` and `retrieve_metadata`, which `pre-mcp-guard` then gates ([docs/mcp.md](mcp.md)) |
| `CLAUDE_PLUGIN_ROOT` | Set by Claude Code; the plugin root used by hooks and commands |
| `CLAUDE_PROJECT_DIR` | Set by Claude Code; the fallback project root when the payload carries none |
| `SF_TARGET_ORG` | Read by the guards as the effective default org when a command omits `--target-org` |

## Mode matrix

| Behaviour | `off` | `minimal` | `standard` | `strict` |
| --- | --- | --- | --- | --- |
| Production and destructive guards | - | yes | yes | yes |
| Secret and generated-path guards | - | yes | yes | yes |
| Ownership and slice enforcement | - | yes | yes | yes |
| Advisory notes (bulkification, missing tests, api drift) | - | - | yes | yes |
| Session context injection | - | yes | yes | yes |
| Stop gate | - | - | yes | yes |
| Deploy without a passing local gate | allowed | allowed | noted | denied |
| MCP production deny and prompt rules | - | yes | yes | yes |
| MCP advisory notes (gate skipped, retrieve overwrites) | - | - | yes | yes |
| Profile-edit prompt | - | - | yes | yes |

`minimal` is the right mode for a research or read-only session: the safety floor stays, the
commentary goes. `strict` is the right mode for a release branch.

## Tuning for a legacy org

A repository that cannot pass the gates today should ratchet rather than exempt:

```json
{
  "gates": { "apexOrgCoverageMin": 70, "analyzerFailSeverity": 2, "requireTestForApexClass": false },
  "hooks": { "mode": "standard", "stopGate": "static" }
}
```

Then raise one number per iteration, with the ratchet recorded in the repository. Baseline
strategies for Code Analyzer findings are in skill `sf-code-analyzer-quality`.

## Per-environment overrides

Keep one committed config and override per shell rather than maintaining several files:

```bash
# release engineer, production window
VF_HOOK_MODE=strict VF_ALLOW_PROD=1 claude

# exploratory session against a scratch org
VF_HOOK_MODE=minimal claude
```

## Validating a config change

```bash
jq . .vibeforce/config.json
node -e 'const {loadConfig}=require(process.env.CLAUDE_PLUGIN_ROOT+"/scripts/lib/config.js");console.log(JSON.stringify(loadConfig(process.cwd()).config,null,2))'
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" static --changed
```

The second command prints the effective merged configuration, which is what the hooks and the
runner actually see.
