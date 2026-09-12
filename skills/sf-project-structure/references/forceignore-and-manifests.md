# `.forceignore` and manifests

Two different exclusion/selection mechanisms, often confused:

| Mechanism | Scope | Honoured by |
| --- | --- | --- |
| `.forceignore` | Excludes local files from *every* project command | `project deploy start`, `project retrieve start`, `project convert source`, `project delete source` (and the previews) |
| `package.xml` | Selects components for one operation | `--manifest` on deploy/retrieve/convert, and Metadata API directly |
| `destructiveChangesPre.xml` / `destructiveChangesPost.xml` | Deletes components during a deployment | `--pre-destructive-changes` / `--post-destructive-changes` |

## `.forceignore` semantics

- Same syntax and matching rules as `.gitignore`.
- Always forward slashes, even on Windows.
- `*` matches anything except `/`; `**` crosses directory boundaries.
- Paths are relative to the directory containing the `.forceignore` file.
- Blank lines separate blocks; `#` starts a comment.

### Precedence with multiple files

When a project command evaluates a source file it walks **up** the directory tree from that file,
uses the **first** `.forceignore` it finds, and stops. It never merges two files.

```text
my-project/
├── .forceignore                 # ignores nothing under classes/
├── force-app/
│   └── main/default/classes/PagedNewResult.cls      -> judged by the ROOT file  => deployed
└── second-package/
    ├── .forceignore             # "Paged*"
    └── main/default/classes/PagedResult.cls          -> judged by second-package => ignored
```

`sf project deploy start --metadata ApexClass` therefore deploys `PagedNewResult` and skips
`PagedResult`. Prefer one root file; document any per-package file in the repo README.

### Always ignored, with or without an entry

- Any file or directory starting with a dot (`.DS_Store`, `.sf`, `.sfdx`).
- Any file ending in `.dup`.
- `package2-descriptor.json`.
- `package2-manifest.json`.

### Patterns that work

```gitignore
# ---- tooling / editor / test files that must never reach an org
**/jsconfig.json
**/.eslintrc.json
**/.eslintrc.cjs
**/__tests__/**
**/*.test.js
.localdevserver/

# ---- a single component: MetadataWithContent has TWO files
force-app/main/default/classes/LegacyBatch.cls
force-app/main/default/classes/LegacyBatch.cls-meta.xml
# equivalent, using a trailing wildcard
force-app/main/default/classes/LegacyBatch.cls*

# ---- a whole bundle (LWC / Aura)
**/lwc/legacyComponent
**/aura/LegacyApp

# ---- every component of a type, wherever it lives
**/classes
**/profiles/**

# ---- by extension
**.cls*
**.pdf

# ---- specific file in one package directory
sales-ext/main/default/layouts/Account-Sales Layout.layout-meta.xml

# ---- encoded special characters (colon in the component name)
**/Custom%3A Marketing Profile.profile-meta.xml
```

### Excluding remote changes you never want to pull

Add the path of the file that *would be created* if you retrieved the component:

```gitignore
**/Dreamhouse.permissionset-meta.xml
```

Source tracking still reports the remote change, but `sf project retrieve start` will not write it.

### Finding the exact filename to ignore

```bash
# From the source tree
ls force-app/main/default/permissionsets

# From the CLI's own view of pending changes (Path column is exactly what to ignore)
sf project deploy preview --target-org vf-dev
sf project retrieve preview --target-org vf-dev

# Confirm the entry took effect
sf project list ignored
sf project list ignored --source-dir force-app/main/default/classes
```

### Where the file lives

| Command | `.forceignore` location it uses |
| --- | --- |
| `project deploy start` / `retrieve start` / `delete source` / `convert source` | Project root (or the nearest one above the file — see precedence) |
| `project convert mdapi` | The metadata retrieve directory, next to `package.xml` |

### Production-grade starting point

```gitignore
# ==== vibe-force baseline .forceignore ====================================
# Local tooling — never org metadata
**/jsconfig.json
**/.eslintrc.json
**/.eslintrc.cjs
**/__tests__/**
**/__mocks__/**
**/*.test.js
**/*.spec.js
.localdevserver/
.vibeforce/

# Org-level configuration owned by admins, not by this repo
**/profiles/**
**/*.settings-meta.xml

# High-churn, low-value metadata that fights merges
**/labels/CustomLabels.labels-meta.xml
**/reports/**
**/dashboards/**
**/*.listView-meta.xml

# Managed-package artefacts that cannot be deployed back
**/installedPackages/**

# Certificates and connected apps: secrets are not retrievable, so the files are
# incomplete and deploying them breaks the org configuration
**/certs/**
**/connectedApps/**
```

