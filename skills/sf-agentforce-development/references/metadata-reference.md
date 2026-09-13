# Agentforce metadata reference

Source: Metadata API Developer Guide (Winter '27 / API version 68.0 pages) and the Agentforce
Developer Guide "Agentforce DX" section, fetched for this skill. The project pins API version
**67.0** in `config/vibe-force.defaults.json`; every field below states the API version it first
appeared in so you can tell what is usable at 67.0.

## The type map

| Type | File suffix | Directory | Available from | Represents |
| --- | --- | --- | --- | --- |
| `AiAuthoringBundle` | `.bundle-meta.xml` + `.agent` | `aiAuthoringBundles/<api-name>/` | 65.0 | The agent blueprint: an Agent Script file plus its metadata wrapper |
| `Bot` | `.bot` | `bots/` | 43.0 | Top-level agent (or Einstein Bot) definition; container for versions |
| `BotVersion` | `.bot` | `bots/` (child of `Bot`) | 43.0 | One version's dialogs, variables, planner reference, language |
| `BotTemplate` | `.botTemplate` | `botTemplates/` | 55.0 | Packageable template generated from a `Bot` + `BotVersion` |
| `GenAiPlannerBundle` | `.genAiPlannerBundle` | `genAiPlannerBundles/<agent>/` | 64.0 | The reasoning engine: which topics and actions the agent may use |
| `GenAiPlanner` | `.genAiPlanner` | `genAiPlanners/` | 60.0-63.0 only | Superseded by `GenAiPlannerBundle` at 64.0 |
| `GenAiPlugin` | `.genAiPlugin` | `genAiPlugins/` | 62.0 | A topic / subagent: a category of actions for one job to be done |
| `GenAiFunction` | `.genAiFunction` | `genAiFunctions/` | 60.0 | An agent action, plus `input/` and `output/` schema folders |
| `GenAiPluginInstructionDef` | n/a (inline) | inside `GenAiPlugin` | 62.0 | One topic instruction; never a standalone file |
| `GenAiPromptTemplate` | `.genAiPromptTemplate` | `genAiPromptTemplates/` | 60.0 | A prompt template with versions, inputs and data providers |
| `GenAiPromptTemplateActv` | `.genAiPromptTemplateActivation` | `genAiPromptTemplateActivations/` | 60.0 | Activation state of a Salesforce-provided prompt template |
| `AiEvaluationDefinition` | `.aiEvaluationDefinition` | `aiEvaluationDefinitions/` | 63.0 | An agent test: subject plus up to 1,000 test cases |
| `AgentPlatformSettings` | `.settings` | `settings/` | 64.0 | Org switch `enableAgentPlatform` |
| `EinsteinGptSettings` | `.settings` | `settings/` | see guide | Org switch `enableEinsteinGptPlatform` |

Access rules worth knowing before a deploy fails:

- `Bot`, `BotVersion` and `BotTemplate` require Chat and Einstein Bots enabled.
- `GenAiPlannerBundle`, `GenAiPlugin` and `GenAiFunction` require Agents enabled.
- `GenAiPromptTemplate` requires Prompt Builder enabled and the Prompt Template Manager permission.
- `AiEvaluationDefinition` requires Agentforce enabled.
- `AgentPlatformSettings` requires `EinsteinGptSettings.enableEinsteinGptPlatform` to be on first.
- `Bot` metadata deploy and retrieve are **not supported** for Lead Nurturing and Sales Coach agents.

## AiAuthoringBundle

The bundle is the thing you edit. Its directory layout mirrors `ApexClass`: a metadata XML file
beside a source file.

```
force-app/main/default/aiAuthoringBundles/
  my_service_agent/
    my_service_agent.agent              # Agent Script blueprint
    my_service_agent.bundle-meta.xml    # Metadata API wrapper
  my_service_agent_5/                   # suffix _5 = version 5 of the same agent
    my_service_agent_5.agent
    my_service_agent_5.bundle-meta.xml
```

A folder with no `_<number>` suffix is the **latest / draft** version.

| Field | Type | Meaning |
| --- | --- | --- |
| `bundleType` | `AiAuthoringBundleType` | Currently only `AGENT` |
| `target` | string | `{Bot}.{BotVersion}`, for example `Agentforce_Service_Agent.v2`. Present means the version is **committed**. Omit it to deploy the agent as a draft |
| `versionTag` | string | Free-text version identifier for tracking |
| `versionDescription` | string | Human-readable description of what changed |

```xml
<?xml version="1.0" encoding="UTF-8"?>
<AiAuthoringBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <bundleType>AGENT</bundleType>
    <target>Agentforce_Service_Agent.v2</target>
    <versionTag>release-2026.3</versionTag>
</AiAuthoringBundle>
```

`target` is populated automatically by `sf agent publish authoring-bundle`. Publishing with the
field present is equivalent to pressing **Commit Version** in Agentforce Builder.

## Agent state and its metadata representation

| Agent state | Metadata | Editable |
| --- | --- | --- |
| Draft (uncommitted) | `AiAuthoringBundle` only | Yes |
| Committed | `AiAuthoringBundle` + `Bot` + `BotVersion` | No - create a new version instead |
| Legacy (no commit stage) | `Bot` + `BotVersion` only | Inactive versions editable, active versions not |

Because saving a version writes `AiAuthoringBundle` but committing writes `Bot`/`BotVersion`, the
two numbering schemes drift apart when you save more often than you commit. The `target` field in
a bundle's `bundle-meta.xml` is the authoritative mapping from bundle version to
`GenAiPlannerBundle` and `BotVersion` version.

## Bot

| Field | Type | Notes |
| --- | --- | --- |
| `label` | string | UI name |
| `description` | string | Free text |
| `type` | `BotType` | Required. `Bot` (default Einstein Bot), `ExternalCopilot` (customer-facing agent), `InternalCopilot` (employee-facing agent) |
| `agentType` | `GenAiAgentType` | 64.0. For example `AgentforceServiceAgent` |
| `agentTemplate` | string | 64.0. Template the agent was created from |
| `botUser` | string | 46.0. **Username** of the agent user - not the name, not the Id |
| `botVersions` | `BotVersion[]` | Child versions |
| `contextVariables` | `ConversationContextVariable[]` | 45.0. Channel-independent session data |
| `pageContextVariables` | `PageContextVariable[]` | 64.0. Page-level context |
| `conversationChannelProviders` | array | 51.0. Channels; **must be edited in the UI**, and are invisible to Metadata API after deploy |
| `defaultOutboundFlow` | string | 65.0. Fallback escalation behaviour |
| `sessionTimeout` | int | 58.0. Idle minutes before session end |
| `logPrivateConversationData` | boolean | 48.0. Logs customer inputs as conversation data |

`ConversationContextVariable` fields that matter for agents:

| Field | Notes |
| --- | --- |
| `developerName`, `label`, `dataType` | `dataType` is one of `Text`, `Number`, `Boolean`, `Object`, `Date`, `DateTime`, `Currency`, `Id` |
| `description` | 63.0. **Consumed by the planner** - write it as instructions, not as a comment |
| `includeInPrompt` | 63.0. Injects the variable into the prompt. The defaults `Id`, `EndUserId` and `EndUserLanguage` always appear; do not change their value |
| `contextVariableMappings` | Maps the variable to a `fieldName` on `LiveChatTranscript`, `MessagingEndUser` or `MessagingSession` for a given `messageType` |

## BotVersion

| Field | Type | Notes |
| --- | --- | --- |
| `entryDialog` | string | Required. First dialog shown |
| `mainMenuDialog` | string | Dialog acting as the main menu |
| `conversationPlanner` | `ConversationDefinitionPlanner[]` | 60.0. Points at the planner; this is what turns a chatbot into an agent |
| `botDialogs`, `botDialogGroups` | arrays | Deterministic dialog tree (Einstein Bots heritage) |
| `conversationVariables` | array | 44.0. Session variables usable as action inputs and outputs |
| `conversationGoals` | array | 57.0 |
| `conversationSystemDialogs` | array | 48.0. System function assigned to a dialog |
| `copilotPrimaryLangauge` | `Language` | Primary language of the agent (spelling is the API's, not a typo here) |
| `knowledgeActionEnabled` | boolean | Default `false` |
| `toneType` | `GenAiBotToneType` | `Casual`, `Formal`, `Neutral` |
| `responseDelayMilliseconds` | int | Simulated typing delay |
| `intentThreshold` | double | 63.0. 1 (least strict) to 5 (most strict); must be enabled by Salesforce Support |

Several `BotVersion` fields are documented as *Reserved for internal use*: `company`,
`copilotSecondaryLanguages`, `initialIntentDetectionEnabled`, `intentDisambiguationEnabled`,
`intentV3Enabled`, `knowledgeFallbackEnabled`, `role`, `surfacesEnabled`. Do not set them.

## GenAiPlannerBundle

The planner is the agent's action surface. One per agent.

| Field | Type | Notes |
| --- | --- | --- |
| `masterLabel` | string | Required |
| `plannerType` | `PlannerType` | Required. `AiCopilot__ReAct` (reactive, one step ahead), `AiCopilot__AgileAppDev` (iterative app-building strategy), `Atlas__ConcurrentMultiAgentOrchestration` (parallel tool calling and multi-agent coordination across text and voice) |
| `description` | string | Purpose and domain of the agent - read by the LLM |
| `capabilities` | string | Tags associated with the agent |
| `genAiPlugins` | `GenAiPlannerFunctionDef[]` | Topics referenced by name, or defined inline as `genAiCustomizedPlugin` |
| `genAiFunctions` | `GenAiPlannerFunctionDef[]` | Actions that are **not** inside a topic, such as a knowledge action |
| `attributeMappings` | `GenAiPlannerAttrMapping[]` | Propagates one action's output into another action's input without routing it through user input |
| `ruleExpressions` | `GenAiPlannerRuleExprDef[]` | Conditions that lock or unlock topics and actions |
| `ruleExpressionAssignments` | `GenAiPlannerRuleExprAsgn[]` | Binds a rule expression to a target |
| `botTemplate` | string | Set when the planner belongs to a template rather than an agent |

`GenAiPlannerAttrMapping`:

| Field | Notes |
| --- | --- |
| `attributeName` | Required. `Namespace.TopicName.ActionName.AttributeName` |
| `attributeType` | Required. `CustomPluginFunctionAttribute`, `StandardPluginFunctionInput`, `StandardPluginFunctionOutput` |
| `mappingType` | Required. `ActionAttribute`, `Constant`, `Variable`, `ContextVariable` |
| `mappingTargetName` | Target of the mapping |

This is the mechanism that keeps a verified customer id out of the LLM's hands: verify once, map
the output to a variable, and map that variable into every downstream action input.

`GenAiPlannerRuleExprDef` / `GenAiPlannerRuleExprCondition`:

| Field | Values |
| --- | --- |
| `expressionType` | `sel` (Salesforce Expression Language, as in formula fields); `handlebars` is reserved for future use |
| `leftOperandType` | `Variable`, `ContextVariable`, `Attribute` |
| `operator` | `equal`, `notEqual`, `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`, `isEmpty`, `isNotEmpty` |
| `targetType` (assignment) | `Function` (a knowledge action), `Plugin` (a topic), `PluginFunction` (an action in a topic) |

```xml
<ruleExpressions>
    <conditions>
        <leftOperand>isVerified</leftOperand>
        <leftOperandType>Variable</leftOperandType>
        <operator>equal</operator>
        <rightOperandValue>true</rightOperandValue>
    </conditions>
    <expression>Verified_User</expression>
    <expressionLabel>Verified User</expressionLabel>
    <expressionName>Verified_User</expressionName>
    <expressionType>sel</expressionType>
</ruleExpressions>
<ruleExpressionAssignments>
    <ruleExpressionName>Verified_User</ruleExpressionName>
    <targetName>AccountManagement</targetName>
    <targetType>Plugin</targetType>
</ruleExpressionAssignments>
```

A rule expression is an authorisation gate expressed in metadata. It does not replace CRUD, FLS or
sharing - see skill `sf-security-model`.

## GenAiPlugin (topic / subagent)

| Field | Notes |
| --- | --- |
| `developerName` | Required. Unique across all custom and customised topics |
| `masterLabel` | Required |
| `language` | Required, for example `en_US` |
| `pluginType` | Required. `Topic` or `APICustomTopic` |
| `description` | What the topic covers - the planner's routing input |
| `scope` | A specific job description for the topic |
| `canEscalate` | Whether the topic may escalate to a human rep |
| `aiPluginUtterances` | Sample utterances used to select the topic at runtime |
| `genAiFunctions` | `functionName` references to actions |
| `genAiPluginInstructions` | `GenAiPluginInstructionDef[]` |
| `plannerField` | The topic's parent planner |

`GenAiPluginInstructionDef` carries `developerName`, `masterLabel`, `language` and `sortOrder`, and
puts the instruction text in **`description`**. `sortOrder` controls execution order.

```xml
<genAiPluginInstructions>
    <description>When only the name of a record is mentioned in the user request, you MUST call
        the record lookup action first to get the necessary IDs.</description>
    <developerName>lookup_ids_first</developerName>
    <masterLabel>Look up ids first</masterLabel>
    <sortOrder>1</sortOrder>
</genAiPluginInstructions>
```

## GenAiFunction (action)

| Field | Notes |
| --- | --- |
| `masterLabel` | Required |
| `description` | Purpose and domain of the action; the planner routes on this |
| `invocationTarget` | Required. The thing being invoked, for example an Apex class name |
| `invocationTargetType` | Required. One of `api`, `apex`, `auraEnabled`, `createCatalogItemRequest`, `executeIntegrationProcedure`, `externalService`, `flow`, `generatePromptResponse`, `mcpTool`, `namedQuery`, `quickAction`, `retriever`, `runExpressionSet`, `slack`, `standardInvocableAction`, `stub` |
| `isConfirmationRequired` | Ask the user to confirm before the action runs |
| `isIncludeInProgressIndicator` | Show a progress indicator |
| `progressIndicatorMessage` | Text for that indicator |
| `mappingAttributes` | `GenAiPlannerAttr[]`: `name`, `label`, `description`, `parameterName`, `parameterType` (`input` or `output`) |
| `pluginField` | The action's parent topic |

```xml
<?xml version="1.0" encoding="UTF-8"?>
<GenAiFunction xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>get tracking information</description>
    <invocationTarget>TrackShipment</invocationTarget>
    <invocationTargetType>apex</invocationTargetType>
    <isConfirmationRequired>false</isConfirmationRequired>
    <masterLabel>get_tracking_info</masterLabel>
</GenAiFunction>
```

The component directory also holds `input/schema.json` and `output/schema.json`. Those schemas are
documented in `action-patterns.md`.

## GenAiPromptTemplate

| Field | Notes |
| --- | --- |
| `masterLabel` | Required |
| `type` | Required. `einstein_gpt__flex`, `einstein_gpt__salesEmail`, `einstein_gpt__recordSummary`, `einstein_gpt__fieldCompletion`, `einstein_gpt__caseEmailDraft` |
| `templateVersions` | Required array of versions |
| `activeVersionIdentifier` | Version identifier of the active version. Replaces `activeVersion`, which stopped working at 64.0 |
| `relatedEntity`, `relatedField` | sObject and field the template is bound to |
| `visibility` | `API` or `Global` |
| `overridable` | Whether a managed-package template can be overridden |

Per version:

| Field | Notes |
| --- | --- |
| `content` | Required. The prompt text, with `{!$Input:...}` and `{!$Flow:...}` merge expressions |
| `status` | Required. `Draft` or `Published`. The active version must be `Published`, and **published versions cannot be edited** through the UI or Metadata API |
| `versionIdentifier` | Unique per version; generated on deploy/retrieve if absent. Replaces `versionNumber`, which stopped working at 64.0 |
| `inputs` | `GenAiPromptTemplateInput[]`: `apiName`, `definition` (URI such as `SOBJECT://Account`), `referenceName` (`Input:Recipient`), `required` |
| `templateDataProviders` | `GenAiPromptTemplateDataProvider[]`: grounding sources, `definition` is a URI such as `flow://Fetch_Products` |
| `primaryModel` | Model for the version, for example `sfdc_ai__DefaultOpenAIGPT4` |
| `responseFormat` | `HTML`, `JSON`, `MarkDown` |
| `outputSchema` | Expected JSON schema of the generated output |
| `isCitationEnabled` | Include citations in generated responses |
| `fileDroppingStrategy` | How attached files are dropped when context limits are exceeded |
| `generationTemplateConfigs` | Policy references (allowed languages, style, response length) |

A data provider parameter carries `parameterName`, `definition`, `isRequired` and a
`valueExpression` such as `{!$Input:Recipient}`.

## Manifests

Whole-agent retrieve at API 67.0 and earlier. Replace the `*` on `ApexClass`, `Flow` and
`GenAiPromptTemplate` with real names: wildcards there pull the whole org and time out.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types><members>*</members><name>Bot</name></types>
    <types><members>*</members><name>BotVersion</name></types>
    <types><members>*</members><name>GenAiPlannerBundle</name></types>
    <types><members>*</members><name>AiAuthoringBundle</name></types>
    <types><members>*</members><name>GenAiPlugin</name></types>
    <types><members>*</members><name>GenAiFunction</name></types>
    <types><members>My_Email_Template</members><name>GenAiPromptTemplate</name></types>
    <types><members>OpportunityPipelineAction</members><name>ApexClass</name></types>
    <types><members>Assign_Sales_Rep</members><name>Flow</name></types>
    <version>67.0</version>
</Package>
```

Single agent version. Note the three different naming conventions:

```xml
<types><members>NGA_Service_Agent.v2</members><name>BotVersion</name></types>
<types><members>NGA_Service_Agent_v2</members><name>GenAiPlannerBundle</name></types>
<types><members>NGA_Service_Agent_2</members><name>AiAuthoringBundle</name></types>
```

| Type | Version naming |
| --- | --- |
| `BotVersion` | `<Agent>.v<N>` |
| `GenAiPlannerBundle` | `<Agent>_v<N>` |
| `AiAuthoringBundle` | `<Agent>_<N>` |

The full agent must already exist in the target org before you deploy a single `BotVersion`.

Wildcard support: `Bot`, `BotVersion`, `GenAiPlannerBundle`, `GenAiPlugin`, `GenAiFunction`,
`GenAiPromptTemplate`, `AiAuthoringBundle` and `AiEvaluationDefinition` all accept `*` in
`package.xml`. Settings types do not - the wildcard applies only when retrieving all settings.

## Retrieve and deploy by `--metadata`

```bash
# One authoring bundle (draft only)
sf project retrieve start --metadata AiAuthoringBundle:Local_Info_Agent --target-org vf-dev

# All versions of that bundle - the trailing wildcard is the difference
sf project retrieve start --metadata "AiAuthoringBundle:Local_Info_Agent*" --target-org vf-dev

# The whole agent graph, via the CLI-only pseudo type
sf project retrieve start --metadata Agent:Local_Info_Agent --target-org vf-dev
sf project deploy start   --metadata Agent:Local_Info_Agent --target-org vf-int
sf project delete source  --metadata Agent:Local_Info_Agent --target-org vf-dev
```

`Agent` is **not** a real metadata type. It is CLI shorthand that resolves to every component of
the agent. Asymmetries to remember:

| Command | Includes Apex and Flows? |
| --- | --- |
| `retrieve --metadata Agent:<name>` | Yes - retrieves the Apex classes and Flows that implement the actions |
| `deploy --metadata Agent:<name>` | No - agent metadata only |
| `delete source --metadata Agent:<name>` | No - leaves Apex and Flows in place |
| `delete source --metadata AiAuthoringBundle:<name>` | No, but it does delete the associated `Bot`, `BotVersion` and `GenAiPlannerBundle` |

## API version 68.0 and later

At API 68.0 the agent metadata model changes: agents are represented by `AiAgentDefinition` and
`AiAgentDefinitionVersion`, with version selectors inside the member name.

```xml
<types><members>MyServiceAgent</members><name>AiAgentDefinition</name></types>
<types><members>MyServiceAgent#*</members><name>AiAgentDefinitionVersion</name></types>
<version>68.0</version>
```

| Selector | Meaning |
| --- | --- |
| `MyAgent#2` | Version 2 of `MyAgent` |
| `MyAgent#*` | All versions of `MyAgent` |
| `*` | All versions of all agents |

Both the source and the target org must be on API 68.0 to use these types. While one side is still
on Summer '26 (67.0), keep using the `Bot` / `BotVersion` / `GenAiPlannerBundle` /
`AiAuthoringBundle` manifest above. At 68.0 the agent's Flow, Apex and prompt-template actions are
retrieved automatically, so they no longer need to be listed in the manifest.

`AiAgentDefinition` and `AiAgentDefinitionVersion` are documented in the Agentforce Developer
Guide's "Use Metadata to Move an Agent to a New Org" page. At the time this skill was written the
Metadata API Developer Guide had no reference page for either type, so their **field lists are
`[unverified]`** here; check the guide before writing one by hand.

Because this project's `apiVersion` is `67.0`, the v67 shape is the default. Changing it is a
`config/vibe-force.defaults.json` edit, not a per-manifest decision - see skill
`sf-project-structure`.

## Cross-references

- Topic and action authoring in Agent Script, plus the JSON schemas: `action-patterns.md`
- Test metadata: `testing-and-evaluation.md`
- Order of deployment and activation: `deployment-checklist.md`
- Grounding data modelled in Data 360: skill `sf-data-cloud`
- Manifest and `.forceignore` conventions: skill `sf-project-structure`
