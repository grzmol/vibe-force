# Agent action patterns

Source: Apex Developer Guide "InvocableMethod Annotation", "InvocableVariable Annotation" and
"Resolve a Prompt Template"; Metadata API Developer Guide "GenAiFunction" and
"GenAiPromptTemplate"; Agentforce Developer Guide "Agentforce Actions", "Create Custom Actions
Using Apex Invocable Method", "Agent Script reference: actions", "Agent Script reference:
variables" and "Agent Script Flow of Control". Fetched for this skill.

An action is the only way an agent changes or reads anything. Everything else - topics,
instructions, planner type - decides *which* action runs.

## Choosing an action type

| Need | Type | `invocationTargetType` | Agent Script target |
| --- | --- | --- | --- |
| Bulk DML, aggregation, callouts, anything transactional | Invocable Apex | `apex` | `apex://ClassName` |
| Admin-maintainable branching, record CRUD, approvals | Autolaunched Flow | `flow` | `flow://Flow_API_Name` |
| Generate prose, summarise, draft an email | Prompt template | `generatePromptResponse` | `prompt://template_name` |
| Call an existing Apex REST class already in the API Catalog | Apex REST | `api` | see note below |
| Expose an `@AuraEnabled` controller method | AuraEnabled | `auraEnabled` | see note below |
| Run a saved SOQL query defined in Setup | Named query | `namedQuery` | see note below |
| Call an External Service registration | External Services | `externalService` | see note below |
| Call an MCP tool | MCP | `mcpTool` | see note below |
| Retrieve grounding chunks from an index | Retriever | `retriever` | skill `sf-data-cloud` |

Agent Script's `target` property accepts the `apex`, `flow` and `prompt` schemes. The remaining
`invocationTargetType` values are valid `GenAiFunction` metadata but are configured through Setup
or Agentforce Builder rather than a `target` URI. Prefer `apex`, `flow` or `prompt` for anything
you author from a DX project.

Apex REST and AuraEnabled actions register in the org's API Catalog, and the API Catalog's limits
on active operations and objects apply. Remove a registration from every agent action that uses it
before inactivating or deleting it.

## Invocable Apex

### The contract, in one table

| Rule | Detail |
| --- | --- |
| Method shape | `static`, `public` or `global`, on an **outer** class |
| One per class | Only one method may carry `@InvocableMethod` |
| Combinable annotations | `@Deprecated` only |
| Input | At most **one** parameter, and it must be a list |
| Output | `void`, or a list obeying the same type rules |
| Bulk correspondence | Output size and order must match input size and order |
| Constructor | From API 66.0, parameter classes need a visible no-argument constructor (public for unpackaged, global for packaged) |

Permitted input and output types: a list of a primitive (never generic `Object`); a list of lists
of a primitive; a list of an sObject type or of lists of that type; `List<sObject>` or
`List<List<sObject>>`; or a list of a user-defined class whose members carry `@InvocableVariable`.
That class must be `public` or `global` and must have at least one annotated member.

`@InvocableVariable` fields typed `List<List<sObject>>` raise a **runtime error**. Use
`List<List<sObject>>` only as a direct `@InvocableMethod` return type.

### `@InvocableMethod` modifiers

| Modifier | Effect |
| --- | --- |
| `label` | Action name shown in builders. Defaults to the method name; always set it |
| `description` | Action description. Default null. This is the planner's routing input |
| `category` | Grouping in Flow Builder. Defaults to `Uncategorized` |
| `callout` | `callout=true` declares the method calls an external system |
| `capabilityType` | `Name://Name`, for example `PromptTemplateType://SalesEmail`; used when grounding a prompt template with Apex |
| `configurationEditor` | Custom property editor for the action's configuration UI |
| `iconName` | Custom icon: `resource:<namespace>__<resource>:<icon>` or `slds:standard:choice` |

### `@InvocableVariable` modifiers

| Modifier | Effect |
| --- | --- |
| `label` | Defaults to the variable name |
| `description` | Default null. Tell the planner what the value is and where to get it |
| `required` | Default `false`. Ignored on output variables |
| `defaultValue` | Value used when none is supplied. **Errors if combined with `required`** |
| `placeholderText` | Example values; supported for `String`, `Integer`, `Double` |

