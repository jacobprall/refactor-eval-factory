import { Pool } from "pg";
import { createEvalStore } from "../app/eval/store/index.js";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString, max: 1 });
try {
	await createEvalStore(pool).migrate();
	console.log("evaluation database is ready");
} finally {
	await pool.end();
}
