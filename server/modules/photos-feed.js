const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { requireRole } = require('./identity-coaching');
const { coachOwnsStudent } = require('./workouts-measurements');

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MIME_EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function detectImageMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function parsePhotoData(input) {
  if (typeof input !== 'string' || input.length > Math.ceil(MAX_PHOTO_BYTES * 4 / 3) + 8) throw new Error('invalid_photo');
  const base64 = input.replace(/^data:image\/(?:jpeg|png|webp);base64,/i, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('invalid_photo');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) throw new Error('photo_too_large');
  const mime = detectImageMime(buffer);
  if (!mime) throw new Error('unsupported_photo_type');
  return { buffer, mime };
}

function photoResponse(row, liked = false) {
  return {
    id: row.id,
    nickname: row.display_name || '训练伙伴',
    privacy: row.privacy,
    moderationStatus: row.moderation_status,
    caption: row.caption,
    showMetrics: row.show_metrics,
    metricSnapshot: row.show_metrics ? {
      weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
      waistCm: row.waist_cm == null ? null : Number(row.waist_cm),
      bodyFatPct: row.body_fat_pct == null ? null : Number(row.body_fat_pct),
    } : null,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    moderationNote: row.moderation_note,
    imageUrl: `/api/gym/photos/${row.id}/image`,
    likeCount: Number(row.like_count || 0),
    likedByMe: Boolean(liked || row.liked_by_me),
  };
}

function nicknameSeed() {
  return `训练伙伴${crypto.randomInt(10000, 100000)}`;
}

function canModeratePhotos(user) {
  return user.roles.some((role) => role === 'admin' || role === 'superadmin');
}

async function canReadPhoto(pool, photo, user) {
  if (canModeratePhotos(user)) return true;
  if (photo.user_id === user.user_id) return !['withdrawn', 'removed'].includes(photo.moderation_status);
  if (photo.moderation_status !== 'approved') return false;
  if (photo.privacy === 'public') return true;
  if (photo.privacy !== 'coach') return false;
  return coachOwnsStudent(pool, user.user_id, photo.user_id);
}

