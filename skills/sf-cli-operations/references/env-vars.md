# Environment variables and configuration variables

Resolution order for anything that exists in more than one place:

```
command-line flag  >  environment variable  >  local (project) config  >  global config  >  org default
```

Prefix a single command to scope a variable to that run:

```bash
SF_ORG_API_VERSION=67.0 sf project deploy start --target-org vf-dev
```

## Configuration variables (`sf config set`)

| Variable | Environment override | Meaning |
| --- | --- | --- |
| `target-org` | `SF_TARGET_ORG` | Username or alias every org command runs against by default |
| `target-dev-hub` | `SF_TARGET_DEV_HUB` | Default Dev Hub for `org create scratch` and `package*` |
| `org-api-version` | `SF_ORG_API_VERSION` | `apiVersion` — the API version of the HTTP request; defaults to the org's max |
| `org-instance-url` | `SF_ORG_INSTANCE_URL` | Instance hosting the org; default `https://login.salesforce.com` |
| `org-max-query-limit` | `SF_ORG_MAX_QUERY_LIMIT` | Maximum records a command returns; default 10,000 |
| `org-capitalize-record-types` | `SF_CAPITALIZE_RECORD_TYPES` | Capitalize the first letter of default record types on scratch-org creation; default `true` |
| `org-custom-metadata-templates` | `SF_ORG_CUSTOM_METADATA_TEMPLATES` | Directory or GitHub repo of custom scaffolding templates |
| `disable-telemetry` | `SF_DISABLE_TELEMETRY` | Opt out of usage/crash reporting |
| `org-isv-debugger-sid`, `org-isv-debugger-url` | — | ISV debugger session |
| `target-devops-center` | — | Org where DevOps Center is installed (DevOps Center commands only) |

`sf config set` without `--global` writes `<project>/.sf/config.json`; `--global` writes
`~/.sf/config.json`. `sf config get <name> --verbose` shows which level a value came from.

`sourceApiVersion` is **not** a config variable — it lives in `sfdx-project.json` and controls the
shape of the metadata (the `<version>` element of the generated manifest). See skill
`sf-project-structure`.

## Environment variables used by vibe-force pipelines

| Variable | Value | Why |
| --- | --- | --- |
| `SF_TARGET_ORG` | alias | Only for interactive convenience; checks and hooks still pass `--target-org` |
| `SF_ORG_API_VERSION` | `67.0` | Pin the request API version to the vibe-force `apiVersion` |
| `SF_USE_GENERIC_UNIX_KEYCHAIN` | `true` | Linux/macOS runners and ssh sessions have no usable OS keychain |
| `SF_DISABLE_TELEMETRY` | `true` | No outbound telemetry from CI |
| `SF_DISABLE_AUTOUPDATE` (or `SF_AUTOUPDATE_DISABLE`) | `true` | Pin the CLI version in the image; no mid-pipeline upgrades |
| `SF_JSON_TO_STDOUT` | `true` | Send failure JSON to stdout so a `\| jq` wrapper sees it |
| `SF_CONTENT_TYPE` | `JSON` | Make every command emit JSON without adding `--json` |
| `SF_LOG_LEVEL` | `warn` (`debug` when triaging) | `~/.sf/sf-<date>.log` verbosity; there is no `--loglevel` flag in v2 |
| `SF_CONTAINER_MODE` | `true` | `org open` returns a one-time URL and `org login web` prints non-browser alternatives |
| `SF_SKIP_SCRATCH_ORG_CHECK` | `true` | Skip the scratch/sandbox identification query after login — faster on runners with many cached orgs |
| `SF_CI_HEARTBEAT_FREQUENCY_MS` | default `300000` | How often a multi-stage command repeats its last status when the org is silent |
| `SF_CI_UPDATE_FREQUENCY_MS` | default `5000` | Interval between multi-stage status updates |
| `SF_NO_TABLE_STYLE` | `true` | Strip borders/colors from table output captured into logs |

