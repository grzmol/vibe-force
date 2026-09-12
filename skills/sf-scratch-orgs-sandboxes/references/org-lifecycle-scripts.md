# Org Lifecycle Scripts

Copy-ready bash for the full create -> deploy -> permission -> seed -> test -> destroy loop, for
snapshot maintenance, and for CI matrices. Every script uses `sf` v2 syntax with an explicit
`--target-org` / `--target-dev-hub`, sets `set -euo pipefail`, and cleans up in a `trap`.

`$VF_ROOT` is the vibe-force plugin root (`${CLAUDE_PLUGIN_ROOT}` inside hooks and commands).
Reports land in `<project>/.vibeforce/reports/`.

## 1. Ephemeral org, full loop (`scripts/ephemeral-org.sh` in a consumer project)

```bash
#!/usr/bin/env bash
# Create a scratch org, deploy source, grant access, seed data, run gates, delete.
set -euo pipefail

DEVHUB="${DEVHUB:-vf-devhub}"
DEF="${DEF:-config/ci-scratch-def.json}"
DAYS="${DAYS:-1}"
ALIAS="vf-eph-$(git rev-parse --short HEAD)-$$"
PERMSETS="${PERMSETS:-VF_App_Admin}"
SEED_PLAN="${SEED_PLAN:-data/plan.json}"

cleanup() {
  local rc=$?
  echo "==> cleanup ($ALIAS)"
  sf org delete scratch --target-org "$ALIAS" --no-prompt >/dev/null 2>&1 || true
  exit "$rc"
}
trap cleanup EXIT INT TERM

echo "==> create $ALIAS"
sf org create scratch \
  --definition-file "$DEF" \
  --target-dev-hub "$DEVHUB" \
  --alias "$ALIAS" \
  --duration-days "$DAYS" \
  --wait 20 \
  --no-track-source

echo "==> deploy source"
sf project deploy start \
  --target-org "$ALIAS" \
  --source-dir force-app \
  --wait 45 \
  --concise

echo "==> assign permission sets"
IFS=',' read -ra SETS <<< "$PERMSETS"
for ps in "${SETS[@]}"; do
  sf org assign permset --name "$ps" --target-org "$ALIAS"
done

if [[ -f "$SEED_PLAN" ]]; then
  echo "==> seed data"
  sf data import tree --plan "$SEED_PLAN" --target-org "$ALIAS"
fi

echo "==> local gate"
node "$VF_ROOT/scripts/checks/vf-check.mjs" local --json

echo "==> org apex tests"
node "$VF_ROOT/scripts/checks/vf-check.mjs" apex --target-org "$ALIAS" --json

echo "==> smoke"
node "$VF_ROOT/scripts/checks/vf-check.mjs" smoke --target-org "$ALIAS" --json

echo "==> PASS"
```

Exit codes propagate from `vf-check`: `0` pass, `1` gate failed, `2` misconfiguration, `3`
org/network error. The `trap` deletes the org on every path, including gate failure.

## 2. Developer workspace org (keeps source tracking)

```bash
#!/usr/bin/env bash
set -euo pipefail
DEVHUB=vf-devhub
ALIAS=vf-dev

sf org create scratch \
  --definition-file config/project-scratch-def.json \
  --target-dev-hub "$DEVHUB" \
  --alias "$ALIAS" \
  --duration-days 30 \
  --set-default \
  --wait 20

sf project deploy start --target-org "$ALIAS" --source-dir force-app --wait 45
sf org assign permset --name VF_App_Admin --target-org "$ALIAS"
sf data import tree --plan data/plan.json --target-org "$ALIAS"
sf org generate password --target-org "$ALIAS" --length 25
sf org display --target-org "$ALIAS" --verbose
sf org open --target-org "$ALIAS"
```

Do not pass `--no-track-source` here: `sf project deploy preview` and conflict detection are the
point of a workspace org.

## 3. Idempotent recreate

```bash
#!/usr/bin/env bash
# Recreate vf-dev only if it is missing or expired.
set -euo pipefail
ALIAS=vf-dev
DEVHUB=vf-devhub

status=$(sf org list --all --skip-connection-status --json \
  | jq -r --arg a "$ALIAS" '
      .result.scratchOrgs[]? | select(.alias == $a or (.aliases // []) | index($a))
      | (.status // "unknown")' | head -1)

if [[ "$status" == "Active" ]]; then
  echo "$ALIAS is active; reusing"
else
  echo "$ALIAS status=${status:-missing}; recreating"
  sf org delete scratch --target-org "$ALIAS" --no-prompt >/dev/null 2>&1 || true
  sf org create scratch -f config/project-scratch-def.json -v "$DEVHUB" -a "$ALIAS" -y 30 -w 20 -d
  sf project deploy start --target-org "$ALIAS" --source-dir force-app --wait 45
  sf org assign permset --name VF_App_Admin --target-org "$ALIAS"
fi
```

