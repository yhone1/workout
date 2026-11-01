const test = require('node:test');
const assert = require('node:assert/strict');
const { slashlessAlias } = require('./page-paths');

test('slashless aliases match only the slashless URL and cannot intercept the canonical page path', () => {
  for (const pathname of ['/home', '/gym', '/member']) {
    const route = slashlessAlias(pathname);
    assert.equal(route.test(pathname), true);
    assert.equal(route.test(`${pathname}/`), false);
  }
});

test('slashless alias escapes regex metacharacters in a path', () => {
  assert.equal(slashlessAlias('/a.b').test('/a.b'), true);
  assert.equal(slashlessAlias('/a.b').test('/axb'), false);
});
