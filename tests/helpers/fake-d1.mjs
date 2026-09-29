// D1 de mentira sobre o SQLite do próprio Node, para testar o SQL de verdade.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = readFileSync(new URL('../../cloudflare/schema.sql', import.meta.url), 'utf8');

const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);
const plain = (row) => (row ? { ...row } : null);

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const statement = (sql, params = []) => ({
    bind: (...args) => statement(sql, args),
    async run() {
      const r = db.prepare(sql).run(...params.map(norm));
      return { success: true, meta: { changes: Number(r.changes) } };
    },
    async all() {
      return { results: db.prepare(sql).all(...params.map(norm)).map(plain) };
    },
    async first() {
      return plain(db.prepare(sql).get(...params.map(norm)));
    },
  });
  return {
    sqlite: db,
    prepare: (sql) => statement(sql),
    async batch(list) {
      const out = [];
      for (const s of list) out.push(await s.run());
      return out;
    },
  };
}

/** KV em memória. */
export function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}
