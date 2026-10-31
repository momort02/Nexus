export interface AuthUser {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  owner: boolean;
  permissions: string;
  icon: string | null;
}

export interface AuthSession {
  id: string;
  userId: string;
  user: AuthUser;
  encryptedAccessToken: string | null;
  accessTokenExpiresAt: Date | null;
  expiresAt: Date;
  selectedGuildId: string | null;
}

export interface GuildMembership {
  id: string;
  name: string;
  role: string;
}

export interface AuthRepository {
  upsertUser(user: Omit<AuthUser, 'id'>): Promise<AuthUser>;
  createSession(session: {
    id: string;
    userId: string;
    encryptedAccessToken: string;
    accessTokenExpiresAt: Date;
    expiresAt: Date;
  }): Promise<void>;
  findSession(id: string): Promise<AuthSession | null>;
  deleteSession(id: string): Promise<void>;
  clearAccessToken(id: string): Promise<void>;
  listMemberships(userId: string): Promise<GuildMembership[]>;
  getMembership(
    userId: string,
    guildId: string,
  ): Promise<GuildMembership | null>;
  createOrSelectGuild(
    userId: string,
    guild: Pick<DiscordGuild, 'id' | 'name'>,
    sessionId: string,
  ): Promise<'created' | 'selected' | 'not-authorized'>;
}

export interface DiscordClient {
  exchangeCode(code: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }>;
  getUser(accessToken: string): Promise<{
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
  }>;
  getGuilds(accessToken: string): Promise<DiscordGuild[]>;
}
