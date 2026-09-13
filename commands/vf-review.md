---
description: Parallel Salesforce code review of the diff against a base ref - dispatch the quality gate and security reviewer in one batch, merge and deduplicate findings, and report them by severity with an over-build dimension.
argument-hint: "[base-ref]"
allowed-tools: Task, Read, Grep, Glob, Bash(git diff:*), Bash(git merge-base:*), Bash(git rev-parse:*), Bash(git log:*)
---

# vf-review - parallel review of a diff

Raw arguments: `$ARGUMENTS`

`BASE` = the first argument, or `origin/main` when none was given.

## 1. Resolve the diff

```bash
git rev-parse --verify <BASE>
git merge-base <BASE> HEAD
git diff --name-status $(git merge-base <BASE> HEAD) HEAD
git diff --stat $(git merge-base <BASE> HEAD) HEAD
```

If `<BASE>` does not resolve, try `origin/master`, then the repository's default branch, and say which one you
used. If none resolves, review the uncommitted working tree instead and state that clearly.

Classify the changed files into slices so each reviewer knows what it is looking at: Apex (`classes/`,
`triggers/`), LWC and Aura (`lwc/`, `aura/`), metadata (`objects/`, `permissionsets/`, `flows/`, `layouts/`,
`flexipages/`), integration (`namedCredentials/`, `externalCredentials/`, `externalServiceRegistrations/`,
`remoteSiteSettings/`), and tests.

If the diff is empty, say so and stop.

## 2. Dispatch both reviewers in one batch

One tool call carrying both tasks. Never run them one after the other - they are independent and read-only.

| Agent | Scope |
| --- | --- |
| `sf-quality-gate` | Bulkification, governor limits, SOQL/DML in loops, trigger framework conformance, async pattern choice, test quality and assertions, naming, dead code, LWC lifecycle and reactivity, accessibility |
| `sf-security-reviewer` | CRUD and FLS enforcement, `with sharing` / `without sharing` / `inherited sharing`, SOQL and SOSL injection, `@AuraEnabled` exposure, hardcoded IDs, credentials and endpoints, named credential usage, permission set grants, `escapeSingleQuotes`, XSS in LWC templates |

Give each one: the base ref, the merge base commit, the file list with its slice, and this instruction set:

- Report findings only, with `file:line`, a stable `rule` id, a severity, the problem, and the concrete fix.
- Severity scale: `blocker`, `high`, `medium`, `low`, `info`.
- Read the surrounding code before judging - a finding you cannot point at a line for is not a finding.
- Do not edit files, do not run formatters or linters, do not run the project test suite.

While they run, run the over-build pass yourself (section 3).

## 3. Over-build pass

The review is not only about defects. Report every place the change is larger than the requirement, with
`file:line` and the smaller alternative that was available.

| Pattern | What to look for | Report as |
| --- | --- | --- |
| Single-caller abstraction | An interface, base class, factory, wrapper, or service with exactly one implementation and one call site | The inlined version |
| Platform feature replicated in code | Hand-rolled validation, rollup, sharing calculation, pagination, record fetch, or callout auth where a validation rule, rollup summary, sharing rule, base Lightning component, Lightning Data Service, or named credential does it | The platform mechanism |
| Second convention | A new trigger framework, selector layer, error logger, HTTP client, or test data factory beside one the project already has | The existing convention |
| Dead or speculative configuration | Custom settings, custom metadata rows, permission set entries, feature flags, or config fields nothing reads | Deletion |
| Unrequested scope | Files, fields, objects, or behaviour outside the stated requirement, including refactors carried along for the ride | Splitting it out or dropping it |
| Speculative generality | Parameters, hooks, or extension points with no current caller; `Object`/`sObject` typing where a concrete type is known | The concrete version |

Severity for this dimension: `medium` when it adds a maintenance surface, `high` when it introduces a second
convention or replicates a platform feature, `low` for a single unused parameter.

An over-build finding never overrides the floor. Do not report enforced CRUD/FLS, an explicit sharing
declaration, bulkification, error handling, a test for changed behaviour, or an accessibility attribute as
over-building - those are required regardless of size.

## 4. Merge and deduplicate

Key every finding on `file:line + rule`. Merge rules:

| Case | Result |
| --- | --- |
| Same key from both agents | One row, both sources named, the higher severity wins |
| Same rule, same file, adjacent lines, same cause | One row with a line range and the occurrence count |
| Same line, different rules | Separate rows - they need different fixes |
| Same underlying cause reported under different rule ids | One row; name the rule ids together and describe the cause once |

Sort by severity (`blocker`, `high`, `medium`, `low`, `info`), then by file path, then by line.

## 5. Output

```text
review base : <BASE> (merge-base <sha>)
files       : <n> changed, <n> added, <n> deleted
reviewers   : sf-quality-gate, sf-security-reviewer, over-build pass
findings    : <blocker>/<high>/<medium>/<low>/<info>
```

| Severity | File:line | Rule | Finding | Fix |
| --- | --- | --- | --- | --- |

Then:

- **Blockers**, restated in one list, each with the smallest change that clears it.
- **Over-build**, as its own section, each row naming the smaller alternative.
- **What is good**, one or two lines, only when it is specific.
- **Verdict**: approve, approve with follow-ups, or request changes. Any `blocker` means request changes.
- **Next command**: `/vf-check local` when findings are mechanical, `/vf-story` when the shape is wrong.

Do not apply fixes in this command. Review and propose; the user decides what gets changed.