`defaultValue` is type-sensitive: `Double` needs the `d` suffix (`'867.3D'`), `Long` needs `l`
(`'922337L'`), `Integer` and `Decimal` take no suffix, `Boolean` is case-insensitive
`'true'`/`'false'`.

Variables may not be static, local, final, `protected` or `private`, and may not be properties.
No other annotation can be combined with `@InvocableVariable`.

### A complete action

This action is bulkified, security-enforced, idempotent and reports per-item failure instead of
throwing.

```apex
public with sharing class CaseEscalationAction {

    public class Request {
        @InvocableVariable(required=true label='Case Id'
            description='18-character Salesforce Id of the case to escalate.')
        public Id caseId;

        @InvocableVariable(label='Reason'
            description='Short reason given by the customer, quoted from the conversation.')
        public String reason;
    }

    public class Result {
        @InvocableVariable(label='Escalated'
            description='True when the case is now escalated. False means no change was made.')
        public Boolean escalated;

        @InvocableVariable(label='Message'
            description='One sentence to relay to the customer verbatim.')
        public String message;
    }

    @InvocableMethod(
        label='Escalate Case'
        description='Escalates one open case and records the customer reason. Use when the customer explicitly asks for a supervisor or says the issue is urgent.'
        category='Service'
    )
    public static List<Result> escalate(List<Request> requests) {
        Set<Id> caseIds = new Set<Id>();
        for (Request r : requests) { caseIds.add(r.caseId); }

        // One query for the whole batch, enforcing the agent user's CRUD, FLS and sharing.
        Map<Id, Case> cases = new Map<Id, Case>([
            SELECT Id, IsClosed, IsEscalated
            FROM Case
            WHERE Id IN :caseIds
            WITH USER_MODE
        ]);

        List<Case> updates = new List<Case>();
        Map<Id, String> problems = new Map<Id, String>();
        for (Request r : requests) {
            Case c = cases.get(r.caseId);
            if (c == null) {
                problems.put(r.caseId, 'That case is not available to me.');
            } else if (c.IsClosed) {
                problems.put(r.caseId, 'That case is already closed, so it cannot be escalated.');
            } else if (c.IsEscalated) {
                problems.put(r.caseId, 'That case is already escalated.'); // idempotent re-run
            } else {
                updates.add(new Case(
                    Id = c.Id, IsEscalated = true,
                    Description = String.isBlank(r.reason) ? null : r.reason
                ));
            }
        }

        Map<Id, String> failures = new Map<Id, String>();
        if (!updates.isEmpty()) {
            List<Database.SaveResult> saves =
                Database.update(updates, false, AccessLevel.USER_MODE);
            for (Integer i = 0; i < saves.size(); i++) {
                if (!saves[i].isSuccess()) {
                    failures.put(updates[i].Id, saves[i].getErrors()[0].getMessage());
                }
            }
        }

        // One result per request, in request order. Never short-circuit this loop.
        List<Result> results = new List<Result>();
        for (Request r : requests) {
            Result out = new Result();
            if (problems.containsKey(r.caseId)) {
                out.escalated = false;
                out.message = problems.get(r.caseId);
            } else if (failures.containsKey(r.caseId)) {
                out.escalated = false;
                out.message = 'I could not escalate that case: ' + failures.get(r.caseId);
            } else {
                out.escalated = true;
                out.message = 'The case is escalated and a supervisor will follow up.';
            }
            results.add(out);
        }
        return results;
    }
}
```

What makes it correct:

1. **Bulk safety** - two DML/SOQL statements regardless of batch size (skill `sf-governor-limits`).
2. **Security** - `with sharing` on the class, `WITH USER_MODE` on the query and
   `AccessLevel.USER_MODE` on the DML. The agent user is a real user with real permissions, so this
   is not optional (skill `sf-security-model`).
3. **Result parity** - every request produces exactly one result at the same index.
4. **Idempotence** - re-escalating an already escalated case is a no-op with an honest message, so
   a planner retry or a test rerun does not corrupt data.
5. **No exceptions for business outcomes** - a thrown exception aborts the whole batch. Failure
   flags do not.

