# A Process Builder process, element by element

A process is a `Flow` with `processType` `Workflow`. Every structure below is ordinary `Flow`
metadata, which is why the same XML can be read, planned and rewritten with the plugin's flow tools.
This reference is what the converter in `scripts/lib/process-to-flow.js` reads, and what a session
needs when it has to finish a migration by hand.

## The shape of the file

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <decisions>...</decisions>            <!-- one per criteria node -->
    <interviewLabel>Case triage {!$Flow.CurrentDateTime}</interviewLabel>
    <label>Case triage</label>
    <processMetadataValues>...</processMetadataValues>   <!-- object, variables, trigger -->
    <processType>Workflow</processType>
    <recordCreates>...</recordCreates>    <!-- action group members -->
    <recordUpdates>...</recordUpdates>
    <actionCalls>...</actionCalls>
    <waits>...</waits>                    <!-- scheduled actions -->
    <startElementReference>myDecision</startElementReference>
    <status>Active</status>
    <variables>...</variables>            <!-- myVariable_current, myVariable_old -->
</Flow>
```

| Element | Meaning in a process |
| --- | --- |
| `processType` | `Workflow` for a record change process. `InvocableProcess` and `CustomEvent` are the other two process types and are out of scope for the Setup migration tool |
| `startElementReference` | The first criteria node. A process has no `<start>` element; that is the record-triggered flow construct that replaces it |
| `decisions` | One per criteria node group. Each `rules` entry is a criteria node with its conditions and the connector into its action group |
| `variables` | `myVariable_current` holds the record's current field values, `myVariable_old` the values immediately before the change. Both are documented names in the Process Builder guide |
| `processMetadataValues` | Builder state as open name/value pairs: the object, the two variable names, the trigger |
| `waits` | Scheduled actions. A `waitEvents` entry of `eventType` `AlarmEvent` carries the offset, and its connector leads to the scheduled action elements |
| `status` | `Active`, `Draft` or `Obsolete`. In the UI `Draft` and `Obsolete` both read as Inactive |

### processMetadataValues the converter reads

`FlowMetadataValue` is documented as an open `name` / `value` pair, so the individual keys below are
**[unverified]** against the Metadata API reference: they are read from retrieved process metadata,
matched case-insensitively, and a missing key is reported as a blocker rather than assumed.

| Key | Used for | Missing means |
| --- | --- | --- |
| `ObjectType` | The triggering object | Fall back to the `objectType` of the input SObject variable, else block |
| `ObjectVariable` | The name that prefixes every current-value reference | Fall back to the input SObject variable, else block: no reference can be rewritten |
| `OldObjectVariable` | The prior-value variable | Prior-value references are then classified as unknown references, not silently accepted |
| `TriggerType` | `onCreateOnly`, `onAllChanges`, `onCreateOrTriggeringUpdate` | Block. "The process starts when" has to be confirmed in Setup; guessing it changes when the flow runs |

The trigger tokens are the same three that `WorkflowRule.triggerType` uses, and they map to the
record-triggered flow start the same way:

| Token | `recordTriggerType` | `doesRequireRecordChangedToMeetCriteria` |
| --- | --- | --- |
| `onCreateOnly` | `Create` | absent |
| `onAllChanges` | `CreateAndUpdate` | absent |
| `onCreateOrTriggeringUpdate` | `CreateAndUpdate` | `true` |

## A criteria node

```xml
<decisions>
    <name>myDecision</name>
    <label>Case triage</label>
    <defaultConnector>
        <targetReference>myDecision2</targetReference>   <!-- all criteria false -->
    </defaultConnector>
    <rules>
        <name>myRule_1</name>
        <conditionLogic>and</conditionLogic>
        <conditions>
            <leftValueReference>myVariable_current.Status</leftValueReference>
            <operator>EqualTo</operator>
            <rightValue><stringValue>New</stringValue></rightValue>
        </conditions>
        <connector>
            <targetReference>myRule_1_A1</targetReference>               <!-- action group -->
        </connector>
        <label>New and mine</label>
    </rules>
