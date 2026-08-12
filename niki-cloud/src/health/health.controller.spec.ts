import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/niki_cloud_test?schema=public";
process.env.DEVICE_SECRET_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const { AppModule } = require("../app.module") as typeof import("../app.module");

describe("HealthController", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns cloud health", async () => {
    await request(app.getHttpServer()).get("/healthz").expect(200, { ok: true });
  });
});
