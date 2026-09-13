# Agent testing and evaluation

Source: Metadata API Developer Guide "AiEvaluationDefinition"; Agentforce Developer Guide "Test an
Agent with Agentforce DX", "Generate a Test Spec", "Customize the Agent Test Spec", "Troubleshoot
Agentforce DX Issues", "Considerations for the Testing API"; Salesforce CLI Command Reference
`agent` commands. Fetched for this skill.

Agent tests are **scored**, not asserted. A test sends an utterance, the agent answers, and a set
of expectations judges the answer. Two expectations are deterministic enough to gate a pipeline
(`topic_sequence_match`, `action_sequence_match`); the rest are quality signals that move.

## The loop

```
agent generate test-spec   ->  local YAML, one file per agent
        edit YAML          ->  add context variables, metrics, custom evaluations
agent test create          ->  creates the test in the org + writes AiEvaluationDefinition locally
agent test run             ->  starts the run, returns a job id
agent test resume/results  ->  human, JSON, JUnit or TAP output
        failures           ->  agent preview + agent trace read, then fix and repeat
```

The agent must already be published in the org before `agent test create` can reference it.

## Test spec YAML

`sf agent generate test-spec` reads the metadata in your DX project, not the org, and prompts for
each test case. The output:

```yaml
name: Resort Manager Tests
description: Tests for the Resort Manager agent.
subjectType: AGENT
subjectName: Resort_Manager
testCases:
  - utterance: Who is working the front desk today at noon?
    expectedTopic: p_16jQP0000000PEX_Employee_Schedule_Management
    expectedActions:
      - EmployeeCopilot__CreateAToDo
    expectedOutcome: Anna is working the desk.
    customEvaluations: []
    conversationHistory: []
    metrics:
      - completeness
      - coherence
      - conciseness
      - output_latency_milliseconds
```

| Key | Purpose |
| --- | --- |
| `subjectName` | API name of the agent under test |
| `subjectType` | `AGENT` |
| `utterance` | The natural-language input |
| `expectedTopic` | API name of the topic the agent should route to |
| `expectedActions` | API names of the actions it should invoke, in order |
| `expectedOutcome` | Natural-language description of the expected answer |
| `metrics` | Out-of-the-box quality checks added to the result output |
| `contextVariables` | Session context injected before the utterance |
| `conversationHistory` | Prior turns, so the utterance is evaluated mid-conversation |
| `customEvaluations` | String or numeric assertions against runtime data |

Context variables let one utterance be tested under several conditions:

```yaml
testCases:
  - utterance: Are there any resort experiences that match my interests today?
    expectedTopic: Experience_Management
    expectedActions: []
    expectedOutcome: The agent should politely ask for the guest's email address AND membership number.
    customEvaluations: []
    conversationHistory: []
    contextVariables:
      - name: EndUserLanguage
        value: Spanish
```

Conversation history must start with a `user` message; every `agent` message needs a `topic`:

```yaml
    conversationHistory:
      - role: user
        message: I purchased an item last week but it hasn't arrived yet.
      - role: agent
        message: What is your order ID?
        topic: Ask_for_Order_ID
      - role: user
        message: It's 123456.
```

Round-tripping an existing definition back to a spec:

```bash
sf agent generate test-spec \
  --from-definition force-app/main/default/aiEvaluationDefinitions/ResortManagerTest.aiEvaluationDefinition-meta.xml \
  --output-file specs/Resort_Manager-testSpec.yaml
```

`agent generate test-spec` takes no `--target-org` flag: it is entirely local.

## AiEvaluationDefinition metadata

The spec is a convenience; the metadata is the artefact that goes into version control and moves
between orgs. Suffix `.aiEvaluationDefinition`, directory `aiEvaluationDefinitions/`, available
from API 63.0.

| Field | Notes |
| --- | --- |
| `name` | Required. API name; unique, starts with a letter, no spaces, no trailing or doubled underscores |
| `subjectType` | Required. Only `AGENT` is supported |
| `subjectName` | Required. Must match the agent's API name exactly, as shown on its Setup detail page |
| `subjectVersion` | Optional. Defaults to the latest active version; the value comes from `BotVersion` |
| `description` | Purpose of the test |
| `testCase` | Array of test cases |

Per test case: `number` (auto-calculated if omitted), `inputs`, and one or more `expectation`
entries. Inputs carry `utterance` (required), plus optional `contextVariable`
(`variableName`/`variableValue`) and `conversationHistory` (`index`, `role`, `message`, `topic`).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<AiEvaluationDefinition xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>Escalation regression pack</description>
    <name>Opportunity_Coach_Test</name>
    <subjectName>Opportunity_Coach</subjectName>
    <subjectType>AGENT</subjectType>
    <subjectVersion>v1</subjectVersion>
    <testCase>
        <number>1</number>
        <inputs>
            <utterance>What is open on the Global Media account?</utterance>
        </inputs>
        <expectation>
            <name>topic_sequence_match</name>
            <expectedValue>Opportunity_Review</expectedValue>
        </expectation>
        <expectation>
            <name>action_sequence_match</name>
            <expectedValue>['Summarise_Account_Pipeline']</expectedValue>
        </expectation>
        <expectation>
            <name>conciseness</name>
        </expectation>
    </testCase>
    <testCase>
        <number>2</number>
        <inputs>
            <utterance>give me a pizza recipe</utterance>
        </inputs>
        <expectation>
            <name>topic_sequence_match</name>
            <expectedValue>Small_Talk</expectedValue>
        </expectation>
        <expectation>
            <name>action_sequence_match</name>
            <expectedValue>[]</expectedValue>
        </expectation>
    </testCase>
