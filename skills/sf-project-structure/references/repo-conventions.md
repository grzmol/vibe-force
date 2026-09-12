# Team conventions for a Salesforce DX repository

These are working agreements, not platform rules. Every one of them exists because metadata XML is
generated, order-sensitive, and often org-wide — properties that make ordinary Git workflows fail
unless the team constrains what enters the repo.

## Branch and story model

| Rule | Detail |
| --- | --- |
| Branch per story | `feature/<ticket>-<slug>`, e.g. `feature/ACME-412-broker-scoring`. One story, one branch, one scratch org or Developer sandbox |
| `main` is deployable | `main` always matches what is validated against UAT. Nothing merges without a green `vf-check local` and a successful `vf-check deploy-validate` |
| Integration branch only when releases are batched | `main` → `release/<date>` → production; otherwise deploy `main` |
| One story per package directory where possible | A story that must span package directories declares it in `.vibeforce/state/contract.md` during wave 0 |
| Rebase, do not merge, inside a story branch | Metadata XML merges badly; a linear history keeps conflicts to single files |
| Delete the branch and the scratch org together | `sf org delete scratch --target-org <alias>` in the same cleanup step |

## Path ownership (wave-1 parallelism)

vibe-force runs up to four build agents in parallel, each owning disjoint paths. The same split is a
good human convention because it maps to the metadata types that collide.

| Owner | Paths |
| --- | --- |
| `sf-apex-engineer` | `**/classes/**`, `**/triggers/**` |
| `sf-lwc-engineer` | `**/lwc/**`, `**/aura/**`, `**/staticresources/**` |
| `sf-metadata-engineer` | `**/objects/**`, `**/permissionsets/**`, `**/permissionsetgroups/**`, `**/flows/**`, `**/layouts/**`, `**/flexipages/**`, `**/tabs/**`, `**/applications/**` |
| `sf-integration-engineer` | `**/namedCredentials/**`, `**/externalCredentials/**`, `**/externalServiceRegistrations/**`, `**/remoteSiteSettings/**`, `**/cspTrustedSites/**`, platform event objects |

Ownership is recorded in `.vibeforce/state/ownership.json` and enforced by the vibe-force hooks; a
write outside the current agent's paths is refused. Cross-slice contracts — Apex method signatures
an LWC calls, field API names a Flow reads — are decided in wave 0 and written to
`.vibeforce/state/contract.md` before any file is created.

## Naming

| Artefact | Convention | Example |
| --- | --- | --- |
| Apex class | PascalCase, suffix states the role | `BrokerScoringService`, `BrokerScoringServiceTest`, `BrokerSelector`, `BrokerScoreBatch` |
| Apex trigger | `<Object>Trigger` (object name without `__c`), one per object, logic delegated to a handler class | `BrokerTrigger` on `Broker__c` |
| LWC | camelCase directory and file basenames | `brokerScoreCard/brokerScoreCard.js` |
| Custom object / field | PascalCase with `__c`, no abbreviations, no `X` prefixes | `Broker__c.ScoreBand__c` |
| Permission set | `<Domain><Capability>` | `BrokerScoringUse`, `BrokerScoringAdmin` |
| Flow | `<Object>_<Trigger or Purpose>` | `Broker_AfterUpdate_RecalculateScore` |
| Custom label | `<Domain>_<Meaning>` | `Broker_ScoreOutOfRange` |
| Custom permission (bypass) | `Bypass<Automation>` | `BypassBrokerTriggers` |
| Test data factory | `<Domain>TestDataFactory` in `unpackaged`/`test-data` | `BrokerTestDataFactory` |

## Reviewing metadata XML diffs

Generated XML produces diffs that look alarming and hide the real change. Checklist for a reviewer:

