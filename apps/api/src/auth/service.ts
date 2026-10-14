import { randomUUID } from 'node:crypto';
import type { PasswordHasher } from './password.js';
import { createToken, hashToken } from './tokens.js';
import { AuthRepository, type AuthenticatedSession, type AuthUserRecord, type NewSession, type PublicUser } from './repository.js';

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1_000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export type AuthErrorCode = 'email_in_use' | 'invalid_credentials' | 'invalid_session' | 'session_not_found';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
  }
}

type IssuedSession = {
  record: NewSession;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};

export type AuthResult = {
  user: PublicUser;
  session: Omit<IssuedSession, 'record'> & { sessionId: string };
};

function issueSession(userId: string, deviceName?: string): IssuedSession {
  const accessToken = createToken();
  const refreshToken = createToken();
  const now = Date.now();
  const accessExpiresAt = new Date(now + ACCESS_TOKEN_TTL_MS);
  const refreshExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS);
  return {
    record: {
      id: randomUUID(),
      userId,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
      ...(deviceName ? { deviceName } : {}),
    },
    accessToken,
    refreshToken,
    accessTokenExpiresAt: accessExpiresAt.toISOString(),
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export class AuthService {
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {
    this.dummyHash = passwordHasher.hash(`dummy-${randomUUID()}`);
  }

  async register(email: string, password: string, deviceName?: string): Promise<AuthResult> {
    const user: AuthUserRecord = {
      id: randomUUID(),
      email,
      passwordHash: await this.passwordHasher.hash(password),
    };
    const issued = issueSession(user.id, deviceName);
    try {
      await this.repository.createUserWithSession(user, issued.record);
    } catch (error) {
      if (isUniqueViolation(error)) throw new AuthError('email_in_use');
      throw error;
    }
    return {
      user: { id: user.id, email: user.email },
      session: this.publicSession(issued),
    };
  }

  async login(email: string, password: string, deviceName?: string): Promise<AuthResult> {
    const user = await this.repository.findUserByEmail(email);
    const hash = user?.passwordHash ?? await this.dummyHash;
    if (!(await this.passwordHasher.verify(password, hash)) || !user) {
      throw new AuthError('invalid_credentials');
    }
    const issued = issueSession(user.id, deviceName);
    await this.repository.createSession(issued.record);
    return { user: { id: user.id, email: user.email }, session: this.publicSession(issued) };
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const issued = issueSession('00000000-0000-0000-0000-000000000000');
    const user = await this.repository.rotateSession(hashToken(refreshToken), issued.record);
    if (!user) throw new AuthError('invalid_session');
    return { user, session: this.publicSession(issued) };
  }

  async authenticate(accessToken: string): Promise<PublicUser> {
    const session = await this.authenticateSession(accessToken);
    return { id: session.id, email: session.email };
  }

  async authenticateSession(accessToken: string): Promise<AuthenticatedSession> {
    const session = await this.repository.findSessionByAccessTokenHash(hashToken(accessToken));
    if (!session) throw new AuthError('invalid_session');
    return session;
  }

  async logout(accessToken: string): Promise<void> {
    if (!(await this.repository.revokeByAccessTokenHash(hashToken(accessToken)))) {
      throw new AuthError('invalid_session');
    }
  }

  async logoutRefresh(refreshToken: string): Promise<void> {
    await this.repository.revokeByRefreshTokenHash(hashToken(refreshToken));
  }

  async listSessions(accessToken: string) {
    const accessTokenHash = hashToken(accessToken);
    const current = await this.repository.findSessionByAccessTokenHash(accessTokenHash);
    if (!current) throw new AuthError('invalid_session');
    const sessions = await this.repository.listActiveSessions(current.id, accessTokenHash);
    return sessions.map((session) => ({
      id: session.id,
      deviceName: session.deviceName,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
      accessTokenExpiresAt: session.accessExpiresAt.toISOString(),
      refreshTokenExpiresAt: session.refreshExpiresAt.toISOString(),
      current: session.current,
    }));
  }

  async revokeSession(accessToken: string, sessionId: string): Promise<void> {
    const current = await this.repository.findSessionByAccessTokenHash(hashToken(accessToken));
    if (!current) throw new AuthError('invalid_session');
    if (!(await this.repository.revokeSession(current.id, sessionId))) {
      throw new AuthError('session_not_found');
    }
  }

  private publicSession(issued: IssuedSession): Omit<IssuedSession, 'record'> & { sessionId: string } {
    return {
      sessionId: issued.record.id,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      accessTokenExpiresAt: issued.accessTokenExpiresAt,
      refreshTokenExpiresAt: issued.refreshTokenExpiresAt,
    };
  }
}