</AiEvaluationDefinition>
```

The second case is the one people forget: prove the agent **refuses** out-of-scope requests and
invokes no action. An agent that will answer anything will eventually answer something expensive.

## Expectation catalogue

| `name` | `expectedValue` format | Deterministic? |
| --- | --- | --- |
| `topic_sequence_match` | Topic API name, for example `OOTBSingleRecordSummary` | Yes |
| `action_sequence_match` | `string[]` of action API names, for example `['IdentifyRecordByName', 'action2']`; `[]` asserts no action ran | Yes |
| `bot_response_rating` | Natural-language description of the expected response | No - judged |
| `coherence` | none | No - scored |
| `completeness` | none | No - scored |
| `conciseness` | none | No - scored |
| `output_latency_milliseconds` | none | Measured |
| `string_comparison` | uses `parameter`, not `expectedValue` | Yes |
| `numeric_comparison` | uses `parameter`, not `expectedValue` | Yes |

`label` is optional on any expectation and appears in results instead of the expectation name -
use it when the same custom criterion appears several times in one case.

Definitions Salesforce applies to the scored metrics: coherent means easy to understand and free
of grammatical errors; complete means all essential information is present; concise means brief
but comprehensive, shorter being better.

Results report each metric as a value against a threshold, plus the judge's explanation when the
metric fails. A representative run:

| Metric | Value / threshold | Verdict |
| --- | --- | --- |
| `completeness` | 1 / 0.6 | Fail - the answer omitted the weather information the user asked for |
| `coherence` | 4 / 0.6 | Pass |
| `conciseness` | 5 / 0.6 | Pass |
| `output_latency_milliseconds` | 3564 ms | Measured, not thresholded |

## Custom evaluation criteria

`string_comparison` and `numeric_comparison` take a `parameter` array instead of an
`expectedValue`. Parameter names are fixed: `operator`, `actual`, `expected`.

| Operator | Applies to |
| --- | --- |
| `equals` | string or numeric |
| `contains` | string |
| `startswith` | string |
| `endswith` | string |
| `greater_than`, `greater_than_or_equal` | numeric |
| `less_than`, `less_than_or_equal` | numeric |

Set `isReference: true` on a parameter whose `value` is a JSONPath expression into the
`generatedData` object returned by the test results. That is how you assert on what the agent
actually passed to an action:

```yaml
    customEvaluations:
      - label: Check for correct date
        name: string_comparison
        parameters:
          - name: operator
            value: equals
            isReference: false
          - name: actual
            value: $.generatedData.invokedActions[*][?(@.function.name == 'Check_Weather')].function.input.dateToCheck
            isReference: true
          - name: expected
            value: "2025-09-12"
            isReference: false
```

Discover the JSON structure before writing the path:

```bash
sf agent test run --api-name Guest_Experience_Agent_Test --verbose --target-org vf-dev
```

`--verbose` prints the generated data - the invoked actions, their inputs and outputs, the objects
touched, and per-action latency:

```
[ [ { "function": { "name": "Check_Weather",
                    "input": { "dateToCheck": "2025-09-12" },
                    "output": {} },
      "executionLatency": 804 } ] ]
```

Custom evaluations are the strongest test you can write for an agent, because they assert on the
**inputs the planner constructed**, not on generated prose.

## CLI workflow

```bash
# Create the test in the org from the spec; --preview renders the metadata without deploying it
sf agent test create --spec specs/Opportunity_Coach-testSpec.yaml \
  --api-name Opportunity_Coach_Test --target-org vf-dev

# List what exists in the org
sf agent test list --target-org vf-dev

# Run, waiting up to 10 minutes, writing JUnit for CI
sf agent test run --api-name Opportunity_Coach_Test --wait 10 \
  --result-format junit --output-dir .vibeforce/reports --target-org vf-dev

# If the wait expired, pick the run back up
sf agent test resume --use-most-recent --wait 10 --target-org vf-dev