## Full `SF_*` reference

### Org selection, API, and connection

| Variable | Effect |
| --- | --- |
| `SF_TARGET_ORG` | Overrides the `target-org` config variable |
| `SF_TARGET_DEV_HUB` | Overrides `target-dev-hub` |
| `SF_ACCESS_TOKEN` | Supplies the access token for `org login access-token` instead of prompting |
| `SF_ORG_API_VERSION` | Overrides `org-api-version` |
| `SF_ORG_INSTANCE_URL` | Overrides `org-instance-url` |
| `SF_AUDIENCE_URL` | Overrides the JWT `aud` claim (e.g. `https://test.salesforce.com` for a sandbox) |
| `SF_ORG_MAX_QUERY_LIMIT` | Max records returned by a command; default 10,000 |
| `SF_DNS_TIMEOUT` | Seconds to wait when checking whether an org is reachable; default 3 |
| `SF_DISABLE_DNS_CHECK` | `true` skips the org-reachability check (workaround for `DomainNotFound`) |
| `SF_DOMAIN_RETRY` | Seconds to wait for a new scratch org's My Domain to resolve; default 240 |
| `SF_WEB_OAUTH_SERVER_TIMEOUT` | Milliseconds `org login web` waits for the callback; default 120000 |
| `SF_CONTAINER_MODE` | Headless behaviour for `org open` and `org login web` |
| `SF_USE_GENERIC_UNIX_KEYCHAIN` | Use `~/.sfdx/key.json` instead of the macOS keychain / Linux libsecret |
| `SF_CRYPTO_V2` | `true` enables 256-bit encryption of local auth files (one-time migration) |

### Deploy, retrieve, and source tracking

| Variable | Effect |
| --- | --- |
| `SF_ORG_METADATA_REST_DEPLOY` | `true` uses the Metadata REST API for deploys instead of SOAP; escapes the 39 MB SOAP zip limit |
| `SF_DEPLOY_SIZE_THRESHOLD` | Percentage (1–100, default 80) of the Metadata API size/file-count limit at which `project deploy start` warns |
| `SF_MDAPI_TEMP_DIR` | Directory that keeps the intermediate metadata-format files (useful for inspecting exactly what was sent) |
| `SF_APPLY_REPLACEMENTS_ON_CONVERT` | `true` applies `replacements` during `project convert source` so they can be inspected before deploying |
| `SF_DISABLE_SOURCE_MEMBER_POLLING` | `true` stops polling `SourceMember` after a deploy/retrieve |
| `SF_SOURCE_MEMBER_POLLING_TIMEOUT` | Seconds to keep polling `SourceMember` |
| `SF_SOURCE_TRACKING_BATCH_SIZE` | Tracked-file updates batched after a deploy/retrieve; default 8,000 (Windows) or 15,000 (Linux/macOS). Lower it well below `ulimit -Hn` if file handles run out |
| `SF_SOURCE_TRACKING_ASSUME_SYNCED` | `true` skips the local filesystem scan when syncing with a tracked org |
| `SF_DISABLE_SOURCE_MOBILITY` | `true` disables source mobility, so moving a file within the project registers as delete plus create |
| `SF_LIST_METADATA_BATCH_SIZE` | Concurrent `listMetadata` calls for `project generate manifest --from-org`; default 500 |

### Apex and tests

| Variable | Effect |
| --- | --- |
| `SF_PRECOMPILE_ENABLE` | `true` pre-compiles Apex before `apex run test`; default `false` |
| `SF_IMPROVED_CODE_COVERAGE` | `true` scopes coverage results to the classes named in the run |

### Output, logging, updates

