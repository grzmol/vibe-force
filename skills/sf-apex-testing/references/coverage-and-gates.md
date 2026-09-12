# Apex Coverage and Gates Reference

What Salesforce counts as covered, why sandbox and production disagree, the full CLI surface for
running tests and retrieving coverage, and how `vf-check apex` turns those numbers into a pass or
fail.

## Platform coverage rules

| Rule | Value |
| --- | --- |
| Minimum coverage to deploy Apex or upload a package | 75% of Apex code, with **all** tests passing |
| Coverage basis | total number of code lines in the org |
| `System.debug` calls | not counted as covered code |
| Test methods and test classes | not counted as covered code |
| Every trigger | must have some test coverage |
| All classes and triggers | must compile successfully |
| Conditional and ternary operators | not considered executed unless **both** branches run |
| Coverage refresh | numbers do **not** refresh when Apex changes; rerun tests to get a correct estimate |
| Production deployment default | every unit test in the org namespace executes |
| Package-related tests | excluded from org coverage, except when package tests cause your triggers to fire |
| Parallelism | tests do **not** run in parallel during metadata deployments, package installations, or change-set deployments |

Adding code changes the denominator. An org with 50 covered lines at 100% that gains a 50-line
uncovered trigger drops to 50%.

## Test levels and the coverage rule each implies

| `--test-level` | Which tests run | Coverage rule |
| --- | --- | --- |
| `RunSpecifiedTests` | only the tests named in `--tests` / `runTests` | the executed tests must cover **each class and trigger in the deployment package** to at least 75%, computed per class and per trigger — a different and stricter rule than overall coverage |
| `RunLocalTests` | all local tests, including tests from no-namespace unlocked packages; excludes installed managed packages and namespaced unlocked packages | overall org coverage must reach 75%; **default for production deployments containing Apex** |
| `RunAllTestsInOrg` | every test in the org, including package tests | overall coverage includes package code |
| `NoTestRun` | none | permitted only where the platform allows it (for example a non-production org without Apex changes) |

`vibe-force` default in `config/vibe-force.defaults.json` is `testLevels.sandbox` =
`RunLocalTests` and `testLevels.production` = `RunLocalTests`. Use `RunSpecifiedTests` only for a
fast inner loop or a narrowly scoped hotfix, and remember the per-class 75% rule then applies to
every class in the package.

## Why sandbox and production coverage differ

| Cause | Mechanism | Remedy |
| --- | --- | --- |
| Test failures | a failing test contributes no coverage, so the overall percentage changes | make every test pass in the source org before deploying |
| Data dependencies | `@IsTest(SeeAllData=true)` tests execute different paths when the records differ or are missing | create test data in the test |
| Metadata dependencies | different profile or permission settings change which branch runs | align metadata, or assign permission sets inside the test |
| Managed and unlocked package tests | UI "run all tests" excludes package code from org coverage; a `RunAllTestsInOrg` deployment includes it | validate in a sandbox or run a validation deployment first |
| New components at 100% still failing | the **average** of new and existing code must reach 75% | raise coverage on existing code, or deploy the test methods alongside |
| Production coverage drifting below 75% after a clean deployment | data- or metadata-dependent tests silently change branches | remove org-data dependencies |

Recommended process, straight from the Code Coverage Best Practices page: stage production
deployments through a **Full Sandbox** (it mimics production metadata and data), use test data
rather than org data, and if production still fails, run local tests **in production**, identify
classes below 75%, and write tests for those specific classes.

## `sf apex run test`

```bash
sf apex run test --tests CaseEscalationServiceTest --synchronous \
  --code-coverage --detailed-coverage --result-format human --target-org vf-dev
```

| Flag | Short | Type | Notes |
| --- | --- | --- | --- |
| `--target-org` | `-o` | option | **required** unless the `target-org` config variable is set; `vibe-force` always passes it explicitly |
| `--test-level` | `-l` | option | `RunSpecifiedTests`, `RunLocalTests`, `RunAllTestsInOrg`; default `RunLocalTests` |
| `--class-names` | `-n` | option, repeatable | mutually exclusive with `--suite-names` and `--tests` |
| `--suite-names` | `-s` | option, repeatable | mutually exclusive with `--class-names` and `--tests` |
| `--tests` | `-t` | option, repeatable | `Class`, `Class.method`, or `ns.Class.method`; a class without a method runs all its methods |
| `--code-coverage` | `-c` | boolean | required to obtain any coverage numbers |
| `--detailed-coverage` | `-v` | boolean | per-test coverage; human-readable format only |
| `--result-format` | `-r` | option | `human` (default), `tap`, `junit`, `json` |
| `--output-dir` | `-d` | option | writes result files for CI artefacts |
| `--wait` | `-w` | option (minutes) | streaming client socket timeout; if tests do not finish, the command prints a test run id |
| `--poll-interval` | `-i` | option (seconds) | retry interval |
| `--synchronous` | `-y` | boolean | runs the methods of a **single** Apex class synchronously; otherwise asynchronous |
| `--concise` | — | boolean | only failed results; human output only |
| `--api-version` | — | option | overrides the API version for the request |
| `--json` | — | boolean | machine-readable command output |
| `--flags-dir` | — | option | import flag values from a directory |

