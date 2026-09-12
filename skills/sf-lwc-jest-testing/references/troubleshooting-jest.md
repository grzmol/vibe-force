# Troubleshooting LWC Jest

Symptom-to-cause table, diagnostic workflow, and the failure modes that make `vf-check jest` fail
for reasons that are not real defects.

## 1. Failure table

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Cannot find module '@salesforce/apex/Foo.bar' from '...'` | `jest.mock` missing, or declared without `{ virtual: true }` | Add the third argument: `jest.mock(path, factory, { virtual: true })` |
| `Cannot find module 'c/foo'` | Component is not in a `lwc` directory of a package directory listed in `sfdx-project.json` | Move the bundle, or add the directory to `packageDirectories` |
| `Cannot find module 'foo/fancyButton'` | Component from another namespace | Add a `moduleNameMapper` entry and a stub bundle |
| `TypeError: Cannot read properties of null (reading 'querySelector')` | Component uses light DOM, so `shadowRoot` is `null` | Query with `element.querySelector(...)` |
| `expect(received).toBe(expected)` with an empty string | Asserted before the rerender microtask ran | `await Promise.resolve()` before the assertion |
| Assertion passes alone, fails in the file | Missing DOM cleanup, or leaked mock state | `afterEach` removing `document.body` children plus `jest.clearAllMocks()` |
| `getRecord.emit is not a function` | `lightning/uiRecordApi` is using the inert default stub | Map it to a mock built with `createLdsTestWireAdapter` |
| `adapter.error is not a function` | Adapter was created with `createTestWireAdapter` (generic) | Use `createLdsTestWireAdapter` or `createApexTestWireAdapter` |
| Wire never provisions; component stays in the loading branch | The component's reactive config resolved to `undefined`, so the adapter never fired | Set the `@api` inputs before `appendChild`, then assert `getLastConfig()` |
| `jest.mock` factory throws `ReferenceError: Cannot access 'X' before initialization` | `jest.mock` is hoisted above imports; the factory closed over a module-scope constant | `require(...)` inside the factory, or inline the literal |
| Test hangs until `testTimeout` | An awaited promise never resolves (unmocked `fetch`, `loadScript`, or a mock without a return value) | Give every mock a resolved value |
| `ReferenceError: TextEncoder is not defined` | jsdom lacks the encoder a dependency expects | Add a `setupFiles` entry that assigns `global.TextEncoder`/`TextDecoder` from `node:util` |
| `HTMLCanvasElement.prototype.getContext is not implemented` | Chart component rendering to a canvas | `setupFiles: ['jest-canvas-mock']` |
| `Not implemented: window.scrollTo` warnings | jsdom stubs | Harmless; silence with a `jest.spyOn(window, 'scrollTo')` if it pollutes output |
| Snapshot fails on every run | Snapshot captured dynamic content (dates, ids) | Delete the snapshot test and assert specific nodes |
| Coverage below the gate but every test passes | Untested branches (error paths, getters used only in one branch) | Add the missing branch test; never lower the gate |
| `vf-check jest` exits 2 | `node_modules` missing, or `@salesforce/sfdx-lwc-jest` not installed | `npm install` in the consumer project |
| `vf-check jest` reports a bundle without tests | `gates.requireJestForLwc` is `true` | Add `__tests__/<bundle>.test.js` |
| Tests pass locally, fail in CI | Worker parallelism or snapshot writing | Run with `-- --runInBand --ci` |

## 2. Diagnostic workflow

1. Reproduce the single failing file:
   ```bash
   npm run test:unit -- force-app/main/default/lwc/caseList/__tests__/caseList.test.js
   ```
2. Narrow to one case: `npm run test:unit -- -t "renders an error panel"`.
3. Print the rendered markup at the point of failure:
   ```javascript
   // eslint-disable-next-line no-console
   console.log(element.shadowRoot.innerHTML);
   ```
   Remove the statement before committing - `vf-check lint` flags `no-console`.
4. Verify the wire configuration the component actually produced:
   ```javascript
   console.log(getCases.getLastConfig());
   ```
5. Step through with the inspector:
   ```bash
   npm run test:unit:debug            # add `debugger;` first, then open chrome://inspect
   sfdx-lwc-jest --debug -- --no-cache --runInBand
   ```
6. If behaviour differs from the org, the mock is wrong, not the component - compare the fixture
   JSON against a real payload captured with
   `sf data query --query "SELECT Id, Name FROM Account LIMIT 1" --json --target-org vf-dev`.

## 3. Async timing rules

| Situation | Flushes needed |
| --- | --- |
| Property assignment causing a rerender | 1 (`await Promise.resolve()`) |
| Wire adapter `emit` | 1 |
| Imperative Apex `.then()` updating a field | 2 |
| Imperative Apex, then `notifyRecordUpdateAvailable`, then rerender | 3, or `await` each step in the component and flush twice |
| `loadScript` chain in `renderedCallback` | 1 per awaited promise in the chain |
| `setTimeout` / `setInterval` | `jest.useFakeTimers()` + `jest.advanceTimersByTime(ms)`, then flush |

If the count is uncertain, loop:

```javascript
async function settle(times = 4) {
    for (let i = 0; i < times; i += 1) {
        await Promise.resolve();
    }
}
```

This is a debugging aid. Once the real count is known, assert with that exact number of flushes so
a regression in the promise chain fails the test.

## 4. Mock state leaks

| Leak | Detection | Prevention |
| --- | --- | --- |
| Call counts accumulate across tests | `toHaveBeenCalledTimes(1)` fails with 2 | `jest.clearAllMocks()` in `afterEach` |
| `mockResolvedValue` from a previous test still active | A test passes for the wrong reason | Set return values in `beforeEach` |
| LMS registry mock keeps old handlers | Subscriber receives messages from a removed component | Component must `unsubscribe`; assert it |
| jsdom body still holds a component | Two matching elements found by `querySelector` | Remove every child in `afterEach` |
| Fake timers left installed | Later files behave strangely | `jest.useRealTimers()` in `afterEach` |

## 5. What not to do when a test is red

| Tempting fix | Why it is wrong |
| --- | --- |
| `jest.setTimeout(60000)` | Hides a hanging promise |
| `-u` to accept a snapshot diff | Records the bug as expected behaviour |
| `it.skip` to get the gate green | The gate exists to block exactly this |
| Lowering `jestCoverageMin` | Config change disguised as a fix; requires explicit approval |
| Mocking the component under test | The suite then tests nothing |
| Adding `await new Promise(r => setTimeout(r, 50))` | Flaky under CI load; flush microtasks instead |

## 6. Interaction with other gates

| Gate | Relationship |
| --- | --- |
| `vf-check lint` | `no-console`, unused imports in test files are ESLint findings, not Jest findings |
| `vf-check analyzer` | Code Analyzer scans component JS, not `__tests__` fixtures; see skill `sf-code-analyzer-quality` |
| `vf-check apex` | Apex tests need an org; Jest never substitutes for them (skill `sf-apex-testing`) |
| `vf-check smoke` | Org-side proof that the deployed component actually works (skill `sf-post-deploy-verification`) |

A green Jest suite proves the component's JavaScript logic, not that field-level security, sharing,
or the Apex contract hold in the org. Those are wave 3 and wave 4 concerns.

## 7. Reading a Jest failure

```
 ● c-case-panel › renders one row per case

    expect(received).toHaveLength(expected)
    Expected length: 2
    Received length: 0
    Received array:  []

      at Object.<anonymous> (force-app/main/default/lwc/casePanel/__tests__/casePanel.test.js:41:22)