Each exclusion is a decision, not a default. Ignoring `**/profiles/**` requires permission sets to
carry the access (skill `sf-security-model`); ignoring `**/reports/**` means report changes are
managed in the org and are not reproducible in a new scratch org.

## `package.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>AccountService</members>
        <members>AccountServiceTest</members>
        <name>ApexClass</name>
    </types>
    <types>
        <members>*</members>
        <name>CustomObject</name>
    </types>
    <version>67.0</version>
</Package>
```

| Element | Meaning |
| --- | --- |
| `<fullName>` | Name of a server-side package. Absent means an unpackaged, client-side manifest |
| `<types>` | One block per metadata type; repeat freely |
| `<members>` | `fullName` of a component, or `*` for every component of that type when the type allows wildcards |
| `<name>` | Metadata type name exactly as in the Metadata API WSDL (`ApexClass`, `CustomObject`, `Settings`) |
| `<version>` | API version used for the operation. vibe-force pins `67.0` |

Wildcard rules that cost people hours:

| Case | Behaviour |
| --- | --- |
| `*` support is per type | The "Allows Wildcard (\*)?" column of the Metadata Types reference is the authority |
| `<members>*</members>` for `CustomObject` | Returns all **custom** objects, not standard objects |
| Standard objects | Must be named explicitly (`<members>Account</members>` under `CustomObject`) |
| `*` and managed packages | Wildcard retrieves exclude components in managed packages; name them with the namespace (`myns__MyCustomObject__c`) or retrieve the package by name |
| Managed component access in profiles/permission sets | Namespace plus two underscores, and wildcards are not supported |
| `destructiveChanges*.xml` | Wildcards are **not** supported at all |

Naming conventions inside `<members>`:

| Component | `fullName` form | Example |
| --- | --- | --- |
| Field | `Object.Field` | `MyObject__c.MyField__c`, `Account.SLA__c`, `Account.Phone` |
| List view | `Object.ViewUniqueName` | `Account.AccountTeam` |
| Record type, validation rule, compact layout | `Object.Name` | `Account.Partner` |
| Layout | `Object-Layout Name` | `Account-Account Layout` |
| Standard picklist (API 38.0+) | `StandardValueSet` member | `Industry`, `SalesTeamRole` (case-sensitive) |
| Settings | member = area, type = `Settings` | `<members>Security</members><name>Settings</name>` |
| Rule container vs single rule | `AssignmentRules` takes an object; `AssignmentRule` takes `Object.ruleName` | `Case` vs `Case.samplerule` |
| Sharing rules | `SharingCriteriaRule`, `SharingOwnerRule`, `SharingTerritoryRule`, `SharingGuestRule`; `Object.*` and `*` supported | `Lead.testShareRule`, `Account.*` |
| Managed component | `namespace__Name` | `myns__MyCustomObject__c` |

### Generating manifests

```bash
# From local source (what this branch changed)
sf project generate manifest --source-dir force-app --name manifest/package.xml

# From specific components
sf project generate manifest \
  --metadata ApexClass:AccountService --metadata CustomObject:Broker__c \
  --name manifest/package.xml

# From an org's full inventory (slow; excludes managed/unlocked package metadata by default)
sf project generate manifest --from-org vf-prod --output-dir manifest
sf project generate manifest --from-org vf-prod --include-packages unlocked \
  --excluded-metadata Report --excluded-metadata Dashboard --output-dir manifest

