/** Kleiner tabellenbasierter Drizzle-Ersatz für Unit-Tests (kein SQL: where() filtert nicht, update() trifft alle Zeilen der Tabelle). */
import { getTableName } from "drizzle-orm";

type Row = Record<string, any>;
export function createFakeDb(seed: Array<[table: object, rows: Row[]]> = [], options: { onceTables?: object[] } = {}) {
  const tables = new Map<object, Row[]>(seed.map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]));
  const served = new Set<object>();
  const insertCalls: Array<{ table: string; values: Row }> = []; const updateCalls: Array<{ table: string; values: Row }> = [];
  let nextId = 1000;
  const rows = (table: object) => { if (!tables.has(table)) tables.set(table, []); return tables.get(table)!; };
  const query = (result: Row[]) => { const q: any = { where: () => q, orderBy: () => q, leftJoin: () => q, innerJoin: () => q, limit: async (n: number) => result.slice(0, n), then: (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject) }; return q; };
  const db: any = {
    select: () => ({ from: (table: object) => { let result = rows(table); if (options.onceTables?.includes(table)) { if (served.has(table)) result = []; served.add(table); } return query(result.map((row) => ({ ...row }))); } }),
    insert: (table: object) => ({ values: (values: Row) => { const row = { id: nextId++, ...values }; rows(table).push(row); insertCalls.push({ table: getTableName(table as never), values }); const promise = Promise.resolve([{ insertId: row.id, affectedRows: 1 }]); return Object.assign(promise, { onDuplicateKeyUpdate: () => promise }); } }),
    update: (table: object) => ({ set: (values: Row) => ({ where: async () => { for (const row of rows(table)) Object.assign(row, values); updateCalls.push({ table: getTableName(table as never), values }); return []; } }) }),
    delete: (table: object) => ({ where: async () => { tables.set(table, []); return []; } }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
  };
  return { db, rows, insertCalls, updateCalls };
}
