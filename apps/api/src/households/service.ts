import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { currencyMetadata, type MoneyCurrencyCode } from '@rttw/domain';
import type { PublicUser } from '../auth/repository.js';
import { createToken, hashToken } from '../auth/tokens.js';

export type WebHousehold = { id: string; name: string; baseCurrency: MoneyCurrencyCode; memberId: string; role: 'owner' | 'member' };
export type WebMember = { id: string; userId: string; displayName: string; email: string; role: 'owner' | 'member' };
export class HouseholdError extends Error {
  constructor(readonly code: 'household_forbidden' | 'owner_required' | 'invalid_invitation' | 'already_member' | 'invalid_request', readonly statusCode: number) { super(code); }
}
type Queryable = Pick<PoolClient, 'query'>;
type HouseholdRow = { id: string; name: string; base_currency_code: MoneyCurrencyCode; member_id: string; role: 'owner' | 'member' };

async function listHouseholds(database: Queryable, userId: string, personal = false): Promise<WebHousehold[]> {
  const result = await database.query<HouseholdRow>(`
    SELECT h.id, h.name, h.base_currency_code, m.id AS member_id, m.role
    FROM household_members m JOIN households h ON h.id = m.household_id
    WHERE m.user_id = $1 AND m.membership_status = 'active' AND m.deleted_at IS NULL AND h.deleted_at IS NULL
      AND CASE WHEN $2 THEN h.personal_owner_user_id = $1 ELSE h.personal_owner_user_id IS NULL END
    ORDER BY h.created_at, h.id
  `, [userId, personal]);
  return result.rows.map((row) => ({ id: row.id, name: row.name, baseCurrency: row.base_currency_code, memberId: row.member_id, role: row.role }));
}

async function authorize(database: Queryable, userId: string, householdId: string, owner = false) {
  const result = await database.query<{ id: string; role: string; personal_owner_user_id: string | null }>(`
    SELECT m.id, m.role, h.personal_owner_user_id FROM household_members m JOIN households h ON h.id = m.household_id
    WHERE m.household_id = $1 AND m.user_id = $2 AND m.membership_status = 'active'
      AND m.deleted_at IS NULL AND h.deleted_at IS NULL
      AND (h.personal_owner_user_id IS NULL OR h.personal_owner_user_id = $2)
    FOR SHARE OF m, h
  `, [householdId, userId]);
  const member = result.rows[0];
  if (!member) throw new HouseholdError('household_forbidden', 403);
  if (owner && member.role !== 'owner') throw new HouseholdError('owner_required', 403);
  return member;
}

async function insertHousehold(database: Queryable, user: PublicUser, input: { name: string; baseCurrency: MoneyCurrencyCode }, personal = false): Promise<WebHousehold> {
  const id = randomUUID();
  const memberId = randomUUID();
  await database.query(`INSERT INTO households (id, name, base_currency_code, created_by_user_id, updated_by_user_id, personal_owner_user_id)
    VALUES ($1, $2, $3, $4, $4, $5)`, [id, input.name, input.baseCurrency, user.id, personal ? user.id : null]);
  await database.query(`INSERT INTO household_members
    (id, household_id, user_id, display_name, role, membership_status, created_by_user_id, updated_by_user_id)
    VALUES ($1, $2, $3, $4, 'owner', 'active', $3, $3)`, [memberId, id, user.id, user.email.split('@')[0]?.slice(0, 120) || 'Member']);
  return { id, name: input.name, baseCurrency: input.baseCurrency, memberId, role: 'owner' };
}

export class HouseholdService {
  constructor(private readonly database: Pool) {}

  async list(userId: string) { return listHouseholds(this.database, userId); }

