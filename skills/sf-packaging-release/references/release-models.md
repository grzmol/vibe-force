# Release models

Choosing how a Salesforce codebase reaches production, and what each choice costs. Sources:
Salesforce DX Developer Guide (unlocked and second-generation managed packaging), Salesforce CLI
command reference. Summer '26 / API version 67.0.

## The three models

| | Org-based deployment | Unlocked packages | Managed packages (2GP) |
| --- | --- | --- | --- |
| Unit of release | A metadata deployment | A package **version** (`04t`) | A package version (`04t`) |
| Versioning | Git tags and nothing else | `MAJOR.MINOR.PATCH.BUILD`, enforced | Same, plus ancestry and upgrade paths |
| Namespace | None | Optional | Required |
| Who installs it | You, into your own orgs | You, or another team | Subscribers you do not control |
| Can a subscriber edit the metadata | Yes | Yes | No - it is locked |
| Dependency management | Implicit, by deploy order | Explicit, in `sfdx-project.json` | Explicit, plus ancestry |
| Removing a component | Destructive changes | `--upgrade-type` decides | Deprecation rules |
| Primary tool | `sf project deploy` | `sf package` | `sf package` |
| vibe-force gate | `vf-check deploy-validate` then `deploy-quick` | The local gate, then the package pipeline | Same |

## Decision path

Start at the top. Stop at the first row that describes you.

| Question | If yes |
| --- | --- |
| Do you distribute to orgs you do not control? | **Managed package (2GP)** |
| Do separate teams need to release into the same org on independent schedules? | **Unlocked packages** |
| Is there metadata you genuinely cannot untangle from existing org configuration? | **Org-dependent unlocked package** |
| Anything else | **Org-based deployment** |

The last row is where most projects belong and where many stop reading too early. Packaging is not
a maturity level. It is a solution to independent release cadence and to distribution.

## What packaging actually costs

| Cost | Detail |
| --- | --- |
| Version pinning | Every consumer declares a version. Every bump is a commit somewhere else |
| Dependency graph | It must be maintained, inspected and kept acyclic |
| Cross-package refactor | Stops being one commit. Becomes: change base, version base, promote base, bump pin, change consumer |
| Build time | `sf package version create` runs the packaged Apex tests. It is minutes, not seconds |
| Promotion discipline | A version created with `--skip-validation` cannot be promoted. Speed shortcuts remove releasability |
| Ancestry | `ancestorVersion: NONE` silently breaks upgrades for existing installs |

Against that, what you buy: independent cadence, an install that is atomic and reversible
(`sf package uninstall`), and a real answer to "which version is in that org"
(`sf package installed list`).

## Unlocked packages: repository shapes

### One repo, several packages

```
sfdx-project.json
  packageDirectories:
    - path: base        package: Acme Base      (fflib, utilities, shared domain)
    - path: sales       package: Acme Sales     depends on Acme Base
    - path: service     package: Acme Service   depends on Acme Base
```

- One commit can still change base and both consumers, then version all three.
- CI builds packages in dependency order.
- This is the cheapest way to get packaging benefits. Prefer it.

### Several repos, several packages

- Each repo owns one package and publishes versions.
- Consumers pin a version in their own `sfdx-project.json`.
- Independent cadence is real, and so is the cost: a base change needs a published version before
  any consumer can use it, and a cross-package refactor is a multi-repo, multi-PR operation.

Take this shape only when the teams are genuinely independent - different roadmaps, different
release calendars, different on-call.

### The base package

A base package containing fflib plus your shared utilities, depended on by every other package, is
the shape that works. The alternatives both fail:

| Alternative | Failure |
| --- | --- |
| fflib duplicated into each package | Version skew. Two copies of `fflib_SObjectUnitOfWork` in one org, with different behaviour |
| No base package, each package self-contained | Shared domain logic is copy-pasted and diverges |

See skill `sf-fflib-foundations` for what belongs in the base.

## Org-dependent unlocked packages

`--org-dependent` on `sf package create`, unlocked packages only.