Requirements and caveats:

- The running user needs the **View All Data** system permission; it is disabled by default.
- `testRunCoverage` in JSON and JUnit output is the percentage of covered lines over total lines
  across the Apex classes **evaluated by that run** — not the org-wide figure.
- To run Apex and Flow tests together, `sf logic run test` accepts the same flags plus
  `--test-category Apex|Flow`.

## `sf apex get test`

```bash
sf apex get test --test-run-id 707xx0000000001 --code-coverage \
  --result-format junit --output-dir /tmp/apex-results --target-org vf-dev
```

| Flag | Short | Notes |
| --- | --- | --- |
| `--test-run-id` | `-i` | **required**; printed by `sf apex run test` when the run outlives `--wait` |
| `--target-org` | `-o` | required unless configured |
| `--code-coverage` | `-c` | retrieve coverage |
| `--detailed-coverage` | — | per-test detail; note there is **no** `-v` short form on this command |
| `--output-dir` | `-d` | where to store result files |
| `--result-format` | `-r` | `human` (default), `tap`, `junit`, `json` |
| `--concise` | — | failures only; human output only |

## Test suites

A suite groups classes so CI can run a named subset. Source form:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ApexTestSuite xmlns="http://soap.sforce.com/2006/04/metadata">
    <testClassName>CaseEscalationServiceTest</testClassName>
    <testClassName>CaseTriggerTest</testClassName>
    <testClassName>OpportunityCloseServiceTest</testClassName>
</ApexTestSuite>
```

```text
force-app/main/default/testSuites/CoreRegression.testSuite-meta.xml
```

```bash
sf apex run test --suite-names CoreRegression --code-coverage \
  --result-format json --output-dir /tmp/apex-results --wait 30 --target-org vf-dev
```

Suite strategy that keeps feedback fast:

| Suite | Contents | When it runs |
| --- | --- | --- |
| `Smoke` | one test per critical path | every `vf-check apex` in the dev loop |
| `CoreRegression` | everything touching shared objects and the trigger framework | wave 2 of the `vibe-force` workflow |
| `Integration` | callout-mock-driven tests for external services | before `deploy-validate` |
| (none) | `RunLocalTests` | `deploy-validate` and `deploy-quick` |

## Synchronous versus asynchronous runs

| Aspect | `--synchronous` | default (asynchronous) |
| --- | --- | --- |
| Scope | methods of a single Apex class | any selection |
| Returns | results inline | a test run id, then results via `--wait` or `sf apex get test` |
| Parallelism | none | tests run in parallel unless disabled org-wide |
| Contention risk | lowest | `UNABLE_TO_LOCK_ROW` and deadlocks possible |
| Daily quota | shared with asynchronous | the greater of 500 or 10× the number of test classes (production); the greater of 500 or 20× (sandbox and Developer Edition) |
| Use for | the inner loop, and diagnosing a flaky test | CI and full regression |

## `vf-check apex` contract

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" apex --target-org vf-dev
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" apex --tests CaseEscalationServiceTest \
  --target-org vf-dev --json
```

| Gate | Config key | Default | Meaning |
| --- | --- | --- | --- |
| Org coverage | `gates.apexOrgCoverageMin` | 85 | org-wide covered/total must be at or above this after the run — deliberately above the platform's 75% so a later deployment has headroom |
| Per-class coverage | `gates.apexClassCoverageMin` | 75 | every class touched by the change must reach this; matches the platform's `RunSpecifiedTests` rule |
| Test presence | `gates.requireTestForApexClass` | true | a new `*.cls` without a corresponding `*Test.cls` fails the check |

Exit codes (shared by every check): `0` pass, `1` gate failed, `2` misconfiguration or missing tool,
`3` org or network error.

Report shape written to `<project>/.vibeforce/reports/apex-<ISO>.json`:

