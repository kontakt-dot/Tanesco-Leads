/** Datenbank-Migrationen beim Start ausführen (ohne drizzle-kit zur Laufzeit): node dist/migrate.js */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ist nicht gesetzt.");
  const connection = await mysql.createConnection({ uri: url, multipleStatements: true });
  const db = drizzle(connection);
  await migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR ?? "drizzle" });
  await connection.end();
  console.log("[Migration] Datenbank ist auf dem aktuellen Stand.");
}

main().catch((error) => { console.error("[Migration] fehlgeschlagen:", error); process.exit(1); });
