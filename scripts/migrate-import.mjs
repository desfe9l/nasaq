#!/usr/bin/env node
/**
 * One-way, non-destructive PostgreSQL import for the NASAQ cutover.
 *
 * Required environment:
 *   SOURCE_DATABASE_URL             old provider, read-only in practice
 *   NASAQ_PRIMARY_DATABASE_URL      independent target resource
 *
 * The target schema is migrated first. The target must be empty (apart from
 * _migrations); this prevents an accidental merge from silently overwriting or
 * duplicating production data. Rows are copied with their original values,
 * identifiers and timestamps, in foreign-key order, and every table is checked
 * by count plus a deterministic SHA-256 digest before the command succeeds.
 */
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const sourceUrl = process.env.SOURCE_DATABASE_URL?.trim();
const targetUrl = process.env.NASAQ_PRIMARY_DATABASE_URL?.trim();
if (!sourceUrl || !targetUrl) {
  throw new Error("SOURCE_DATABASE_URL and NASAQ_PRIMARY_DATABASE_URL are both required");
}

function identity(value) {
  const url = new URL(value);
  return `${url.hostname}:${url.port || "5432"}/${url.pathname}`;
}
if (identity(sourceUrl) === identity(targetUrl)) {
  throw new Error("SOURCE_DATABASE_URL and NASAQ_PRIMARY_DATABASE_URL resolve to the same resource; refusing to self-import");
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(rows) {
  const hash = crypto.createHash("sha256");
  for (const row of rows) hash.update(JSON.stringify(canonical(row)) + "\n");
  return hash.digest("hex");
}

async function tables(client) {
  const result = await client.query(`
    select c.relname as name,
           coalesce((select array_agg(a.attname order by a.attnum)
                     from pg_attribute a
                     where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '{}') as columns,
           coalesce((select array_agg(kcu.column_name order by kcu.ordinal_position)
                     from information_schema.table_constraints tc
                     join information_schema.key_column_usage kcu
                       on kcu.constraint_name = tc.constraint_name
                      and kcu.table_schema = tc.table_schema
                     where tc.table_schema = n.nspname and tc.table_name = c.relname
                       and tc.constraint_type = 'PRIMARY KEY'), '{}') as primary_columns
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> '_migrations'
      and c.relnamespace = n.oid
    order by c.relname
  `);
  return result.rows.map((row) => ({
    name: row.name,
    columns: row.columns,
    primaryColumns: row.primary_columns,
  }));
}

async function dependencyOrder(client, tableList) {
  const names = new Set(tableList.map((table) => table.name));
  const result = await client.query(`
    select child.relname as child, parent.relname as parent
    from pg_constraint fk
    join pg_class child on child.oid = fk.conrelid
    join pg_class parent on parent.oid = fk.confrelid
    join pg_namespace ns on ns.oid = child.relnamespace
    where fk.contype = 'f' and ns.nspname = 'public'
  `);
  const deps = new Map([...names].map((name) => [name, new Set()]));
  for (const row of result.rows) {
    if (names.has(row.child) && names.has(row.parent) && row.child !== row.parent) deps.get(row.child).add(row.parent);
  }
  const ordered = [];
  while (deps.size) {
    const ready = [...deps].filter(([, parents]) => parents.size === 0).map(([name]) => name).sort();
    if (!ready.length) throw new Error("Foreign-key dependency cycle detected; refusing partial import");
    for (const name of ready) {
      ordered.push(tableList.find((table) => table.name === name));
      deps.delete(name);
      for (const parents of deps.values()) parents.delete(name);
    }
  }
  return ordered;
}

async function migrateTarget() {
  const result = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "migrate.mjs")], {
    env: { ...process.env, NASAQ_PRIMARY_DATABASE_URL: targetUrl, VERCEL_ENV: "" },
    encoding: "utf8",
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) throw new Error(`target schema migration failed with exit code ${result.status}`);
}

async function main() {
  await migrateTarget();
  const source = new pg.Client({ connectionString: sourceUrl });
  const target = new pg.Client({ connectionString: targetUrl });
  await source.connect();
  await target.connect();
  try {
    const sourceTables = await tables(source);
    const targetTables = await tables(target);
    const targetNames = new Set(targetTables.map((table) => table.name));
    for (const table of sourceTables) {
      if (!targetNames.has(table.name)) throw new Error(`target schema is missing table ${table.name}`);
      const count = Number((await target.query(`select count(*)::int as n from ${quoteIdent(table.name)}`)).rows[0].n);
      if (count !== 0) throw new Error(`target table ${table.name} is not empty; import is non-destructive and will not merge data`);
    }

    const order = await dependencyOrder(target, sourceTables);
    const report = [];
    for (const table of order) {
      const select = `select ${table.columns.map(quoteIdent).join(", ")} from ${quoteIdent(table.name)}${table.primaryColumns.length ? ` order by ${table.primaryColumns.map(quoteIdent).join(", ")}` : ""}`;
      const rows = (await source.query(select)).rows;
      await target.query("BEGIN");
      try {
        for (let offset = 0; offset < rows.length; offset += 100) {
          for (const row of rows.slice(offset, offset + 100)) {
            const placeholders = table.columns.map((_, index) => `$${index + 1}`).join(", ");
            await target.query(`insert into ${quoteIdent(table.name)} (${table.columns.map(quoteIdent).join(", ")}) values (${placeholders})`, table.columns.map((column) => row[column]));
          }
        }
        await target.query("COMMIT");
      } catch (error) {
        await target.query("ROLLBACK");
        throw new Error(`import failed for ${table.name}: ${error.message}`);
      }
      const copied = (await target.query(select)).rows;
      const sourceDigest = digest(rows);
      const targetDigest = digest(copied);
      if (rows.length !== copied.length || sourceDigest !== targetDigest) {
        throw new Error(`verification failed for ${table.name}: source=${rows.length}/${sourceDigest} target=${copied.length}/${targetDigest}`);
      }
      report.push({ table: table.name, rows: rows.length, sha256: sourceDigest });
      console.log(`[import] verified ${table.name}: ${rows.length} row(s), ${sourceDigest}`);
    }
    console.log(JSON.stringify({ ok: true, source: identity(sourceUrl), target: identity(targetUrl), tables: report }, null, 2));
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error(`[import] FAILED: ${error.message}`);
  process.exitCode = 1;
});
