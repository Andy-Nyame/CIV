import "dotenv/config";

import { defineConfig } from "prisma/config";

// Prisma CLI operations use Neon's direct endpoint. The runtime application
// connection is configured separately through DATABASE_URL in src/lib/db.ts.
const directUrl =
  process.env.DIRECT_URL ??
  "postgresql://USER:PASSWORD@DIRECT_HOST:5432/civ?sslmode=require";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node --import tsx prisma/seed.ts",
  },
  datasource: {
    url: directUrl,
  },
});
