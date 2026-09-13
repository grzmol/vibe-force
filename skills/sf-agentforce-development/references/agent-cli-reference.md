# Salesforce CLI: agent command reference

Source: Salesforce CLI Command Reference, `agent Commands` index and individual command pages, plus
the `org` command pages for `org create agent-user` and `org open agent`. Fetched for this skill.

Salesforce CLI v2 only. Every org-touching command below takes `-o | --target-org`; the few that
do not are called out explicitly, because they operate purely on local DX project files. The CLI
and its core plugins ship weekly, so treat this table as the shape of the command group, and
`sf <command> --help` as the authority for the exact flag list on your installed version.

## Command index

| Command | Org needed | Purpose |
| --- | --- | --- |
| `agent generate agent-spec` | yes | Generate the YAML spec that describes the agent |
| `agent generate authoring-bundle` | yes | Turn a spec into an `AiAuthoringBundle` with an Agent Script file |
| `agent validate authoring-bundle` | yes | Compile the Agent Script file, report syntax errors |
| `agent publish authoring-bundle` | yes | Publish the bundle: creates or versions the agent in the org |
| `agent create` | yes | Legacy path: create a non-Agent-Script agent from a spec |
| `agent activate` / `agent deactivate` | yes | Make a version live / take it offline |
| `agent preview` | yes | Interactive conversation with an agent |
| `agent preview start` / `send` / `sessions` / `end` | mixed | Programmatic (scriptable) preview session |
| `agent trace list` / `read` / `delete` | no | Work with local trace files from preview sessions |
| `agent generate test-spec` | **no** | Generate the test spec YAML from local metadata |
| `agent test create` | yes | Create the test in the org, write `AiEvaluationDefinition` locally |
| `agent test list` | yes | List agent tests in the org |
| `agent test run` / `resume` / `results` | yes | Start a run, resume it, fetch results |
| `agent test run-eval` (Beta) | yes | Rich evaluation runner |
| `agent generate template` | yes (`--source-org`) | Generate a `BotTemplate` for 2GP packaging |
| `agent adl *` | yes | Agentforce Data Library management - see skill `sf-data-cloud` |
| `agent mcp *` (Developer Preview) | yes | MCP servers in the API Catalog |
| `org create agent-user` | yes | Create the user the agent runs as |
| `org open agent` | yes | Open the agent in Agentforce Builder |

Flags present on nearly every command: `--json`, `--flags-dir`, `--api-version`.

## Authoring

### `agent generate agent-spec`

Produces a YAML spec: company context, role, and an LLM-generated list of topics. Requires an org
because it calls the org's LLM.

| Flag | Notes |
| --- | --- |
| `--type` | `customer` or `internal` |
| `--role` | What the agent does |
| `--company-name`, `--company-description`, `--company-website` | Context passed to the LLM |
| `--max-topics` | Default 5 |
| `--agent-user` | Username of the org user to assign to the agent |
| `--tone` | `formal`, `casual`, `neutral` |
| `--enrich-logs` | `true` or `false`; adds agent conversation data to event logs |
| `--prompt-template` | API name of a custom prompt template to use instead of the default |
| `--grounding-context` | Context and personalisation added when using a custom prompt template |
| `--spec` | Existing spec to iterate on |
| `--output-file` | Default `specs/agentSpec.yaml` |
| `--full-interview` | Prompt for required **and** optional properties |
| `--force-overwrite` | Do not confirm before overwriting |

```bash
sf agent generate agent-spec --type customer \
  --role "Field customer complaints and manage employee schedules." \
  --company-name "Coral Cloud Resorts" \
  --company-description "Destination activities and reservation services." \
  --max-topics 5 --output-file specs/resortManagerAgent.yaml --target-org vf-dev
```

Iterating is the intended workflow: pass the existing file to `--spec`, sharpen `--role`, and
write the result back over the same `--output-file`.

### `agent generate authoring-bundle`

| Flag | Notes |
| --- | --- |
| `-f, --spec` | Spec YAML; without it the command lists specs to choose from |
| `--no-spec` | Skip the spec and emit default Agent Script boilerplate |
| `-n, --name` | Label of the bundle |
| `--api-name` | Derived from the label if omitted; must not already exist in the org |
| `-d, --output-dir` | Default is `force-app/main/default/aiAuthoringBundles/<api-name>` |
| `--force-overwrite` | Overwrite an existing local bundle with the same API name |

