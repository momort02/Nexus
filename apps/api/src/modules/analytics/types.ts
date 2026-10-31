export interface AnalyticsPoint {
  date: string;
  messageCount: number;
  joins: number;
  leaves: number;
  activeMembers: number;
}

export interface AnalyticsTotals {
  messageCount: number;
  joins: number;
  leaves: number;
  activeMemberDays: number;
  uniqueActiveMembers: number;
}

export interface AnalyticsSummary {
  timezone: string;
  from: string;
  to: string;
  observedFrom: string | null;
  series: AnalyticsPoint[];
  totals: AnalyticsTotals;
  active: {
    dau: number;
    wau: number;
    mau: number;
  };
}

export interface AnalyticsChannel {
  channelId: string;
  messageCount: number;
}

export interface AnalyticsRepository {
  getTimezone(guildId: string): Promise<string | null>;
  updateTimezone(guildId: string, timezone: string): Promise<boolean>;
  getSummary(input: {
    guildId: string;
    from: string;
    to: string;
    timezone: string;
    startAt: Date;
    endAt: Date;
  }): Promise<AnalyticsSummary>;
  countUniqueActiveMembers(input: {
    guildId: string;
    from: Date;
    to: Date;
  }): Promise<number>;
  listChannels(input: {
    guildId: string;
    from: Date;
    to: Date;
    page: number;
    pageSize: number;
    channelId?: string;
  }): Promise<{ channels: AnalyticsChannel[]; total: number }>;
}
