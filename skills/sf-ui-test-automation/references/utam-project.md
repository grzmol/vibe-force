# A UTAM project, concretely

Every configuration block below is taken from `salesforce/utam-js-recipes` (MIT, Salesforce) as it
stands today, and every version from the npm registry. Nothing here is reconstructed from memory.

## Dependencies

| Package | Version | Why |
| --- | --- | --- |
| `@utam/core` | 3.3.0 | Runtime: `utam.load`, `utam.getCurrentDocument` |
| `wdio-utam-service` | 3.3.0 | WebdriverIO service, injects compiled page objects |
| `salesforce-pageobjects` | 12.0.0 | Salesforce-authored page objects for Lightning Experience |
| `@wdio/cli`, `@wdio/local-runner`, `@wdio/jasmine-framework`, `@wdio/spec-reporter` | 8.x in the recipes | Runner, framework, reporter |
| `dotenv`, `envfile` | 16.x / 7.x | Read and write the `.env` that holds the per-run login URL |
| `@salesforce/sfdx-lwc-jest` | 7.9.0 | The unit tier in the same project |

The recipes pin the Chrome version in `capabilities.browserVersion` (`139.0.7258.67` at the time of
writing). Pin it in CI as well, or a Chrome auto-update turns into a red build with no commit.

## npm scripts, verbatim from the recipes

```json
{
  "lint": "eslint .",
  "format": "prettier --write .",
  "test": "wdio",
  "build": "yarn compile:utam && yarn generate:utam",
  "compile:utam": "utam -c utam.config.js && cd utam-preview && yarn compile",
  "generate:utam": "cd utam-generator && yarn generate && yarn compile",
  "create:env": "node scripts/create-env-file.js",
  "generate:login": "node scripts/generate-login-url.js"
}
```

`generate:login` is the authentication step; `build` is the compile step. A test run is
`generate:login` then `test`, in that order, every time.

## utam.config.js

```js
module.exports = {
    // file masks for utam page objects
    pageObjectsFileMask: ['force-app/**/__utam__/**/*.utam.json'],
    // output folder for generated page objects, relative to the package root
    pageObjectsOutputDir: 'pageObjects',
    // remap custom elements imports
    alias: {
        'utam-sfdx/': 'utam-js-recipes/',
        'utam-*/': 'utam-preview/',
    },
    lint: {
        printToConsole: false,
    },
};
```

Page object sources live beside the component they model, in a `__utam__` directory - the same
convention as `__tests__` for Jest. Compiled output in `pageObjects/` is generated: never edit it,
never commit a hand-fix to it.

## wdio.conf.js

```js
require('dotenv').config();

const { UtamWdioService } = require('wdio-utam-service');
const { DEBUG } = process.env;
const EXPLICIT_TIMEOUT = 60 * 1000;
const DEBUG_TIMEOUT = EXPLICIT_TIMEOUT * 30;

exports.config = {
    runner: 'local',
    specs: ['force-app/test/**/*.spec.js'],
    maxInstances: 1,
    capabilities: [
        {
            maxInstances: 1,
            browserName: 'chrome',
            browserVersion: '139.0.7258.67',
            'goog:chromeOptions': {
                args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
            },
        },
    ],
    waitforTimeout: DEBUG ? DEBUG_TIMEOUT : EXPLICIT_TIMEOUT,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,
    automationProtocol: 'webdriver',
    services: [
        [UtamWdioService, { implicitTimeout: 0, injectionConfigs: ['salesforce-pageobjects/ui-global-components.config.json'] }],
    ],
    framework: 'jasmine',
    reporters: ['spec'],
    jasmineOpts: { defaultTimeoutInterval: 1000 * 60 * 5 },
};
```

`DEBUG=true npx wdio` multiplies the wait budget by 30 for an interactive session. Never ship that
value as the default - a 30-minute wait is how a broken selector becomes a stalled pipeline.

`maxInstances: 1` is the recipes' choice. Parallel specs against one org share record state and API
limits; parallelise by splitting across orgs, not across browsers.

## Authentication, per run

```js
// scripts/generate-login-url.js, reduced to the mechanism
const getUrlCmd = 'sf org open -p /lightning -r --json';
const { url } = JSON.parse(stdout).result;
// upsert url + timestamp into .env, keyed for the target org
```