```

Read it in this order:

| Line | Question it answers |
| --- | --- |
| Suite and test name | Which contract broke |
| `Received` value | Did the component render nothing, or the wrong thing? Empty almost always means a timing or wire-provisioning problem, not a logic bug |
| File and line | The assertion, not the cause - the cause is usually the setup above it |
| Stack frames inside `node_modules` | Ignore them; LWC engine frames are noise |

Zero rendered nodes has three usual causes, in order of frequency: the rerender was not flushed,
the wire never provisioned because the config resolved to `undefined`, or the mock resolved after
the assertion ran.

## 8. Suite performance

| Symptom | Cause | Fix |
| --- | --- | --- |
| Whole suite takes minutes | Real timers combined with polling components | `jest.useFakeTimers()` |
| A single file dominates the run | Dozens of `createElement` calls with heavy base-component trees | Split the file by behaviour, assert less markup |
| Watch mode rebuilds everything | Changes to `jest.config.js` or a shared mock invalidate the cache | Expected; keep shared mocks stable |
| CI slower than local by an order of magnitude | Worker pool thrashing on a small container | `-- --runInBand` |

## 9. Deciding whether a red test is the bug

| Question | If yes |
| --- | --- |
| Did the component contract intentionally change? | Update the test to the new observable behaviour; do not keep both |
| Does the test assert an implementation detail (field name, internal call, source text)? | Delete it - it fails the "defends an observable contract" bar |
| Does the test pin a string that product owns (a label, a message)? | Assert the element and its role, not the exact wording, or import the label mock |
| Would a plausible bug make this test fail? | Keep it and fix the component |
| Is the test flaky across runs? | Find the unawaited promise or real timer; never retry-loop around it |

## Sources

- https://github.com/salesforce/sfdx-lwc-jest (debug mode, config override, module resolution)
- https://developer.salesforce.com/docs/platform/lwc/guide/unit-testing-using-jest-debug-tests.html
- https://developer.salesforce.com/docs/platform/lwc/guide/unit-testing-using-jest-patterns.html
- https://github.com/salesforce/wire-service-jest-util (adapter method availability per factory)
- https://jestjs.io/docs/30.0/troubleshooting
- https://jestjs.io/docs/30.0/timer-mocks
