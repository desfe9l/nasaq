import { createAdapterFactory } from "better-auth/adapters";
import type { BetterAuthOptions } from "better-auth";
import { getObjectStorage } from "@/lib/storage/r2.server";

const STATE_KEY = "_nasaq-auth/state-v1.json";

type Row = Record<string, unknown>;
type State = { tables: Record<string, Row[]>; counters: Record<string, number> };

export interface AuthStore {
  read(): Promise<State>;
  write(state: State): Promise<void>;
}

function emptyState(): State { return { tables: {}, counters: {} }; }

export function createR2AuthStore(): AuthStore {
  const provider = getObjectStorage();
  if (!provider) throw new Error("AUTH_STORAGE_NOT_CONFIGURED");
  let chain = Promise.resolve();
  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.then(() => undefined, () => undefined);
    return next;
  };
  return {
    read: () => locked(async () => {
      const bytes = await provider.get(STATE_KEY);
      if (!bytes) return emptyState();
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as State;
        return { tables: parsed.tables ?? {}, counters: parsed.counters ?? {} };
      } catch { throw new Error("AUTH_STORAGE_CORRUPT"); }
    }),
    write: (state) => locked(async () => {
      await provider.put(STATE_KEY, new TextEncoder().encode(JSON.stringify(state)), "application/json");
    }),
  };
}

function compare(actual: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case "eq": return actual === expected;
    case "ne": return actual !== expected;
    case "in": return Array.isArray(expected) && expected.includes(actual);
    case "not_in": return Array.isArray(expected) && !expected.includes(actual);
    case "contains": return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    case "starts_with": return typeof actual === "string" && typeof expected === "string" && actual.startsWith(expected);
    case "gt": return Number(actual) > Number(expected);
    case "gte": return Number(actual) >= Number(expected);
    case "lt": return Number(actual) < Number(expected);
    case "lte": return Number(actual) <= Number(expected);
    default: return actual === expected;
  }
}

function matches(row: Row, where?: Array<{ field: string; operator?: string; value: unknown }>): boolean {
  return !where?.length || where.every((clause) => compare(row[clause.field], clause.operator ?? "eq", clause.value));
}

function selectRow<T extends Row>(row: T, select?: string[]): T {
  if (!select?.length) return { ...row } as T;
  return Object.fromEntries(select.filter((key) => key in row).map((key) => [key, row[key]])) as T;
}

export function createR2AuthAdapter(): ReturnType<typeof createAdapterFactory<BetterAuthOptions>> {
  const store = createR2AuthStore();
  const custom = ({ getModelName, getFieldName }: any): any => ({
    async create<T extends Row>(input: any) {
      const { model, data, select } = input;
      const state = await store.read();
      const table = getModelName(model);
      const row = { ...data };
      state.tables[table] ??= [];
      state.tables[table].push(row);
      await store.write(state);
      return selectRow(row, select) as T;
    },
    async update<T>(input: any) {
      const { model, where, update } = input;
      const state = await store.read();
      const table = getModelName(model); const rows = state.tables[table] ?? [];
      const row = rows.find((item) => matches(item, where.map((w: any) => ({ field: getFieldName({ model, field: w.field }), operator: w.operator, value: w.value }))));
      if (!row) return null;
      Object.assign(row, update); await store.write(state); return row as T;
    },
    async updateMany(input: any) {
      const { model, where, update } = input;
      const state = await store.read(); const table = getModelName(model); const rows = state.tables[table] ?? [];
      let count = 0;
      for (const row of rows) if (matches(row, where.map((w: any) => ({ field: getFieldName({ model, field: w.field }), operator: w.operator, value: w.value })))) { Object.assign(row, update); count++; }
      if (count) await store.write(state); return count;
    },
    async findOne<T extends Row>(input: any) {
      const { model, where, select } = input;
      const state = await store.read(); const table = getModelName(model);
      const row = (state.tables[table] ?? []).find((item) => matches(item, where.map((w: any) => ({ field: getFieldName({ model, field: w.field }), operator: w.operator, value: w.value }))));
      return row ? selectRow(row, select) as T : null;
    },
    async findMany<T extends Row>(input: any) {
      const { model, where, limit, offset, select, sortBy } = input;
      const state = await store.read(); const table = getModelName(model);
      let rows = (state.tables[table] ?? []).filter((item) => matches(item, (where ?? []).map((w: any) => ({ field: getFieldName({ model, field: w.field }), operator: w.operator, value: w.value }))));
      if (sortBy) rows = rows.sort((a, b) => String(a[sortBy.field] ?? "").localeCompare(String(b[sortBy.field] ?? "")) * (sortBy.direction === "desc" ? -1 : 1));
      return rows.slice(offset ?? 0, (offset ?? 0) + limit).map((row) => selectRow(row, select) as T);
    },
    async delete(input: any) {
      const { model, where } = input;
      const state = await store.read(); const table = getModelName(model); const rows = state.tables[table] ?? [];
      state.tables[table] = rows.filter((item) => !matches(item, where.map((w: any) => ({ field: getFieldName({ model, field: w.field }), operator: w.operator, value: w.value })))); await store.write(state);
    },
    async deleteMany(input: any) {
      const { model, where } = input;
      const state = await store.read(); const table = getModelName(model); const rows = state.tables[table] ?? [];
      const kept = rows.filter((item) => !matches(item, where.map((w: any) => ({ field: getFieldName({ model, field: w.field }), operator: w.operator, value: w.value }))));
      const count = rows.length - kept.length; state.tables[table] = kept; if (count) await store.write(state); return count;
    },
    async count(input: any) {
      const { model, where } = input;
      const state = await store.read(); const table = getModelName(model);
      return (state.tables[table] ?? []).filter((item) => matches(item, (where ?? []).map((w: any) => ({ field: getFieldName({ model, field: w.field }), operator: w.operator, value: w.value })))).length;
    },
  });
  return createAdapterFactory({ adapter: custom, config: { adapterId: "nasaq-r2-auth", adapterName: "nasaq-r2-auth", supportsDates: true, supportsJSON: true, supportsBooleans: true, supportsArrays: true, supportsNumericIds: false, transaction: false } });
}