# Destructive manifests by type: pre | post | destroy | package
sf project generate manifest --metadata ApexClass:ObsoleteService --type post --output-dir manifest
```

`--type` controls the generated filename: `package` → `package.xml`, `pre` →
`destructiveChangesPre.xml`, `post` → `destructiveChangesPost.xml`, `destroy` →
`destructiveChanges.xml`. `--name` overrides it. Tune `--from-org` concurrency with
`SF_LIST_METADATA_BATCH_SIZE` (default 500 parallel `listMetadata` calls).

### Using a manifest

```bash
sf project retrieve start --manifest manifest/package.xml --target-org vf-prod
sf project deploy start   --manifest manifest/package.xml --target-org vf-int --dry-run
sf project convert source --manifest manifest/package.xml --output-dir mdapi-out
```

Source-tracking caveat: retrieves driven by a manifest still return profile information for
everything source tracking currently reports, not only what the manifest names. Reviewing profile
diffs after a tracked retrieve is therefore misleading — another reason for the permission-set
policy.

## Destructive changes

A deletion is a deployment whose payload names components to remove. The deletion manifest has the
same shape as `package.xml` **without** wildcards.

`destructiveChangesPost.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>ObsoleteObject__c</members>
        <name>CustomObject</name>
    </types>
</Package>
```

Accompanying `package.xml` for a delete-only deployment (components empty, version required):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <version>67.0</version>
</Package>
```

```bash
# Validate first — always.
sf project deploy validate --target-org vf-int \
  --manifest manifest/package.xml \
  --post-destructive-changes manifest/destructiveChangesPost.xml \
  --test-level RunLocalTests

sf project deploy start --target-org vf-int \
  --manifest manifest/package.xml \
  --post-destructive-changes manifest/destructiveChangesPost.xml \
  --purge-on-delete
```

| Rule | Detail |
| --- | --- |
| `Pre` vs `Post` | `destructiveChangesPre.xml` deletes **before** additions/updates; `destructiveChangesPost.xml` deletes **after**. Available since API 33.0 |
| Default order | With plain `destructiveChanges.xml`, deletions run before additions |
| Dependency breaking | Use `Post` when an addition removes the dependency (update the Apex class, then delete the object it referenced). Post destructive changes are processed *before* tests run |
| Recycle Bin | Deleted components go to the Recycle Bin unless `--purge-on-delete`. Roll-up summary fields are always purged |
| Lightning pages | You cannot delete a custom object, a component on an active Lightning page, or the page itself while the page's action override is active — deactivate it in Lightning App Builder first |
| Partial success | If some named components do not exist, the remaining deletions are still attempted |
| Apex deletions | When deleting Apex classes or triggers, run local tests in the same deployment to surface remaining references |
| Manifest version | The API version used for the deployment is the one in `package.xml` |

Local-and-org deletion in a tracked org is simpler:

```bash
sf project delete source --metadata ApexClass:ObsoleteService --target-org vf-dev --check-only
sf project delete source --metadata ApexClass:ObsoleteService --target-org vf-dev --no-prompt \
  --test-level RunSpecifiedTests --tests AccountServiceTest
```

vibe-force hooks treat destructive operations as high risk: `blockDestructive` in
`.vibeforce/config.json` blocks `--post-destructive-changes`, `--pre-destructive-changes`,
`sf project delete source`, and `--purge-on-delete` against a `productionAliases` target unless
`VF_ALLOW_PROD=1` is set for that single run.

## Verification checklist

| Question | Command |
| --- | --- |
| What is currently ignored? | `sf project list ignored` |
| Is this specific file ignored? | `sf project list ignored --source-dir <path>` |
| What would deploy, delete, conflict, or be ignored? | `sf project deploy preview --target-org <alias>` |
| Does the manifest select what I think? | `sf project deploy start --manifest manifest/package.xml --dry-run --target-org <alias>` |
| Does the destructive manifest resolve? | `sf project deploy validate --manifest manifest/package.xml --post-destructive-changes manifest/destructiveChangesPost.xml --target-org <alias>` |
| Does the API version match the project? | `grep -o '<version>.*</version>' manifest/package.xml` |
| Is the local gate green first? | `node "$VF_ROOT/scripts/checks/vf-check.mjs" local` |

## Sources

- How to Exclude Source When Syncing: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_exclude_source.htm>
- Deploying and Retrieving Metadata with the Zip File: <https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/deploying_and_retrieving_metadata_with_the_zip_file.htm>
- Sample package.xml Manifest Files: <https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/manifest_samples.htm>
- Deleting Components from an Organization: <https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_deploy_deleting_files.htm>
- Metadata Types (wildcard support per type): <https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_types_list.htm>
- `sf project generate manifest`, `sf project list ignored`, `sf project delete source`: <https://github.com/salesforcecli/plugin-deploy-retrieve/blob/main/README.md>