| Look for | Why |
| --- | --- |
| Field `<fullName>` changes | Renaming a field API name is a breaking change for Apex, LWC, Flows, reports, and integrations |
| `<type>`, `<length>`, `<precision>`, `<scale>` changes on an existing field | Destructive data conversion in every org that already has data |
| New `<picklistValues>` / removed values | Removing a picklist value orphans existing records and breaks record types |
| `<valueSet>` moved from local to `GlobalValueSet` | Changes the deploy order and can fail if the value set is not deployed first |
| Record type changes plus `<businessProcess>` | Business process must exist before the record type deploys |
| Whole-file reordering with no semantic change | Someone edited XML in the org UI and retrieved it; ask whether a real change is buried in the noise |
| Profile diffs | Usually org drift, not intent — see the policy below |
| `<active>true</active>` on Flow versions | Activating a flow is a behaviour change even when the flow body is identical |
| `<sourceApiVersion>` or a class's `<apiVersion>` bump | Changes runtime semantics (see the API 67.0 security defaults in skill `sf-apex-development`) |
| Layout diffs | Layout XML lists every field; confirm nothing was silently dropped |
| `.forceignore` changes | Newly ignored metadata silently stops deploying — always a reviewed decision |
| `sfdx-project.json` changes | New package directory, API version bump, or `sourceBehaviorOptions` — all structural |

Rules that keep diffs reviewable:

1. Never edit metadata XML in the org and retrieve it wholesale into an unrelated story.
2. Never reformat XML by hand; let the CLI and the project formatter produce it
   (`vf-check format` enforces this).
3. One logical change per commit: schema, then automation, then UI.
4. Commit `sfdx-project.json`, `.forceignore`, and manifest changes separately from feature work so
   they stand out in review.

## Profiles versus permission sets

| Decision | Policy |
| --- | --- |
| New access | Always a permission set, composed into a permission set group per persona |
| Profiles in source control | Ignore `**/profiles/**` by default. Keep at most one minimal baseline profile per persona, containing only what a profile can exclusively own |
| Why | Profile XML is org-wide: retrieving it pulls every object, field, tab, app, and page visibility in the org, so diffs are enormous, merges conflict constantly, and a deploy overwrites admin changes made outside the repo |
| Source-tracking wrinkle | A tracked retrieve returns profile permissions for everything source tracking reports, even components absent from the manifest — so profile files accumulate unrelated changes |
| Exception | Login IP ranges, login hours, password policies, and default record types/apps still live on the profile. Manage them deliberately, in their own story |

Details and the permission-set-group design pattern: skill `sf-security-model`.

## Picklist and record-type churn

| Problem | Convention |
| --- | --- |
| Picklist values changing every sprint | Move shared picklists to a `GlobalValueSet`; one file, one owner, one diff |
| Standard picklists | `StandardValueSet` members are case-sensitive (`Industry`, `SalesTeamRole`); they are org-wide, so treat a change as a release-level decision |
| Record types multiplying | Record types are referenced by layouts, business processes, profiles, permission sets, and Apex; adding one touches many files. Require a design note in the story |
| List views | High churn and low value in source; ignore `**/*.listView-meta.xml` unless a list view is part of the delivered UX |
| Translations | One story owns `translations/` per release; otherwise every branch conflicts on the same files |

## Deploy-order dependencies to encode in the story plan

| Deploy this first | Before this |
| --- | --- |
| `GlobalValueSet`, `CustomObject`, `CustomField` | `Layout`, `FlexiPage`, `PermissionSet`, Apex referencing the fields |
| `BusinessProcess` | `RecordType` that uses it |
| `CustomPermission` | `PermissionSet` granting it, Apex/Flow checking it |
| `ExternalCredential` | `NamedCredential` referencing it |
| `PlatformEventChannel` | `PlatformEventChannelMember` |
| `ApexClass` | `FlexiPage` or `QuickAction` referencing it, `Flow` invoking it |
| `Flow` | `FlowDefinition` that activates a version |
| Metadata that removes a dependency | `destructiveChangesPost.xml` that deletes the dependency |

A single `sf project deploy start` resolves most intra-transaction ordering itself; the table matters
when a release is split across multiple deployments or package directories (see skill
`sf-deployment-strategies`).

## Monorepo versus single package directory