`sf org list --clean` removes local auth entries for non-active scratch orgs, which is the right
periodic housekeeping on a developer machine and on long-lived CI runners.

## 4. Async create with resume (long snapshot-based provisioning)

```bash
#!/usr/bin/env bash
set -euo pipefail
DEVHUB=vf-devhub
ALIAS=vf-snap

JOB=$(sf org create scratch \
        --definition-file config/snapshot-scratch-def.json \
        --target-dev-hub "$DEVHUB" \
        --alias "$ALIAS" \
        --duration-days 7 \
        --async --json | jq -r '.result.scratchOrgInfo.Id // .result.jobId')

echo "job=$JOB"
for attempt in 1 2 3 4 5 6; do
  if sf org resume scratch --job-id "$JOB" --wait 10 --json > /tmp/resume.json 2>/dev/null; then
    echo "ready"; break
  fi
  echo "still provisioning (attempt $attempt)"
done
sf org display --target-org "$ALIAS"
```

`sf org resume scratch --use-most-recent` is the flag to use when the job id was not captured.
Snapshot-based creation is materially slower than edition-based creation.

## 5. Snapshot refresh pipeline (nightly)

```bash
#!/usr/bin/env bash
# Rebuild the VFBase snapshot from current main so feature orgs start pre-seeded.
set -euo pipefail
DEVHUB=vf-devhub
SEED=vf-seed-$$
SNAP=VFBase

trap 'sf org delete scratch -o "$SEED" -p >/dev/null 2>&1 || true' EXIT

sf org create scratch -f config/project-scratch-def.json -v "$DEVHUB" -a "$SEED" -y 1 -w 20
sf project deploy start --target-org "$SEED" --source-dir force-app --wait 45
sf package install --package 04tXXXXXXXXXXXXXXX --target-org "$SEED" \
  --wait 20 --publish-wait 20 --security-type AdminsOnly --no-prompt
sf org assign permset --name VF_App_Admin --target-org "$SEED"
sf data import tree --plan data/plan.json --target-org "$SEED"

# A snapshot name is unique per Dev Hub; delete the old one first.
sf org delete snapshot --snapshot "$SNAP" --target-dev-hub "$DEVHUB" --no-prompt || true
sf org create snapshot \
  --source-org "$SEED" \
  --name "$SNAP" \
  --description "main@$(git rev-parse --short HEAD) $(date -u +%Y-%m-%dT%H:%MZ)" \
  --target-dev-hub "$DEVHUB"

# Poll until Active
for _ in $(seq 1 40); do
  st=$(sf org get snapshot --snapshot "$SNAP" --target-dev-hub "$DEVHUB" --json | jq -r '.result.Status')
  echo "snapshot status=$st"
  [[ "$st" == "Active" ]] && break
  [[ "$st" == "Error" ]] && { echo "snapshot failed"; exit 1; }
  sleep 30
done
```

Constraints worth encoding in the script: you cannot snapshot a namespaced scratch org, you
cannot snapshot an org that was itself created from a snapshot, and connected apps, named
credentials, and external credentials are never copied into a snapshot.

## 6. Seeding data deterministically

```bash
# Export a curated graph out of a reference org once, commit it, replay it everywhere.
sf data export tree \
  --query "SELECT Name, Industry, BillingCountry, (SELECT LastName, Email FROM Contacts) FROM Account WHERE VF_Seed__c = true" \
  --prefix vfseed --output-dir data --plan --target-org vf-int

sf data import tree --plan data/vfseed-Account-Contact-plan.json --target-org vf-dev

# Ad-hoc single records / cleanup
sf data create record --sobject Account --values "Name='VF Smoke' Industry='Technology'" --target-org vf-dev
sf data query --query "SELECT COUNT() FROM Account WHERE Name LIKE 'VF %'" --target-org vf-dev
sf data delete bulk --sobject Account --file data/delete-accounts.csv --wait 10 --target-org vf-dev
```

Seeding strategy, plan files, and bulk limits live in skill `sf-data-management`. This reference
only covers wiring it into a lifecycle script.

## 7. Post-create assertion block

Put this after seeding in any script that other automation depends on. It fails fast instead of
letting a half-provisioned org poison a later wave.