# Fetch results for a finished run
sf agent test results --job-id 4KBfake0000003F4AQ --verbose --target-org vf-dev
```

| Flag | Commands | Notes |
| --- | --- | --- |
| `--result-format` | `run`, `resume`, `results` | `human` (default), `json`, `junit`, `tap` |
| `--output-dir` | `run`, `resume`, `results` | Results are written only if the run has completed |
| `--verbose` | `run`, `resume`, `results` | Adds generated data; required for building JSONPath |
| `--wait` | `run`, `resume` | Minutes; without it the command returns a job id immediately |
| `--use-most-recent` | `resume`, `results` | Uses the last run's job id |
| `--job-id` | `results` (required), `resume` | From the original `agent test run` output |

## Debugging a failing test

A failing score is not a bug report. Reproduce the conversation, then read the trace:

```bash
sf agent preview --api-name Opportunity_Coach --target-org vf-dev
sf agent preview sessions
sf agent trace read --session-id <SESSION_ID> --format summary
sf agent trace read --session-id <SESSION_ID> --format detail --dimension routing
sf agent trace read --session-id <SESSION_ID> --format detail --dimension actions
sf agent trace read --session-id <SESSION_ID> --format detail --dimension grounding
sf agent trace read --session-id <SESSION_ID> --format detail --dimension errors
```

| Failure | Dimension to read | Usual cause |
| --- | --- | --- |
| Wrong topic | `routing` | Two topic descriptions overlap, or the scope is too broad |
| Right topic, wrong action | `actions` | Action descriptions do not distinguish the cases |
| Right action, wrong inputs | `actions` | Input descriptions do not say where the value comes from |
| Answer ignores retrieved data | `grounding` | No output property sets `copilotAction:isUsedByPlanner` |
| Action threw | `errors` | Apex or Flow failure - switch to `--use-live-actions --apex-debug` and use the Apex Replay Debugger |

Low `coherence` or `completeness` scores almost always trace back to vague instructions or vague
action descriptions rather than to the model. Fix the text, rerun, compare.

`agent trace read --turn <N>` narrows to a single turn; turns start at 1.
`agent trace list --agent <api-name> --since 2026-04-20` finds older sessions.

## CI wiring

```bash
sf org login jwt --client-id "$CONSUMER_KEY" --jwt-key-file server.key \
  --username "$CI_USERNAME" --alias vf-int --instance-url "$INSTANCE_URL"

sf agent activate --api-name Opportunity_Coach --version 1 --target-org vf-int
sf agent test run --api-name Opportunity_Coach_Test --wait 15 \
  --result-format junit --output-dir .vibeforce/reports --target-org vf-int
```

Rules learned from the troubleshooting guide:

- Web login is unavailable in CI. Use the JWT flow with an external client app.
- Some tests require the agent to be **activated** first; add an `agent activate` step.
- Without `--wait`, poll with `agent test resume --job-id <id>` before judging pass or fail.
- Exit code `1` means test cases had **execution errors**, not that assertions failed. Parse the
  result output to distinguish the two.

Gate the build on `topic_sequence_match` and `action_sequence_match` plus custom evaluations. Track
`coherence`, `completeness`, `conciseness` and `output_latency_milliseconds` as trends, and alert
on a sustained drop rather than a single run.

## Limits and cost

| Limit | Value |
| --- | --- |
| Test cases per `AiEvaluationDefinition` | 1,000 |
| Concurrent `IN-PROGRESS` runs | 10 |
| Billing | Generative AI use in production **and sandbox** consumes Einstein Requests, and possibly Data 360 credits |
| Stability | Test results can change as the testing service improves |

That last row is why a scored metric is a poor gate: the same suite can produce a different score
next week without any change on your side.

## Regression practice

1. One `AiEvaluationDefinition` per agent, checked into the repo beside the agent.
2. Every production incident becomes a test case with the exact failing utterance.
3. Keep a refusal case per topic: an out-of-scope utterance with `action_sequence_match` `[]`.
4. Keep an ambiguity case: an utterance missing a required input, expecting the agent to ask.
5. Pin `subjectVersion` when testing a specific committed version; omit it to test the active one.
6. Use `contextVariables` to cover language, channel and record-context variants instead of
   duplicating utterances.
7. Test the Apex behind the actions with ordinary Apex tests (skill `sf-apex-testing`) - the agent
   suite proves routing, not arithmetic.

## `agent test run-eval` (Beta)

A second runner exists for richer evaluation. It accepts the same YAML test spec - inferring the
agent from `subjectName` - or a JSON payload, and supports subagent routing assertions, action
invocation checks, string and numeric assertions, semantic similarity scoring and LLM-based
quality ratings.

```bash
sf agent test run-eval --spec specs/Opportunity_Coach-testSpec.yaml \
  --result-format junit --target-org vf-dev
```

| Flag | Notes |
| --- | --- |
| `--spec` | Required. YAML or JSON; reads from stdin when piped |
| `--api-name` | Overrides the agent inferred from `subjectName` |
| `--batch-size` | Tests per API request, default and maximum 5 |
| `--no-normalize` | Disables auto-correction of field names and shorthand JSONPath in JSON payloads |
| `--result-format` | `human` (default), `json`, `junit`, `tap` |

It is a Beta Service under the Beta Services Terms. Keep the `agent test run` path as the gate
until it goes GA.

## Cross-references

- Metadata shape and manifests: `metadata-reference.md`
- Writing the actions the tests assert on: `action-patterns.md`
- Activation before a CI test run: `deployment-checklist.md`
- Apex debug logs behind a failing action: skill `sf-debugging-logs`
- Where the suite sits in the wave model: skill `sf-workflow-orchestration`
