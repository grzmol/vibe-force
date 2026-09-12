# `sfdx-project.json` reference

Authoritative schema: `@salesforce/core`
[`schemas/sfdx-project.schema.json`](https://github.com/forcedotcom/sfdx-core/blob/main/schemas/sfdx-project.schema.json).
Prose reference: [Salesforce DX Project Configuration](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_config.htm).

Commit this file. The CLI rewrites parts of it (`packageAliases`, and packaging fields during
`sf package create` / `sf package version create`), so review its diffs like code.

## Top-level properties

| Property | Type | Required | Meaning |
| --- | --- | --- | --- |
| `packageDirectories` | array | yes | Directories the project commands target when syncing source. Relative paths only; exactly one `default: true` |
| `name` | string | no (required for some Salesforce Functions projects) | Project name |
| `namespace` | string | no | Namespace applied to scratch orgs created from this project. Must be registered and linked to the Dev Hub. Empty string for no namespace |
| `sourceApiVersion` | string | no | API version the metadata conforms to; becomes `<version>` in the manifest the CLI generates |
| `sfdcLoginUrl` | string | no | Login URL used by `sf org login *`; default `https://login.salesforce.com` |
| `signupTargetLoginUrl` | string | no | Login URL stamped into newly created scratch orgs (test/ISV scenarios) |
| `oauthLocalPort` | number | no | Local OAuth callback port; default 1717. Must match the connected app's callback URL |
| `defaultLwcLanguage` | string | no | `javascript` (default) or `typescript`; controls what `sf template generate lightning component` scaffolds |
| `plugins` | object | no | Per-plugin configuration you want in version control |
| `packageAliases` | object | no | CLI-maintained alias → package/version id map (`0Ho…`, `04t…`) |
| `packageBundles` / `packageBundleAliases` | array / object | no | Package-bundle entries and their aliases |
| `replacements` | array | no | Deploy-time string or regex replacement in metadata source |
| `sourceBehaviorOptions` | array | no (Beta) | Extra decomposed metadata types. Managed by `sf project convert source-behavior`, never by hand |
| `registryCustomizations` | object | no | Local overrides of the metadata registry (advanced) |
| `registryPresets` | array | no | Deprecated — superseded by `sourceBehaviorOptions` |
| `pushPackageDirectoriesSequentially` | boolean | no | Deprecated. Only affected the retired `force:source:push`; `sf project deploy start` ignores it |

## `packageDirectories` entries

Minimal (source-only) form:

| Field | Meaning |
| --- | --- |
| `path` | Directory relative to the project root (`"force-app"` and `"./force-app"` are equivalent) |
| `default` | Marks the default directory: retrieve target, conversion output, and the directory `sf package create` assumes |

Packaging form adds (2GP / unlocked — see skill `sf-packaging-release`):

| Field | Meaning |
| --- | --- |
| `package` | Package name or alias this directory maps to |
| `versionName`, `versionNumber`, `versionDescription` | `major.minor.patch.build`, e.g. `1.2.1.NEXT` |
| `definitionFile` | Scratch-org-style definition used to build the package version |
| `dependencies` | Array of `{ "package": "<alias or 04t id>", "versionNumber": "1.2.0.LATEST" }` |
| `ancestorId` / `ancestorVersion` | Immediate ancestor of the version being created |
| `apexTestAccess` | Extra permission sets/licences granted while package Apex tests run |
| `packageMetadataAccess` | Extra access granted while package metadata deploys |
| `unpackagedMetadata` | Metadata deployed for testing but not packaged (test data factories, sample data) |
| `seedMetadata` | Metadata deployed **before** the packaged metadata |
| `postInstallScript`, `postInstallUrl`, `uninstallScript`, `releaseNotesUrl` | Managed-package install hooks and links |
| `scopeProfiles` | `true` = only include profile settings from the directory being packaged |
| `includeProfileUserLicenses` | Include `<userLicense>` in profile metadata; default `false` |
| `calculateTransitiveDependencies` | Derive indirect dependencies from the direct ones |

## Worked examples

### Single package directory, org-development model

```json
{
  "packageDirectories": [{ "path": "force-app", "default": true }],
  "namespace": "",
  "sfdcLoginUrl": "https://login.salesforce.com",
  "sourceApiVersion": "67.0"
}
```

### Multiple package directories, domain-aligned

```json
{
  "packageDirectories": [
    { "path": "force-app", "default": true },
    { "path": "sales-ext" },
    { "path": "service-ext" },
    { "path": "integration" },
    { "path": "unpackaged" }
  ],
  "namespace": "",
  "sfdcLoginUrl": "https://acme.my.salesforce.com",
  "sourceApiVersion": "67.0",
  "plugins": {
    "vibeforce": { "ownership": ".vibeforce/state/ownership.json" }
  }
}
```

`plugins` is a free-form object; values are read by whichever plugin owns the key. Keep only
settings that should apply to the whole team.

### Unlocked package with a dependency

```json
{
  "packageDirectories": [
    {
      "path": "force-app",
      "default": true,
      "package": "acme-core",
      "versionName": "Summer release",
      "versionNumber": "1.4.0.NEXT",
      "definitionFile": "config/project-scratch-def.json",
      "unpackagedMetadata": { "path": "test-data" },
      "dependencies": [{ "package": "acme-base@2.1.0.LATEST" }]
    },
    { "path": "unpackaged", "default": false }
  ],
  "namespace": "acme",
  "sourceApiVersion": "67.0",
  "packageAliases": {
    "acme-core": "0Ho1t000000XXXXXXX",
    "acme-base@2.1.0": "04t1t000000YYYYYYY"
  }
}
```

### Sandbox-first login URL

```json
{
  "sfdcLoginUrl": "https://acme--uat.sandbox.my.salesforce.com"
}
```

Use the My Domain form (`…my.salesforce.com`), not the Lightning URL
(`…lightning.force.com`); My Domain survives instance migrations. A `--instance-url` flag on
`sf org login *` overrides this value.

## `replacements`

Rewrites strings in metadata **as it is deployed or packaged**; the files on disk are untouched.

| Field | Required | Meaning |
| --- | --- | --- |
| `filename` *or* `glob` | one of them | Exact file path, or a glob such as `force-app/**/*.cls` |
| `stringToReplace` *or* `regexToReplace` | one of them | Literal string or regular expression to find |
| `replaceWithEnv` *or* `replaceWithFile` | one of them | Environment variable name, or a file whose contents become the replacement |
| `allowUnsetEnvVariable` | no | With `replaceWithEnv`, allow an unset variable (replaces with empty string) instead of failing |
| `replaceWhenEnv` | no | Array of `{ "env": "NAME", "value": "..." }` gates — the replacement happens only when all match |

```json
{
  "replacements": [
    {
      "glob": "force-app/**/*.cls",
      "stringToReplace": "__CALLOUT_BASE_URL__",
      "replaceWithEnv": "CALLOUT_BASE_URL"
    },
    {
      "filename": "force-app/main/default/namedCredentials/Acme.namedCredential-meta.xml",
      "regexToReplace": "<endpoint>.*</endpoint>",
      "replaceWithEnv": "ACME_ENDPOINT",
      "replaceWhenEnv": [{ "env": "CI", "value": "true" }]
    }
  ]
}
```

Inspect the result without deploying:

```bash
SF_APPLY_REPLACEMENTS_ON_CONVERT=true \
  sf project convert source --source-dir force-app --output-dir /tmp/converted
grep -r "CALLOUT_BASE_URL" /tmp/converted || echo "replacement applied"
```

`sf project deploy start --json` reports what it substituted in `result.replacements`.

Replacements are the sanctioned way to keep environment-specific endpoints out of source. They are
not a secret store: the value lands in org metadata, so use them for URLs and ids, and keep real
credentials in External Credentials / Named Credentials (skill `sf-integration-patterns`).

## `sourceBehaviorOptions`

| Value | Decomposes |
| --- | --- |
| `decomposeCustomLabelsBeta2` | `CustomLabels` |
| `decomposePermissionSetBeta2` | `PermissionSet` |
| `decomposeSharingRulesBeta` | `SharingRules` |
| `decomposeWorkflowBeta` | `Workflow` |
| `decomposeExternalServiceRegistrationBeta` | `ExternalServiceRegistration` |

`decomposeCustomLabelsBeta` and `decomposePermissionSetBeta` (the v1 values) are still accepted by
`sf project convert source-behavior --behavior`, but new projects should use the `Beta2` variants.

```bash
git status --porcelain | grep . && { echo "commit first"; exit 1; }
sf project convert source-behavior --behavior decomposePermissionSetBeta2 --dry-run
sf project convert source-behavior --behavior decomposePermissionSetBeta2
```

To back it out: revert the commit the command produced and recreate any source-tracking org.

## API version rules

| Setting | Controls | Where |
| --- | --- | --- |
| `sourceApiVersion` | Shape of the *metadata* — the `<version>` element of the generated manifest | `sfdx-project.json` |
| `apiVersion` (`org-api-version` config / `SF_ORG_API_VERSION` / `--api-version`) | Shape of the *HTTP request* — the Metadata API endpoint version | config, env, flag |

Consequences:

- Retrieving with a `sourceApiVersion` older than the field's introducing release silently omits
  that field.
- Deploying a file containing a newer field with an older `sourceApiVersion` fails.
- A manifest's own `<version>` beats `sourceApiVersion`; `sourceApiVersion` beats `--api-version`,
  `SF_ORG_API_VERSION`, and `org-api-version` for the metadata shape.

vibe-force keeps `sourceApiVersion` == `apiVersion` == `config/vibe-force.defaults.json` →
`apiVersion` (`67.0`). `sf doctor` flags a mismatch.

```bash
sf project generate manifest --source-dir force-app --name /tmp/package.xml
grep -o '<version>.*</version>' /tmp/package.xml   # must echo the pinned version
```

## Validation checklist

| Check | Command |
| --- | --- |
| Valid JSON, one default directory | `node -e "const p=require('./sfdx-project.json');const d=p.packageDirectories.filter(x=>x.default);if(d.length!==1)throw new Error('need exactly one default, found '+d.length)"` |
| No absolute paths | `node -e "require('./sfdx-project.json').packageDirectories.forEach(d=>{if(d.path.startsWith('/'))throw new Error(d.path)})"` |
| Every directory exists | `node -e "const fs=require('fs');require('./sfdx-project.json').packageDirectories.forEach(d=>{if(!fs.existsSync(d.path))throw new Error('missing '+d.path)})"` |
| Pinned API version | `node -e "const p=require('./sfdx-project.json');if(p.sourceApiVersion!=='67.0')throw new Error(p.sourceApiVersion)"` |
| CLI agrees with the file | `sf project deploy preview --target-org vf-dev` (lists per-directory components) |
| Doctor is happy | `sf doctor --output-dir .vibeforce/reports/doctor` |

`vf-check format` and `vf-check lint` glob from `packageDirectories`; a directory that is on disk but
not in this file is invisible to both the CLI and the gates.

## Sources

- `sfdx-project.schema.json`: <https://github.com/forcedotcom/sfdx-core/blob/main/schemas/sfdx-project.schema.json>
- Salesforce DX Project Configuration: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_config.htm>
- Multiple Package Directories: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_mpd.htm>
- Replace Strings in Code Before Deploying or Packaging: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_string_replace.htm>
- Decomposed Metadata Types: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_decomposed_md_types.htm>
- How API Version and Source API Version Work in Salesforce CLI: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_dev_api_version.htm>
- Project Configuration File for a Second-Generation Managed Package: <https://developer.salesforce.com/docs/atlas.en-us.pkg2_dev.meta/pkg2_dev/sfdx_dev_dev2gp_config_file.htm>
