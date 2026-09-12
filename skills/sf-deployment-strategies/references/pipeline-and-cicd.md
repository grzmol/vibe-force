# Pipeline and CI/CD

Branching model, promotion gates, and working GitHub Actions YAML for a vibe-force project.

Commands are verified against the Salesforce CLI command reference
(<https://github.com/salesforcecli/cli/blob/main/README.md>). The promotion shape follows the
Salesforce DX Developer Guide *Build and Release Your App with Metadata API* chapter
(<https://developer.salesforce.com/docs/atlas.en-us.262.0.sfdx_dev.meta/sfdx_dev/sfdx_dev_build_mdapi.htm>).

## Branching model

```
feature/VF-123-lead-router ──┐
feature/VF-124-scoring    ──┼─▶ main ──▶ tag release/YYYY-MM-DD
                             │     │
                  scratch org│     ├─▶ vf-int   (auto on merge)
                  vf-check   │     ├─▶ vf-uat   (manual, manifest-scoped)
                  local      │     └─▶ vf-prod  (validate + quick, approval-gated)
                             │
                  hotfix/VF-199 ─▶ main (fast path, same gates)
```

- `main` is what production runs. It is protected: PR required, status checks required, linear
  history.
- Feature branches build and verify in an ephemeral scratch org. Nothing merges without a green
  `vf-check local` and a green `vf-check apex` in that scratch org.
- `vf-int` receives every merge to `main` automatically. It is the first org where the whole
  codebase coexists.
- `vf-uat` is promoted deliberately, manifest-scoped, when a release candidate is cut.
- `vf-prod` is only ever reached through `deploy validate` then `deploy quick` off a release tag.
- Hotfixes branch from the release tag, take the same gates, and merge back into `main`.

Why trunk-based rather than long-lived environment branches: Salesforce metadata merges badly
(profiles, layouts, flows are whole-file XML), so the cost of divergence is far higher than the
cost of feature flags. Ship dark behind a custom permission or custom metadata flag instead of
holding a branch open.

## Promotion gates

| Stage | Trigger | Org | Deploy command | Gate (`vf-check`) | Failure action |
| --- | --- | --- | --- | --- | --- |
| PR | push to `feature/*` | ephemeral scratch | `deploy start --source-dir force-app` | `local`, then `apex` | block merge |
| Integration | merge to `main` | `vf-int` | `deploy start --test-level RunLocalTests` | `local`, `apex` | revert or forward-fix on `main` |
| UAT | manual dispatch on a release candidate | `vf-uat` | `deploy start --manifest manifest/package.xml --test-level RunLocalTests` | `verify` | fix, re-cut candidate |
| Production validate | tag `release/*` | `vf-prod` | `deploy validate --manifest ... --test-level RunLocalTests` | `deploy-validate` | fix, re-tag |
| Production deploy | manual approval on the same run | `vf-prod` | `deploy quick --job-id` | `deploy-quick` then `verify` | forward-fix or quick-deploy the rollback job |

`vf-check` exit contract, identical in every stage: `0` pass, `1` gate failed, `2`
misconfiguration/missing tool, `3` org or network error. Only `1` should ever fail a build
"legitimately"; `2` and `3` mean the pipeline itself is broken.

## Authentication: JWT bearer flow

Never use `sf org login web` in CI. Create a connected app with a certificate, then:

```bash
printf '%s' "$SF_JWT_KEY" > /tmp/server.key
chmod 600 /tmp/server.key

sf org login jwt \
  --client-id "$SF_CLIENT_ID" \
  --jwt-key-file /tmp/server.key \
  --username "$SF_USERNAME" \
  --instance-url "$SF_INSTANCE_URL" \
  --alias vf-prod \
  --set-default
```

| Secret | Purpose |
| --- | --- |
| `SF_CLIENT_ID` | Connected app consumer key |
| `SF_JWT_KEY` | PEM private key matching the certificate uploaded to the connected app |
| `SF_USERNAME` | Integration user in the target org, pre-authorized for the connected app |
| `SF_INSTANCE_URL` | `https://login.salesforce.com` for production, `https://test.salesforce.com` for sandboxes |

One connected app per target org type, one integration user per org, least privilege on the
integration user's permission sets. Full auth matrix in skill `sf-cli-operations`.

## GitHub Actions: PR verification

```yaml
# .github/workflows/pr.yml
name: pr
on:
  pull_request:
    branches: [main]

concurrency:
  group: pr-${{ github.head_ref }}
  cancel-in-progress: true

env:
  SF_USE_PROGRESS_BAR: 'false'
  VF_ROOT: ${{ github.workspace }}/.vibe-force

jobs:
  local-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm install --global @salesforce/cli
      - name: Local gate (format, lint, analyzer, jest)
        run: node "$VF_ROOT/scripts/checks/vf-check.mjs" local --changed --json
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: vf-reports-local, path: .vibeforce/reports/ }

  org-gate:
    runs-on: ubuntu-latest
    needs: local-gate
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm install --global @salesforce/cli
      - name: Authorize Dev Hub
        env:
          SF_JWT_KEY: ${{ secrets.SF_JWT_KEY }}
        run: |
          printf '%s' "$SF_JWT_KEY" > /tmp/server.key && chmod 600 /tmp/server.key
          sf org login jwt --client-id "${{ secrets.SF_CLIENT_ID }}" \
            --jwt-key-file /tmp/server.key \
            --username "${{ secrets.SF_DEVHUB_USERNAME }}" \
            --alias vf-devhub --set-default-dev-hub
      - name: Ephemeral scratch org, deploy, org tests
        env: { DEVHUB: vf-devhub, DEF: config/ci-scratch-def.json }
        run: bash scripts/ephemeral-org.sh
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: vf-reports-org, path: .vibeforce/reports/ }
```

`scripts/ephemeral-org.sh` is the script in skill `sf-scratch-orgs-sandboxes`
(`references/org-lifecycle-scripts.md` §1): it creates the org, deploys, assigns permission sets,
seeds, runs `vf-check apex` and `vf-check smoke`, and deletes the org in a `trap`.

## GitHub Actions: integration on merge

```yaml
# .github/workflows/integration.yml
name: integration
on:
  push:
    branches: [main]

concurrency:
  group: integration
  cancel-in-progress: false        # never cancel a running deploy

env:
  SF_USE_PROGRESS_BAR: 'false'
  VF_ROOT: ${{ github.workspace }}/.vibe-force

jobs:
  deploy-int:
    runs-on: ubuntu-latest
    environment: integration
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm install --global @salesforce/cli
      - name: Authorize vf-int
        env:
          SF_JWT_KEY: ${{ secrets.SF_JWT_KEY_INT }}
        run: |
          printf '%s' "$SF_JWT_KEY" > /tmp/server.key && chmod 600 /tmp/server.key
          sf org login jwt --client-id "${{ secrets.SF_CLIENT_ID_INT }}" \
            --jwt-key-file /tmp/server.key \
            --username "${{ secrets.SF_USERNAME_INT }}" \
            --instance-url https://test.salesforce.com \
            --alias vf-int --set-default
      - name: Drift check
        run: sf project deploy preview --target-org vf-int
      - name: Deploy
        run: |
          sf project deploy start \
            --target-org vf-int \
            --source-dir force-app \
            --test-level RunLocalTests \
            --coverage-formatters json --coverage-formatters json-summary \
            --results-dir .vibeforce/reports/coverage \
            --junit --wait 90 --verbose
      - name: Org gate
        run: node "$VF_ROOT/scripts/checks/vf-check.mjs" verify --target-org vf-int --json
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: vf-reports-int, path: .vibeforce/reports/ }
```

`concurrency` without `cancel-in-progress` matters: cancelling a mid-flight Salesforce deploy
leaves a job you then have to `sf project deploy cancel` and poll.

## GitHub Actions: production release

Two jobs in one workflow. The first validates (safe, unguarded). The second quick-deploys behind
a GitHub environment approval, which is also where `VF_ALLOW_PROD` is granted.

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ['release/*']

concurrency:
  group: production
  cancel-in-progress: false

env:
  SF_USE_PROGRESS_BAR: 'false'
  VF_ROOT: ${{ github.workspace }}/.vibe-force

jobs:
  validate:
    runs-on: ubuntu-latest
    outputs:
      job-id: ${{ steps.validate.outputs.job-id }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm install --global @salesforce/cli
      - name: Local gate
        run: node "$VF_ROOT/scripts/checks/vf-check.mjs" local --json
      - name: Authorize vf-prod
        env:
          SF_JWT_KEY: ${{ secrets.SF_JWT_KEY_PROD }}
        run: |
          printf '%s' "$SF_JWT_KEY" > /tmp/server.key && chmod 600 /tmp/server.key
          sf org login jwt --client-id "${{ secrets.SF_CLIENT_ID_PROD }}" \
            --jwt-key-file /tmp/server.key \
            --username "${{ secrets.SF_USERNAME_PROD }}" \
            --instance-url https://login.salesforce.com \
            --alias vf-prod
      - name: Release manifest
        run: |
          PREV="$(git describe --tags --abbrev=0 "${GITHUB_REF_NAME}^" 2>/dev/null || echo origin/main)"
          CHANGED="$(git diff --name-only "$PREV...${GITHUB_REF_NAME}" -- force-app | tr '\n' ' ')"
          test -n "$CHANGED" || { echo "empty release payload"; exit 1; }
          sf project generate manifest --source-dir $CHANGED --name package --output-dir manifest
          cat manifest/package.xml
      - name: Pre-deploy backup
        run: |
          mkdir -p .vibeforce/reports/backup
          sf project retrieve start --manifest manifest/package.xml --target-org vf-prod \
            --target-metadata-dir .vibeforce/reports/backup \
            --zip-file-name "pre-${GITHUB_SHA:0:7}.zip" --wait 60
      - name: Validate
        id: validate
        run: |
          node "$VF_ROOT/scripts/checks/vf-check.mjs" deploy-validate --target-org vf-prod --json
          echo "job-id=$(jq -r '.jobs[-1].jobId' .vibeforce/state/deploy-jobs.json)" >> "$GITHUB_OUTPUT"
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: vf-release-evidence
          path: |
            .vibeforce/reports/
            .vibeforce/state/deploy-jobs.json
            manifest/package.xml

  deploy:
    runs-on: ubuntu-latest
    needs: validate
    environment: production          # required reviewers configured in GitHub
    env:
      VF_ALLOW_PROD: '1'             # granted only after the environment approval
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm install --global @salesforce/cli
      - uses: actions/download-artifact@v4
        with: { name: vf-release-evidence }
      - name: Authorize vf-prod
        env:
          SF_JWT_KEY: ${{ secrets.SF_JWT_KEY_PROD }}
        run: |
          printf '%s' "$SF_JWT_KEY" > /tmp/server.key && chmod 600 /tmp/server.key
          sf org login jwt --client-id "${{ secrets.SF_CLIENT_ID_PROD }}" \
            --jwt-key-file /tmp/server.key \
            --username "${{ secrets.SF_USERNAME_PROD }}" \
            --instance-url https://login.salesforce.com --alias vf-prod
      - name: Quick deploy
        run: |
          sf project deploy quick \
            --job-id "${{ needs.validate.outputs.job-id }}" \
            --target-org vf-prod --wait 60 --verbose
      - name: Post-deploy verification
        run: node "$VF_ROOT/scripts/checks/vf-check.mjs" verify --target-org vf-prod --json
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: vf-postdeploy, path: .vibeforce/reports/ }
```

`VF_ALLOW_PROD=1` is set only inside the approval-gated job. The vibe-force hooks refuse
production deploys without it whenever `hooks.blockProductionDeploy` is `true`, so an agent
cannot accidentally reach production from an unapproved context.

## Coverage gating

The platform floor is 75%. `config/vibe-force.defaults.json` sets the harness gates higher:

```json
"gates": {
  "apexOrgCoverageMin": 85,
  "apexClassCoverageMin": 75,
  "jestCoverageMin": 80,
  "analyzerFailSeverity": 3,
  "requireTestForApexClass": true,
  "requireJestForLwc": true
}
```

`vf-check deploy-validate` reads the coverage artifacts produced by
`--coverage-formatters json --results-dir .vibeforce/reports/coverage` and fails with exit `1`
when a gate is missed. To reproduce the gate by hand:

```bash
sf project deploy validate --manifest manifest/package.xml --target-org vf-prod \
  --test-level RunLocalTests --coverage-formatters json-summary \
  --results-dir /tmp/cov --wait 180 --json > /tmp/val.json

jq -r '.result.details.runTestResult.codeCoverageWarnings[]?.message' /tmp/val.json
jq -r '.result.details.runTestResult.numFailures' /tmp/val.json
```

Coverage warnings are advisory in the CLI output but binding for quick deploy: a validation that
did not meet coverage cannot be quick-deployed.

## Other CI platforms

GitLab CI equivalent of the release stages:

```yaml
stages: [local, integration, validate, deploy]

variables:
  SF_USE_PROGRESS_BAR: "false"
  VF_ROOT: "$CI_PROJECT_DIR/.vibe-force"

.sf-auth: &sf-auth
  - printf '%s' "$SF_JWT_KEY" > /tmp/server.key && chmod 600 /tmp/server.key
  - sf org login jwt --client-id "$SF_CLIENT_ID" --jwt-key-file /tmp/server.key
      --username "$SF_USERNAME" --instance-url "$SF_INSTANCE_URL" --alias "$SF_ALIAS"

local-gate:
  stage: local
  script:
    - npm ci && npm i -g @salesforce/cli
    - node "$VF_ROOT/scripts/checks/vf-check.mjs" local --changed --json
  artifacts: { when: always, paths: [.vibeforce/reports/] }

prod-validate:
  stage: validate
  rules: [{ if: '$CI_COMMIT_TAG =~ /^release\//' }]
  script:
    - npm ci && npm i -g @salesforce/cli
    - *sf-auth
    - node "$VF_ROOT/scripts/checks/vf-check.mjs" deploy-validate --target-org "$SF_ALIAS" --json
  artifacts: { when: always, paths: [.vibeforce/reports/, .vibeforce/state/deploy-jobs.json] }

prod-deploy:
  stage: deploy
  rules: [{ if: '$CI_COMMIT_TAG =~ /^release\//', when: manual }]
  variables: { VF_ALLOW_PROD: "1" }
  script:
    - npm ci && npm i -g @salesforce/cli
    - *sf-auth
    - node "$VF_ROOT/scripts/checks/vf-check.mjs" deploy-quick --target-org "$SF_ALIAS" --json
    - node "$VF_ROOT/scripts/checks/vf-check.mjs" verify       --target-org "$SF_ALIAS" --json
```

`when: manual` is the GitLab analogue of a GitHub environment approval — the human gate that also
justifies `VF_ALLOW_PROD`.

## Runner hygiene

| Concern | Action |
| --- | --- |
| CLI version drift | Pin: `npm install --global @salesforce/cli@<version>`; record `sf --version` in the report |
| Progress bar noise | `SF_USE_PROGRESS_BAR=false` |
| Private key on disk | Write to `/tmp`, `chmod 600`, never echo; rely on the platform's secret masking |
| Concurrent deploys to one org | `concurrency.group` per org, `cancel-in-progress: false` |
| Shallow clones | `fetch-depth: 0` — `--changed` needs `git merge-base origin/main HEAD` |
| Orphaned scratch orgs | `trap` delete plus a scheduled `sf org list --clean --no-prompt` job |
| Evidence retention | Upload `.vibeforce/reports/` and `deploy-jobs.json` on every run, including failures |

## Agent mapping

| Wave | Agent | Pipeline analogue |
| --- | --- | --- |
| 0 | `sf-scout` | impact analysis, manifest scoping |
| 1 | `sf-apex-engineer`, `sf-lwc-engineer`, `sf-metadata-engineer`, `sf-integration-engineer` | the feature branch commits |
| 2 | `sf-test-engineer`, `sf-quality-gate`, `sf-security-reviewer` | the `local-gate` job |
| 3 | `sf-deploy-engineer` | `validate` then approval-gated `deploy` |
| 4 | `sf-org-verifier`, `sf-test-engineer` | post-deploy `verify` |

Wave 3 is deliberately serial and single-owner: one agent holds the job id, the approval, and the
rollback plan. See skill `sf-workflow-orchestration`.
