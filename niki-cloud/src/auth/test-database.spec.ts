import { requireTestDatabaseUrl } from "./test-database";

describe("requireTestDatabaseUrl", () => {
  it("fails closed when DATABASE_URL is absent", () => {
    expect(() => requireTestDatabaseUrl(undefined)).toThrow(
      "DATABASE_URL must be explicitly set for auth integration tests",
    );
  });

  it("fails closed for a database whose name is not explicitly for tests", () => {
    expect(() => requireTestDatabaseUrl("postgresql://localhost/niki_cloud?schema=public")).toThrow(
      "DATABASE_URL must name a clearly designated test database",
    );
  });

  it("fails closed for a non-PostgreSQL URL", () => {
    expect(() => requireTestDatabaseUrl("https://localhost/niki_cloud_test")).toThrow(
      "DATABASE_URL must be a PostgreSQL URL for auth integration tests",
    );
  });

  it("accepts an explicitly named test database", () => {
    expect(requireTestDatabaseUrl("postgresql://localhost/niki_cloud_test?schema=public")).toBe(
      "postgresql://localhost/niki_cloud_test?schema=public",
    );
  });
});
