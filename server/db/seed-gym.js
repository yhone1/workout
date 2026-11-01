const fs = require('fs');
const path = require('path');

const SEED_DIR = path.join(__dirname, '..', 'seed');

async function seedGym(pool) {
  const exercises = JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'exercise-seed.json'), 'utf8'));
  const exerciseRows = exercises.map((item) => ({
    slug: item.slug,
    name_zh: item.nameZh,
    name_en: item.nameEn,
    primary_muscle: item.primaryMuscle,
    primary_muscle_zh: item.primaryMuscleZh,
    secondary_muscles: item.secondaryMuscles,
    secondary_muscles_zh: item.secondaryMusclesZh,
    equipment: item.equipment,
    equipment_zh: item.equipmentZh,
    body_part: item.bodyPart,
    category: item.category,
    split_tags: item.splitTags,
    cue_zh: item.cueZh,
    source_file: item.sourceFile,
    media_path: item.mediaPath,
    is_active: item.isActive,
  }));
  await pool.query(
    `INSERT INTO gym_exercises (
       slug, name_zh, name_en, primary_muscle, primary_muscle_zh,
       secondary_muscles, secondary_muscles_zh, equipment, equipment_zh,
       body_part, category, split_tags, cue_zh, source_file, media_path, is_active
     )
     SELECT slug, name_zh, name_en, primary_muscle, primary_muscle_zh,
            secondary_muscles, secondary_muscles_zh, equipment, equipment_zh,
            body_part, category, split_tags, cue_zh, source_file, media_path, is_active
     FROM jsonb_to_recordset($1::jsonb) AS seed(
       slug text, name_zh text, name_en text, primary_muscle text, primary_muscle_zh text,
       secondary_muscles jsonb, secondary_muscles_zh jsonb, equipment text, equipment_zh text,
       body_part text, category text, split_tags jsonb, cue_zh text, source_file text, media_path text, is_active boolean
     )
     ON CONFLICT (slug) DO NOTHING`,
    [JSON.stringify(exerciseRows)],
  );

  const templates = JSON.parse(fs.readFileSync(path.join(SEED_DIR, 'template-seed.json'), 'utf8'));
  const templateRows = templates.map((item) => ({
    code: item.code,
    split_type: item.splitType,
    name: item.name,
    description: item.description,
    content: { days: item.days },
    is_active: true,
  }));
  await pool.query(
    `INSERT INTO gym_templates (code, split_type, name, description, content, is_active)
     SELECT code, split_type, name, description, content, is_active
     FROM jsonb_to_recordset($1::jsonb) AS seed(
       code text, split_type text, name text, description text, content jsonb, is_active boolean
     )
     ON CONFLICT (code) DO NOTHING`,
    [JSON.stringify(templateRows)],
  );
}

module.exports = { seedGym };
