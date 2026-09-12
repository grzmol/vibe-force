# Jest Setup for LWC

Complete, copy-ready configuration for `@salesforce/sfdx-lwc-jest` in a Salesforce DX project, plus
the `__mocks__` layout, coverage wiring, and CI invocation used by `vf-check jest`.

## 1. Install

```bash
# from the root of the Salesforce DX project
npm install
npm install @salesforce/sfdx-lwc-jest --save-dev
```

Version pinning: the npm `latest` tag tracks the repository, not a Salesforce release. To test
against a specific production release, install the release-named tag published for that release
(for example `@salesforce/sfdx-lwc-jest@<release>`); the full tag list is on the npm versions page
for the package.

Optional companions used by the Salesforce sample apps:

| Package | Purpose |
| --- | --- |
| `@sa11y/jest` | `toBeAccessible()` matcher for accessibility assertions |
| `jest-canvas-mock` | jsdom canvas stub, required by chart components |
| `@lwc/engine-dom` | Provides `createElement` (newer sample apps import it from here instead of `lwc`) |

## 2. npm scripts

```json
{
  "scripts": {
    "test": "npm run test:unit",
    "test:unit": "sfdx-lwc-jest",
    "test:unit:watch": "sfdx-lwc-jest --watch",
    "test:unit:debug": "sfdx-lwc-jest --debug",
    "test:unit:coverage": "sfdx-lwc-jest --coverage"
  }
}
```

### `sfdx-lwc-jest` CLI options

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `--coverage` | boolean | `false` | Collect coverage and print it |
| `-u`, `--updateSnapshot` | boolean | `false` | Re-record failing snapshots |
| `--verbose` | boolean | `false` | Print individual test results with suite hierarchy |
| `--watch` | boolean | `false` | Re-run tests related to changed files |
| `--debug` | boolean | `false` | Run under the Node inspector (`chrome://inspect`) |
| `--version` | boolean | n/a | Print the version |
| `--help` | boolean | n/a | Print usage |
| `-- <jest args>` | passthrough | n/a | Everything after `--` is passed straight to Jest |

```bash
sfdx-lwc-jest -- --json
sfdx-lwc-jest -- --runInBand
sfdx-lwc-jest --debug -- --no-cache
npm run test:unit -- force-app/main/default/lwc/accountCard/__tests__/accountCard.test.js
npm run test:unit -- -t "renders an error panel"
```

## 3. `jest.config.js`

`sfdx-lwc-jest` sets up every required Jest option (transform, module resolution, `lightning`
namespace stubs) automatically. Create `jest.config.js` at the project root only when you need to
override something. Note: this file is also required if you want to launch Jest from the VS Code
debugger.

```javascript
// jest.config.js
const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');

const setupFilesAfterEnv = jestConfig.setupFilesAfterEnv || [];
setupFilesAfterEnv.push('<rootDir>/jest-sa11y-setup.js');

module.exports = {
    ...jestConfig,
    moduleNameMapper: {
        // scoped modules that need richer behaviour than the default stub
        '^@salesforce/apex$': '<rootDir>/force-app/test/jest-mocks/apex',
        '^@salesforce/schema$': '<rootDir>/force-app/test/jest-mocks/schema',
        // lightning platform modules
        '^lightning/navigation$': '<rootDir>/force-app/test/jest-mocks/lightning/navigation',
        '^lightning/platformShowToastEvent$':
            '<rootDir>/force-app/test/jest-mocks/lightning/platformShowToastEvent',
        '^lightning/uiRecordApi$': '<rootDir>/force-app/test/jest-mocks/lightning/uiRecordApi',
        '^lightning/messageService$': '<rootDir>/force-app/test/jest-mocks/lightning/messageService',
        '^lightning/actions$': '<rootDir>/force-app/test/jest-mocks/lightning/actions',
        '^lightning/modal$': '<rootDir>/force-app/test/jest-mocks/lightning/modal',
        '^lightning/refresh$': '<rootDir>/force-app/test/jest-mocks/lightning/refresh',
        '^lightning/logger$': '<rootDir>/force-app/test/jest-mocks/lightning/logger',
        // components from another namespace that are not in the local lwc directory
        '^foo/fancyButton$': '<rootDir>/force-app/test/jest-mocks/foo/fancyButton'
    },
    setupFiles: ['jest-canvas-mock'],
    setupFilesAfterEnv,
    testTimeout: 10000,
    collectCoverageFrom: [
        'force-app/main/default/lwc/**/*.js',
        '!force-app/main/default/lwc/**/__tests__/**',
        '!force-app/main/default/lwc/**/*.js-meta.xml'
    ],
    coverageThreshold: {
        global: { statements: 80, branches: 70, functions: 80, lines: 80 }
    }
};
```

