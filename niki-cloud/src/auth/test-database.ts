const TEST_DATABASE_NAME = /(^|[_-])(test|testing|spec)([_-]|$)/i;

export function requireTestDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be explicitly set for auth integration tests");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL for auth integration tests");
  }

  if (parsedUrl.protocol !== "postgresql:" && parsedUrl.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must be a PostgreSQL URL for auth integration tests");
  }

  const databaseName = decodeURIComponent(parsedUrl.pathname).replace(/^\//, "");
  if (!TEST_DATABASE_NAME.test(databaseName)) {
    throw new Error("DATABASE_URL must name a clearly designated test database");
  }

  return databaseUrl;
}
