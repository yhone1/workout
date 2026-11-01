const test = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultFilterTag,
  filterExercises,
  optionsForSelection,
} = require('./plan-exercise-filter');

const catalog = [
  { slug: 'pectorals/press', primaryMuscle: 'pectorals', splitTags: ['ppl_push', 'five_chest'] },
  { slug: 'lats/pulldown', primaryMuscle: 'lats', splitTags: ['ppl_pull', 'upper_lower_upper', 'five_back'] },
  { slug: 'quads/squat', primaryMuscle: 'quads', splitTags: ['ppl_legs', 'upper_lower_lower', 'five_legs'] },
  { slug: 'abs/crunch', primaryMuscle: 'abs', splitTags: ['ppl_legs', 'upper_lower_lower', 'five_arms'] },
];

test('template days receive the matching default action-filter category', () => {
  assert.deepEqual([0, 1, 2].map((day) => defaultFilterTag('ppl', day)), ['ppl_push', 'ppl_pull', 'ppl_legs']);
  assert.deepEqual([0, 1, 2, 3].map((day) => defaultFilterTag('upper_lower', day)), [
    'upper_lower_upper', 'upper_lower_lower', 'upper_lower_upper', 'upper_lower_lower',
  ]);
  assert.deepEqual([0, 1, 2, 3, 4].map((day) => defaultFilterTag('five_day', day)), [
    'five_chest', 'five_back', 'five_legs', 'five_shoulders', 'five_arms',
  ]);
  assert.equal(defaultFilterTag('custom', 0), 'all');
});

test('split filtering excludes abdominal exercises while all-actions mode keeps them', () => {
  assert.deepEqual(filterExercises(catalog, 'ppl_legs').map((exercise) => exercise.slug), ['quads/squat']);
  assert.equal(filterExercises(catalog, 'all').some((exercise) => exercise.primaryMuscle === 'abs'), true);
  assert.deepEqual(filterExercises(catalog, 'unknown'), []);
});

test('an already selected out-of-filter exercise remains selectable and is marked', () => {
  const options = optionsForSelection(catalog, 'ppl_legs', 'abs/crunch');
  assert.equal(options[0].exercise.slug, 'abs/crunch');
  assert.equal(options[0].outsideFilter, true);
  assert.equal(options.some((option) => option.exercise.slug === 'quads/squat' && !option.outsideFilter), true);
});