| Variable | Effect |
| --- | --- |
| `SF_CONTENT_TYPE=JSON` | JSON output for all commands |
| `SF_JSON_TO_STDOUT` | Failure JSON on stdout instead of stderr |
| `SF_LOG_LEVEL` | `error\|warn\|info\|debug\|trace\|fatal`; default `warn` |
| `SF_LOG_ROTATION_PERIOD` | `1h` or `1m` for smaller, more frequent log files; anything else is treated as `1d` |
| `SF_LOG_ROTATION_COUNT` | Number of rotated log files to keep |
| `SF_DISABLE_LOG_FILE` | `true` stops writing `~/.sf/sf-<date>.log` |
| `SF_NO_TABLE_STYLE`, `SF_TABLE_OVERFLOW`, `SF_TABLE_BORDER_STYLE` | Table rendering |
| `SF_DISABLE_AUTOUPDATE` / `SF_AUTOUPDATE_DISABLE` | Disable auto-update |
| `SF_SKIP_NEW_VERSION_CHECK`, `SF_NEW_VERSION_CHECK_FREQ`, `SF_NEW_VERSION_CHECK_FREQ_UNIT` | Control the "new version available" check |
| `SF_HIDE_RELEASE_NOTES`, `SF_HIDE_RELEASE_NOTES_FOOTER` | Suppress release-note output after an update |
| `SF_NPM_REGISTRY` | Private npm registry for plugin installs |
| `SF_NPM_LOG_LEVEL` | npm loglevel used by `sf plugins install` |
| `SF_DISABLE_TELEMETRY` | Opt out of telemetry |
| `SF_USE_PROGRESS_BAR` | `false` disables the deploy progress bar |
| `SF_USE_NETWORK_MUTEX`, `SF_NETWORK_MUTEX_PORT` | Serialize network-heavy operations across concurrent CLI processes |
| `SF_CAPITALIZE_RECORD_TYPES` | See config table |
| `SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_CREATE`, `..._FOR_PACKAGE_VERSION_CREATE` | Stop the CLI rewriting `sfdx-project.json` during packaging |
| `SF_TEMP_SHOW_SECRETS` | `true` re-renders redacted secrets in `sf org display`; Salesforce documents this as a temporary workaround slated for removal |
| `FORCE_OPEN_URL` | Page that `org open` lands on (equivalent to `--path`) |
| `FORCE_SHOW_SPINNER`, `FORCE_SPINNER_DELAY` | Spinner behaviour |

`SF_AUDIT_URI` is **not** a Salesforce CLI environment variable: it appears in neither the Setup
Guide's environment-variable list nor `@salesforce/core`'s `EnvironmentVariable` enum. Do not set it
and do not document it as CLI behaviour `[unverified: no such variable found in current sources]`.

## Deprecated `SFDX_*` synonyms

Every `SFDX_*` name below is a deprecated synonym. When both are set with different values the CLI
uses the `SF_*` value and emits a deprecation warning.

