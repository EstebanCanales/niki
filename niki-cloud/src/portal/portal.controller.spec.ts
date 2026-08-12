import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AuthService } from "../auth/auth.service";
import { requireTestDatabaseUrl } from "../auth/test-database";
import { PrismaService } from "../database/prisma.service";
import { resetTestDatabase } from "../testing/reset-test-database";

process.env.DATABASE_URL = requireTestDatabaseUrl(process.env.DATABASE_URL);
process.env.MAGIC_CODE_PEPPER = "test-magic-code-pepper";
process.env.SESSION_COOKIE_SECRET = "test-session-cookie-secret";
process.env.DEVICE_SECRET_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.CONVERSATION_ENCRYPTION_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
process.env.NIKI_CLOUD_DEV_AUTH = "1";

const { AppModule } = require("../app.module") as typeof import("../app.module");

describe("PortalController", () => {
  let app: INestApplication;
  let cookie: string;
  let prisma: PrismaService;
  let userId: string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    await resetTestDatabase(prisma);

    const auth = app.get(AuthService);
    const user = await auth.createUserForEmail("portal-route@example.com");
    const token = await auth.createSession(user);
    cookie = `niki_session=${auth.signSessionToken(token)}`;
    userId = user.id;
    await prisma.creditEntry.create({
      data: { userId, amountMicros: 1_500_000n, kind: "initial_grant" },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it.each(["/v1/dashboard", "/v1/usage", "/v1/credits"])(
    "requires an authenticated session for %s",
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(401);
    },
  );

  it("returns dashboard, UTC usage, and immutable credit ledger views", async () => {
    const dashboard = await request(app.getHttpServer())
      .get("/v1/dashboard")
      .set("Cookie", cookie)
      .expect(200);
    expect(dashboard.body).toMatchObject({ balanceMicros: "1500000" });

    const usage = await request(app.getHttpServer())
      .get("/v1/usage?period=day")
      .set("Cookie", cookie)
      .expect(200);
    expect(usage.body).toMatchObject({ period: "day", totalQuantity: "0" });

    const credits = await request(app.getHttpServer())
      .get("/v1/credits")
      .set("Cookie", cookie)
      .expect(200);
    expect(credits.body).toMatchObject({
      balanceMicros: "1500000",
      entries: [{ amountMicros: "1500000", kind: "initial_grant" }],
    });
  });

  it("rejects an unsupported usage period", async () => {
    await request(app.getHttpServer())
      .get("/v1/usage?period=year")
      .set("Cookie", cookie)
      .expect(400);
  });
});