```json
{
  "check": "apex",
  "startedAt": "2026-09-12T14:05:11.482Z",
  "durationMs": 91240,
  "status": "failed",
  "gates": {
    "apexOrgCoverageMin": { "required": 85, "actual": 81.4, "pass": false },
    "apexClassCoverageMin": { "required": 75, "worst": "CaseEscalationService", "actual": 62.5, "pass": false },
    "requireTestForApexClass": { "missing": ["CaseAgingService"], "pass": false }
  },
  "findings": [
    {
      "severity": "error",
      "rule": "apexClassCoverageMin",
      "file": "force-app/main/default/classes/CaseEscalationService.cls",
      "message": "62.5% covered (40/64 lines); 75% required",
      "uncoveredLines": [48, 49, 50, 61, 62]
    },
    {
      "severity": "error",
      "rule": "testFailure",
      "file": "force-app/main/default/classes/CaseTriggerTest.cls",
      "message": "bulkInsertEscalatesPlatinumAccountsOnly: System.AssertException: Assertion Failed: Every Platinum case should be escalated: Expected: 100, Actual: 0"
    }
  ],
  "raw": { "testRunId": "707xx0000000001", "testsRan": 42, "failing": 1, "passing": 41 }
}
```

Use `findings[].uncoveredLines` to target the missing branches instead of writing another broad
test.

## Raising coverage without writing filler

| Situation | Wrong move | Right move |
| --- | --- | --- |
| A guard clause is uncovered | add a test that calls the method twice | one test that drives the guard's true branch and asserts the early return's observable effect |
| A `catch` block is uncovered | wrap the call in try/catch in the test | force the failure (missing required field, mocked 500 response) and assert the handled outcome |
| A ternary is half covered | assert the same branch twice | one test per branch — both are required for the line to count |
| A private helper is uncovered | make it public | `@TestVisible`, or exercise it through the public method that owns it |
| Whole class uncovered because it needs a callout | `Test.isRunningTest()` short-circuit in production code | `HttpCalloutMock` |
| Async job uncovered | assert nothing and let coverage rise | enqueue inside `startTest`/`stopTest` and assert the persisted result |
| Getter/setter noise | a test that reads every property | delete the unused properties |

## Daily test-run allocations

| Limit | Value |
| --- | --- |
| Test classes queued per 24 hours, production orgs other than Developer Edition | the greater of 500 or 10 × number of test classes in the org |
| Test classes queued per 24 hours, sandbox and Developer Edition | the greater of 500 or 20 × number of test classes in the org |
| Batch jobs submittable in a running test | 5 |
| `MAX_DML_ROWS` in one synchronous Apex test execution context | 450,000 rows inserted, updated, or deleted |

The queued-class limit applies to tests running **asynchronously**, including runs started from the
Developer Console or by inserting `ApexTestQueueItem` records via SOAP API. Check remaining
allocations with `sf org list limits --target-org vf-dev` (aliases: `sf limits api display`,
`sf force limits api display`) or `OrgLimits.getMap()` in Apex — see `sf-governor-limits`.

## Failure triage

| Failure text | Cause | Action |
| --- | --- | --- |
| `System.AssertException: Assertion Failed` | the behaviour differs from the assertion | read the message you wrote; do not weaken the assertion |
| `System.LimitException: Too many SOQL queries: 101` | non-bulkified code, or a query inside a loop | fix the production code; see `sf-governor-limits` |
| `System.UnexpectedException: No more than one executeBatch can be called...` | more than 5 batch jobs in one test | split the test |
| `Methods defined as TestMethod do not support Web service callouts` | missing `Test.setMock` | install the mock |
| `UNABLE_TO_LOCK_ROW` | parallel tests contending on shared records | create data per test; consider `IsParallel` settings |
| `INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY` inside `runAs` | the test user lacks a permission the code needs | assign a permission set, or assert the denial if that is the intent |
| `MIXED_DML_OPERATION` | setup and non-setup objects in one transaction | wrap the setup-object DML in `System.runAs(thisUser)` |
| `Your runallTests is consuming too many DB resources` | `MAX_DML_ROWS` (450,000) exceeded | reduce the row volume per method |
| Coverage passes locally, fails on deploy | data or metadata dependency | remove `SeeAllData`, assign permission sets explicitly |

## Sources

| Topic | URL |
| --- | --- |
| Understanding testing in Apex (75% rule) | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_testing_intro.htm |
| Code coverage best practices | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_code_coverage_best_pract.htm |
| Code coverage introduction | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_code_coverage_intro.htm |
| Testing best practices and parallel execution | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_testing_best_practices.htm |
| Running unit test methods | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_testing_unit_tests_running.htm |
| `sf apex run test` and `sf apex get test` | https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_apex_commands_unified.htm |
| `sf org list limits` | https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_org_commands_unified.htm |
| Salesforce Platform Apex limits (daily test-class allocations) | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm |
| Miscellaneous Apex limits (`MAX_DML_ROWS` in testing) | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm |
| Salesforce CLI Command Reference (PDF, Spring '26) | https://resources.docs.salesforce.com/260/latest/en-us/sfdc/pdf/sfdx_cli_reference.pdf |
