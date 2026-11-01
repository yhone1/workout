(function attachPlanExerciseFilter(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlanExerciseFilter = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const TAGS = new Set([
    'ppl_push', 'ppl_pull', 'ppl_legs',
    'upper_lower_upper', 'upper_lower_lower',
    'five_chest', 'five_back', 'five_legs', 'five_shoulders', 'five_arms',
  ]);
  const DEFAULTS = {
    ppl: ['ppl_push', 'ppl_pull', 'ppl_legs'],
    upper_lower: ['upper_lower_upper', 'upper_lower_lower', 'upper_lower_upper', 'upper_lower_lower'],
    five_day: ['five_chest', 'five_back', 'five_legs', 'five_shoulders', 'five_arms'],
  };

  function defaultFilterTag(splitType, dayIndex) {
    return DEFAULTS[splitType]?.[dayIndex] || 'all';
  }

  function filterExercises(catalog, filterTag) {
    if (!Array.isArray(catalog)) return [];
    if (!filterTag || filterTag === 'all') return [...catalog];
    if (!TAGS.has(filterTag)) return [];
    return catalog.filter((exercise) => String(exercise.primaryMuscle || '').toLowerCase() !== 'abs'
      && Array.isArray(exercise.splitTags) && exercise.splitTags.includes(filterTag));
  }

  function optionsForSelection(catalog, filterTag, selectedSlug) {
    const options = filterExercises(catalog, filterTag).map((exercise) => ({ exercise, outsideFilter: false }));
    const selected = selectedSlug && catalog.find((exercise) => exercise.slug === selectedSlug);
    if (selected && !options.some((option) => option.exercise.slug === selected.slug)) {
      options.unshift({ exercise: selected, outsideFilter: true });
    }
    return options;
  }

  return { defaultFilterTag, filterExercises, optionsForSelection };
});