| | Ordinary unlocked | Org-dependent unlocked |
| --- | --- | --- |
| When dependencies are validated | At **version create** | At **install** |
| Can reference unpackaged metadata in the install org | No | Yes |
| Build org | A scratch org built from the definition file | Does not need the dependencies |
| Risk | You find problems early | You find problems in the install org |

Use it when the package legitimately depends on org configuration you are not going to package -
typically a brownfield org where a clean-room build is impossible. It is a pragmatic escape, and it
moves failure later rather than removing it.

## Version pinning strategy

| Strategy | Dependency `versionNumber` | Trade-off |
| --- | --- | --- |
| Exact | `4.7.0.3` | Fully reproducible. Every base build needs a consumer commit |
| Latest build | `4.7.0.LATEST` | Picks up patch builds automatically. Reproducibility depends on the base not breaking compatibility within a patch |
| Transitive | `calculateTransitiveDependencies: true`, direct deps only | Much less to maintain. You see less of the graph |

A workable default: `LATEST` within a patch line, transitive calculation on, and
`sf package version displaydependencies` run in CI so the resolved graph is visible in the build log.

## Release pipeline, unlocked packages

```
commit
  -> vf-check local           (format, lint, analyzer, jest)
  -> scratch org build + vf-check apex
  -> sf package version create --code-coverage --wait
  -> sf package version create report   (fail the build unless Status == Success)
  -> install into an integration org --no-prompt --upgrade-type DeprecateOnly
  -> vf-check smoke           (post-install verification in that org)
  -> sf package version promote --no-prompt
  -> install into UAT, then production
```

Two gates that are easy to skip and expensive to skip:

1. **`version create report` must be checked.** `sf package version create` returning does not mean
   the version built. Assert `Status == Success`.
2. **The version is installed and smoke-tested before promotion.** Promotion is a public statement
   that a version is releasable; verify it first.

## Release pipeline, org-based

```
commit
  -> vf-check local
  -> vf-check apex            (against a dev or integration org)
  -> vf-check deploy-validate (check-only against the target)
  -> human confirmation
  -> vf-check deploy-quick    (quick deploy of the recorded job id)
  -> vf-check verify          (apex + smoke in the target)
```

This is what `/vf-deploy` runs. No package ids, no ancestry, no dependency graph. Full detail in
skill `sf-deployment-strategies`.

## Migration paths

| From | To | Route |
| --- | --- | --- |
| Org-based | Unlocked packages | Split `force-app` into package directories first, ship that, then add `package` attributes one directory at a time |
| 1GP managed | 2GP managed | `sf package convert --package 033... --target-dev-hub devhub`, with `-m, --seed-metadata` if pre-conversion metadata is needed |
| Unlocked | Managed | Not a conversion. A new package with a namespace, and a subscriber migration plan |

Splitting `force-app` before introducing packaging is the important ordering. Directory boundaries
are cheap to change; package boundaries are not.

## What to verify in an org

```bash
# Which package versions are installed here
sf package installed list --target-org acme-prod

# Which versions exist and which are released
sf package version list --packages "Acme Base" --released --target-dev-hub devhub

# The dependency graph as built
sf package version displaydependencies --package 04t... --target-dev-hub devhub --edge-direction root-first

# The upgrade path
sf package version displayancestry --package "Acme Base" --target-dev-hub devhub --dot-code
```

`sf package installed list` against production is the single most useful command in this skill. It
answers "what is actually running", which no git history can.

## Anti-patterns

| Anti-pattern | Why it hurts |
| --- | --- |
| Packaging a single-team monorepo | All the cost, none of the independent cadence |
| `--skip-validation` in the main pipeline | The build cannot be promoted; you discover this at release time |
| `--no-prompt` with the default `--upgrade-type Mixed` in CI | An unattended upgrade may delete components and their data |
| Promoting before installing and smoke-testing | Released status on an unverified build |
| Duplicating shared code instead of a base package | Version skew inside a single org |
| Leaving `ancestorVersion: NONE` after a one-off break | Every subsequent version is unreachable for existing installs |
| Treating package directories as packages | They are ownership boundaries. Adding `package` is a separate, larger decision |
