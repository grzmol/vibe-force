# Installing fflib and laying out the repo

Verified against `apex-enterprise-patterns/fflib-apex-common` @ `master` commit `dab5977`,
`fflib-apex-mocks` @ `master` commit `d81e9e1`, `fflib-apex-common-samplecode` @ `master`
commit `4657d63`. `apiVersion` for every generated file is `67.0`, the single source of truth in
`config/vibe-force.defaults.json`.

## 1. What the upstream repos actually contain

```
fflib-apex-common/
  sfdx-project.json                 packageDirectories: [sfdx-source/apex-common], sourceApiVersion 63.0
  sfdx-source/apex-common/
    main/classes/*.cls(+ -meta.xml) 22 production classes and interfaces
    main/labels/fflib-Apex-Common-CustomLabels.labels-meta.xml   <-- REQUIRED, see below
    test/classes/*.cls              the library's own unit tests
  docs/changelog.md

fflib-apex-mocks/
  sfdx-project.json                 packageDirectories: [sfdx-source/apex-mocks], sourceApiVersion 67.0
  sfdx-source/apex-mocks/
    main/classes/*.cls              23 production classes and interfaces (no other metadata)
    test/classes/*.cls              the library's own unit tests

fflib-apex-common-samplecode/
  sfdx-project.json                 packageDirectories: [sfdx-source/untracked (non-default),
                                                         sfdx-source/apex-common-samplecode (default)]
  sfdx-source/apex-common-samplecode/main/classes/{,service,domains,selectors,
                                       triggerHandlers,controllers,batchjobs,restapis}
  sfdx-source/apex-common-samplecode/test/classes/...
```

**`main/labels` is not optional.** `fflib_SecurityUtils` resolves its exception text through
`System.Label.fflib_security_error_object_not_readable`,
`..._object_not_insertable`, `..._object_not_updateable`, `..._object_not_deletable`,
`..._field_not_readable`, `..._field_not_insertable` and `..._field_not_updateable`
(`fflib_SecurityUtils.cls`, `CrudException` and `FlsException` constructors). Copy the classes
without the labels and the deploy fails to compile `fflib_SecurityUtils` with
`Variable does not exist: fflib_security_error_object_not_readable`. `fflib-apex-mocks` ships
classes only.

Neither library publishes a GitHub release or an unlocked-package version id (`releases` API returns
an empty array for both repos; the READMEs offer only a githubsfdeploy button). **Any `04t...` id for
fflib is `[unverified]`** - never hard-code one into a setup script.

## 2. Install options and their tradeoffs

| Option | Command | Upgrade | Pros | Cons |
| --- | --- | --- | --- | --- |
| A. Vendor into a dedicated package directory | `cp -R` from a pinned clone, commit the files | re-copy at a new commit, review the diff | reproducible; deployable with your own metadata; works in 2GP dependencies | library source lives in your repo (~5.6k lines) |
| B. Git submodule | `git submodule add` + a package directory pointing inside it | `git submodule update --remote` | source stays upstream; commit pin is explicit | every clone needs `--recurse-submodules`; CI and Code Analyzer paths get longer; `sf` packaging of submodule paths is awkward |
| C. Deploy-only (no repo copy) | clone to `/tmp`, `sf project deploy start` | re-clone and redeploy | zero repo footprint | org drifts from repo; nothing to review; not packageable; scratch org creation needs a network fetch |
| D. Unlocked package install | `sf package install --package 04t...` | `sf package install` of the next version | smallest footprint | **no published id exists** - `[unverified]`; you would have to build and host your own |

Default for a vibe-force project: **A**. Choose B only when several repos in the same org must track
the same fflib commit. Never C for anything but a throwaway scratch org.

## 3. Option A step by step

