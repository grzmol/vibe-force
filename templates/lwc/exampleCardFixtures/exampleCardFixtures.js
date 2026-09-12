/**
 * Fixture module for `c-example-card`: one definition of every state the component can be in.
 *
 * Imported by the Jest spec (`__tests__/exampleCard.test.js`) and by `c-example-card-harness`,
 * which renders the same states in `sf lightning dev component`. Keeping both consumers on one
 * module is the point - a state that only exists in the preview is a state no test covers.
 *
 * Rename the bundle per component (`<component>Fixtures`). `vf-check pairing` exempts the
 * `*Fixtures` and `*Harness` suffixes from the Jest-spec gate.
 */

export const EMPTY = { key: 'empty', label: 'Empty', records: [], error: null };

export const POPULATED = {
  key: 'populated',
  label: 'Populated',
  records: [
    { Id: '001000000000001AAA', Name: 'Acme', AnnualRevenue: 4200000 },
    { Id: '001000000000002AAA', Name: 'Globex', AnnualRevenue: 150000 },
  ],
  error: null,
};

export const LONG_TEXT = {
  key: 'longText',
  label: 'Long text',
  records: [{ Id: '001000000000003AAA', Name: 'A'.repeat(180), AnnualRevenue: 0 }],
  error: null,
};

export const ERROR = {
  key: 'error',
  label: 'Error',
  records: [],
  error: { body: { message: 'List of accounts is not available.' }, status: 500 },
};

/** Order drives the harness state switcher. */
export const STATES = [EMPTY, POPULATED, LONG_TEXT, ERROR];
