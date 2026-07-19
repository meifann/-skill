import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/agent_signal",
  max: 20, // Neon pooler supports ~100 concurrent; we use 20 per instance
  idleTimeoutMillis: 30_000, // close idle connections after 30s
  connectionTimeoutMillis: 5_000, // fail fast if can't connect in 5s
  allowExitOnIdle: true, // allow process to exit if pool is idle
});

pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err);
});

export default pool;