```bash
set -euo pipefail
FFLIB_COMMON_SHA=dab59777bac37f6b8a3cc2871fcf5df8d37764b4
FFLIB_MOCKS_SHA=d81e9e1833e27e6d704281ae7ffa39cbc304edea

rm -rf /tmp/fflib-src && mkdir -p /tmp/fflib-src
git clone --quiet https://github.com/apex-enterprise-patterns/fflib-apex-mocks.git /tmp/fflib-src/mocks
git -C /tmp/fflib-src/mocks checkout --quiet "$FFLIB_MOCKS_SHA"
git clone --quiet https://github.com/apex-enterprise-patterns/fflib-apex-common.git /tmp/fflib-src/common
git -C /tmp/fflib-src/common checkout --quiet "$FFLIB_COMMON_SHA"

# One package directory, two source trees; main + test both copied (see section 6 on coverage).
mkdir -p fflib/main/default/classes fflib/main/default/labels fflib/test/default/classes
cp /tmp/fflib-src/mocks/sfdx-source/apex-mocks/main/classes/*   fflib/main/default/classes/
cp /tmp/fflib-src/common/sfdx-source/apex-common/main/classes/* fflib/main/default/classes/
cp /tmp/fflib-src/common/sfdx-source/apex-common/main/labels/*  fflib/main/default/labels/
cp /tmp/fflib-src/mocks/sfdx-source/apex-mocks/test/classes/*   fflib/test/default/classes/
cp /tmp/fflib-src/common/sfdx-source/apex-common/test/classes/* fflib/test/default/classes/

# Record the pin next to the code so upgrades are reviewable.
cat > fflib/FFLIB_VERSION <<EOF
fflib-apex-mocks  master $FFLIB_MOCKS_SHA
fflib-apex-common master $FFLIB_COMMON_SHA
vendored          $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
```

Deploy, mocks-first, then your own package directory:

```bash
sf project deploy start --source-dir fflib --target-org vf-dev --wait 30
sf project deploy start --source-dir force-app --target-org vf-dev --wait 30
```

Order rationale: `fflib-apex-common`'s current README says "**Dependencies:** None for deployment or
for running this library's Apex tests", while `docs/changelog.md` still carries the September 2014
note that ApexMocks "must be deployed to the org before deploying this library". Copying both trees
into one package directory and deploying it in a single command sidesteps the question entirely -
the compiler resolves the whole set at once.

## 4. `sfdx-project.json` wiring

```json
{
  "packageDirectories": [
    { "path": "fflib", "default": false },
    { "path": "force-app", "default": true }
  ],
  "namespace": "",
  "sourceApiVersion": "67.0",
  "sfdcLoginUrl": "https://login.salesforce.com"
}
```

Rules that follow from this shape:

| Rule | Reason |
| --- | --- |
| `fflib` is listed **before** `force-app` | `sf project deploy start` without `--source-dir` deploys directories in order; the library compiles first |
| `fflib` is never `default: true` | `sf project retrieve start` and `sf project generate manifest` would write retrieved metadata into the library directory |
| `sourceApiVersion` is `67.0` for the whole project | the upstream repos pin 63.0/67.0 individually; your project overrides both. Keep one number, from `config/vibe-force.defaults.json` |
| `.vibeforce/config.json` lists both | `"packageDirectories": ["fflib", "force-app"]` so `vf-check` scopes analyzer/format correctly |

Second-generation packaging (`packageDirectories` with `package`/`versionNumber`) gets one more
decision: ship fflib inside your package, or depend on a separately built base package. See skill
`sf-packaging-release`; the short version is that a base package containing fflib plus your
`Application` interfaces is only worth it when three or more packages consume it.

## 5. `.forceignore` implications

```gitignore
# .forceignore
**/jsconfig.json
**/.eslintrc.json
**/*.dup-meta.xml

# Do NOT ignore fflib/** - it must deploy.
# Ignore only the upstream scaffolding you copied by accident:
fflib/**/*.md
fflib/FFLIB_VERSION
```

