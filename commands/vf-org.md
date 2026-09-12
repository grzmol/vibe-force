---
description: Inspect and manage the Salesforce orgs behind a vibe-force project - list authorizations, show an org, switch the default, read limits, authorize a new org, open it, or take a health snapshot.
argument-hint: "[list|show|use|limits|open|login|health] [alias]"
allowed-tools: Read, Edit, Grep, Glob, Bash(sf org list:*), Bash(sf org display:*), Bash(sf org open:*), Bash(sf org login web:*), Bash(sf config:*), Bash(sf alias:*), Bash(sf data query:*)
---

# vf-org - org inspection and alias management

Raw arguments: `$ARGUMENTS`

`SUB` = the first bare token, default `list`. `ALIAS` = the second bare token when the subcommand takes one.

Read `<project>/.vibeforce/config.json` first for `orgs`, `productionAliases`, and `apiVersion`. If it is
missing, say the project is not initialised and point at `/vf-init`; the read-only subcommands still work.

Every command below passes `--target-org` explicitly. Never let a subcommand act on the CLI's ambient default
org just because an alias was omitted.

## Subcommands

### `list` (default)

```bash
sf org list --json --skip-connection-status
```

Merge the CLI's authorizations with the project's `orgs` map into one table:

| Slot | Alias | Username | Instance | Type | Status |
| --- | --- | --- | --- | --- | --- |

`Slot` is `dev` / `integration` / `uat` / `prod` from `.vibeforce/config.json`, or blank for an authorization the
project does not map. `Type` is scratch, sandbox, production, or dev hub, taken from `isSandbox`, `isDevHub`, and
whether the entry came from `result.scratchOrgs`. Mark every alias in `productionAliases` explicitly.

Call out both kinds of drift: a config slot pointing at an alias the CLI does not know, and an authorized org
with no slot. Add `--all` when the user wants expired and deleted scratch orgs too.

### `show <alias>`

```bash
sf org display --target-org <ALIAS> --json
```

Report alias, username, org id, instance URL, API version, connected status, and sandbox flag. Do not print the
access token, and do not run `--verbose` (it prints the SFDX auth URL, which is a credential) unless the user
asks for it and understands that.

### `use <alias>`

```bash
sf config set target-org <ALIAS>
```

Sets the project-local default. Refuse an alias in `productionAliases` unless the user confirms and
`VF_ALLOW_PROD=1` is set - a production default org turns every later omission into a production action.
This does not change `.vibeforce/config.json`; if the user wants the slot remapped, edit `orgs` and say so.

To name an existing authorization: `sf alias set <ALIAS>=<username>`.

### `limits <alias>`

```bash
sf org list limits --target-org <ALIAS> --json
```

Report each limit as `remaining / max` with a percentage, sorted by percentage remaining. Flag anything under
20%. Always include `DailyApiRequests`, `DailyAsyncApexExecutions`, `DailyBulkApiBatches`, and `DataStorageMB`
when the org returns them. For storage pressure, add:

```bash
sf org list sobject record-counts --sobject <Object> --target-org <ALIAS>
```

### `open <alias>`

```bash
sf org open --target-org <ALIAS>
sf org open --target-org <ALIAS> --url-only --path lightning/setup/DeployStatus/home
```

Use `--url-only` by default and print the URL rather than launching a browser; launch only when the user asks.
Useful paths: `lightning/setup/DeployStatus/home` (deployment status),
`lightning/setup/ApexClasses/home` (Apex classes), `lightning/setup/AsyncApexJobs/home` (async jobs).
`--source-file <path>` opens an ApexPage, FlexiPage, or Flow in its builder.

### `login [alias]`

```bash
sf org login web --alias <ALIAS>
```

Add `--instance-url <url>` for a sandbox or a My Domain login, `--set-default` only when the user asks, and
`--set-default-dev-hub` for a Dev Hub. This opens a browser and requires the user to authenticate - say so
before running it, and never pass credentials on the command line.

After a successful login, offer to map the new alias into a `.vibeforce/config.json` slot. Add it to
`productionAliases` when `sf org display` reports a non-sandbox, non-scratch org.

### `health <alias>`

A read-only snapshot, no deploy and no data change:

1. `sf org display --target-org <ALIAS> --json` - connected status and API version.
2. `sf org list limits --target-org <ALIAS> --json` - anything under 20% remaining.
3. Failed async work in the last day:

```bash
sf data query --target-org <ALIAS> --result-format json --query "SELECT Id, ApexClass.Name, JobType, Status, NumberOfErrors, ExtendedStatus, CompletedDate FROM AsyncApexJob WHERE Status IN ('Failed','Aborted') AND CreatedDate = LAST_N_DAYS:1 ORDER BY CompletedDate DESC"
```

4. `sf project deploy report --use-most-recent --target-org <ALIAS>` - the last deploy's status.

Output one table of `area | signal | verdict` and a single-line summary. For a full post-deploy verification with
tests and story assertions, use `/vf-verify <ALIAS>` instead - this subcommand is a cheap pulse check.

## Guardrails

| Rule | Reason |
| --- | --- |
| Never print an access token or an SFDX auth URL | They are credentials |
| Never run `sf org delete scratch`, `sf org delete sandbox`, or `sf org logout` from this command | Destructive; the user runs those deliberately |
| A production alias needs the user's explicit naming plus `VF_ALLOW_PROD=1` before `use` | Silent production defaults cause silent production deploys |
| Report an API version mismatch between the org and `apiVersion` in the config, do not fix it | Changing the project API version is a deliberate decision |