`moduleNameMapper` key syntax for cross-namespace components: everything before the first dash in
the tag is the namespace, and the rest becomes camelCase. `<foo-fancy-button>` maps from
`^foo/fancyButton$`. `<rootDir>` is the Salesforce DX workspace root.

## 4. Mock file layout

```
force-app/
  main/default/lwc/<component>/__tests__/<component>.test.js
  main/default/lwc/<component>/__tests__/data/*.json      fixture payloads
  test/jest-mocks/apex.js                                 @salesforce/apex helpers
  test/jest-mocks/schema.js                               @salesforce/schema helpers
  test/jest-mocks/lightning/navigation.js
  test/jest-mocks/lightning/messageService.js
  test/jest-mocks/lightning/platformShowToastEvent.js
  test/jest-mocks/lightning/uiRecordApi.js
  test/jest-mocks/lightning/actions.js
  test/jest-mocks/lightning/modal.js
  test/jest-mocks/lightning/refresh.js
  test/jest-mocks/lightning/logger.js
  test/jest-mocks/foo/fancyButton.js + fancyButton.html    other-namespace component stub
jest.config.js
jest-sa11y-setup.js
```

`sfdx-lwc-jest` installs stubs for every `lightning` namespace base component into its own
`src/lightning-stubs` directory and wires them up automatically; you only add a file here when the
default stub is too inert for the assertion you need.

## 5. Cross-namespace component stub

```javascript
// force-app/test/jest-mocks/foo/fancyButton.js
import { LightningElement, api } from 'lwc';

export default class FancyButton extends LightningElement {
    @api label;
    @api disabled = false;
}
```

```html
<!-- force-app/test/jest-mocks/foo/fancyButton.html -->
<template></template>
```

## 6. Accessibility setup (optional but recommended)

```javascript
// jest-sa11y-setup.js
import { registerSa11yMatcher } from '@sa11y/jest';

registerSa11yMatcher();
```

```javascript
it('is accessible', async () => {
    const element = createElement('c-account-card', { is: AccountCard });
    document.body.appendChild(element);
    await Promise.resolve();
    await expect(element).toBeAccessible();
});
```

## 7. Coverage and the vibe-force gate

| Layer | Where configured | Value |
| --- | --- | --- |
| Jest threshold | `coverageThreshold` in `jest.config.js` | 80 lines/statements |
| Harness gate | `gates.jestCoverageMin` in `.vibeforce/config.json` (defaults from `config/vibe-force.defaults.json`) | 80 |
| Test-presence gate | `gates.requireJestForLwc` | `true` - every `lwc/<bundle>` needs `__tests__` |

Keep the two coverage numbers equal. The harness gate is authoritative: `vf-check jest` computes
coverage itself and fails with exit code 1 when it is below the configured minimum, even if
`jest.config.js` has no `coverageThreshold`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" jest --json
# report: <project>/.vibeforce/reports/jest-<ISO>.json
```

## 8. CI invocation

```bash
npm ci
npm run test:unit -- --coverage --runInBand --ci
```

- `--runInBand` avoids worker-pool contention on small CI containers and makes stack traces
  deterministic.
- `--ci` makes Jest fail instead of writing new snapshots.
- Coverage artefacts land in `coverage/` unless `coverageDirectory` is overridden.

## 9. Debugging configuration

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Debug Jest Tests",
            "type": "node",
            "request": "launch",
            "runtimeArgs": [
                "--inspect-brk",
                "${workspaceRoot}/node_modules/.bin/jest",
                "--runInBand"
            ],
            "console": "integratedTerminal",
            "internalConsoleOptions": "neverOpen",
            "port": 9229
        }
    ]
}
```

Place a `debugger;` statement in the component or the test, run `npm run test:unit:debug`, and
attach from `chrome://inspect`. The VS Code launch configuration above requires `jest.config.js` to
exist at the project root.

## 10. Import styles for `createElement`

| Style | Source |
| --- | --- |
| `import { createElement } from 'lwc';` | Lightning Web Components Developer Guide test examples |
| `import { createElement } from '@lwc/engine-dom';` | Current `trailheadapps` sample apps (for example `lwc-recipes`) |

Both resolve under `sfdx-lwc-jest`. Pick one per project and keep it consistent; mixing the two in
one repository makes greps and codemods unreliable.

## Sources

- https://github.com/salesforce/sfdx-lwc-jest (README: installation, CLI options, config override, module mapping, wire testing, debug setup)
- https://developer.salesforce.com/docs/platform/lwc/guide/unit-testing-using-jest-installation.html
- https://developer.salesforce.com/docs/platform/lwc/guide/unit-testing-using-jest-create-tests.html
- https://developer.salesforce.com/docs/platform/lwc/guide/unit-testing-using-jest-patterns.html
- https://github.com/trailheadapps/lwc-recipes/blob/main/jest.config.js
- https://github.com/trailheadapps/lwc-recipes/blob/main/jest-sa11y-setup.js
- https://jestjs.io/docs/30.0/configuration
