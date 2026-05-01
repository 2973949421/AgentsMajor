export const defaultSqlitePath = "data/agent-major.sqlite";

export interface SqliteConnectionUnavailable {
  readonly reason: string;
}

export type SqliteConnection = SqliteConnectionUnavailable;

export function createSqliteConnection(): SqliteConnection {
  return {
    reason: "Phase 1.1 uses createSqliteRepositories() for runtime access; Drizzle connection is reserved for later migrations."
  };
}