| Model | Use when | Costs |
| --- | --- | --- |
| Single `force-app` | One team, one release train, < ~1500 components | Every story touches the same tree; no ownership boundaries; packaging later requires a migration |
| Multiple package directories, one repo | Multiple domains or squads, shared release train | `sfdx-project.json` must stay accurate; deploy order must be explicit when split |
| Multiple repos, unlocked packages | Independent release cadences, published dependencies | Version pinning, dependency graph maintenance, cross-repo refactors are expensive (skill `sf-packaging-release`) |
| Multiple repos, no packages | Never — two repos deploying to the same org overwrite each other with no shared manifest | Drift is undetectable |

Migration path that works: single directory → domain directories in the same repo → unlocked
packages for the directories that genuinely need independent versioning. Do not skip the middle step;
the directory split is what reveals whether the domain boundaries are real.

## `.gitignore` companion

`.forceignore` controls what the CLI sends to an org. `.gitignore` controls what enters history. They
overlap but are not the same file, and both are needed.

```gitignore
# ==== Salesforce CLI generated =====
.sf/
.sfdx/
.localdevserver/
deploy-options.json

# ==== Node / tooling =====
node_modules/
coverage/
junit/
*.log
.eslintcache

# ==== Secrets and auth material =====
*.key
*.pem
*.crt
auth*.json
.env
.env.*

# ==== vibe-force runtime state =====
.vibeforce/reports/
.vibeforce/state/
!.vibeforce/config.json

# ==== OS / editor =====
.DS_Store
.idea/
*.swp
```

| Path | `.gitignore` | `.forceignore` | Reason |
| --- | --- | --- | --- |
| `.sf/`, `.sfdx/` | yes | implicit (dot-directories) | Auth material and machine-local config |
| `node_modules/` | yes | not needed | Not under a package directory |
| `**/__tests__/**` | no (tests are source) | yes | Jest tests must never deploy |
| `**/profiles/**` | no (if kept at all) | yes | Ignored for deploys, may still be inspected |
| `.vibeforce/config.json` | committed | yes | Project policy is reviewed; never deployed |
| `.vibeforce/reports/`, `state/` | yes | yes | Per-run artefacts |
| `*.key`, `auth*.json` | yes | yes | Secrets — rotate immediately if pushed |

## Pull-request checklist

```text
[ ] Story scope only; no unrelated retrieved metadata
[ ] vf-check local is green (format, lint, analyzer, jest)
[ ] vf-check apex is green against a dev org, coverage gates met
[ ] vf-check deploy-validate succeeded against the integration org (job id in the PR)
[ ] New Apex class has a test class; new LWC has a Jest spec (gates: requireTestForApexClass, requireJestForLwc)
[ ] Access granted via permission set, not profile
[ ] Field-level security and sharing decisions stated in the description
[ ] sfdx-project.json / .forceignore / manifest changes called out explicitly
[ ] Destructive changes listed, with the pre/post choice justified
[ ] No secrets, no org ids, no .sfdx or .sf files in the diff
[ ] Deploy order noted if the release spans multiple deployments
```

## Verification

```bash
# Everything the branch touched, as the CLI sees it
git diff --name-only origin/main...HEAD
sf project deploy preview --target-org vf-dev
sf project list ignored

# Gates
node "$VF_ROOT/scripts/checks/vf-check.mjs" local --changed
node "$VF_ROOT/scripts/checks/vf-check.mjs" apex --target-org vf-dev
node "$VF_ROOT/scripts/checks/vf-check.mjs" deploy-validate --target-org vf-int
```

## Sources

- Track Changes Between Your Project and Org, Best Practices: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_source_tracking_best_practices.htm>
- Retrieve Changes to Profiles with Source Tracking: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_source_tracking_profiles.htm>
- Multiple Package Directories: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_mpd.htm>
- Deleting Components from an Organization: <https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_deploy_deleting_files.htm>
- Sample package.xml Manifest Files (StandardValueSet, rules, sharing rules naming): <https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/manifest_samples.htm>
- Salesforce DX Project Configuration: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_config.htm>
