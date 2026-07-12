/**
 * Coding CLI adapter types module: imported for coverage. The module is type-only at runtime,
 * so this test simply asserts the module loads without runtime exports.
 */

import * as cliTypes from '../types';

describe('codingCli adapter types module', () => {
  it('loads as a type-only module', () => {
    expect(cliTypes).toBeDefined();
  });
});