</decisions>
```

Three facts follow from this shape and decide what can be converted:

1. **Rules in one decision are ordered.** The second rule is evaluated only when the first is false.
2. **`defaultConnector` is the "no criteria matched" path**, which is how a process reaches its next
   criteria node.
3. **An action group that ends on a decision is `EVALUATE THE NEXT CRITERIA`.** The node it reaches
   is entered *because the earlier criteria was true*.

So every criteria node past the first carries a guard: "reached only when X is false" or "reached
only when X is true". A flow has no equivalent of "evaluate this only if the earlier criteria did not
match" other than restating the negation in its own entry conditions, and negating arbitrary
conditions - custom logic, `IsChanged`, formulas - is not mechanical. The converter reports guarded
nodes; it never emits them.

## References inside a process

| Stored reference | In the generated flow | Converter verdict |
| --- | --- | --- |
| `myVariable_current` | `$Record` | Same-record target, convertible |
| `myVariable_current.Status` | `$Record.Status` | Convertible |
| `myVariable_current.Account.Industry` | needs Get Records | Blocked: a record-triggered flow filters and writes the triggering record |
| `myVariable_old.Status` | `{!$Record__Prior.Status}` | Blocked for entry conditions; reported as by-hand work for assignments |
| `myFormula_1` (a `formulas` element) | a flow formula, rewritten | Blocked: references must be rewritten, and a cross-object reference cannot be migrated at all |
| `$User.Id`, `$Organization.Id` and other global variables | the same reference | Convertible |
| any other variable or constant | - | Blocked: no equivalent in the generated flow |

## Conditions to entry conditions

`FlowCondition.operator` is a `FlowComparisonOperator`; `start.filters` uses the narrower
`FlowRecordFilterOperator`.

| Operator | Entry condition | If not |
| --- | --- | --- |
| `EqualTo`, `NotEqualTo` | yes | |
| `GreaterThan`, `LessThan`, `GreaterThanOrEqualTo`, `LessThanOrEqualTo` | yes | The Setup tool refuses these on **picklist** fields; check the field type |
| `StartsWith`, `EndsWith`, `Contains` | yes | |
| `IsNull` | yes | `rightValue` `booleanValue` `true` or `false`, as the process stored it |
| `IsChanged` | **no** | Decision, or entry formula `{!$Record.F} <> {!$Record__Prior.F}` |
| `WasSet`, `WasSelected`, `WasVisited` | **no** | Screen-flow operators; a record change process should not have them |
| `In`, `NotIn`, `IsBlank`, `IsEmpty`, `HasError` | **no** | Decision |

`conditionLogic` maps straight onto `filterLogic`: `and`, `or`, or a custom string such as
`1 AND (2 OR 3)`.

Values are already typed in a process, unlike a workflow field update: `stringValue`, `numberValue`,
`booleanValue`, `dateValue`, `dateTimeValue` or `elementReference`. Nothing has to be inferred, so
nothing can be inferred wrongly - a real advantage of migrating a process over migrating a workflow
rule.

## Action group members

An action group is a connector chain, not a list. The converter walks it from the criteria node's
connector and classifies each element by the collection it lives in.

| Collection | Classified as | Reason |
| --- | --- | --- |
| `recordUpdates` with `inputReference` = the record variable and no `object` | before-save assignments | Field writes on the triggering record |
| `recordUpdates` with `object` and `filters` | after-save | Writes related records; group every write to one object into a single element |
| `recordCreates`, `recordDeletes`, `recordLookups` | after-save | Cannot run before the record exists |
| `actionCalls` | after-save, labelled with `actionType` | `emailAlert`, `apex`, `flow`, `quickAction`, `submit`, `chatterPost` and the rest |
| `subflows`, `apexPluginCalls` | after-save | |
| `waits` | scheduled path | Scheduled actions belong on an after-save flow's `scheduledPaths` |
| `decisions` | next criteria node | Not part of the action group; ends the walk |
| a target that is in no collection | blocker | The file references an element it does not define |

A same-record `recordUpdates` element splits further, per `inputAssignments` entry: a literal or a
same-record reference becomes an assignment item, anything else becomes a by-hand item with the
reason attached.

## The converter's contract

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-process-to-flow.js" plan    <process.flow-meta.xml> [--json]
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-process-to-flow.js" convert <process.flow-meta.xml> \
  --criteria <rule name or label> [--out-dir <dir>] [--status Draft|Active] [--flow-name <ApiName>] [--stdout] [--json]
```