| Mistake | Effect |
| --- | --- |
| `fflib/**` in `.forceignore` | library silently omitted from every deploy; the first `Application.cls` deploy fails with `Invalid type: fflib_Application` |
| Leaving `FFLIB_VERSION` un-ignored | `sf project deploy start` reports an unknown file type and fails the deploy |
| Ignoring `fflib/test/**` | see coverage discussion below |
| Ignoring `fflib/**/labels/**` or forgetting to copy the labels | `fflib_SecurityUtils` fails to compile: `Variable does not exist: fflib_security_error_object_not_readable` |
| `.forceignore` entries that only match on one OS path separator | `sf` normalises to `/`; always write `fflib/...`, never `fflib\...` |

## 6. Coverage consequence of vendoring (do not skip)

The two libraries are roughly 5,600 lines of Apex. Deploying `main/classes` without
`test/classes` adds thousands of uncovered lines to the org, which drags org-wide coverage down and
fails the `apexOrgCoverageMin` gate of 85 in `config/vibe-force.defaults.json` even when your own
code is at 95%.

| Choice | Org-wide coverage effect | Test run time | Recommendation |
| --- | --- | --- | --- |
| Vendor `main` + `test` | library covers itself | +1 to 3 min per full run | **default** |
| Vendor `main` only | large uncovered block | fastest | only if you exclude fflib from the coverage gate deliberately and document it |
| Vendor `main` + `test` but run `RunSpecifiedTests` in CI | full coverage available on demand | fast per-PR | good compromise; `testLevels.sandbox` stays `RunLocalTests` for release validation |

`RunLocalTests` executes the vendored fflib tests as well, because they are local (non-namespaced)
tests. Budget for this in `vf-check apex` timings. Skill `sf-deployment-strategies` covers test-level
selection.

## 7. Option B: git submodule

```bash
git submodule add -b master \
  https://github.com/apex-enterprise-patterns/fflib-apex-common.git vendor/fflib-apex-common
git submodule add -b master \
  https://github.com/apex-enterprise-patterns/fflib-apex-mocks.git vendor/fflib-apex-mocks
git -C vendor/fflib-apex-common checkout dab59777bac37f6b8a3cc2871fcf5df8d37764b4
git -C vendor/fflib-apex-mocks  checkout d81e9e1833e27e6d704281ae7ffa39cbc304edea
git add vendor/fflib-apex-common vendor/fflib-apex-mocks .gitmodules
```

```json
{
  "packageDirectories": [
    { "path": "vendor/fflib-apex-mocks/sfdx-source/apex-mocks", "default": false },
    { "path": "vendor/fflib-apex-common/sfdx-source/apex-common", "default": false },
    { "path": "force-app", "default": true }
  ],
  "sourceApiVersion": "67.0"
}
```

Costs to accept: `git clone --recurse-submodules` in every CI job, `sf code-analyzer run` must
exclude both vendor paths explicitly, and `prettier`/`eslint` config must ignore them. An empty
submodule directory produces `Expected source-backed components in package directory` from the CLI -
the classic "forgot `--recurse-submodules`" failure.

## 8. Upgrade procedure

```bash
# 1. See what changed since your pin.
git -C /tmp/fflib-src/common log --oneline "$FFLIB_COMMON_SHA..origin/master" -- sfdx-source/apex-common

# 2. Re-vendor at the new commit into a scratch branch.
git checkout -b chore/fflib-upgrade
# ... repeat the cp commands from section 3 with the new SHAs, update fflib/FFLIB_VERSION

# 3. Review the diff. Breaking changes historically arrive as constructor/enum changes
#    (e.g. the December 2022 DataAccess enum) - grep your own code for the touched members.
git diff --stat -- fflib

# 4. Validate against a scratch org before merging.
sf org create scratch --definition-file config/project-scratch-def.json \
  --alias fflib-upgrade --duration-days 1 --target-dev-hub vf-devhub --wait 20
sf project deploy start --target-org fflib-upgrade --wait 30
sf apex run test --target-org fflib-upgrade --test-level RunLocalTests \
  --code-coverage --result-format human --wait 30

# 5. Check-only validate against the release target before the real deploy.
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" deploy-validate --target-org vf-uat
```

Known upgrade hazards, from `fflib-apex-common/docs/changelog.md`:

