const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const exercises = JSON.parse(fs.readFileSync(path.join(__dirname, 'exercise-seed.json'), 'utf8'));
const templates = JSON.parse(fs.readFileSync(path.join(__dirname, 'template-seed.json'), 'utf8'));

test('精选动作库数量、ID、主要肌群和本地演示图完整', () => {
  assert.ok(exercises.length >= 80 && exercises.length <= 120, `got ${exercises.length}`);
  assert.equal(new Set(exercises.map((item) => item.slug)).size, exercises.length);
  assert.equal(new Set(exercises.map((item) => item.mediaPath)).size, exercises.length);
  for (const exercise of exercises) {
    assert.ok(exercise.nameZh && exercise.primaryMuscleZh && exercise.cueZh, exercise.slug);
    assert.ok(fs.statSync(path.join(projectRoot, exercise.mediaPath.replace(/^\//, ''))).size > 0, exercise.mediaPath);
  }
});

test('三种分化模板训练日数量正确，所有模板动作都能在动作库找到', () => {
  const bySlug = new Set(exercises.map((item) => item.slug));
  const expectedDays = { ppl: 3, upper_lower: 4, five_day: 5 };
  assert.deepEqual(new Set(templates.map((item) => item.splitType)), new Set(Object.keys(expectedDays)));
  for (const template of templates) {
    assert.equal(template.days.length, expectedDays[template.splitType], template.code);
    for (const day of template.days) for (const exercise of day.exercises) assert.ok(bySlug.has(exercise.exerciseSlug), `${template.code}/${exercise.exerciseSlug}`);
  }
});
