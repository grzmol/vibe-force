# `sf package` command matrix

Source: Salesforce CLI command reference (`salesforcecli/cli`, `@salesforce/plugin-packaging`),
current at Summer '26 / API version 67.0.

Every command accepts `--json` and `--flags-dir`; org-touching ones accept `--api-version`.

## Id prefixes - know which one a flag wants

| Prefix | Object |
| --- | --- |
| `0Ho` | Package |
| `04t` | Subscriber package **version** - the thing you install |
| `05i` | Package version (Dev Hub side) |
| `08c` | Package version **create request** |
| `0Hf` | Package **install** request |
| `06y` | Package **uninstall** request |
| `033` | First-generation managed package (1GP) |

Most "it says the id is invalid" errors are a `0Ho` passed where a `04t` belongs.

## Package lifecycle - Dev Hub side

| Command | Required flags | Notes |
| --- | --- | --- |
| `sf package create` | `--name`, `--package-type`, `--path`, `--target-dev-hub` | `--package-type` is `Managed` or `Unlocked`. `-e, --no-namespace` is unlocked-only. `--org-dependent` applies to unlocked packages only. Writes the `0Ho` alias into `sfdx-project.json` |
| `sf package update` | `--package`, `--target-dev-hub` | Change `--name`, `--description`, `--error-notification-username`, or `--recommended-version-id` (the version installed when subscribers click the install link) |
| `sf package delete` | `--package`, `--target-dev-hub` | `-n, --no-prompt` skips the confirmation |
| `sf package list` | `--target-dev-hub` | Everything in the Dev Hub |
| `sf package convert` | `--package` (a `033` 1GP id), `--target-dev-hub` | Converts a 1GP managed package to 2GP. `-m, --seed-metadata` deploys metadata before conversion; `-a, --patch-version` targets a specific released patch |

## Version lifecycle

### `sf package version create`

Required: `--target-dev-hub`, and either `--installation-key` or `--installation-key-bypass`.

| Flag | Meaning |
| --- | --- |
| `-p, --package` | `0Ho` id or alias of the package |
| `-d, --path` | Directory holding the contents |
| `-n, --version-number` | Overrides `sfdx-project.json` |
| `-a, --version-name`, `-e, --version-description` | Override the project file |
| `-k, --installation-key` | Protect the version with a key |
| `-x, --installation-key-bypass` | Create with no key |
| `-c, --code-coverage` | Calculate and store coverage by running packaged Apex tests |
| `-f, --definition-file` | Scratch-org-like definition describing the build org |
| `-b, --branch` | Source-control branch the version is based on |
| `-t, --tag` | Version tag |
| `-w, --wait` | Minutes to wait |
| `--skip-validation` | **A version created this way cannot be promoted** |
| `--async-validation` | Return the version before validations complete |
| `--skip-ancestor-check` | Override ancestry requirements |
| `--generate-pkg-zip` | Produce a ZIP for debugging or inspection |
| `--post-install-script`, `--uninstall-script` | Managed packages only |
| `--post-install-url`, `--releasenotes-url` | Subscriber-facing URLs |
| `--language` | Package language |
| `--verbose` | Verbose output |

The two flags that decide whether a build is releasable: `--code-coverage` (you want it) and
`--skip-validation` (it blocks promotion).

### The rest

| Command | Required flags | Notes |
| --- | --- | --- |
| `sf package version create list` | `--target-dev-hub` | Filter with `-s, --status` and `-c, --created-last-days` |
| `sf package version create report` | `--package-create-request-id` (`08c`), `--target-dev-hub` | Where a failed build tells you why |
| `sf package version promote` | `--package` (`04t` or alias), `--target-dev-hub` | Promotes to **released**. `-n, --no-prompt` skips confirmation |
| `sf package version list` | `--target-dev-hub` | `-p, --packages` filters; `-r, --released` shows released only; `-b, --branch`, `-o, --order-by`, `-c, --created-last-days`, `-m, --modified-last-days` |
| `sf package version report` | `--package` (`04t`), `--target-dev-hub` | Detail for one version |
| `sf package version update` | `--package` (`04t`), `--target-dev-hub` | Change `--version-name`, `--version-description`, `--branch`, `--tag`, `--installation-key` |
| `sf package version delete` | `--package` (`04t`), `--target-dev-hub` | `-n, --no-prompt` |
| `sf package version retrieve` | `--package` (`04t`), `--target-dev-hub` | Retrieves the version's source into `-d, --output-dir`, default `force-app` |
| `sf package version displayancestry` | `--package` (`0Ho` or `04t`), `--target-dev-hub` | `--dot-code` emits DOT for a graph tool |
| `sf package version displaydependencies` | `--package` (`04t`), `--target-dev-hub` | `--edge-direction root-first\|root-last`; `-k` for key-protected versions |

