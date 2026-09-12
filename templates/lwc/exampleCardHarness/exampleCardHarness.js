/**
 * Preview harness for `c-example-card`.
 *
 * `sf lightning dev component` renders a bundle with whatever its own defaults produce; it has no
 * property editor. This wrapper supplies the fixtures instead, so every state is one click away
 * without seeding org records or adding a demo branch to the component itself.
 *
 * Lives in a non-default package directory (see skill `sf-local-development`, pattern 9) so it is
 * deployed to scratch orgs and sandboxes only, never to production.
 */

import { LightningElement } from 'lwc';
import { STATES } from 'c/exampleCardFixtures';

export default class ExampleCardHarness extends LightningElement {
  states = STATES;
  selectedKey = STATES[0].key;

  get selected() {
    return this.states.find((state) => state.key === this.selectedKey) ?? this.states[0];
  }

  get buttons() {
    return this.states.map((state) => ({
      ...state,
      variant: state.key === this.selectedKey ? 'brand' : 'neutral',
    }));
  }

  handleSelect(event) {
    this.selectedKey = event.target.dataset.key;
  }
}
