import { config } from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

try {
  // Local dev convenience only — throws on runtimes without process.cwd()
  // (edge); there the platform injects env vars instead.
  config({ path: ".env.local" });
} catch {
  // ignore: env comes from the platform
}

const sql = neon(process.env.DATABASE_URL!);

export const db = drizzle({ client: sql, schema });
