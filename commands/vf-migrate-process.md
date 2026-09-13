---
description: 'Convert Salesforce Process Builder processes to record-triggered flows. `plan` classifies every criteria node in a process file - what converts automatically, what needs an after-save flow, what needs a scheduled path, what needs a human - in a few lines per node. `convert` writes the before-save flow for one criteria node as a single Assignment on $Record, and reports the rest instead of guessing at it.'
argument-hint: "[plan|convert] <process.flow-meta.xml> [--criteria <name>]"
allowed-tools: Glob, Grep, Bash(node:*), Bash(sf project deploy validate:*), Bash(sf data query:*)
---

# vf-migrate-process - Process Builder to flows

Raw arguments: `$ARGUMENTS`

First bare token = the subcommand (`plan` when omitted), second = the process file. A process is a
`Flow` whose `processType` is `Workflow`, so the file lives in `flows/` and ends `.flow-meta.xml`.

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-process-to-flow.js" plan    <process.flow-meta.xml>
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-process-to-flow.js" convert <process.flow-meta.xml> --criteria '<rule name or label>'
```

Find the candidates first if the argument is missing:

```bash
grep -rl '<processType>Workflow</processType>' --include='*.flow-meta.xml' .
sf data query --use-tooling-api --target-org <alias> \
  --query "SELECT ApiName, Label, ProcessType, Status FROM FlowDefinitionView WHERE ProcessType = 'Workflow'"
```

## Method

1. `plan` first, always. It never quotes XML, so a process with eight criteria nodes costs a few
   hundred tokens to understand instead of tens of thousands.
2. Split the work the way the plan does: a **before-save** flow for field writes on the triggering
   record, an **after-save** flow for everything else, `scheduledPaths` for scheduled actions.
3. `convert --criteria <name>` for each node the plan marks `before-save: auto`. The flow is written
   `Draft`, in the process's own directory unless `--out-dir` says otherwise.
4. Build the after-save half by hand from the plan's `after-save` lines. Group every write to one
   target object into a **single** Update Records element.
5. Work the `blocked` lines as decisions, not as obstacles: a guarded criteria node, an
   `EVALUATE THE NEXT CRITERIA` chain, a prior-value reference or a process formula each need a
   human to say what the flow should do.
6. Validate, activate, then deactivate the process - in that order, never the reverse:
   ```bash
   node "$CLAUDE_PLUGIN_ROOT/scripts/checks/vf-check.mjs" local --files <flow file>
   sf project deploy validate --source-dir <flow file> --target-org <alias>
   ```

Read skill `sf-process-builder-migration` before step 3 if the process has more than one criteria
node; the chaining semantics decide the target architecture.

## What converts automatically

A criteria node that no earlier node guards, whose conditions all map to flow entry conditions, and
whose action group only writes fields on the triggering record with literals, same-record references
or global variables. It becomes one before-save flow with a single Assignment on `$Record`, the
process's trigger as `recordTriggerType`, and `doesRequireRecordChangedToMeetCriteria` when the
process used the advanced "created, or edited to meet criteria" option.

## What is reported, never guessed

Guarded criteria nodes, `EVALUATE THE NEXT CRITERIA` chains, scheduled actions, prior-value
(`myVariable_old`) and related-record references, process formulas, condition operators with no
entry-condition form (`IsChanged`, `In`, `WasSet`), record creates, email alerts, Apex, subflows,
quick actions and approvals. Salesforce's own **Migrate to Flow** in Setup migrates a whole process
as an after-save flow; use it when that is what you want.

## Hard rules

- A before-save flow assigns to `$Record`. It must never contain an Update Records element for the
  triggering record - that saves the record a second time.
- The generated flow may not reuse the process's API name. A `Flow` deployed under that name becomes
  a new **version of the process**.
- Keep the generated flow `Draft` until it is verified against an org.
- Never deactivate a process in the same deploy that activates its replacement.
- Event processes (`CustomEvent`) and invocable processes (`InvocableProcess`) are out of scope for
  both this tool and the Setup tool. Rebuild them.
- Exit code `1` means the file or the node did not convert. That is an answer, not a failure to work
  around.
