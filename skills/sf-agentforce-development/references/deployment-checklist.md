# Agent deployment checklist

Source: Agentforce Developer Guide "Set Up Your Development Environment for Agentforce DX",
"Create an Agentforce-Ready Scratch Org", "Set Up Einstein Generative AI and Agentforce", "Use
Metadata to Move an Agent to a New Org", "Define Agent Metadata (v67 and Earlier)", "Synchronize
Your Development Org with Your DX Project", "Manage an Agent with Agentforce DX", "Troubleshoot
Agentforce DX Issues"; Salesforce CLI Command Reference `agent` and `org` commands. Fetched for
this skill.

Everything here assumes API version **67.0**, the value in `config/vibe-force.defaults.json`.

## 1. Org prerequisites

Both the source and the target org need the same switches. Missing them produces
`This feature is not currently enabled for this user type or org` from the `agent` commands, or a
missing Agentforce Builder in Setup.

| Requirement | Scratch org | Sandbox / Developer Edition |
| --- | --- | --- |
| Einstein generative AI | `einsteinGptSettings.enableEinsteinGptPlatform: true` | Setup > Einstein Setup > Turn on Einstein |
| Agentforce | `agentPlatformSettings.enableAgentPlatform: true` | Setup > Agentforce Agents > enable Agentforce |
| Feature licence | `Einstein1AIPlatform` in `features` | Provisioned on the org |
| Data 360 (only if the agent grounds on it) | Not available - use a sandbox | Setup > Data Cloud Setup Home; provisioning can take up to 60 minutes |

```json
{
  "orgName": "vf agent dev",
  "edition": "Developer",
  "features": ["EnableSetPasswordInApi", "Einstein1AIPlatform"],
  "settings": {
    "lightningExperienceSettings": { "enableS1DesktopEnabled": true },
    "agentPlatformSettings": { "enableAgentPlatform": true },
    "einsteinGptSettings": { "enableEinsteinGptPlatform": true }
  }
}
```

```bash
sf org create scratch --definition-file config/afdx-scratch-def.json \
  --alias vf-agent --set-default --target-dev-hub DevHub
```

`Einstein1AIPlatform` is supported in Developer and Enterprise editions. Do not start the
Agentforce steps in a sandbox until Data 360 setup reports completion - the Setup page says so
explicitly, and half-provisioned Data 360 produces confusing agent errors.

Scratch org versus sandbox, per the guide: use a scratch org when the agent needs no Agentforce
Data Library or Data 360; use a sandbox (Developer or Developer Pro) when it does. Sandbox is the
recommended default for Agentforce DX.

## 2. Permissions for the deploying user

If the deploying identity is a System Administrator, nothing to do. Otherwise:

| Task | System permission |
| --- | --- |
| Publish an authoring bundle | `Modify All Data` **and** `Manage AI Agents` |
| Preview an agent | `Agent Platform Builder` |
| Generate or validate an authoring bundle | none beyond normal DX access |
| `sf org list metadata` | `Modify All Data` or `Modify Metadata Through Metadata API Functions` |

Grant them through a permission set, not by editing a profile (skill `sf-security-model`).

CI uses the JWT flow; web login is unavailable in a pipeline:

```bash
sf org login jwt --client-id "$CONSUMER_KEY" --jwt-key-file server.key \
  --username "$CI_USERNAME" --alias vf-int --instance-url "$INSTANCE_URL"
```

## 3. The agent user

Agents run as a dedicated Salesforce user. Create it in **every** org the agent runs in, because
usernames are globally unique and cannot be copied.

```bash
sf org create agent-user --base-username service-agent@acme.com \
  --first-name Service --last-name Agent --target-org vf-int
```

What the command does:

- Generates a user with a globally unique username. Without `--base-username` the pattern is
  `agent.user.<GUID>@your-org-domain.com`; with it, a 12-character GUID is inserted before the `@`.
- Sets the user's email to the new username.
- Assigns the `Einstein Agent User` profile.
- Assigns the permission sets `AgentforceServiceAgentBase`, `AgentforceServiceAgentUser` and
  `EinsteinGPTPromptTemplateUser`.
- Verifies that the user licences required by that profile and those permission sets are available.

What it does **not** do: grant access to your data. Write a permission set covering exactly the
objects, fields and record access the agent's actions need, and assign it:

```bash
sf org assign permset --name Agent_Data_Access \
  --on-behalf-of service-agent.a1b2c3d4e5f6@acme.com --target-org vf-int
```

The generated user has no password and cannot log in. Only admins can view or edit it in Setup.

The Agent Script file names this user in its `access` block:

