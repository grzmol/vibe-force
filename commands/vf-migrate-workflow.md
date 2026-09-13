---
description: 'Convert Salesforce workflow rules to record-triggered flows. `plan` classifies every rule in a workflow file - what converts automatically, what needs an after-save flow, what needs a human - in a few lines per rule. `convert` writes the before-save flow for one rule as a single Assignment on $Record, and reports the after-save work instead of guessing at it.'
argument-hint: "[plan|convert] <file.workflow-meta.xml> [--rule <fullName>]"
allowed-tools: Glob, Grep, Bash(node:*), Bash(sf project deploy validate:*)
---

# vf-migrate-workflow - workflow rules to flows

Raw arguments: `$ARGUMENTS`

First bare token = the subcommand (`plan` when omitted), second = the workflow file.

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-workflow-to-flow.js" plan    <file.workflow-meta.xml>
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-workflow-to-flow.js" convert <file.workflow-meta.xml> --rule '<fullName>'
```

## Method

1. `plan` first, always. It never quotes XML, so a workflow file with thirty rules costs a few
   hundred tokens to understand instead of tens of thousands.
2. Split the work the way the plan does: a **before-save** flow for everything that writes fields
   on the triggering record, an **after-save** flow for everything that cannot run before save.
3. `convert --rule <name>` for each rule the plan marks `before-save: auto`. The flow is written
   with `status` `Draft`.
4. Build the after-save flow by hand from the plan's `after-save` lines. Group every write to one
   target object into a **single** Update Records element; one element per field is a DML per field.
5. Add the plan's `before-save by hand` lines to the generated flow: a workflow Formula update
   needs its field references rewritten to `{!$Record.Field}`, which cannot be derived from the
   workflow file.
6. Validate, activate, then deactivate the workflow rule - in that order, never the reverse:
   ```bash
   sf project deploy validate --source-dir <flow file> --target-org <alias>
   ```

## What converts automatically

Field updates on the triggering record with `operation` `Literal`, and criteria built from
`criteriaItems`. The rule's `triggerType` becomes `recordTriggerType`, and
`onCreateOrTriggeringUpdate` additionally sets `doesRequireRecordChangedToMeetCriteria`.

## What is reported, never guessed

Cross-object field updates, `Formula` / `Null` / `NextValue` / `PreviousValue` updates, email
alerts, tasks, outbound messages, time-dependent actions, formula-based rule criteria, and the
filter operations with no single Flow equivalent (`notContain`, `includes`, `excludes`, `within`).
A converter that invents these produces flows that deploy and then behave differently from the
rule they replaced. Salesforce's own **Migrate to Flow** in Setup covers part of this set.

## Hard rules

- A before-save flow assigns to `$Record`. It must never contain an Update Records element for the
  triggering record - that saves the record a second time and throws away the reason to be
  before-save at all.
- Keep the generated flow `Draft` until it is verified against an org.
- Never deactivate a workflow rule in the same deploy that activates its replacement.
- Exit code `1` means the rule did not convert. That is an answer, not a failure to work around.