### Agent Script wiring

```agentscript
subagent case_support:

    actions:
        escalate_case:
            description: "Escalate one open case when the customer asks for a supervisor."
            inputs:
                caseId: string
                    label: "Case Id"
                    description: "18-character Salesforce Id of the case."
                    is_required: True
                reason: string
                    label: "Reason"
                    description: "Customer's own words describing the urgency."
            outputs:
                escalated: boolean
                message: string
            target: "apex://CaseEscalationAction"

    reasoning:
        instructions: ->
            if @variables.case_id != "":
                run @actions.escalate_case
                    with caseId = @variables.case_id
                    with reason = @variables.escalation_reason
                    set @variables.escalation_message = @outputs.message
```

Two ways to call an action, with different semantics:

| Placement | Behaviour |
| --- | --- |
| `run @actions.<name>` in `reasoning: instructions` | Runs deterministically while Agentforce builds the prompt, before the LLM sees anything |
| Listed under `reasoning: actions` as a tool | Offered to the LLM, which decides whether to call it |

Reasoning instructions are processed top to bottom; the LLM only reasons once the resolved prompt
is complete. Use `run` for anything that must always happen (verification, a required lookup) and
a tool for anything the LLM should choose.

Action chaining runs a second action automatically with the first action's outputs:

```agentscript
    actions:
        GetOrderByOrderNumber: @actions.GetOrderByOrderNumber
            with orderNumber = @variables.order_number
            set @variables.orderDetails = @outputs.orderDetails

            run @actions.ScheduleOrder
                with orderDetails = @variables.orderDetails
                set @variables.DeliveryDate = @outputs.deliveryDate
```

Output parameters can be hidden from the model with `filter_from_agent: True` - use it for ids and
internal flags the LLM must not paraphrase back to the user.

Agent Script types used for action inputs, outputs and variables:

| Type | Notes |
| --- | --- |
| `string` | Alphanumeric, no special characters. Also the type for a record Id |
| `number` | Integers and decimals alike; IEEE 754 double precision |
| `boolean` | `True` or `False`, capitalised - the value is case-sensitive |
| `object` | A JSON object such as `{"SKU": "abc123", "count": 42}` |
| `date` | Any valid date format |
| `list[type]` | List of any primitive or `object`, for example `list[boolean]` |
| `id` | Deprecated - use `string` for record Ids |

Use `None` to test whether a value is set; for strings, test both `None` and `""`.

## Flow actions

An autolaunched Flow is the right action when the logic is branching record work that an admin
must own. Reference it with `flow://<Flow_API_Name>` and declare inputs and outputs exactly as for
Apex.

```agentscript
        assign_sales_rep:
            description: "Assign an owner to a lead based on territory rules."
            inputs:
                leadId: string
                    is_required: True
            outputs:
                ownerName: string
            target: "flow://AssignSalesRep"
```

Flow-side rules that keep the action usable:

- The Flow must be autolaunched (no screens): the agent has no UI to render a screen into.
- Every variable the agent passes or reads must be marked available for input or output.
- Flow runs in the agent user's context, so the agent user needs Flow access and record access.
- Flow element limits and the per-transaction governor limits still apply - a Flow action is not a
  way around bulk design (skill `sf-flow-automation`, skill `sf-governor-limits`).

Publishing an authoring bundle never deploys Flows. Deploy the Flow first, then publish.

## Prompt template actions

A prompt template turns record context into generated text. Reference it with
`prompt://<template_name>`; the underlying `GenAiFunction` uses `invocationTargetType`
`generatePromptResponse`.

Grounding sources available to a template:

| Source | Mechanism |
| --- | --- |
| Record fields | `inputs` with `definition` `SOBJECT://Account` or `SOBJECT://Account/Description`, merged as `{!$Input:Account.Name}` |
| Flow | `templateDataProviders` with `definition` `flow://Fetch_Products`, merged as `{!$Flow:Fetch_Products.Prompt}` |
| Apex | `templateDataProviders` pointing at an invocable method annotated with the matching `capabilityType` |
| Retriever / indexed content | Configured in Prompt Builder against a search index - see skill `sf-data-cloud` |