| Exit | Meaning |
| --- | --- |
| `0` | The plan printed, or the flow was written |
| `1` | The answer is "no": wrong `processType`, unreadable trigger, no reachable criteria node, or the named node needs human work |
| `2` | Misuse: missing file, malformed XML, no `--criteria`, a name collision with the process, or a target file that already exists |

Guarantees worth relying on:

- Neither command prints process or flow XML, so a plan of a large process costs a few hundred
  tokens.
- `convert` emits `status` `Draft` unless told otherwise, so nothing starts firing on the next deploy.
- The emitted flow contains exactly one `assignments` element and never a `recordUpdates` element.
- The emitted flow's children follow the `Flow` XSD sequence, which the Metadata API enforces.
- `migratedFromWorkflowRuleName` is **not** set: that field names a workflow rule, and this flow came
  from a process. The origin is recorded in `description` instead.
- The generated name may not equal the process name, and an existing file is never overwritten -
  either would turn the new flow into a new *version of the process*.

## What the plan report looks like

```
process: Case_triage  object: Case  Active  trigger: onAllChanges -> CreateAndUpdate
criteria nodes: 3
- myRule_1 "New and mine" [myDecision] -> before-save: auto, complete
    criteria: Status EqualTo New AND OwnerId EqualTo $User.Id
    before-save: Priority = High (stringValue)
    before-save: Subject = $Record.Origin (elementReference)
- myRule_2 "Priority missing" [myDecision] -> by hand
    criteria: Priority IsNull true
    after-save: myRule_2_A1 Action (emailAlert) - ... add it as an actionCall on the after-save flow
    after-save: myRule_2_A2 Create Records - ... rebuild it on the after-save flow
    blocked: this criteria node is only reached when myRule_1 is false; ...
- myRule_3 "Was escalated" [myDecision2] -> by hand
    criteria: myVariable_old.Status EqualTo Escalated
    scheduled path: myWait_1 - scheduled actions become scheduledPaths on an after-save flow; ...
    blocked: criteria reads the prior value myVariable_old.Status; ... {!$Record__Prior.Status}
```

Read it as a work list: `before-save: auto` nodes are `convert` calls, `after-save` and
`scheduled path` lines are the flow you build by hand, `blocked` lines are decisions only a human
can make.

## Sources

- Metadata API Developer Guide, `Flow`: `FlowProcessType` (`Workflow`, `InvocableProcess`,
  `CustomEvent`), `FlowStart`, `FlowRecordFilter`, `FlowRecordFilterOperator`, `FlowComparisonOperator`,
  `FlowScheduledPath`, `FlowMetadataValue`
  <https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_visual_workflow.htm>
- Automate Your Business Processes: Process Builder, Setting Values in the Process Builder, Execute
  Actions for Multiple Criteria, Reevaluate Records in the Process Builder
  <https://help.salesforce.com/s/articleView?id=platform.process_which_tool.htm&type=5>
- Migrate to Flow Tool Considerations
  <https://help.salesforce.com/s/articleView?id=platform.migrate_to_flow_tool_considerations.htm&type=5>