```bash
sf agent generate authoring-bundle --spec specs/resortManagerAgent.yaml \
  --name "Resort Manager" --api-name Resort_Manager --target-org vf-dev
```

The bundle is `<api-name>.agent` plus `<api-name>.bundle-meta.xml`. An org is required because the
command uses the org's LLM to write the first draft of the Agent Script file.

### `agent validate authoring-bundle`

Compiles the Agent Script file and prints each syntax error with a description and a location.
Run it after every edit; it is the fastest feedback loop in the workflow.

```bash
sf agent validate authoring-bundle --api-name Resort_Manager --target-org vf-dev
```

Only `-n, --api-name` beyond the common flags. Without it, the command lists the bundles it finds
in the DX project.

### `agent publish authoring-bundle`

| Flag | Notes |
| --- | --- |
| `-n, --api-name` | Bundle to publish; prompts with a list if omitted |
| `--skip-retrieve` | Do not retrieve the resulting agent metadata back into the DX project |

Sequence the command performs: validate the Agent Script compiles, publish it to the org, create
or version the associated metadata (`Bot`, `BotVersion`, and the `GenAi*` components), retrieve
that metadata back to the project unless `--skip-retrieve`, then deploy the `AiAuthoringBundle`
itself. Compilation errors abort before anything reaches the org.

### `agent create` (legacy)

Creates an agent from a spec **without** an Agent Script blueprint. The command reference itself
recommends against it: those agents are less flexible and harder to maintain, and several
Agentforce DX commands do not work with them. Flags: `--name`, `--api-name`, `--spec`,
`--preview`. Use the authoring-bundle path instead.

## Lifecycle

### `agent activate` / `agent deactivate`

| Flag | Command | Notes |
| --- | --- | --- |
| `-n, --api-name` | both | Prompts with a list if omitted |
| `--version` | `activate` only | The number in `vN.botVersion-meta.xml` |

```bash
sf agent activate --api-name Resort_Manager --version 2 --target-org vf-int
sf agent deactivate --api-name Resort_Manager --target-org vf-int
```

Only one version is active at a time. A published agent must be active before `agent preview` can
reach it. With `--json` and no `--version`, the latest version is activated.

### `org open agent`

| Flag | Notes |
| --- | --- |
| `-n, --api-name` | Opens the agent in the Agent Builder UI |
| `--authoring-bundle` | Opens the agent in Agentforce Builder by bundle API name |
| `--version` | With `--authoring-bundle`, opens a specific version |
| `-b, --browser` | `chrome`, `edge`, `firefox` |
| `--private` | Incognito window |
| `-r, --url-only` | Print the URL instead of launching a browser |

```bash
sf org open agent --api-name Coral_Cloud_Agent --target-org vf-dev
sf org open agent --authoring-bundle MyAgent --version 1 --url-only --target-org vf-dev
```

### `org create agent-user`

| Flag | Notes |
| --- | --- |
| `--base-username` | Email-format base; a 12-character GUID is inserted before the `@` |
| `--first-name` | Default `Agent` |
| `--last-name` | Default `User` |

Assigns the `Einstein Agent User` profile and the `AgentforceServiceAgentBase`,
`AgentforceServiceAgentUser` and `EinsteinGPTPromptTemplateUser` permission sets, and checks that
the required user licences are available. Add anything else afterwards with `org assign permset`
or `org assign permsetlicense`.

## Preview and trace

### `agent preview` (interactive)

| Flag | Notes |
| --- | --- |
| `-n, --api-name` | An activated, published agent |
| `--authoring-bundle` | A local authoring bundle |
| `--use-live-actions` | Invokes the deployed implementation behind each action instead of mocking it |
| `-x, --apex-debug` | Enable Apex debug logging during the conversation |
| `-d, --output-dir` | Transcript directory; default `./temp/agent-preview` |

Without `--use-live-actions`, preview runs in **simulated** mode: the LLM mocks every action from
the topic information in the Agent Script file. Use simulated mode before the implementations
exist; use live mode to surface compile and validation errors and to attach the Apex Replay
Debugger. Exit the conversation with ESC or Control+C.

