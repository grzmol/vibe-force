# The contract file

`.vibeforce/state/contract.md` is the single artefact wave-1 agents read before touching
anything. It exists so parallel agents never negotiate: every cross-slice decision is already
made, written down, and attributable.

## Template

```markdown
# Contract: <story id or short title>
generated: <ISO timestamp> by sf-orchestrator

## Story
<one paragraph, user-visible behaviour>

## Acceptance criteria
1. <observable behaviour, verifiable in an org>
2. ...

## Scope decisions (minimal change ladder)
| # | Requirement | Rung | Decision | Rejected alternative | Reason |
|---|---|---|---|---|---|
| 1 | escalation reason on list | 2 reuse | reuse Case.Escalation_Reason__c | new field | field already exists, 3 orgs populated |
| 2 | list rendering | 4 platform | lightning-datatable in caseList | custom table component | base component gives sorting, a11y, FLS |
| 3 | reason required on escalate | 3 config | validation rule | Apex validation | no cross-object logic needed |
| 4 | bulk escalate action | 7 custom | CaseEscalationService | Flow | needs 200-record bulk + callout |

## Out of scope (explicitly dropped)
- <item> - <why it is not needed for the acceptance criteria>

## Contracts
### Apex
| Signature | Owner | Consumers |
|---|---|---|
| `CaseEscalationService.escalate(List<Id> caseIds, String reasonCode)` returns `List<EscalationResult>` | sf-apex-engineer | caseList LWC, EscalateCasesInvocable |
| `EscalationResult { Id caseId; Boolean success; String errorCode; }` | sf-apex-engineer | LWC error rendering |

### Schema
| API name | Type | Owner | Notes |
|---|---|---|---|
| `Case.Escalation_Reason__c` | Picklist(Sla_Breach, Customer_Request) | sf-metadata-engineer | existing, no change |
| `Case.Escalated_At__c` | DateTime | sf-metadata-engineer | new, audit only |

### Events and integrations
| Name | Payload | Owner | Consumers |
|---|---|---|---|
| `Case_Escalated__e` | caseId, reasonCode, occurredAt | sf-integration-engineer | external ticketing relay |

### Permissions
| Permission set | Grants | Owner |
|---|---|---|
| `Case_Escalation_Access` | Case.Escalation_Reason__c RW, Case.Escalated_At__c R, Apex class CaseEscalationService | sf-metadata-engineer |

## Ownership
| Agent | Owned paths |
|---|---|
| sf-apex-engineer | `force-app/main/default/classes/CaseEscalation*` , `.../classes/CaseEscalationServiceTest.cls` |
| sf-lwc-engineer | `force-app/main/default/lwc/caseList/**` |
| sf-metadata-engineer | `force-app/main/default/objects/Case/**`, `force-app/main/default/permissionsets/Case_Escalation_Access.permissionset-meta.xml` |
| sf-integration-engineer | `force-app/main/default/objects/Case_Escalated__e/**`, `.../classes/integration/CaseEscalationRelay.cls` |

## Test plan
| Behaviour | Test | Level |
|---|---|---|
| escalate sets reason and timestamp in bulk | CaseEscalationServiceTest.escalatesInBulk | Apex, 200 records |
| escalate rejects blank reason | CaseEscalationServiceTest.rejectsBlankReason | Apex |
| list renders reason column | caseList.test.js renders reason | Jest |
| escalation event relayed | CaseEscalationRelayTest with HttpCalloutMock | Apex |
| story end to end in org | vf-check smoke probe escalateSmoke.apex | org |

## Target orgs
| Wave | Org alias |
|---|---|
| 2 (apex tests) | acme-dev |
| 3 (deploy) | acme-uat |
| 4 (verify) | acme-uat |

## Risks
| Risk | Mitigation | Owner |
|---|---|---|
| Case object has 3 existing triggers | domain-layer change only, order of execution reviewed | sf-apex-engineer |
| Active flow `Case_Escalation_v2` overlaps | flow left untouched, entry criteria checked | sf-metadata-engineer |
```

## Rules

1. **Written before wave 1, never during.** A change to the contract pauses the wave; the
   orchestrator updates the file and re-briefs the affected agents.
2. **Every row has an owner.** A contract line with no owner is an unassigned defect.
3. **Rejected alternatives stay in the file.** They are the record of why the implementation is
   as small as it is, and they stop the next session from "improving" it back up the ladder.
4. **Out of scope is explicit.** The list is what prevents scope creep from being rediscovered
   as a good idea in wave 1.
5. **Signatures are exact.** Parameter types, return types, and API names as they will be
   written. "A method to escalate cases" is not a contract.
6. **Test plan before code.** Each acceptance criterion maps to at least one test at the level
   that can actually observe it.

## Consumption

| Reader | Uses it for |
| --- | --- |
| wave-1 agents | their slice, the signatures they must match, their non-goals |
| `sf-test-engineer` | the test plan, the coverage expectations |
| `sf-quality-gate` | what is deliberate (rejected alternatives) versus accidental |
| `sf-security-reviewer` | permission scope, event payloads, integration surface |
| `sf-deploy-engineer` | the component set, destructive changes, target org |
| `sf-org-verifier` | acceptance criteria to verify in the org |
| `/vf-review` | over-build detection: anything in the diff that is not in the contract |

## Lifecycle

```bash
# created in wave 0
cat .vibeforce/state/contract.md

# amended (pauses the current wave)
$EDITOR .vibeforce/state/contract.md   # orchestrator only

# archived with the story when it ships
mkdir -p docs/contracts && cp .vibeforce/state/contract.md docs/contracts/2026-09-case-escalation.md
```

The state directory is gitignored, so a contract worth keeping is copied into the repository
deliberately. Most are disposable; the ones that document a non-obvious rejected alternative are
worth the commit.