| Deprecated | Current |
| --- | --- |
| `SFDX_DEFAULTUSERNAME` | `SF_TARGET_ORG` |
| `SFDX_DEFAULTDEVHUBUSERNAME` | `SF_TARGET_DEV_HUB` |
| `SFDX_ACCESS_TOKEN` | `SF_ACCESS_TOKEN` |
| `SFDX_API_VERSION` | `SF_ORG_API_VERSION` |
| `SFDX_INSTANCE_URL` | `SF_ORG_INSTANCE_URL` |
| `SFDX_AUDIENCE_URL` | `SF_AUDIENCE_URL` |
| `SFDX_CONTENT_TYPE` | `SF_CONTENT_TYPE` |
| `SFDX_JSON_TO_STDOUT` | `SF_JSON_TO_STDOUT` |
| `SFDX_LOG_LEVEL` | `SF_LOG_LEVEL` |
| `SFDX_LOG_ROTATION_COUNT` / `_PERIOD` | `SF_LOG_ROTATION_COUNT` / `_PERIOD` |
| `SFDX_DISABLE_LOG_FILE` | `SF_DISABLE_LOG_FILE` |
| `SFDX_MAX_QUERY_LIMIT` | `SF_ORG_MAX_QUERY_LIMIT` |
| `SFDX_MDAPI_TEMP_DIR` | `SF_MDAPI_TEMP_DIR` |
| `SFDX_REST_DEPLOY` | `SF_ORG_METADATA_REST_DEPLOY` |
| `SFDX_DISABLE_TELEMETRY` | `SF_DISABLE_TELEMETRY` |
| `SFDX_DISABLE_AUTOUPDATE` / `SFDX_AUTOUPDATE_DISABLE` | `SF_DISABLE_AUTOUPDATE` / `SF_AUTOUPDATE_DISABLE` |
| `SFDX_DISABLE_SOURCE_MEMBER_POLLING` | `SF_DISABLE_SOURCE_MEMBER_POLLING` |
| `SFDX_SOURCE_MEMBER_POLLING_TIMEOUT` | `SF_SOURCE_MEMBER_POLLING_TIMEOUT` |
| `SFDX_SOURCE_TRACKING_BATCH_SIZE` | `SF_SOURCE_TRACKING_BATCH_SIZE` |
| `SFDX_USE_GENERIC_UNIX_KEYCHAIN` | `SF_USE_GENERIC_UNIX_KEYCHAIN` |
| `SFDX_USE_PROGRESS_BAR` | `SF_USE_PROGRESS_BAR` |
| `SFDX_PRECOMPILE_ENABLE` | `SF_PRECOMPILE_ENABLE` |
| `SFDX_IMPROVED_CODE_COVERAGE` | `SF_IMPROVED_CODE_COVERAGE` |
| `SFDX_DNS_TIMEOUT` | `SF_DNS_TIMEOUT` |
| `SFDX_DOMAIN_RETRY` | `SF_DOMAIN_RETRY` |
| `SFDX_NPM_REGISTRY` | `SF_NPM_REGISTRY` |
| `SFDX_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_CREATE` / `..._VERSION_CREATE` | `SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_CREATE` / `..._VERSION_CREATE` |

Network/proxy variables are not prefixed and keep their standard names: `HTTP_PROXY`, `HTTPS_PROXY`,
`NODE_EXTRA_CA_CERTS`, `NODE_TLS_REJECT_UNAUTHORIZED`.

## vibe-force's own variables

These are read by vibe-force hooks and check runners, not by the Salesforce CLI.

| Variable | Values | Effect |
| --- | --- | --- |
| `VF_HOOK_MODE` | `off\|minimal\|standard\|strict` | Overrides `hooks.mode` from `.vibeforce/config.json` |
| `VF_ALLOW_PROD` | `1` | One-shot escape hatch for a deliberate production operation |
| `VF_SKIP_CHECKS` | `1` | Skip automatic check execution in hooks (does not skip explicit `vf-check` runs) |
| `VF_DEBUG` | `1` | Verbose hook and check diagnostics |

## Verification

```bash
sf config list                                  # local + global config variables
sf config get target-org org-api-version --verbose
env | grep -E '^(SF_|SFDX_|FORCE_)' | sort      # what the shell actually exports
sf doctor --output-dir .vibeforce/reports/doctor   # includes the resolved environment
```

## Sources

- Salesforce CLI Setup Guide, "Salesforce CLI Environment Variables": <https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_dev_cli_env_variables.htm>
- Salesforce CLI Setup Guide, "List of Configuration Variables": <https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_dev_cli_config_values.htm>
- Salesforce CLI Setup Guide, "How API Version and Source API Version Work in Salesforce CLI": <https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_dev_api_version.htm>
- `EnvironmentVariable` enum and synonyms: <https://github.com/forcedotcom/sfdx-core/blob/main/src/config/envVars.ts>
- Environment variable descriptions: <https://github.com/forcedotcom/sfdx-core/blob/main/messages/envVars.md>
- `sf config get` CONFIGURATION VARIABLES output: <https://github.com/salesforcecli/plugin-settings/blob/main/README.md>