```bash
sf agent preview --authoring-bundle Resort_Manager --use-live-actions --apex-debug \
  --output-dir transcripts/resort --target-org vf-dev
```

### `agent preview start` / `send` / `sessions` / `end` (programmatic)

```bash
# start prints the session ID. The JSON key that carries it is [unverified]: run the
# command once with --json and read the payload before scripting around it.
sf agent preview start --authoring-bundle Resort_Manager --simulate-actions \
  --target-org vf-dev

sf agent preview send --authoring-bundle Resort_Manager --session-id "$SESSION" \
  --utterance "What can you help me with?" --target-org vf-dev

sf agent preview sessions
sf agent preview end --authoring-bundle Resort_Manager --session-id "$SESSION" --target-org vf-dev
```

| Command | Flags beyond the common set |
| --- | --- |
| `start` | `-n, --api-name`, `--authoring-bundle`, `--use-live-actions`, `--simulate-actions` |
| `send` | `-u, --utterance` (required), `--session-id`, `-n, --api-name`, `--authoring-bundle` |
| `sessions` | none - no `--target-org`, it reads the local cache |
| `end` | `--session-id`, `-n, --api-name`, `--authoring-bundle` |

With `--authoring-bundle`, `start` requires exactly one of `--use-live-actions` or
`--simulate-actions`. Published agents (`--api-name`) always use live actions and ignore both
flags. `--session-id` is optional when the agent has exactly one active session; with more than
one, omitting it is an error. `end` also prints where the session's trace files live.

### `agent trace list` / `read` / `delete`

Trace files are written locally by every preview session, one file per session, one trace entry per
turn. These commands need no org.

`agent trace list`:

| Flag | Notes |
| --- | --- |
| `-a, --agent` | Filter by authoring bundle or published agent API name |
| `--session-id` | Filter to one session |
| `--since` | ISO 8601: `2026-04-20`, `2026-04-20T14:00:00Z`, or with milliseconds |

`agent trace read`:

| Flag | Notes |
| --- | --- |
| `-s, --session-id` | **Required** |
| `-f, --format` | `summary` (default), `detail`, `raw` |
| `-d, --dimension` | Required with `--format detail`: `actions`, `grounding`, `routing`, `errors` |
| `-t, --turn` | One turn; turns start at 1 |

| Format | Use it for |
| --- | --- |
| `summary` | Per-turn narrative: topic routing, actions executed, the response |
| `detail` + dimension | Filtered drill-down into one concern, minimising noise |
| `raw` | Unprocessed trace JSON, for custom analysis or when the schema has changed |

| Dimension | Answers |
| --- | --- |
| `actions` | What ran, with which inputs and outputs, and how long it took |
| `grounding` | The LLM's reasoning steps - how it decided |
| `routing` | When and why the agent moved between subagents |
| `errors` | Every error in the session, aggregated |

```bash
sf agent trace list --agent Resort_Manager --since 2026-04-20
sf agent trace read --session-id "$SESSION" --format detail --dimension routing
sf agent trace read --session-id "$SESSION" --turn 2 --format summary
```

## Testing

### `agent generate test-spec`

Local only - **no `--target-org`, no `--json`**. It reads the metadata in your DX project, not the
org, and prompts for utterance, expected topic, expected actions, expected outcome, optional custom
evaluation and optional conversation history.

| Flag | Notes |
| --- | --- |
| `-f, --output-file` | Default `specs/<AGENT_API_NAME>-testSpec.yaml` |
| `-d, --from-definition` | Convert an existing `AiEvaluationDefinition` XML file back into a spec |
| `--force-overwrite` | Do not confirm before overwriting |

### `agent test create`

| Flag | Notes |
| --- | --- |
| `--spec` | Test spec YAML |
| `--api-name` | API name of the new test; must not already exist in the org |
| `--preview` | Render the `AiEvaluationDefinition` without deploying it |
| `--force-overwrite` | Overwrite an existing test with the same API name |

Writes the `AiEvaluationDefinition` component into the DX project and prints its filename.

### `agent test list`

No flags beyond the common set. Outputs API name, unique id and creation date for every agent test
in the org.

### `agent test run` / `resume` / `results`