```xml
<templateVersions>
    <content>You are a service rep at {!$Input:Sender.CompanyName}.
Customer: {!$Input:Recipient.Name}
{!$Flow:Fetch_Products.Prompt}
Write a two-sentence reply recommending only the products listed above.</content>
    <inputs>
        <apiName>Recipient</apiName>
        <definition>SOBJECT://Contact</definition>
        <referenceName>Input:Recipient</referenceName>
        <required>true</required>
    </inputs>
    <templateDataProviders>
        <definition>flow://Fetch_Products</definition>
        <referenceName>Flow:Fetch_Products</referenceName>
        <parameters>
            <definition>SOBJECT://Contact</definition>
            <isRequired>true</isRequired>
            <parameterName>Recipient</parameterName>
            <valueExpression>{!$Input:Recipient}</valueExpression>
        </parameters>
    </templateDataProviders>
    <status>Published</status>
</templateVersions>
```

The published version of a template cannot be edited through the UI or Metadata API. Iterate on a
`Draft` version and promote by changing `activeVersionIdentifier`.

Grounding a template with Apex means writing an invocable method that carries `capabilityType`:

```apex
public with sharing class SalesEmailGrounding {
    @InvocableMethod(
        label='Fetch recommended products'
        description='Returns the products this contact is eligible for, as prompt-ready text.'
        capabilityType='PromptTemplateType://SalesEmail'
    )
    public static List<Response> ground(List<Request> requests) { /* ... */ return null; }
}
```

Calling a template from Apex directly, when you want generation without an agent:

```apex
ConnectApi.EinsteinPromptTemplateGenerationsInput input =
    new ConnectApi.EinsteinPromptTemplateGenerationsInput();
input.isPreview = false;

Map<String, ConnectApi.WrappedValue> values = new Map<String, ConnectApi.WrappedValue>();
ConnectApi.WrappedValue recipient = new ConnectApi.WrappedValue();
recipient.value = new Map<String, String>{ 'id' => contactId };
values.put('Input:Recipient', recipient);
input.inputParams = values;

input.additionalConfig = new ConnectApi.EinsteinLlmAdditionalConfigInput();
input.additionalConfig.applicationName = 'PromptTemplateGenerationsInvocable';

ConnectApi.EinsteinPromptTemplateGenerationsRepresentation output =
    ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate(promptTemplateId, input);
String generated = output.generations[0].text;
```

`output.prompt` holds the resolved prompt - log it when a template misbehaves, because the bug is
almost always in the resolution, not in the model.

## `GenAiFunction` input and output schemas

Each `GenAiFunction` component directory may contain `input/schema.json` and
`output/schema.json`. The root `lightning:type` is always `lightning__objectType`.

Input schema:

```json
{
  "required": ["OwnerId", "Status"],
  "properties": {
    "OwnerId": {
      "title": "Owner Id",
      "description": "ID of the Salesforce record that owns the request.",
      "lightning:type": "lightning__textType",
      "lightning:isPII": false,
      "copilotAction:isUserInput": true
    }
  },
  "lightning:type": "lightning__objectType"
}
```

Output schema:

```json
{
  "properties": {
    "Id": {
      "title": "Contact Request Id",
      "description": "ID of the Salesforce contact request record.",
      "lightning:type": "lightning__recordIdType",
      "lightning:isPII": false,
      "copilotAction:isDisplayable": true,
      "copilotAction:isUsedByPlanner": true
    }
  },
  "lightning:type": "lightning__objectType"
}
```

| Property | Applies to | Meaning |
| --- | --- | --- |
| `title` | both | Required. Label for the property |
| `description` | both | What the value is; the planner reads it |
| `lightning:type` | both | Required. See the type table below |
| `lightning:isPII` | both | Marks personally identifiable information |
| `copilotAction:isUserInput` | input | The property is presented as user input |
| `copilotAction:isDisplayable` | output | The property can be displayed as output |
| `copilotAction:isUsedByPlanner` | output | The planner may use the value. **At least one output property must set this to `true`, or the planner returns random responses** |

