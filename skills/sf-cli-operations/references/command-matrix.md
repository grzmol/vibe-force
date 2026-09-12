# `sf` v2 command matrix

Every flag in this file is taken from the generated Salesforce CLI command reference
(<https://github.com/salesforcecli/cli/blob/main/README.md>, the source of
<https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_unified.htm>).
Short flags are shown where they exist. `--json` and `--flags-dir` are available on every command
listed here unless noted. `-o, --target-org` is written out in full in this plugin's examples.

## `sf org` — authorization and org inventory

| Command | Key flags | Purpose |
| --- | --- | --- |
| `org login web` | `-a/--alias`, `-s/--set-default`, `-d/--set-default-dev-hub`, `-i/--client-id`, `-r/--instance-url`, `-b/--browser chrome\|edge\|firefox`, `--scopes`, `-c/--client-app` (with `--username`) | Interactive web server OAuth flow |
| `org login jwt` | `-i/--client-id` (req), `-f/--jwt-key-file` (req), `-o/--username` (req), `-r/--instance-url`, `-a/--alias`, `-s/--set-default`, `-d/--set-default-dev-hub` | Headless CI authorization |
| `org login sfdx-url` | `-f/--sfdx-url-file`, `-u/--sfdx-url-stdin`, `-a/--alias`, `-s`, `-d` | Authorize from a captured auth URL |
| `org login access-token` | `-r/--instance-url` (req), `-a/--alias`, `-s`, `-d`, `-p/--no-prompt` | Store an existing access token |
| `org logout` | `-o/--target-org`, `-a/--all`, `-p/--no-prompt`, `-c/--client-app` | Remove local authorization |
| `org display` | `-o` (req), `--verbose` (adds `sfdxAuthUrl`), `--api-version` | Org id, instance URL, alias, API version, connected status |
| `org display user` | `-o` (req) | User id, profile, password status. Does **not** accept an access token as `--target-org` |
| `org list` | `--all`, `--verbose`, `--clean`, `-p/--no-prompt`, `--skip-connection-status` | Inventory of authorized orgs and scratch orgs |
| `org list auth` | — | Raw auth-file inventory |
| `org list limits` | `-o` (req) | All org limits with `Max`/`Remaining` |
| `org list metadata` | `-m/--metadata-type` (req, case-sensitive), `--folder`, `-f/--output-file` | `listMetadata` for one type |
| `org list metadata-types` | `-f/--output-file`, `--api-version` | `describeMetadata` — what the org supports |
| `org list sobject record-counts` | `-s/--sobject` (repeatable) | Row counts per object (uses the org's record-count endpoint) |
| `org list users` | `-o` (req) | Users in the org with ids and profiles |
| `org auth show-access-token` | `-o` (req), `-p/--no-prompt` | Reveal the access token (prompts unless `--no-prompt`/`--json`) |
| `org auth show-sfdx-auth-url` | `-o` (req), `-p/--no-prompt` | Reveal the SFDX auth URL for CI |
| `org auth show-user-password` | `-o` (req), `-p/--no-prompt` | Reveal a generated scratch-org password |
| `org open` | `-o` (req), `-p/--path`, `-f/--source-file`, `-r/--url-only`, `--private`, `-b/--browser` | Open Setup, a record page, or a source file's target |
| `org assign permset` | `-n/--name` (repeatable), `-b/--on-behalf-of` | Assign permission sets after a deploy |
| `org generate password` | `-l/--length` (20–1000, default 20), `-c/--complexity` (default 5), `-b/--on-behalf-of` | Set a password for a scratch-org user |
| `org enable tracking` / `org disable tracking` | `-o` (req) | Turn source tracking on/off locally for an org |
| `org create scratch` | `-v/--target-dev-hub` (req), `-f/--definition-file`, `-a/--alias`, `-d/--set-default`, `-y/--duration-days`, `--no-track-source` | See skill `sf-scratch-orgs-sandboxes` |
| `org create sandbox` / `org refresh sandbox` / `org resume sandbox` | `-f/--definition-file`, `-o/--target-org`, `-a/--alias`, `--no-track-source`, `-w/--wait` | See skill `sf-scratch-orgs-sandboxes` |

## `sf project` — metadata movement and tracking

| Command | Key flags | Purpose |
| --- | --- | --- |
| `project deploy start` | `-d/--source-dir` (repeatable), `-m/--metadata`, `-x/--manifest`, `-l/--test-level`, `-t/--tests`, `-c/--ignore-conflicts`, `-r/--ignore-errors`, `-g/--ignore-warnings`, `--dry-run`, `-w/--wait`, `-a/--api-version`, `--concise`, `--verbose`, `--async`, `--purge-on-delete`, `--pre-destructive-changes`, `--post-destructive-changes`, `--coverage-formatters`, `--results-dir` | Deploy source |
| `project deploy validate` | same targeting flags; test level required at `RunSpecifiedTests`/`RunLocalTests`/`RunAllTestsInOrg` | Check-only deploy that yields a quick-deploy job id |
| `project deploy quick` | `-i/--job-id`, `-r/--use-most-recent`, `-w/--wait`, `--async` | Promote a validated deployment (valid for 10 days) |
| `project deploy report` | `-i/--job-id`, `-r/--use-most-recent`, `--coverage-formatters`, `--results-dir` | Fetch status/results of a deployment |
| `project deploy resume` / `deploy cancel` | `-i/--job-id`, `-r/--use-most-recent`, `-w/--wait` | Resume watching / cancel an in-flight deployment |
| `project deploy preview` | `-x/--manifest`, `-d/--source-dir`, `-m/--metadata`, `-c/--ignore-conflicts`, `--concise` | Dry list of what deploys, is deleted, conflicts, or is ignored |
| `project retrieve start` | `-x/--manifest`, `-m/--metadata`, `-d/--source-dir`, `-r/--output-dir`, `-n/--package-name`, `-c/--ignore-conflicts`, `-w/--wait` (default 33 min), `-a/--api-version`, `-t/--target-metadata-dir`, `-z/--unzip`, `--single-package`, `--zip-file-name`, `--root-type-with-dependencies` | Retrieve source (or a metadata-format zip) |
| `project retrieve preview` | `-c/--ignore-conflicts`, `--concise` | Remote changes that would be retrieved |
| `project delete source` | `-m/--metadata`, `-p/--source-dir`, `-c/--check-only`, `-r/--no-prompt`, `-f/--force-overwrite`, `-t/--track-source`, `-l/--test-level`, `--tests`, `-w/--wait`, `--verbose` | Delete from org **and** local project |
| `project delete tracking` | `-p/--no-prompt` | Delete all local source-tracking files for an org |
| `project reset tracking` | `-r/--revision <SourceMember revision>`, `-p/--no-prompt` | Reset tracking to a revision (or to "everything in sync") |
| `project generate manifest` | `-m/--metadata`, `-p/--source-dir`, `--from-org`, `-c/--include-packages managed\|unlocked`, `--excluded-metadata`, `-n/--name`, `-t/--type pre\|post\|destroy\|package`, `-d/--output-dir` | Build `package.xml` / `destructiveChanges*.xml` |
| `project list ignored` | `-p/--source-dir` | What `.forceignore` currently excludes |
| `project convert source` | `-r/--root-dir`, `-d/--output-dir`, `-n/--package-name`, `-p/--source-dir`, `-x/--manifest`, `-m/--metadata`, `--api-version` | Source format → metadata format |
| `project convert mdapi` | `-r/--root-dir` (req), `-d/--output-dir`, `-p/--metadata-dir`, `-x/--manifest`, `-m/--metadata` | Metadata format → source format |
| `project convert source-behavior` | `-b/--behavior` (req: `decomposeCustomLabelsBeta2`, `decomposeCustomLabelsBeta`, `decomposePermissionSetBeta`, `decomposePermissionSetBeta2`, `decomposeSharingRulesBeta`, `decomposeWorkflowBeta`, `decomposeExternalServiceRegistrationBeta`), `--dry-run`, `--preserve-temp-dir`, `-o/--target-org` | Enable optional metadata decomposition and rewrite the source |

## `sf apex`

| Command | Key flags | Purpose |
| --- | --- | --- |
| `apex run` | `-f/--file` (omit to read stdin) | Execute anonymous Apex |
| `apex run test` | `-l/--test-level RunLocalTests\|RunAllTestsInOrg\|RunSpecifiedTests`, `-n/--class-names`, `-s/--suite-names`, `-t/--tests`, `-c/--code-coverage`, `-v/--detailed-coverage`, `-d/--output-dir`, `-r/--result-format human\|tap\|junit\|json`, `-y/--synchronous`, `-w/--wait`, `-i/--poll-interval`, `--concise` | Run Apex tests (`vf-check apex`) |
| `apex get test` | `-i/--test-run-id` (req), `-c/--code-coverage`, `--detailed-coverage`, `-d/--output-dir`, `-r/--result-format` | Fetch results of an async run |
| `apex get log` | `-i/--log-id`, `-n/--number`, `-d/--output-dir` | Download debug logs |
| `apex list log` | — | List available logs with ids |
| `apex tail log` | `-c/--color`, `-d/--debug-level`, `-s/--skip-trace-flag` | Stream logs (skill `sf-debugging-logs`) |

## `sf data`

Full flag tables live in skill `sf-data-management`, `references/data-commands.md`. Summary:

| Command | Purpose |
| --- | --- |
| `data query` / `data search` | SOQL / SOSL with `-r human\|csv\|json`, `--output-file`, `--all-rows`, `-t/--use-tooling-api` |
| `data get\|create\|update\|delete record` | Single-record CRUD with `--values` / `--where` / `--record-id` |
| `data export tree` / `data import tree` | Small relational datasets as sObject-tree JSON (`--plan`) |
| `data export bulk` / `data import bulk` / `data upsert bulk` / `data update bulk` / `data delete bulk` | Bulk API 2.0 ingest and query |
| `data export\|import\|upsert\|update\|delete resume`, `data resume`, `data bulk results` | Job status and result files |
| `data create file` | Upload a local file as a `ContentDocument` |

## `sf package`, `sf sobject`, `sf schema`, `sf template generate`

| Command | Key flags | Purpose |
| --- | --- | --- |
| `package create` | `-n/--name`, `-t/--package-type Managed\|Unlocked`, `-r/--path`, `-v/--target-dev-hub` | Create a package (writes `packageAliases`) |
| `package version create` | `-p/--package`, `-x/--installation-key-bypass`, `-w/--wait`, `-c/--code-coverage`, `--skip-validation` | Build a package version |
| `package version promote` | `-p/--package`, `-n/--no-prompt` | Mark a version released |
| `package install` | `-p/--package`, `-k/--installation-key`, `-w/--wait`, `-r/--no-prompt`, `-a/--apex-compile`, `-s/--security-type` | Install into a target org |
| `package installed list` | `-o` (req) | What is installed in an org |
| `sobject describe` | `-s/--sobject` (req), `-t/--use-tooling-api` | Field-level describe |
| `sobject list` | `-s/--sobject all\|custom\|standard` | Object inventory |
| `schema generate sobject` / `field` / `platformevent` / `tab` | `-l/--label`, `-o/--object`, `-d/--output-dir` | Scaffold object/field metadata interactively |
| `template generate apex class` | `-n/--name` (req), `-d/--output-dir`, `-t/--template` | Scaffold an Apex class (alias `sf force apex class create`) |
| `template generate lightning component` | `-n/--name` (req), `-d/--output-dir`, `--type lwc\|aura` | Scaffold LWC/Aura (alias `sf lightning generate component`) |
| `template generate project` | `-n/--name` (req), `-t/--template`, `-x/--manifest`, `-d/--output-dir`, `--default-package-dir` | New DX project (alias `sf force project create`) |

## `sf config`, `sf alias`, `sf plugins`, diagnostics

| Command | Key flags | Purpose |
| --- | --- | --- |
| `config set` | `-g/--global`; `name value` or `name=value` pairs | Set config variables |
| `config get` | `--verbose` (shows local vs global) | Read specific variables |
| `config list` / `config unset` | `-g/--global` for unset | Inspect / clear |
| `alias set` / `alias list` / `alias unset` | `alias unset -a/--all`, `-p/--no-prompt` | Name orgs and other values |
| `plugins` | — | Installed plugins and versions |
| `plugins install <plugin>` | `-f/--force`, `-s/--silent`, `-v/--verbose` | Install from npm or a GitHub ref |
| `plugins link <path>` | `--[no-]install`, `-v` | Link a local plugin (never auto-updated) |
| `plugins uninstall` / `plugins update` / `plugins reset` | `reset --hard`, `--reinstall` | Remove / refresh plugins |
| `plugins inspect <plugin>` | — | Resolve the location and version actually in use |
| `plugins trust verify` / `plugins trust allowlist add\|list\|remove` | — | Signature verification for third-party plugins |
| `code-analyzer run` | `--rule-selector`, `--target`, `--workspace`, `--config-file`, `--output-file`, `--severity-threshold` | Static analysis (`vf-check analyzer`) |
| `code-analyzer rules` | `--rule-selector`, `--config-file`, `--output-file` | List/export the active rule set |
| `code-analyzer config` | `--rule-selector`, `--workspace`, `-f/--config-file`, `--output-file`, `--include-unmodified-rules`, `--no-suppressions` | Generate `code-analyzer.yml` |
| `lightning dev app` / `component` / `site` | `-o/--target-org`, `-n/--name`, `-d/--device-type` | Local Lightning development server (skill `sf-local-development`) |
| `doctor` | `--output-dir`, `--command "<cmd>"`, `--plugin`, `--create-issue` | Diagnostics bundle |
| `which <command>` | — | Which plugin owns a command |
| `version` / `update [CHANNEL]` | `update --available`, `--force` | Version and channel management |
| `autocomplete [zsh\|bash\|powershell]` | `-r/--refresh-cache` | Shell completion |
| `info releasenotes display` | `-v/--version` | CLI release notes |

## Retired `sfdx force:*` → `sf` v2 migration

`sfdx` is now an alias of `sf`, and these legacy names survive only as command aliases. New code must
use the right-hand column; vibe-force hooks reject the left-hand column in `standard` and `strict`
modes.

| Retired command | Replacement |
| --- | --- |
| `sfdx force:auth:web:login` | `sf org login web` |
| `sfdx force:auth:jwt:grant` | `sf org login jwt` |
| `sfdx force:auth:sfdxurl:store` | `sf org login sfdx-url` |
| `sfdx force:auth:accesstoken:store` | `sf org login access-token` |
| `sfdx force:auth:logout` | `sf org logout` |
| `sfdx force:auth:list` | `sf org list auth` |
| `sfdx force:org:display` | `sf org display` |
| `sfdx force:org:list` | `sf org list` |
| `sfdx force:org:open` | `sf org open` |
| `sfdx force:org:create` (scratch) | `sf org create scratch` |
| `sfdx force:org:delete` | `sf org delete scratch` |
| `sfdx force:user:create` | `sf org create user` |
| `sfdx force:user:display` | `sf org display user` |
| `sfdx force:user:list` | `sf org list users` |
| `sfdx force:user:password:generate` | `sf org generate password` |
| `sfdx force:user:permset:assign` | `sf org assign permset` |
| `sfdx force:limits:api:display` | `sf org list limits` |
| `sfdx force:limits:recordcounts:display` | `sf org list sobject record-counts` |
| `sfdx force:mdapi:listmetadata` | `sf org list metadata` |
| `sfdx force:mdapi:describemetadata` | `sf org list metadata-types` |
| `sfdx force:source:push` | `sf project deploy start` (source tracking deploys changed source with no targeting flags) |
| `sfdx force:source:pull` | `sf project retrieve start` |
| `sfdx force:source:deploy` | `sf project deploy start --source-dir\|--metadata\|--manifest` |
| `sfdx force:source:retrieve` | `sf project retrieve start --source-dir\|--metadata\|--manifest` |
| `sfdx force:source:deploy:report` | `sf project deploy report` |
| `sfdx force:source:deploy:cancel` | `sf project deploy cancel` |
| `sfdx force:mdapi:deploy` | `sf project deploy start --metadata-dir` |
| `sfdx force:mdapi:retrieve` | `sf project retrieve start --target-metadata-dir` |
| `sfdx force:source:delete` | `sf project delete source` |
| `sfdx force:source:manifest:create` | `sf project generate manifest` |
| `sfdx force:source:ignored:list` | `sf project list ignored` |
| `sfdx force:source:tracking:reset` | `sf project reset tracking` |
| `sfdx force:source:tracking:clear` | `sf project delete tracking` |
| `sfdx force:source:convert` | `sf project convert source` |
| `sfdx force:mdapi:convert` | `sf project convert mdapi` |
| `sfdx force:apex:execute` | `sf apex run` |
| `sfdx force:apex:test:run` | `sf apex run test` |
| `sfdx force:apex:test:report` | `sf apex get test` |
| `sfdx force:apex:log:get` / `:list` / `:tail` | `sf apex get log` / `sf apex list log` / `sf apex tail log` |
| `sfdx force:data:soql:query` | `sf data query` |
| `sfdx force:data:record:create` / `:get` / `:update` / `:delete` | `sf data create record` / `get record` / `update record` / `delete record` |
| `sfdx force:data:tree:export` / `:import` | `sf data export tree` / `sf data import tree` |
| `sfdx force:data:bulk:upsert` / `:delete` / `:status` | `sf data upsert bulk` / `sf data delete bulk` / `sf data resume` (Bulk API 2.0). The `sf force data bulk *` wrappers still exist for Bulk API 1.0 serial mode |
| `sfdx force:schema:sobject:describe` / `:list` | `sf sobject describe` / `sf sobject list` |
| `sfdx force:apex:class:create` / `force:apex:trigger:create` | `sf template generate apex class` / `apex trigger` |
| `sfdx force:lightning:component:create` | `sf template generate lightning component` |
| `sfdx force:project:create` | `sf template generate project` |
| `sfdx force:alias:set` / `:list` / `:unset` | `sf alias set` / `list` / `unset` |
| `sfdx force:config:set` / `:get` / `:list` / `:unset` | `sf config set` / `get` / `list` / `unset` |
| `sfdx force:package:*` | `sf package *` (identical subcommand names) |
| `sfdx scanner:run` (Code Analyzer v4) | `sf code-analyzer run` (v5) |

Source-tracking note: v2 has no `push`/`pull`. `sf project deploy start` with no targeting flag
deploys exactly the locally changed, source-tracked components, and `sf project retrieve start` with
no targeting flag retrieves the remotely changed ones — the same semantics the old `push`/`pull`
provided, with conflict detection on by default.

## Behavioural details worth remembering

| Detail | Consequence |
| --- | --- |
| `--json` overrides `-r/--result-format` | A wrapper can always ask for JSON without knowing the command's native formats |
| `sf org display` redacts secrets | Use `sf org auth show-access-token`, `show-sfdx-auth-url`, `show-user-password`; `SF_TEMP_SHOW_SECRETS=true` is a temporary escape hatch that Salesforce documents as being removed in a future release |
| `--target-org` accepts an access token | Handy for ephemeral runs; escape `!` in the token as `\!` |
| `-w/--wait 0` on bulk data commands | Returns immediately with a job id; pair with `* resume` |
| `sf project deploy validate` job ids | Usable by `sf project deploy quick` for 10 days |
| `org list --clean` | Removes local auth for inactive scratch orgs only; non-scratch orgs need `org logout` |
| `sf update` | Updates the core CLI, not JIT or user-installed plugins |

## Sources

- Salesforce CLI command reference (generated): <https://github.com/salesforcecli/cli/blob/main/README.md>
- `@salesforce/plugin-data` reference: <https://github.com/salesforcecli/plugin-data/blob/main/README.md>
- `@salesforce/plugin-deploy-retrieve` reference: <https://github.com/salesforcecli/plugin-deploy-retrieve/blob/main/README.md>
- `@salesforce/plugin-auth` reference: <https://github.com/salesforcecli/plugin-auth/blob/main/README.md>
- `@salesforce/plugin-settings` reference: <https://github.com/salesforcecli/plugin-settings/blob/main/README.md>
- Salesforce CLI Setup Guide, "Move from sfdx (v7) to sf (v2)": <https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_move_to_sf_v2.htm>
- Salesforce Code Analyzer command reference: <https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/get-started.html>
- `@salesforce/plugin-lightning-dev` reference: <https://github.com/salesforcecli/plugin-lightning-dev/blob/main/README.md>