  async ensurePersonal(user: PublicUser): Promise<WebHousehold> {
    return this.transaction(async (client) => {
      // Serializes personal-ledger creation across simultaneous tabs/devices.
      await client.query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [user.id]);
      const [existing] = await listHouseholds(client, user.id, true);
      if (existing) return existing;
      return insertHousehold(client, user, { name: 'Personal', baseCurrency: 'USD' }, true);
    });
  }

  async create(user: PublicUser, input: { name: string; baseCurrency: MoneyCurrencyCode }): Promise<WebHousehold> {
    if (!input.name.trim() || input.name.length > 120 || !Object.hasOwn(currencyMetadata, input.baseCurrency)) throw new HouseholdError('invalid_request', 400);
    return this.transaction((client) => insertHousehold(client, user, { ...input, name: input.name.trim() }));
  }

  async settings(user: PublicUser, householdId: string, input: { name: string; baseCurrency: MoneyCurrencyCode }): Promise<WebHousehold> {
    if (!input.name.trim() || input.name.length > 120 || !Object.hasOwn(currencyMetadata, input.baseCurrency)) throw new HouseholdError('invalid_request', 400);
    return this.transaction(async (client) => {
      const member = await authorize(client, user.id, householdId, true);
      // A reporting-currency preference never rewrites historical ledger/FX data.
      await client.query(`UPDATE households SET name = $3, base_currency_code = $4,
        updated_by_user_id = $2, updated_at = now(), revision = revision + 1
        WHERE id = $1 AND deleted_at IS NULL`, [householdId, user.id, input.name.trim(), input.baseCurrency]);
      const household = (await listHouseholds(client, user.id, member.personal_owner_user_id !== null)).find((entry) => entry.id === householdId);
      if (!household) throw new HouseholdError('household_forbidden', 403);
      return household;
    });
  }

  async members(userId: string, householdId: string): Promise<WebMember[]> {
    return this.transaction(async (client) => {
      const member = await authorize(client, userId, householdId);
      if (member.personal_owner_user_id) throw new HouseholdError('household_forbidden', 403);
      const result = await client.query<{ id: string; user_id: string; display_name: string; email: string; role: 'owner' | 'member' }>(`
        SELECT m.id, m.user_id, m.display_name, u.email, m.role
        FROM household_members m JOIN users u ON u.id = m.user_id
        WHERE m.household_id = $1 AND m.membership_status = 'active' AND m.deleted_at IS NULL AND u.deleted_at IS NULL
        ORDER BY m.created_at, m.id
      `, [householdId]);
      return result.rows.map((row) => ({ id: row.id, userId: row.user_id, displayName: row.display_name, email: row.email, role: row.role }));
    });
  }

  async invite(user: PublicUser, householdId: string, email: string) {
    return this.transaction(async (client) => {
      const member = await authorize(client, user.id, householdId, true);
      if (member.personal_owner_user_id) throw new HouseholdError('household_forbidden', 403);
      const normalized = email.trim().toLowerCase();
      const existing = await client.query(`SELECT m.id FROM household_members m JOIN users u ON u.id = m.user_id
        WHERE m.household_id = $1 AND u.email = $2 AND m.membership_status = 'active' AND m.deleted_at IS NULL`, [householdId, normalized]);
      if (existing.rows.length) throw new HouseholdError('already_member', 409);
      const token = createToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
      await client.query(`INSERT INTO household_invitations (id, household_id, email, token_hash, invited_by_user_id, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)`, [randomUUID(), householdId, normalized, hashToken(token), user.id, expiresAt]);
      return { token, email: normalized, expiresAt };
    });
  }

  async accept(user: PublicUser, token: string): Promise<WebHousehold> {
    return this.transaction(async (client) => {
      const invitation = await client.query<{ id: string; household_id: string }>(`
        SELECT i.id, i.household_id FROM household_invitations i
        JOIN households h ON h.id = i.household_id AND h.deleted_at IS NULL AND h.personal_owner_user_id IS NULL
        JOIN household_members owner ON owner.household_id = h.id AND owner.user_id = i.invited_by_user_id
          AND owner.role = 'owner' AND owner.membership_status = 'active' AND owner.deleted_at IS NULL
        WHERE i.token_hash = $1 AND i.email = $2 AND i.accepted_at IS NULL AND i.expires_at > now()
        FOR UPDATE OF i
      `, [hashToken(token), user.email]);
      const row = invitation.rows[0];
      if (!row) throw new HouseholdError('invalid_invitation', 404);
      await client.query(`INSERT INTO household_members
        (id, household_id, user_id, display_name, role, membership_status, created_by_user_id, updated_by_user_id)
        VALUES ($1, $2, $3, $4, 'member', 'active', $3, $3)
        ON CONFLICT (household_id, user_id) DO UPDATE SET membership_status = 'active', deleted_at = NULL,
          updated_by_user_id = $3, updated_at = now(), revision = household_members.revision + 1`,
      [randomUUID(), row.household_id, user.id, user.email.split('@')[0]?.slice(0, 120) || 'Member']);
      await client.query('UPDATE household_invitations SET accepted_at = now(), accepted_by_user_id = $2 WHERE id = $1 AND email = $3', [row.id, user.id, user.email]);
      const households = await listHouseholds(client, user.id);
      const household = households.find((entry) => entry.id === row.household_id);
      if (!household) throw new HouseholdError('household_forbidden', 403);
      return household;
    });
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