## Subscriber org side

| Command | Required flags | Notes |
| --- | --- | --- |
| `sf package install` | `--package` (`04t`), `--target-org` | See the flag table below |
| `sf package install report` | `--request-id` (`0Hf`), `--target-org` | Poll a running install |
| `sf package installed list` | `--target-org` | What is installed right now |
| `sf package uninstall` | `--package` (`04t`), `--target-org` | `-w, --wait` |
| `sf package uninstall report` | `--request-id` (`06y`), `--target-org` | Poll a running uninstall |

### `sf package install` flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `-p, --package` | - | `04t` id or alias of the version |
| `-k, --installation-key` | null | Required for a key-protected package |
| `-r, --no-prompt` | off | Allows without confirmation: (1) Remote Site Settings and Content Security Policy websites sending or receiving data, and (2) `--upgrade-type Delete` to proceed |
| `-s, --security-type` | `AdminsOnly` | Security access type for the installed package |
| `-t, --upgrade-type` | `Mixed` | `Mixed`, `DeprecateOnly` or `Delete`. Unlocked packages only |
| `-a, --apex-compile` | `all` | Compile all Apex in the org and package, or only Apex in the package |
| `-w, --wait` | - | Minutes to wait for installation status |
| `-b, --publish-wait` | - | Minutes to wait for the `04t` id to become available |

### `--upgrade-type`, spelled out

Applies when upgrading an **unlocked** package whose new version removed components.

| Value | Behaviour |
| --- | --- |
| `Mixed` | Removed components are deprecated or deleted, per component type. The default |
| `DeprecateOnly` | Removed components are deprecated, never deleted. The safe choice |
| `Delete` | Removed components are deleted from the subscriber org. **Can result in the loss of data associated with the deleted components** |

## 1GP - `sf package1`

`sf package1 version create`, `create get`, `display` and `list` operate on first-generation
managed packages. New work should be 2GP; `sf package convert` migrates an existing 1GP.

## CI recipes

Create, wait, and fail on a bad build:

```bash
set -euo pipefail

req=$(sf package version create \
        --package "Expense Manager" \
        --installation-key-bypass --code-coverage \
        --target-dev-hub devhub --json | jq -r '.result.Id')

sf package version create report --package-create-request-id "$req" --target-dev-hub devhub --json \
  | jq -e '.result[0].Status == "Success"' > /dev/null

ver=$(sf package version create report --package-create-request-id "$req" \
        --target-dev-hub devhub --json | jq -r '.result[0].SubscriberPackageVersionId')
echo "version $ver"
```

Install into a test org, unattended and safe:

```bash
sf package install --package "$ver" --target-org acme-uat \
  --wait 20 --publish-wait 20 --no-prompt --upgrade-type DeprecateOnly
```

`--upgrade-type DeprecateOnly` is pinned deliberately: `--no-prompt` would otherwise authorise a
`Delete` upgrade with no human in the loop.

Read the dependency graph before you change a version pin:

```bash
sf package version displaydependencies --package "$ver" --target-dev-hub devhub --edge-direction root-first
sf package version displayancestry --package "Expense Manager" --target-dev-hub devhub --dot-code > ancestry.dot
```

## Gotchas

| Symptom | Cause | Fix |
| --- | --- | --- |
| Install hangs with no output in CI | A Remote Site Setting or CSP Trusted Site prompt | `--no-prompt` |
| "Can't promote unvalidated package versions" | The version was created with `--skip-validation` | Rebuild without it |
| Install fails on standard picklist values | `StandardValueSet` cannot be packaged | `seedMetadata` on the package directory |
| Version create fails on Apex test permissions | Tests need permission sets the creating user lacks | `apexTestAccess` in `sfdx-project.json` |
| Version create fails on missing metadata the tests need | Test fixtures are not in the package | `unpackagedMetadata` directory |
| Subscribers cannot upgrade | `ancestorVersion` set to `NONE` | Set a real ancestor, or `HIGHEST` |
| Two versions at the same number | `versionNumber` not incremented | Use `NEXT` in the build position |
| Id rejected as invalid | `0Ho` passed where `04t` is required, or the reverse | Check the prefix table above |