```agentscript
access:
    default_agent_user: "service-agent.a1b2c3d4e5f6@acme.com"
```

A preview session that fails to initialise after a successful `agent validate authoring-bundle` is
almost always a missing or inactive `default_agent_user`.

## 4. Deploy order

Publishing an authoring bundle never deploys Apex classes, Flows or prompt templates. Deploying an
agent with `--metadata Agent:<name>` does not carry Apex or Flows either. Order matters:

| Step | What | Command |
| --- | --- | --- |
| 1 | Supporting metadata: custom objects, fields, permission sets | `sf project deploy start --manifest manifest/package.xml --target-org vf-int` |
| 2 | Action implementations: Apex, Flows, prompt templates | `sf project deploy start --metadata "ApexClass:CaseEscalationAction,Flow:AssignSalesRep" --target-org vf-int` |
| 3 | The agent graph | `sf project deploy start --manifest manifest/agent-package.xml --target-org vf-int` |
| 4 | Agent user and permission set assignment | `sf org create agent-user`, `sf org assign permset` |
| 5 | Test definitions | included in the manifest as `AiEvaluationDefinition`, or `sf agent test create` |
| 6 | Activation | `sf agent activate --api-name <agent> --version <n> --target-org vf-int` |

The plugin's gate wraps steps 1-3:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" deploy-validate --target-org vf-int
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" deploy-quick --target-org vf-int
```

Validate-then-quick-deploy is the house pattern (skill `sf-deployment-strategies`); the quick
deploy job is usable for `quickJobMaxAgeDays` days per `config/vibe-force.defaults.json`.

## 5. The manifest

First deployment into an org must carry the **whole** agent, not a single version.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types><members>Opportunity_Coach</members><name>Bot</name></types>
    <types><members>*</members><name>BotVersion</name></types>
    <types><members>*</members><name>GenAiPlannerBundle</name></types>
    <types><members>*</members><name>AiAuthoringBundle</name></types>
    <types><members>*</members><name>GenAiPlugin</name></types>
    <types><members>*</members><name>GenAiFunction</name></types>
    <types><members>Pipeline_Summary</members><name>GenAiPromptTemplate</name></types>
    <types><members>CaseEscalationAction</members><name>ApexClass</name></types>
    <types><members>AssignSalesRep</members><name>Flow</name></types>
    <version>67.0</version>
</Package>
```

Never wildcard `ApexClass`, `Flow` or `GenAiPromptTemplate` in an agent manifest: it pulls the
entire org and the deployment times out.

Subsequent single-version deployments switch `Bot` for `BotVersion` and use the versioned names:

```xml
<types><members>Opportunity_Coach.v2</members><name>BotVersion</name></types>
<types><members>Opportunity_Coach_v2</members><name>GenAiPlannerBundle</name></types>
<types><members>Opportunity_Coach_2</members><name>AiAuthoringBundle</name></types>
```

When the bundle version and the Bot version have drifted - which happens whenever you save more
often than you commit - open the bundle's `bundle-meta.xml` and read `target`. It holds
`{Bot}.{BotVersion}`, which is the authoritative mapping.

## 6. Draft versus committed

| State | Metadata present | Editable | Deploy note |
| --- | --- | --- | --- |
| Draft | `AiAuthoringBundle` with **no** `target` | Yes | Deploys as a draft; you can still change its agent user |
| Committed | `AiAuthoringBundle` with `target`, plus `Bot` and `BotVersion` | No | A committed agent's username **cannot** be changed; create a new version instead |
| Legacy | `Bot` + `BotVersion` only | Inactive versions only | No commit stage |

Deploy failures complaining about missing `Bot` or `BotVersion` mean you tried to deploy a
committed agent without its `Bot`/`BotVersion` components. Use the full manifest.

## 7. What does not survive a deploy

| Item | Behaviour | What to do |
| --- | --- | --- |
| Agent user (`botUser`) | Retrieved metadata carries the **source org's** username, which does not exist in the target | Use the Salesforce DX string replacement mechanism before deploying, or fix the username manually after |
| Messaging channel providers | Must be added, edited and removed in the UI; deployed providers are not visible to Metadata API afterwards | Re-connect channels in the target org by hand and record it in the runbook |
| Activation state | A deployed agent is not an active agent | Explicit `sf agent activate` step |
| Apex and Flows behind actions | Not carried by `deploy --metadata Agent:<name>` | Deploy them as their own metadata types first |
| Agent version parity | After a deploy, source and target agents must match or **future deployments are blocked** | Create a matching version in the source org whenever you create one in the target |

String replacement for the username is the supported mechanism; it works only for **draft**
agents, because a committed agent cannot be edited.