| Date | Change | Impact on your code |
| --- | --- | --- |
| December 2022 | native user mode support added; `enforceCRUD`/`enforceFLS` selector flags deprecated in favour of `DataAccess`; `fflib_SObjectUnitOfWork.UserModeDML` added, `SimpleDML` deprecated | move selectors to the `(Boolean, DataAccess)` constructor - skill `sf-fflib-selector-layer` |
| April 2021 | `fflib_SObjectDomain` split into `fflib_IDomain` (domain) and `fflib_ISObjectDomain` (trigger handler) | domain classes and `Application.Domain` registrations may need reshaping - skill `sf-fflib-domain-service-uow` |
| April 2020 | repo converted to Salesforce DX source format | only affects how you vendor |
| July 2014 | `onValidate()` no longer fires on after update | legacy domains relying on it need `Configuration.enableOldOnUpdateValidateBehaviour()` |

## 9. Target directory tree for a vibe-force project

```
repo/
  sfdx-project.json
  .forceignore
  .vibeforce/config.json                  packageDirectories: ["fflib", "force-app"]
  fflib/
    FFLIB_VERSION
    main/default/classes/fflib_*.cls(+ -meta.xml)
    main/default/labels/fflib-Apex-Common-CustomLabels.labels-meta.xml
    test/default/classes/fflib_*Test.cls(+ -meta.xml)
  force-app/main/default/
    classes/
      Application.cls
      service/    IAccountsService.cls AccountsService.cls AccountsServiceImpl.cls
      domains/    IAccounts.cls Accounts.cls
      selectors/  IAccountsSelector.cls AccountsSelector.cls
      triggerHandlers/ AccountsTriggerHandler.cls
    triggers/     AccountsTrigger.trigger
  force-app/test/default/classes/          mirrors the folders above, one *Test per class
  config/code-analyzer.yml                 excludes fflib/**
  scripts/apex/assert-application-wiring.apex
```

Test classes mirror the production folder names so `sf apex run test --tests` selection and code
review stay mechanical. Skill `sf-project-structure` owns the wider directory conventions; skill
`sf-fflib-testing` owns the test naming.

## 10. Code Analyzer scoping

```yaml
# config/code-analyzer.yml (excerpt - full file owned by config/)
rules:
  pmd:
    ApexCRUDViolation:
      severity: 3
engines:
  pmd:
    disable_engine: false
    file_extensions:
      apex: ['.cls', '.trigger']
```

```bash
# Analyze only your own code; the vendored library is upstream's problem.
sf code-analyzer run --workspace force-app --config-file config/code-analyzer.yml \
  --severity-threshold 3 --output-file .vibeforce/reports/analyzer.json
```

Passing `--workspace force-app` rather than `.` is the cheapest way to keep vendored fflib out of the
report; `vf-check analyzer` does this from `packageDirectories` minus library paths. Rule-level
tuning for fflib-shaped code is in skill `sf-code-analyzer-quality`.

## 11. Removal checklist

If a project decides fflib was the wrong call (see `fflib-vs-plain-apex.md`), remove it in one
release rather than leaving both idioms:

- [ ] Replace `Application.Selector.newInstance(X.SObjectType)` calls with direct selector class calls, then inline the queries.
- [ ] Replace `Application.UnitOfWork` with explicit ordered DML in the service method.
- [ ] Delete the `Impl` split: interface + `Impl` collapse into one `with sharing` class.
- [ ] Delete `Application.cls`.
- [ ] Delete `fflib/` and its `sfdx-project.json` entry, `.vibeforce/config.json` entry, and analyzer exclusion.
- [ ] `sf project deploy start --source-dir force-app --target-org vf-dev` then run the destructive change for the `fflib_*` classes (skill `sf-deployment-strategies`).

## Related

- Skill `sf-project-structure` - package directories, `.forceignore`, multi-package repos
- Skill `sf-packaging-release` - 2GP dependencies and base packages
- Skill `sf-scratch-orgs-sandboxes` - scratch org definition for fflib validation
- Skill `sf-code-analyzer-quality` - analyzer configuration and rule scoping
- Skill `sf-cli-operations` - `sf` command reference
