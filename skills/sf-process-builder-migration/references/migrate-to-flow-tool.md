# Migrate to Flow, for processes

Salesforce ships **Migrate to Flow** in Setup. It is the supported way to move a whole process, and
it is worth knowing exactly where its support stops, because everything past that line is work a
session has to plan. This reference is the process half; workflow rules are covered in
[`sf-flow-automation/references/workflow-to-flow-migration.md`](../../sf-flow-automation/references/workflow-to-flow-migration.md).

## Timeline

| Date | What changed |
| --- | --- |
| Summer '23 | Creating new processes is blocked. Existing processes can still be activated, deactivated and edited |
| 31 December 2025 | End of support for Process Builder and Workflow Rules. Existing automation keeps executing, unsupported: no fixes, no patches |

An active process after that date is not a broken org, it is an unsupported dependency. Treat it as
debt with an owner and a date (`sf-technical-debt-audit`).

## What the tool does

| Property | Behaviour |
| --- | --- |
| Scope | **Record-triggered processes only.** Event processes and invocable processes are not supported |
| Output timing | Every migrated process becomes an **after-save** ("Actions and Related Records") flow. Optimising it into a before-save ("Fast Field Updates") flow is a manual step afterwards |
| Granularity | You select which criteria to migrate. The Migratable column says whether the process migrates fully or partially |
| Partial migration | Finishes, then lists the actions that need configuration under **Needs Review** |
| Invoke flow actions | Migrated as a **subflow**, which runs in the same transaction. Anything with a callout, an external action or a pause has to be redesigned onto an asynchronous path |
| Recursion | Not fully supported. A migrated process evaluates the record **once**, even if the process reevaluated it up to five additional times |
| Custom metadata in a formula | Migrates and works, but cannot be configured from the resource picker afterwards |
| Cross-object reference in a formula | **Cannot migrate** |
| Criteria with a related-record field (field traversal) | **Not supported** |
| Processes containing custom metadata types | **Not supported** |

## Action types

Migrate without extra configuration:

| Action |
| --- |
| Record update |
| Record create |
| Invoke flow |
| Invoke Apex |
| Email alert |

Keep their position in the flow but **need configuration afterwards**:

| Action |
| --- |
| Post to Chatter |
| Quick Action |
| Submit for Approval |
| Send Custom Notification |
| Live Message Notification |
| Send Surveys |
| Quip-related actions |

## Scheduled actions

| Rule | Consequence |
| --- | --- |
| Scheduled actions migrate only when you select the **single** criteria they belong to | Select several criteria and **no** scheduled action is migrated |
| A time-based process migrates one outcome per flow | Several outcomes means several flows, each activated, and only then the process deactivated |
| Migrated scheduled actions become scheduled paths named `ScheduledPath__#` | Rename them to something a human can read before you ship |
| At run time the new flow deletes the original process's pending actions | Then re-queues them on the matching path, or cancels them when the record no longer meets the criteria |
| A pending time-based action that is still at rest migrates when the record is next changed | An untouched record keeps the process's pending action until then |

Check the queue in Setup before and after the cutover. A pending-action count that drops without an
explanation is the failure mode worth catching in a sandbox.

## The procedure

1. Migrate and test in a **sandbox** first. Nothing about this belongs in production as a first run.
2. Setup, Quick Find, **Migrate to Flow**.
3. Select the process. Select the criteria to migrate - one criteria if it owns scheduled actions.
4. Migrate, then open **Needs Review** if the migration was partial.
5. Test the flow in Flow Builder, and against real records.
6. Activate the flow.
7. Deactivate the process, in a separate step.

## The gap between the tool and this plugin

| Concern | Setup tool | `/vf-migrate-process` |
| --- | --- | --- |
| Runs against | The org | The retrieved `.flow-meta.xml` in the repository |
| Output | One after-save flow per selection, created in the org | One before-save flow file per criteria node, `Draft`, in source |
| Field writes on the triggering record | After-save Update Records; optimise by hand | Assignment on `$Record` |
| What it refuses | Unsupported criteria and action types | Anything it would have to guess, with the reason |
| Reviewable diff | No - the flow appears in the org | Yes - a file in the branch, validated by `vf-check` |
| Scheduled actions | Migrates them as scheduled paths | Reports them; build the after-save flow by hand |

Use both. The Setup tool is the fastest way to a working after-save flow for a complex process; the
converter is the way to keep field-stamping on the cheap side of the save and to keep the whole
migration in reviewable source.

## Manual conversion methods

| Unsupported thing | Rebuild as |
| --- | --- |
| Criteria a flow's entry conditions cannot express | A Decision immediately after the start element, with the condition builder. Note the cost: the flow then runs on every qualifying save and evaluates the Decision |
| `does not contain` | `Contains` plus custom logic - condition 1 with `Contains`, logic `NOT 1` |
| A process task action | Create Records on `Task` |
| Email alerts and outbound messages | An Action element |
| Relative date values (`TODAY`, `NEXT WEEK`) | A Decision |
| `IsChanged` criteria | Entry formula comparing `{!$Record.F}` with `{!$Record__Prior.F}`, or a Decision |
| An invocable process | A subflow, or an autolaunched flow called by an Action |

## Verification after a migration

```bash
# The flow is active, the process is not
sf data query --use-tooling-api --target-org <alias> \
  --query "SELECT ApiName, ProcessType, Status, VersionNumber FROM FlowDefinitionView WHERE ProcessType IN ('Workflow','AutoLaunchedFlow')"

# The migrated flow deploys from source as well as it ran in the org
sf project retrieve start --metadata Flow:<migrated flow> --target-org <alias>
node "$CLAUDE_PLUGIN_ROOT/scripts/checks/vf-check.mjs" local --files <flow file>

# Behaviour, on a record that exercises each criteria
sf data create record --sobject <Object> --values "<field>=<value>" --target-org <alias>
sf apex get log --number 1 --target-org <alias> | grep -E "FLOW_|WF_"
```

The `Workflow` debug log category records processes and flows; a log that still shows the process
firing means the deactivation did not deploy (`sf-debugging-logs`).

## Sources

- Migrate to Flow Tool Considerations, Considerations for Migrating a Process to a Flow
  <https://help.salesforce.com/s/articleView?id=platform.migrate_to_flow_tool_considerations.htm&type=5>
- Move Processes and Workflows to Flow Builder with the Migrate to Flow Tool
  <https://help.salesforce.com/s/articleView?id=platform.flow_migrate_to_flow.htm&type=5>
- Process Builder, "Starting in Summer '23, you can't create new processes"
  <https://help.salesforce.com/s/articleView?id=platform.process_overview.htm&type=5>
- End of support for Workflow Rules and Process Builder
  <https://help.salesforce.com/s/articleView?id=001096524&type=1>
- Monitor Your Processes' Pending Scheduled Actions
  <https://help.salesforce.com/s/articleView?id=platform.process_monitor_instance.htm&type=5>