## 8. Activation

```bash
sf agent activate --api-name Opportunity_Coach --version 2 --target-org vf-int
sf agent deactivate --api-name Opportunity_Coach --target-org vf-int
```

| Fact | Consequence |
| --- | --- |
| Only one version is active at a time | Activating v2 implicitly retires v1 as the live version |
| `--version` is the number in `vN.botVersion-meta.xml` | `force-app/main/default/bots/My_Agent/v4.botVersion-meta.xml` means `--version 4` |
| Activation makes the agent immediately available on its connected channels | Treat it as the release moment, not the deploy |
| Deactivation ends open interactions and makes the agent unreachable | Use it as the rollback lever before redeploying |
| An agent must be deactivated to change topics or actions | Build the change as a new version rather than editing a live one |
| `agent preview` needs the agent published and active | A preview failure right after deploy is often just a missing activation |
| With `--json` and no `--version` | The latest version is activated automatically |

## 9. Post-deploy verification

```bash
# Components landed
sf org list metadata --metadata-type Bot --target-org vf-int
sf org list metadata --metadata-type BotVersion --target-org vf-int
sf org list metadata --metadata-type GenAiPlannerBundle --target-org vf-int
sf org list metadata --metadata-type AiAuthoringBundle --target-org vf-int

# Agent user exists, is active and has the expected profile
sf data query --target-org vf-int --query \
  "SELECT Id, Username, IsActive, Profile.Name FROM User WHERE Profile.Name = 'Einstein Agent User'"

# Round-trip: what the org thinks the agent is
sf project retrieve start --metadata Agent:Opportunity_Coach --target-org vf-int

# Behaviour
sf agent preview --api-name Opportunity_Coach --target-org vf-int
sf agent test run --api-name Opportunity_Coach_Test --wait 15 \
  --result-format junit --output-dir .vibeforce/reports --target-org vf-int

# Org-level gate
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" smoke --target-org vf-int
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" verify --target-org vf-int
```

A retrieve immediately after deploy is the cheapest proof that the graph is coherent: if the org
returns an agent whose planner references topics that were not deployed, you find out now rather
than during the first customer conversation.

## 10. Packaging an agent

Second-generation managed packaging goes through `BotTemplate`:

```bash
sf agent generate template \
  --agent-file force-app/main/default/bots/My_Awesome_Agent/My_Awesome_Agent.bot-meta.xml \
  --agent-version 1 --output-dir my-package --source-org my-scratch-org
```

The command reads the local `Bot`, `BotVersion` and `GenAiPlannerBundle` files and writes
`<output-dir>/botTemplates/<Agent_API_name>_v<Version>_Template.botTemplate-meta.xml`. The
corresponding `BotVersion` file must exist locally, and `--source-org` must be a **namespaced
scratch org**.

Known limitation: this does not work for agents created from an Agent Script file. Agent Script
agents cannot currently be packaged as templates.

## 11. Failure table

| Symptom | Cause | Fix |
| --- | --- | --- |
| `This feature is not currently enabled for this user type or org` | Einstein or Agentforce off | Section 1 |
| `agent publish authoring-bundle` succeeds, agent not visible | Wrong org, or stale Builder page | `sf org display`, then refresh Agentforce Builder |
| Live preview ignores an Apex change | Publishing a bundle does not deploy Apex | Deploy `ApexClass` first, then publish |
| Retrieve returns one bundle version only | Missing wildcard | `--metadata "AiAuthoringBundle:My_Agent*"` |
| Deploy fails on missing `Bot`/`BotVersion` | Committed agent deployed without its components | Full manifest, section 5 |
| Agent deployed but cannot run in the target | Source-org username in `botUser` | String replacement, or set the user on a new version |
| Breakpoints never hit during preview | Simulated mode mocks all actions | `--use-live-actions --apex-debug` |
| `agent test create` says the agent does not exist | Test created before publish | Publish first |
| CI tests pass locally, fail in the pipeline | Web login, missing activation, or no `--wait` | Section 2 and `testing-and-evaluation.md` |
| Future deploys blocked | Source and target agent versions diverged | Create the matching version in the source org |

## Cross-references

- Metadata types, manifests and the v68 change: `metadata-reference.md`
- Action implementations that must be deployed first: `action-patterns.md`
- Tests to run after activation: `testing-and-evaluation.md`
- Every command and flag used above: `agent-cli-reference.md`
- Validate/quick-deploy strategy and rollback: skill `sf-deployment-strategies`
- Org shapes and sandbox lifecycle: skill `sf-scratch-orgs-sandboxes`
- Permission set design for the agent user: skill `sf-security-model`