| `lightning:type` | Extra attributes |
| --- | --- |
| `lightning__textType` | `maxLength`, `minLength`. Maximum length is **250 characters** |
| `lightning__multilineTextType` | `maxLength`, `minLength` |
| `lightning__richTextType` | `maxLength`, `minLength` |
| `lightning__integerType` | `maximum`, `minimum` |
| `lightning__numberType` | `maximum`, `minimum` |
| `lightning__booleanType` | - |
| `lightning__dateType` | - |
| `lightning__dateTimeType` | Requires a `dateTime` string `yyyy-MM-dd'T'HH:mm:ss.SSSZ`; optional IANA `timeZone` |
| `lightning__recordIdType` | - |
| `lightning__listType` | - |
| `lightning__objectType` | Requires a nested `properties` object |
| `lightning__urlType` | `lightning:allowedUrlSchemes` array |

Anything longer than a short label must not be `lightning__textType`: a summary that exceeds 250
characters is silently useless.

## Description quality

The planner has no type system to fall back on. Descriptions are the routing algorithm.

| Field | Answer these | Bad | Good |
| --- | --- | --- | --- |
| Action `description` | What does it do, to what, and when should the agent choose it? | `Handles orders.` | `Cancels one open order and issues a refund. Use only after the customer confirms the order number.` |
| Input `description` | What format, and where does the agent get the value? | `Order number.` | `Order number as shown on the confirmation email, for example ORD-10432. Ask the customer if it is not already in the conversation.` |
| Output `description` | What should the agent do with the value? | `Status.` | `Cancellation status; state it to the customer and do not attempt the action again if it is ALREADY_CANCELLED.` |
| Topic `description` and `scope` | Which jobs belong here, and which explicitly do not? | `Orders.` | `Order lookup, cancellation and delivery questions. Does not handle returns or payments.` |

Rules of thumb that fall out of that:

- One verb, one object per action. `ManageOrder` is not an action, it is a subagent.
- No two actions may plausibly match the same sentence. Overlap makes routing non-deterministic.
- Never describe implementation (`calls OrderService.cancel`). Describe the user-visible effect.
- Put preconditions in the description, not only in instructions: the planner reads descriptions
  when it chooses, and instructions only once the topic is already selected.

## Security and identity

Every action executes as the **agent user**, not as the person in the conversation. Consequences:

| Concern | What to do |
| --- | --- |
| Object and field access | Grant the agent user a purpose-built permission set covering exactly the objects and fields the actions touch. Missing FLS surfaces as empty values, not as an obvious error |
| Record access | The agent user's sharing determines which records the action can see. Broadening sharing to make an agent work exposes those records to every conversation |
| Enforcement in code | `with sharing` + `WITH USER_MODE` / `AccessLevel.USER_MODE`. `without sharing` in an agent action means the agent can read anything |
| User-supplied ids | Do not trust an id the LLM produced from user text. Verify it, or propagate a verified value through planner `attributeMappings` |
| Destructive actions | Set `isConfirmationRequired` so the user approves before the write |
| PII | Mark schema properties `lightning:isPII` so the Trust Layer treats them accordingly |
| Secrets | Never return API keys, tokens or internal ids as displayable outputs; use `filter_from_agent` or omit them |

Deep coverage of CRUD/FLS enforcement, permission set design and sharing lives in skill
`sf-security-model`; enterprise Apex structure in skill `sf-apex-development`.

## Checklist before an action ships

- [ ] Class is `with sharing`, queries use `WITH USER_MODE`, DML uses `AccessLevel.USER_MODE`
- [ ] Exactly one `@InvocableMethod`, `static`, on an outer class
- [ ] One list in, one list out, same size and order, no `continue` skipping a result
- [ ] No SOQL or DML inside a loop over the request list
- [ ] Business failures return a flag and a message; exceptions are reserved for real faults
- [ ] Re-running the action with the same input is safe
- [ ] Action, input and output descriptions name entity, effect and precondition
- [ ] At least one output property sets `copilotAction:isUsedByPlanner`
- [ ] Long text outputs use `lightning__multilineTextType` or `lightning__richTextType`
- [ ] Apex and Flow are deployed **before** the authoring bundle is published
- [ ] The agent user's permission set covers every object and field the action touches
- [ ] An Apex test asserts the bulk contract (skill `sf-apex-testing`)