```bash
assert_org () {
  local alias="$1"
  local ok=1

  sf org display --target-org "$alias" --json >/dev/null || ok=0

  # permission set actually assigned to the running user
  cnt=$(sf data query --target-org "$alias" --json --query \
    "SELECT COUNT() FROM PermissionSetAssignment WHERE PermissionSet.Name = 'VF_App_Admin' AND AssigneeId = '$(sf org display --target-org "$alias" --json | jq -r '.result.id')'" \
    | jq -r '.result.totalSize') || cnt=0

  # seed data present
  seeds=$(sf data query --target-org "$alias" --json \
    --query "SELECT COUNT() FROM Account WHERE VF_Seed__c = true" | jq -r '.result.totalSize') || seeds=0

  # Apex is compilable and callable
  cat > /tmp/probe.apex <<'APEX'
System.assertNotEquals(null, UserInfo.getOrganizationId(), 'no org context');
System.debug(LoggingLevel.INFO, 'probe-ok ' + Limits.getLimitQueries());
APEX
  sf apex run --file /tmp/probe.apex --target-org "$alias" >/dev/null || ok=0

  [[ "$ok" == 1 && "$seeds" -gt 0 ]] || { echo "org assertions failed (ok=$ok seeds=$seeds)"; return 1; }
  echo "org assertions passed (permsetAssignments=$cnt seeds=$seeds)"
}

assert_org "$ALIAS"
```

`vf-check smoke` runs the productised version of these probes; see skill
`sf-post-deploy-verification`.

## 8. CI matrix: one org per shape

```yaml
# .github/workflows/scratch-matrix.yml
name: scratch-matrix
on: [pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shape:
          - { name: base, def: config/ci-scratch-def.json }
          - { name: community, def: config/community-scratch-def.json }
          - { name: intl, def: config/intl-scratch-def.json }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm install --global @salesforce/cli
      - name: Authorize Dev Hub (JWT)
        env:
          SF_JWT_KEY: ${{ secrets.SF_JWT_KEY }}
        run: |
          printf '%s' "$SF_JWT_KEY" > /tmp/server.key
          sf org login jwt \
            --client-id "${{ secrets.SF_CLIENT_ID }}" \
            --jwt-key-file /tmp/server.key \
            --username "${{ secrets.SF_DEVHUB_USERNAME }}" \
            --alias vf-devhub --set-default-dev-hub
      - name: Ephemeral org for ${{ matrix.shape.name }}
        env:
          DEVHUB: vf-devhub
          DEF: ${{ matrix.shape.def }}
          VF_ROOT: ${{ github.workspace }}/.vibe-force
        run: bash scripts/ephemeral-org.sh
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: vf-reports-${{ matrix.shape.name }}
          path: .vibeforce/reports/
```

Allocation arithmetic before you widen the matrix: concurrent jobs consume active scratch orgs,
and every successful create also consumes one of the rolling 24-hour daily allocations. A
Developer Edition Dev Hub (3 active / 6 daily) cannot sustain a three-way matrix on a busy repo;
an Enterprise Dev Hub (40 / 80) can.

## 9. Reclaiming allocation

```bash
# What is holding my active allocation?
sf limits api display --target-org vf-devhub
sf data query --target-org vf-devhub --query "
  SELECT ScratchOrg, SignupUsername, Status, ExpirationDate, Description
  FROM ActiveScratchOrg
  ORDER BY ExpirationDate"

# Delete by scratch org id from the Dev Hub (works even without a local auth entry)
sf data delete record --sobject ActiveScratchOrg --record-id 2SR... --target-org vf-devhub

# Local hygiene
sf org list --all --skip-connection-status
sf org list --clean --no-prompt
```

Deleting the `ActiveScratchOrg` record in the Dev Hub is the escape hatch when a CI runner died
before its `trap` ran and the org was never authorized locally.

## 10. Sandbox provisioning script

```bash
#!/usr/bin/env bash
# Create (or refresh) the integration sandbox from production.
set -euo pipefail
PROD=vf-prod
NAME=vfint          # 10 chars max, alphanumeric
ALIAS=vf-int

if sf org list --json | jq -e --arg n "$NAME" '.result.sandboxes[]? | select(.sandboxName == $n)' >/dev/null; then
  echo "==> refresh $NAME"
  sf org refresh sandbox --name "$NAME" --target-org "$PROD" --wait 60 --poll-interval 60 --no-prompt
else
  echo "==> create $NAME"
  sf org create sandbox \
    --definition-file config/dev-sandbox-def.json \
    --alias "$ALIAS" \
    --target-org "$PROD" \
    --wait 60 --poll-interval 60 --no-prompt
fi

sf alias set "$ALIAS=$(sf org list --json | jq -r --arg n "$NAME" '.result.sandboxes[] | select(.sandboxName==$n) | .username')"
sf project deploy start --target-org "$ALIAS" --source-dir force-app --wait 60
node "$VF_ROOT/scripts/checks/vf-check.mjs" smoke --target-org "$ALIAS"
```

Sandbox create and refresh are queued server-side and routinely exceed the 6-minute default
`--wait`; pass 30–60 minutes and a `--poll-interval` so the log shows progress. If the command
returns control before the sandbox is ready, resume with
`sf org resume sandbox --name "$NAME" --target-org "$PROD" --wait 60`.