The timestamp exists because the URL is perishable: it is minted single-use through the UI Bridge
`/services/oauth2/singleaccess` endpoint, and `sf org open --url-only` prints a security warning
saying it is equivalent to logging someone in under the current credential. Practical consequences:

| Situation | Handling |
| --- | --- |
| Suite of several specs | Regenerate before the run; if a spec logs out, regenerate inside that spec's setup |
| CI | Generate after the org is provisioned and permission sets are assigned, not before |
| Local rerun | `npm run generate:login` again, always; a stale `.env` looks like a login-screen failure |
| Artefacts and logs | Never print the URL; a failed step should print the org alias instead |

## Page object grammar

```json
{
  "root": true,
  "selector": { "css": "body" },
  "elements": [
    {
      "name": "navigationBar",
      "type": "salesforce-pageobjects/global/pageObjects/appNav",
      "public": true,
      "selector": { "css": "one-appnav" }
    },
    {
      "name": "activeFlexiPage",
      "selector": { "css": ".oneContent.active app_flexipage-lwc-app-flexipage" },
      "type": "utam-sfdx/pageObjects/appFlexipage",
      "public": true
    }
  ],
  "methods": [
    {
      "name": "getComponent",
      "compose": [
        { "element": "activeFlexiPage" },
        { "chain": true, "apply": "waitForLoad", "returnType": "utam-sfdx/pageObjects/appFlexipage" },
        { "chain": true, "element": "flexipageComponent2", "returnType": "salesforce-pageobjects/flexipage/pageObjects/component2" }
      ]
    }
  ]
}
```

| Key | Meaning |
| --- | --- |
| `root` + `selector` | The page object's anchor; `body` for a page, a component tag for a component |
| `elements[].type` | Another page object - this is how shadow DOM boundaries stay invisible to the spec |
| `public: true` | Generates a getter; anything not public is internal to the page object |
| `methods[].compose` | A multi-step interaction with `chain: true` threading the previous result |

Rule of thumb: if a spec needs three getters in a row to reach an element, that chain belongs in a
composed method on the page object.

## A spec

```js
import Hello from '../../pageObjects/hello.js';
import HomePage from '../../pageObjects/homePage.js';
import { TestEnvironment } from './utilities/test-environment.js';

describe('Scratch Org Tests', () => {
    const testEnvironment = new TestEnvironment('scratchOrg');
    let appHomePage;

    beforeEach(async () => {
        await browser.navigateTo(testEnvironment.sfdxLoginUrl);
        const domDocument = utam.getCurrentDocument();
        await domDocument.waitFor(async () => (await domDocument.getUrl()).includes('Hello'));
        appHomePage = await utam.load(HomePage);
    });

    it('hello: displays greeting', async () => {
        const component = await appHomePage.getComponent();
        const hello = await component.getContent(Hello);
        expect(await hello.getText()).toContain('Hello, World!');
    });
});
```

Three things to copy from it: the login URL comes from the environment, the wait is a condition on
the URL, and the assertion is on user-visible text.

## In CI

```yaml
- run: sf org create scratch -f config/ci-scratch-def.json -v vf-devhub -a "$ALIAS" -y 1 -w 15 --no-track-source
- run: sf project deploy start --target-org "$ALIAS" --source-dir force-app --wait 30
- run: sf org assign permset --name VF_App_Admin --target-org "$ALIAS"
- run: npm run build
- run: npm run generate:login          # after the org is usable, not before
- run: npx wdio run wdio.conf.js
- if: always()
  run: sf org delete scratch -o "$ALIAS" -p
```

Keep the UI job off the blocking pre-merge path: `vf-check local` is offline and stays the gate. A
nightly UI run, or a label-triggered one, gives the same regression coverage without making an org
outage a merge outage. The ephemeral-org script and its `trap` cleanup are in
`sf-scratch-orgs-sandboxes/references/org-lifecycle-scripts.md`.

## Sources

- <https://github.com/salesforce/utam-js-recipes> - `package.json`, `utam.config.js`, `wdio.conf.js`,
  `scripts/generate-login-url.js`, `force-app/test/sfdx-scratch-org.spec.js`,
  `force-app/main/default/lwc/__utam__/homePage.utam.json`
- <https://registry.npmjs.org/@utam/core>, `/wdio-utam-service`, `/salesforce-pageobjects`
- <https://github.com/salesforcecli/plugin-org/blob/main/messages/open.md>