| Flag | `run` | `resume` | `results` |
| --- | --- | --- | --- |
| `-n, --api-name` | yes | - | - |
| `-i, --job-id` | - | optional | **required** |
| `-r, --use-most-recent` | - | yes | yes |
| `-w, --wait` | yes | yes | - |
| `--result-format` | yes | yes | yes |
| `-d, --output-dir` | yes | yes | yes |
| `--verbose` | yes | yes | yes |

`--result-format` accepts `human` (default), `json`, `junit`, `tap`. `--output-dir` writes results
only when the run has completed. `--verbose` adds the generated data - invoked actions, their
inputs and outputs, the objects touched - which is what you need to build the JSONPath expressions
used by custom evaluations.

Without `--wait`, `agent test run` returns a job id and hands the terminal back; resume with the
job id or `--use-most-recent`.

### `agent test run-eval` (Beta)

| Flag | Notes |
| --- | --- |
| `-s, --spec` | **Required**. YAML test spec or JSON payload; reads stdin when piped |
| `-n, --api-name` | Overrides the agent inferred from the spec's `subjectName` |
| `--batch-size` | Tests per API request; default and maximum 5 |
| `--no-normalize` | Disable auto-correction of field names and shorthand JSONPath in JSON payloads |
| `--result-format` | `human` (default), `json`, `junit`, `tap` |

Supports subagent routing assertions, action invocation checks, string and numeric assertions,
semantic similarity scoring and LLM-based quality ratings. Beta Service; keep `agent test run` as
the pipeline gate.

## Packaging

### `agent generate template`

| Flag | Notes |
| --- | --- |
| `-f, --agent-file` | **Required**. Path to the `Bot` metadata file |
| `--agent-version` | **Required**. `BotVersion` number; the file must exist locally |
| `-s, --source-org` | **Required**. Namespaced scratch org containing the agent |
| `-r, --output-dir` | Where `BotTemplate` and `GenAiPlannerBundle` are written |

```bash
sf agent generate template \
  --agent-file force-app/main/default/bots/My_Awesome_Agent/My_Awesome_Agent.bot-meta.xml \
  --agent-version 1 --output-dir my-package --source-org my-scratch-org
```

Output name: `<Agent_API_name>_v<Version>_Template.botTemplate-meta.xml`. Does not work for agents
whose blueprint is an Agent Script file.

## Project commands used with agents

These are ordinary `sf project` commands; the agent-specific part is the metadata argument.

```bash
# Source-tracked orgs: preview then act
sf project retrieve preview --target-org vf-dev
sf project retrieve start   --target-org vf-dev
sf project deploy preview   --target-org vf-dev
sf project deploy start     --target-org vf-dev

# Not source-tracked: name the metadata
sf project retrieve start --metadata "AiAuthoringBundle:Local_Info_Agent*" --target-org vf-dev
sf project deploy start   --metadata AiAuthoringBundle:Local_Info_Agent    --target-org vf-dev
sf project delete source  --metadata AiAuthoringBundle:Local_Info_Agent    --target-org vf-dev

# The Agent pseudo type resolves the whole agent graph
sf project retrieve start --metadata Agent:Local_Info_Agent --target-org vf-dev
sf project deploy start   --metadata Agent:Local_Info_Agent --target-org vf-int
sf project delete source  --metadata Agent:Local_Info_Agent --target-org vf-dev
```

Deleting an `AiAuthoringBundle` also deletes the associated `Bot`, `BotVersion` and
`GenAiPlannerBundle`, after a confirmation prompt. It never deletes the Apex classes or Flows that
implement the actions.

## CI authentication

```bash
sf org login jwt --client-id "$CONSUMER_KEY" --jwt-key-file server.key \
  --username "$CI_USERNAME" --instance-url "$INSTANCE_URL" --alias vf-int
```

`--client-id`, `--jwt-key-file` and `--username` are required; `--instance-url`, `--alias`,
`--set-default` and `--set-default-dev-hub` are optional. Sandbox instance URLs take the form
`https://<MyDomainName>--<SandboxName>.sandbox.my.salesforce.com`.

More CLI conventions, `--json` parsing and environment variables: skill `sf-cli-operations`.

## Retired syntax

`sfdx force:*` commands do not appear anywhere in this skill and must not appear in a project that
uses it. There is no `sfdx force:` equivalent for the agent commands - they were introduced on the
v2 CLI only.
