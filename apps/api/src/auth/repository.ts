import type { Pool, PoolClient } from 'pg';

export type AuthUserRecord = {
  id: string;
  email: string;
  passwordHash: string;
};

export type PublicUser = Pick<AuthUserRecord, 'id' | 'email'>;

export type NewSession = {
  id: string;
  userId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  deviceName?: string;
  rotatedFromSessionId?: string;
};

export type AuthenticatedSession = PublicUser & {
  sessionId: string;
};

export type ActiveSession = {
  id: string;
  deviceName: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  current: boolean;
};

type Queryable = Pick<PoolClient, 'query'>;

async function insertSession(database: Queryable, session: NewSession) {
  await database.query(`
    INSERT INTO auth_sessions (
      id, user_id, device_name, access_token_hash, refresh_token_hash,
      access_expires_at, refresh_expires_at, rotated_from_session_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [
    session.id,
    session.userId,
    session.deviceName ?? null,
    session.accessTokenHash,
    session.refreshTokenHash,
    session.accessExpiresAt,
    session.refreshExpiresAt,
    session.rotatedFromSessionId ?? null,
  ]);
}

export class AuthRepository {
  constructor(private readonly database: Pool) {}

  async findUserByEmail(email: string): Promise<AuthUserRecord | undefined> {
    const result = await this.database.query<{ id: string; email: string; password_hash: string }>(`
      SELECT id, email, password_hash
      FROM users
      WHERE email = $1 AND deleted_at IS NULL
    `, [email]);
    const row = result.rows[0];
    return row ? { id: row.id, email: row.email, passwordHash: row.password_hash } : undefined;
  }

  async createUserWithSession(user: AuthUserRecord, session: NewSession): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [
        user.id,
        user.email,
        user.passwordHash,
      ]);
      await insertSession(client, session);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createSession(session: NewSession): Promise<void> {
    await insertSession(this.database, session);
  }

  async findSessionByAccessTokenHash(accessTokenHash: string): Promise<AuthenticatedSession | undefined> {
    const result = await this.database.query<{ id: string; email: string; session_id: string }>(`
      SELECT users.id, users.email, auth_sessions.id AS session_id
      FROM auth_sessions
      JOIN users ON users.id = auth_sessions.user_id
      WHERE auth_sessions.access_token_hash = $1
        AND auth_sessions.revoked_at IS NULL
        AND auth_sessions.access_expires_at > now()
        AND users.deleted_at IS NULL
    `, [accessTokenHash]);
    const row = result.rows[0];
    return row ? { id: row.id, email: row.email, sessionId: row.session_id } : undefined;
  }

  async rotateSession(refreshTokenHash: string, replacement: NewSession): Promise<PublicUser | undefined> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<PublicUser & { session_id: string; device_name: string | null }>(`
        SELECT users.id, users.email, auth_sessions.id AS session_id, auth_sessions.device_name
        FROM auth_sessions
        JOIN users ON users.id = auth_sessions.user_id
        WHERE auth_sessions.refresh_token_hash = $1
          AND auth_sessions.revoked_at IS NULL
          AND auth_sessions.refresh_expires_at > now()
          AND users.deleted_at IS NULL
        FOR UPDATE OF auth_sessions
      `, [refreshTokenHash]);
      const row = result.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return undefined;
      }

      replacement.userId = row.id;
      if (row.device_name) replacement.deviceName = row.device_name;
      replacement.rotatedFromSessionId = row.session_id;
      await client.query('UPDATE auth_sessions SET revoked_at = now(), last_used_at = now() WHERE id = $1', [row.session_id]);
      await insertSession(client, replacement);
      await client.query('COMMIT');
      return { id: row.id, email: row.email };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeByAccessTokenHash(accessTokenHash: string): Promise<boolean> {
    const result = await this.database.query(`
      UPDATE auth_sessions
      SET revoked_at = now(), last_used_at = now()
      WHERE access_token_hash = $1
        AND revoked_at IS NULL
        AND access_expires_at > now()
    `, [accessTokenHash]);
    return (result.rowCount ?? 0) > 0;
  }

  async revokeByRefreshTokenHash(refreshTokenHash: string): Promise<void> {
    await this.database.query(`UPDATE auth_sessions SET revoked_at = now(), last_used_at = now()
      WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND refresh_expires_at > now()`, [refreshTokenHash]);
  }

  async listActiveSessions(userId: string, currentAccessTokenHash: string): Promise<ActiveSession[]> {
    const result = await this.database.query<{
      id: string;
      device_name: string | null;
      created_at: Date;
      last_used_at: Date | null;
      access_expires_at: Date;
      refresh_expires_at: Date;
      current: boolean;
    }>(`
      SELECT id, device_name, created_at, last_used_at, access_expires_at, refresh_expires_at,
        access_token_hash = $2 AS current
      FROM auth_sessions
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND refresh_expires_at > now()
      ORDER BY created_at DESC, id
    `, [userId, currentAccessTokenHash]);
    return result.rows.map((row) => ({
      id: row.id,
      deviceName: row.device_name,
      createdAt: new Date(row.created_at),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
      accessExpiresAt: new Date(row.access_expires_at),
      refreshExpiresAt: new Date(row.refresh_expires_at),
      current: row.current,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.database.query(`
      UPDATE auth_sessions
      SET revoked_at = now(), last_used_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
    `, [sessionId, userId]);
    return (result.rowCount ?? 0) > 0;
  }
}