function mountPhotoFeedRoutes(app, { pool, auth, privateRoot }) {
  const members = [auth, requireRole('student', 'coach', 'admin')];
  const students = [auth, requireRole('student')];
  const coaches = [auth, requireRole('coach')];
  const admins = [auth, requireRole('admin')];

  app.get('/api/gym/profile', ...members, async (req, res) => {
    try {
      const result = await pool.query('SELECT display_name FROM gym_profiles WHERE user_id=$1', [req.user.user_id]);
      res.json({ displayName: result.rows[0]?.display_name || '' });
    } catch (error) { console.error('GET gym profile', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.put('/api/gym/profile', ...members, async (req, res) => {
    const displayName = String(req.body?.displayName || '').trim();
    if (displayName.length < 1 || displayName.length > 40 || /[\x00-\x1f\x7f]/.test(displayName)) return res.status(400).json({ error: 'invalid_display_name' });
    try {
      await pool.query(
        `INSERT INTO gym_profiles (user_id,display_name) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET display_name=EXCLUDED.display_name,updated_at=now()`,
        [req.user.user_id, displayName],
      );
      res.json({ displayName });
    } catch (error) { console.error('PUT gym profile', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.post('/api/gym/photos', ...students, async (req, res) => {
    const privacy = ['self', 'coach', 'public'].includes(req.body?.privacy) ? req.body.privacy : null;
    const caption = String(req.body?.caption || '').trim().slice(0, 240);
    if (!privacy) return res.status(400).json({ error: 'invalid_privacy' });
    let image;
    try { image = parsePhotoData(req.body?.imageData); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const storageKey = crypto.randomUUID();
    const filename = `${storageKey}${MIME_EXTENSIONS[image.mime]}`;
    const target = path.join(privateRoot, filename);
    try {
      await fs.promises.mkdir(privateRoot, { recursive: true });
      await fs.promises.writeFile(target, image.buffer, { flag: 'wx', mode: 0o600 });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const profile = await client.query('SELECT 1 FROM gym_profiles WHERE user_id=$1', [req.user.user_id]);
        if (!profile.rowCount) await client.query('INSERT INTO gym_profiles (user_id,display_name) VALUES ($1,$2)', [req.user.user_id, nicknameSeed()]);
        const inserted = await client.query(
          `INSERT INTO gym_photos (user_id,storage_key,mime_type,byte_size,privacy,caption,show_metrics)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [req.user.user_id, storageKey, image.mime, image.buffer.length, privacy, caption, req.body?.showMetrics === true],
        );
        await client.query("INSERT INTO gym_photo_moderation_events (photo_id,actor_id,event_type) VALUES ($1,$2,'uploaded')", [inserted.rows[0].id, req.user.user_id]);
        await client.query('COMMIT');
        res.status(201).json({ photo: photoResponse({ ...inserted.rows[0], display_name: null }) });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        await fs.promises.unlink(target).catch(() => {});
        console.error('insert photo', error.message); res.status(500).json({ error: 'db' });
      } finally { client.release(); }
    } catch (error) {
      await fs.promises.unlink(target).catch(() => {});
      console.error('store photo', error.message); res.status(500).json({ error: 'photo_storage' });
    }
  });

  app.get('/api/gym/photos', ...students, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT p.*,g.display_name,COALESCE(l.like_count,0)::int AS like_count
         FROM gym_photos p LEFT JOIN gym_profiles g ON g.user_id=p.user_id
         LEFT JOIN LATERAL (SELECT count(*) AS like_count FROM gym_photo_likes WHERE photo_id=p.id) l ON TRUE
         WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 100`,
        [req.user.user_id],
      );
      res.json({ photos: result.rows.map((row) => photoResponse(row)) });
    } catch (error) { console.error('GET my photos', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.patch('/api/gym/photos/:id', ...students, async (req, res) => {
    const id = Number(req.params.id);
    const privacy = req.body?.privacy;
    const showMetrics = req.body?.showMetrics;
    const caption = req.body?.caption;
    if (!Number.isSafeInteger(id) || id <= 0 || (privacy !== undefined && !['self', 'coach', 'public'].includes(privacy)) ||
        (showMetrics !== undefined && typeof showMetrics !== 'boolean') || (caption !== undefined && typeof caption !== 'string')) return res.status(400).json({ error: 'invalid_photo_update' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM gym_photos WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, req.user.user_id]);
      if (!current.rowCount || current.rows[0].moderation_status === 'withdrawn' || current.rows[0].moderation_status === 'removed') { await client.query('ROLLBACK'); return res.status(404).json({ error: 'photo_not_found' }); }
      const old = current.rows[0];
      const nextPrivacy = privacy || old.privacy;
      const needsReview = nextPrivacy === 'public' && (old.privacy !== 'public' || old.moderation_status !== 'approved');
      const newStatus = needsReview ? 'pending' : old.moderation_status;
      const updated = await client.query(
        `UPDATE gym_photos SET privacy=$3,show_metrics=COALESCE($4,show_metrics),caption=COALESCE($5,caption),
          moderation_status=$6,reviewed_by=CASE WHEN $6='pending' THEN NULL ELSE reviewed_by END,
          reviewed_at=CASE WHEN $6='pending' THEN NULL ELSE reviewed_at END,
          moderation_note=CASE WHEN $6='pending' THEN '' ELSE moderation_note END
         WHERE id=$1 AND user_id=$2 RETURNING *`,
        [id, req.user.user_id, nextPrivacy, showMetrics ?? null, caption === undefined ? null : caption.trim().slice(0, 240), newStatus],
      );
      if (old.privacy !== nextPrivacy) await client.query("INSERT INTO gym_photo_moderation_events (photo_id,actor_id,event_type,note) VALUES ($1,$2,'privacy_changed',$3)", [id, req.user.user_id, `${old.privacy} → ${nextPrivacy}`]);
      await client.query('COMMIT');
      res.json({ photo: photoResponse({ ...updated.rows[0], display_name: null }) });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('update photo', error.message); res.status(500).json({ error: 'db' }); }
    finally { client.release(); }
  });

  app.post('/api/gym/photos/:id/withdraw', ...students, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_photo' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE gym_photos SET moderation_status='withdrawn',withdrawn_at=now() WHERE id=$1 AND user_id=$2
         AND moderation_status NOT IN ('withdrawn','removed') RETURNING id`,
        [id, req.user.user_id],
      );
      if (!result.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'photo_not_found' }); }
      await client.query("INSERT INTO gym_photo_moderation_events (photo_id,actor_id,event_type) VALUES ($1,$2,'withdrawn')", [id, req.user.user_id]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('withdraw photo', error.message); res.status(500).json({ error: 'db' }); }
    finally { client.release(); }
  });

  app.get('/api/admin/photos', ...admins, async (req, res) => {
    const status = ['pending', 'approved', 'rejected', 'withdrawn', 'removed', 'all'].includes(req.query.status) ? req.query.status : 'pending';
    try {
      const result = await pool.query(
        `SELECT p.*,u.username,g.display_name,COALESCE(l.like_count,0)::int AS like_count
         FROM gym_photos p JOIN users u ON u.id=p.user_id LEFT JOIN gym_profiles g ON g.user_id=p.user_id
         LEFT JOIN LATERAL (SELECT count(*) AS like_count FROM gym_photo_likes WHERE photo_id=p.id) l ON TRUE
         WHERE ($1='all' OR p.moderation_status=$1) ORDER BY p.created_at DESC LIMIT 200`,
        [status],
      );
      res.json({ photos: result.rows.map((row) => ({ ...photoResponse(row), username: row.username })) });
    } catch (error) { console.error('admin photo queue', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.post('/api/admin/photos/:id/review', ...admins, async (req, res) => {
    const id = Number(req.params.id);
    const decision = req.body?.decision;
    const note = String(req.body?.note || '').trim().slice(0, 500);
    if (!Number.isSafeInteger(id) || id <= 0 || !['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'invalid_review' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const photo = await client.query('SELECT * FROM gym_photos WHERE id=$1 FOR UPDATE', [id]);
      if (!photo.rowCount || photo.rows[0].moderation_status !== 'pending') { await client.query('ROLLBACK'); return res.status(404).json({ error: 'photo_not_pending' }); }
      const moderationStatus = decision === 'approve' ? 'approved' : 'rejected';
      const updated = await client.query(
        `UPDATE gym_photos SET moderation_status=$2,reviewed_by=$3,reviewed_at=now(),moderation_note=$4 WHERE id=$1 RETURNING *`,
        [id, moderationStatus, req.user.user_id, note],
      );
      await client.query('INSERT INTO gym_photo_moderation_events (photo_id,actor_id,event_type,note) VALUES ($1,$2,$3,$4)', [id, req.user.user_id, moderationStatus, note]);
      await client.query('COMMIT');
      res.json({ photo: photoResponse({ ...updated.rows[0], display_name: null }) });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('moderate photo', error.message); res.status(500).json({ error: 'db' }); }
    finally { client.release(); }
  });

  app.post('/api/admin/photos/:id/remove', ...admins, async (req, res) => {
    const id = Number(req.params.id);
    const note = String(req.body?.note || '').trim().slice(0, 500);
    if (!Number.isSafeInteger(id) || id <= 0 || !note) return res.status(400).json({ error: 'invalid_removal' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM gym_photos WHERE id=$1 FOR UPDATE', [id]);
      if (!current.rowCount || ['withdrawn', 'removed'].includes(current.rows[0].moderation_status)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'photo_not_removable' }); }
      const updated = await client.query(
        `UPDATE gym_photos SET moderation_status='removed',reviewed_by=$2,reviewed_at=now(),moderation_note=$3,withdrawn_at=NULL WHERE id=$1 RETURNING *`,
        [id, req.user.user_id, note],
      );
      await client.query("INSERT INTO gym_photo_moderation_events (photo_id,actor_id,event_type,note) VALUES ($1,$2,'removed',$3)", [id, req.user.user_id, note]);
      await client.query('COMMIT');
      res.json({ photo: photoResponse({ ...updated.rows[0], display_name: null }) });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('remove photo', error.message); res.status(500).json({ error: 'db' }); }
    finally { client.release(); }
  });

  app.get('/api/coach/students/:studentId/photos', ...coaches, async (req, res) => {
    const studentId = Number(req.params.studentId);
    if (!Number.isSafeInteger(studentId) || studentId <= 0) return res.status(400).json({ error: 'invalid_student' });
    try {
      if (!await coachOwnsStudent(pool, req.user.user_id, studentId)) return res.status(404).json({ error: 'student_not_found' });
      const result = await pool.query(
        `SELECT p.*,g.display_name,COALESCE(l.like_count,0)::int AS like_count
         FROM gym_photos p LEFT JOIN gym_profiles g ON g.user_id=p.user_id
         LEFT JOIN LATERAL (SELECT count(*) AS like_count FROM gym_photo_likes WHERE photo_id=p.id) l ON TRUE
         WHERE p.user_id=$1 AND p.privacy IN ('coach','public') AND p.moderation_status='approved' ORDER BY p.created_at DESC LIMIT 100`,
        [studentId],
      );
      res.json({ photos: result.rows.map((row) => photoResponse(row)) });
    } catch (error) { console.error('coach student photos', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.get('/api/gym/feed', ...members, async (req, res) => {
    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 20));
    const beforeId = req.query.before ? Number(req.query.before) : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(beforeId) || beforeId <= 0) return res.status(400).json({ error: 'invalid_cursor' });
    try {
      const result = await pool.query(
        `SELECT p.*,g.display_name,COALESCE(l.like_count,0)::int AS like_count,
           EXISTS(SELECT 1 FROM gym_photo_likes mine WHERE mine.photo_id=p.id AND mine.user_id=$1) AS liked_by_me,
           CASE WHEN p.show_metrics THEN m.weight_kg END AS weight_kg,
           CASE WHEN p.show_metrics THEN m.waist_cm END AS waist_cm,
           CASE WHEN p.show_metrics THEN m.body_fat_pct END AS body_fat_pct
         FROM gym_photos p LEFT JOIN gym_profiles g ON g.user_id=p.user_id
         LEFT JOIN LATERAL (SELECT count(*) AS like_count FROM gym_photo_likes WHERE photo_id=p.id) l ON TRUE
         LEFT JOIN LATERAL (SELECT weight_kg,waist_cm,body_fat_pct FROM gym_measurements
           WHERE student_id=p.user_id AND status='confirmed' ORDER BY recorded_at DESC,id DESC LIMIT 1) m ON TRUE
         WHERE p.privacy='public' AND p.moderation_status='approved' AND p.id<$2
         ORDER BY p.id DESC LIMIT $3`,
        [req.user.user_id, beforeId, limit],
      );
      res.json({ photos: result.rows.map((row) => photoResponse(row)), nextBefore: result.rows.length === limit ? result.rows.at(-1).id : null });
    } catch (error) { console.error('GET gym feed', error.message); res.status(500).json({ error: 'db' }); }
  });

  app.post('/api/gym/photos/:id/like', ...members, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_photo' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const photo = await client.query("SELECT id FROM gym_photos WHERE id=$1 AND privacy='public' AND moderation_status='approved' FOR SHARE", [id]);
      if (!photo.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'photo_not_found' }); }
      const deleted = await client.query('DELETE FROM gym_photo_likes WHERE photo_id=$1 AND user_id=$2 RETURNING photo_id', [id, req.user.user_id]);
      const liked = !deleted.rowCount;
      if (liked) await client.query('INSERT INTO gym_photo_likes (photo_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, req.user.user_id]);
      const count = await client.query('SELECT count(*)::int AS count FROM gym_photo_likes WHERE photo_id=$1', [id]);
      await client.query('COMMIT');
      res.json({ liked, likeCount: count.rows[0].count });
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('toggle photo like', error.message); res.status(500).json({ error: 'db' }); }
    finally { client.release(); }
  });

  app.get('/api/gym/photos/:id/image', ...members, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_photo' });
    try {
      const result = await pool.query('SELECT * FROM gym_photos WHERE id=$1', [id]);
      if (!result.rowCount || !await canReadPhoto(pool, result.rows[0], req.user)) return res.status(404).json({ error: 'photo_not_found' });
      const photo = result.rows[0];
      if (photo.moderation_status === 'withdrawn' || (photo.moderation_status === 'removed' && !canModeratePhotos(req.user))) return res.status(404).json({ error: 'photo_not_found' });
      const ext = MIME_EXTENSIONS[photo.mime_type];
      const filename = path.join(privateRoot, `${photo.storage_key}${ext}`);
      if (!fs.existsSync(filename)) return res.status(404).json({ error: 'photo_file_missing' });
      res.set({ 'Content-Type': photo.mime_type, 'Content-Length': String(photo.byte_size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(filename).pipe(res);
    } catch (error) { console.error('read private photo', error.message); res.status(500).json({ error: 'photo_read' }); }
  });
}

module.exports = { mountPhotoFeedRoutes, detectImageMime, parsePhotoData, canReadPhoto, photoResponse };
