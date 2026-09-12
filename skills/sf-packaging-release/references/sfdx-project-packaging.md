# `sfdx-project.json` packaging attributes

Source: Salesforce DX Developer Guide, "Project Configuration File for Unlocked Packages",
"Package Installation Key", "Specify Unpackaged Metadata or Apex Access for Apex Tests (Unlocked
Packages)", "Manage Apex Access for Package Version Creation Tests". Summer '26 / API version 67.0.

Non-packaging keys of this file (`sourceApiVersion`, `sfdcLoginUrl`, plain `packageDirectories`)
are covered by skill `sf-project-structure`. This reference is the packaging subset.

**A parameter supplied on the CLI overrides the value in the project file.**

## Full attribute table

| Name | Required | Default and meaning |
| --- | --- | --- |
| `package` | yes | The package name specified in the project file |
| `path` | yes | Directory containing the package contents. Without one, the CLI uses a placeholder when you create the package |
| `versionNumber` | yes | Sets the version number assigned the next time you create a version. Format `MAJOR.MINOR.PATCH.BUILD`, for example `1.2.1.8`. **You must increment it before creating a new version**, or you get multiple versions at the same number. `NEXT` in the build position auto-increments |
| `versionName` | no | Defaults to `versionNumber` |
| `versionDescription` | no | None |
| `packageAliases` | yes | The CLI writes aliases here when you create a package or version. You may also edit it by hand. Use the alias instead of the cryptic id in `sf package` commands |
| `namespace` | no | None. A 1-15 character alphanumeric identifier distinguishing your package and its contents from other developers' packages |
| `dependencies` | no | None. Packages this one requires |
| `calculateTransitiveDependencies` | no | False. When true, list only direct dependencies and the indirect ones are calculated for you |
| `ancestorVersion` / `ancestorId` | no | None. Defines the package upgrade path |
| `seedMetadata` | no | None. Path to a seed metadata directory. **Standard value sets only** |
| `unpackagedMetadata` | no | None. Metadata that is not part of the package, available to package-creation Apex tests |
| `apexTestAccess` | no | None. Permission sets and permission set licenses assigned to the user running Apex tests at version create |
| `includeProfileUserLicenses` | no | False. When true, user licenses associated with profiles in unlocked packages are retained during version creation. By default unlocked packages remove profile information not pertinent to the packaged metadata |
| `postInstallUrl` | no | None. A URL to post-install instructions for subscribers |
| `releaseNotesUrl` | no | None. A URL to release notes |
| `definitionFile` | no | None. Path to a definition file, similar to a scratch org definition, describing features and org preferences |
| `default` | no | Marks the default package directory |

## A complete example

```json
{
  "namespace": "",
  "sfdcLoginUrl": "https://login.salesforce.com",
  "sourceApiVersion": "67.0",
  "packageDirectories": [
    {
      "path": "util",
      "default": true,
      "package": "Expense Manager - Util",
      "versionName": "Summer '26",
      "versionDescription": "Welcome to the Summer 2026 release of Expense Manager Util",
      "versionNumber": "4.7.0.NEXT",
      "definitionFile": "config/scratch-org-def.json"
    },
    {
      "path": "exp-core",
      "default": false,
      "package": "Expense Manager",
      "versionName": "v 3.2",
      "versionDescription": "Summer 2026 Release",
      "versionNumber": "3.2.0.NEXT",
      "postInstallUrl": "https://expenser.com/post-install-instructions.html",
      "releaseNotesUrl": "https://expenser.com/summer-2026-release-notes.html",
      "definitionFile": "config/scratch-org-def.json",
      "dependencies": [
        { "package": "Expense Manager - Util", "versionNumber": "4.7.0.LATEST" }
      ]
    }
  ],
  "packageAliases": {}
}
```

## Version numbering

Format: `MAJOR.MINOR.PATCH.BUILD`.

| Keyword | Where | Effect |
| --- | --- | --- |
| `NEXT` | Build position of `versionNumber` | Automatically increments to the next available build for the package, for example `1.2.1.NEXT` |
| `LATEST` | Build position of a dependency's `versionNumber` | Pins to the latest build of that `MAJOR.MINOR.PATCH`, for example `4.7.0.LATEST` |

Alternatively, set the number per build with `--version-number` on `sf package version create`; the
flag wins over the file.

## Dependencies

Direct only, with transitive calculation enabled:

```json
"calculateTransitiveDependencies": true,
"dependencies": [
  { "package": "Expense Manager - Util", "versionNumber": "4.7.0.LATEST" }
]
```

