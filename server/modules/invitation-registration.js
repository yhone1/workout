const { acceptInvitation } = require('./coach-invitations');

function registrationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function registerWithInvitation({
  pool,
  username,
  passwordHash,
  sessionToken,
  sessionExpiresAt,
  invitationToken,
  encryptionKey,
}) {
  if (!pool || typeof pool.connect !== 'function') throw registrationError('db');
  if (typeof username !== 'string' || !username.trim()
      || typeof passwordHash !== 'string' || !passwordHash
      || typeof sessionToken !== 'string' || !sessionToken
      || !sessionExpiresAt) {
    throw registrationError('invalid');
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    let userResult;
    try {
      userResult = await client.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
        [username, passwordHash],
      );
    } catch (error) {
      if (error.code === '23505') throw registrationError('exists');
      throw error;
    }
    const user = userResult.rows[0];
    if (!user) throw registrationError('db');

    const accepted = await acceptInvitation(client, {
      token: invitationToken,
      studentId: user.id,
      encryptionKey,
    });
    await client.query(
      'INSERT INTO auth_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [sessionToken, user.id, sessionExpiresAt],
    );

    await client.query('COMMIT');
    transactionStarted = false;
    return {
      token: sessionToken,
      username: user.username,
      userId: Number(user.id),
      roles: ['student'],
      relationship: accepted.relationship,
    };
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { registerWithInvitation };