The guide's worked example: with `calculateTransitiveDependencies` enabled, if your package depends
on `Expense Manager - Util`, which itself depends on `External Apex Library`, you declare only
`Expense Manager - Util` and the chain is resolved for you.

Without it, you declare the whole chain by hand - and it drifts the first time a dependency adds one
of its own.

Inspect what actually resolved:

```bash
sf package version displaydependencies --package 04t... --target-dev-hub devhub --edge-direction root-first
```

## Ancestry

`ancestorVersion` and `ancestorId` define the upgrade path from one version to the next.

| Value | Effect |
| --- | --- |
| A specific version or id | That version is the ancestor |
| `"HIGHEST"` | Automatically sets the ancestor to the highest promoted and released version. Use only with `ancestorVersion` or `ancestorId` |
| `"NONE"` | **An existing customer cannot upgrade to that package version.** The upgrade path is broken deliberately |

```json
{
  "path": "util",
  "package": "Expense Manager - Util",
  "versionNumber": "4.7.0.NEXT",
  "ancestorVersion": "HIGHEST"
}
```

`--skip-ancestor-check` on `sf package version create` overrides the requirement, allowing an
ancestor that would otherwise be rejected. Inspect the resulting tree with
`sf package version displayancestry --dot-code`.

## `seedMetadata`

```json
"packageDirectories": [
  {
    "seedMetadata": { "path": "my-unpackaged-seed-directory" }
  }
]
```

Seed metadata is **available to standard value sets only**. If your package depends on standard
value sets, put the value sets in a seed metadata directory. It is not a general escape hatch for
metadata that will not package.

`sf package convert` has the equivalent flag `-m, --seed-metadata`: a directory of metadata deployed
before the 1GP-to-2GP conversion.

## `unpackagedMetadata`

```json
{
  "path": "force-app",
  "package": "TV_unl",
  "versionName": "ver 0.1",
  "versionNumber": "0.1.0.NEXT",
  "default": true,
  "unpackagedMetadata": { "path": "my-unpackaged-directory" }
}
```

Intended for metadata that is **not** part of your package but that package-creation Apex tests
need. The rule the guide states plainly: **you cannot include the same metadata in both an
unpackaged directory and a packaged directory.**

## `apexTestAccess`

When the Apex tests that run at version creation need permission sets or permission set licenses:

```json
{
  "path": "force-app",
  "package": "TV_unl",
  "versionNumber": "0.1.0.NEXT",
  "default": true,
  "unpackagedMetadata": { "path": "my-unpackaged-directory" },
  "apexTestAccess": {
    "permissionSets": ["Permission_Set_1", "Permission_Set_2"],
    "permissionSetLicenses": ["SalesConsoleUser"]
  }
}
```

These are assigned to the user in whose context the tests run during package version creation. It is
the fix for "the tests pass in a scratch org and fail at version create".

## `includeProfileUserLicenses`

```json
{
  "package": "PackageA",
  "path": "common",
  "versionName": "ver 0.1",
  "versionNumber": "0.1.0.NEXT",
  "default": false,
  "includeProfileUserLicenses": true
}
```

Default false. Unlocked packages strip profile information not pertinent to the packaged metadata;
setting this to `true` retains the user licenses associated with those profiles.

## Installation keys

Set the key when creating the version:

```bash
sf package version create --package "Expense Manager" --installation-key "<key>" --wait 30 --target-dev-hub devhub
```

The key is the **first** step during installation. It ensures no package information - name,
components - is disclosed until the correct key is supplied. Package creators give the key to
authorized subscribers, who supply it whether installing from the CLI or a browser.

Either `--installation-key` or `--installation-key-bypass` must be given at version create.

Never pass the key as a literal on a command line in CI. The vibe-force Bash guard denies
credentials as command-line arguments; read it from an environment variable or a secret store.

## Checklist before `sf package version create`

- [ ] `versionNumber` incremented, or `NEXT` in the build position
- [ ] `ancestorVersion` is a real version or `HIGHEST`, never a stale `NONE`
- [ ] `dependencies` declared, and `calculateTransitiveDependencies` set if the graph has depth
- [ ] `seedMetadata` present if the package touches standard value sets
- [ ] `unpackagedMetadata` present if package-creation tests need fixtures, and no metadata is duplicated between packaged and unpackaged
- [ ] `apexTestAccess` present if those tests need permission sets
- [ ] `--code-coverage` passed, and `--skip-validation` **not** passed
- [ ] Installation key read from the environment, not typed into the command
- [ ] `vf-check local` green on the source that is about to be packaged
