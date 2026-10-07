/**
 * AuthStore over a local directory — development and tests only.
 *
 * A deployed Vercel function has no writable, durable filesystem, so this
 * backend is refused whenever the runtime is a deployment (`VERCEL=1` or
 * `NASAQ_STRICT_ENV=1`); `./index.server.ts` enforces that, and the store also
 * reports itself as non-durable so the environment report can say so out loud.
 *
 * It exists because local sign-up/sign-in must exercise the REAL hashing, REAL
 * session rows and REAL revocation — a memory stub would let a broken auth flow
 * pass its own tests. Writes are atomic (temp file + rename) and creates are
 * exclusive (`wx`), so a duplicate address is refused by the filesystem itself
 * rather than by a check-then-write race.
 */
import { constants } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DuplicateEmailError,
  type AuthStore,
  type NewStoredUser,
  type SessionPatch,
  type StoredSession,
  type StoredUser,
  type ThrottleRecord,
  type UserPatch,
} from "./types";
import { authKeyHash, normalizeEmail } from "./r2";

/** Filesystem store: identity lives under one directory of JSON records. */
export function createFileAuthStore(rootDir: string): AuthStore {
  const usersDir = join(rootDir, "users");
  const emailsDir = join(rootDir, "emails");
  const sessionsDir = join(rootDir, "sessions");
  const throttleDir = join(rootDir, "throttle");
  let prepared: Promise<void> | null = null;

  const ensureDirs = (): Promise<void> => {
    prepared ??= (async () => {
      for (const dir of [usersDir, emailsDir, sessionsDir, throttleDir]) {
        await mkdir(dir, { recursive: true });
      }
    })();
    return prepared;
  };

  const userPath = (id: string) => join(usersDir, `${safeSegment(id)}.json`);
  const emailPath = (email: string) => join(emailsDir, `${authKeyHash(normalizeEmail(email))}.json`);
  const sessionPath = (tokenHash: string) => join(sessionsDir, `${safeSegment(tokenHash)}.json`);
  const throttlePath = (key: string) => join(throttleDir, `${authKeyHash(key)}.json`);

  const readJson = async <T>(path: string): Promise<T | null> => {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw error;
    }
  };

  const writeJson = async (path: string, value: unknown, exclusive = false): Promise<boolean> => {
    await ensureDirs();
    const body = JSON.stringify(value, null, 0);
    if (exclusive) {
      try {
        const handle = await open(path, "wx");
        try {
          await handle.writeFile(body, "utf8");
        } finally {
          await handle.close();
        }
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "EEXIST") return false;
        throw error;
      }
    }
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, body, "utf8");
    await rename(temp, path);
    return true;
  };

  // Serialize read-modify-write per record so two concurrent requests cannot
  // lose each other's patch (throttle counters and login lockouts depend on it).
  const serial = new Map<string, Promise<unknown>>();
  const withLock = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = serial.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    serial.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  };

  const readUser = (id: string) => readJson<StoredUser>(userPath(id));

  const userSessions = async (userId: string): Promise<string[]> => {
    await ensureDirs();
    let entries: string[] = [];
    try {
      entries = await readdir(sessionsDir);
    } catch {
      return [];
    }
    const hashes: string[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const session = await readJson<StoredSession>(join(sessionsDir, entry));
      if (session?.userId === userId) hashes.push(session.tokenHash);
    }
    return hashes;
  };

  return {
    kind: "filesystem",
    durable: true,

    async createUser(input: NewStoredUser) {
      const email = normalizeEmail(input.email);
      await ensureDirs();
      const claimed = await writeJson(emailPath(email), { userId: input.id }, true);
      if (!claimed) throw new DuplicateEmailError();
      const now = new Date().toISOString();
      const user: StoredUser = {
        id: input.id,
        email,
        name: input.name ?? null,
        emailVerified: input.emailVerified === true,
        image: input.image ?? null,
        passwordHash: input.passwordHash ?? null,
        createdAt: input.createdAt ?? now,
        updatedAt: input.updatedAt ?? now,
        failedAttempts: input.failedAttempts ?? 0,
        lockedUntil: input.lockedUntil ?? null,
      };
      try {
        await writeJson(userPath(user.id), user);
      } catch (error) {
        await rm(emailPath(email), { force: true });
        throw error;
      }
      return user;
    },

    async findUserByEmail(email) {
      const index = await readJson<{ userId?: string }>(emailPath(email));
      if (!index?.userId) return null;
      return readUser(index.userId);
    },

    findUserById: (id) => readUser(id),

    async updateUser(id, patch: UserPatch) {
      return withLock(`user:${id}`, async () => {
        const current = await readUser(id);
        if (!current) return null;
        const next: StoredUser = {
          ...current,
          ...patch,
          email: patch.email ? normalizeEmail(patch.email) : current.email,
          updatedAt: new Date().toISOString(),
        };
        if (next.email !== current.email) {
          const claimed = await writeJson(emailPath(next.email), { userId: id }, true);
          if (!claimed) throw new DuplicateEmailError();
          await writeJson(userPath(id), next);
          await rm(emailPath(current.email), { force: true });
          return next;
        }
        await writeJson(userPath(id), next);
        return next;
      });
    },

    async deleteUser(id) {
      const current = await readUser(id);
      if (!current) return;
      for (const tokenHash of await userSessions(id)) {
        await rm(sessionPath(tokenHash), { force: true });
      }
      await rm(userPath(id), { force: true });
      await rm(emailPath(current.email), { force: true });
    },

    async listUsers(limit) {
      await ensureDirs();
      const entries = await readdir(usersDir);
      const users: StoredUser[] = [];
      for (const entry of entries.slice(0, Math.max(1, limit))) {
        if (!entry.endsWith(".json")) continue;
        const user = await readJson<StoredUser>(join(usersDir, entry));
        if (user) users.push(user);
      }
      return users.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async createSession(session) {
      await writeJson(sessionPath(session.tokenHash), session);
    },

    findSession: (tokenHash) => readJson<StoredSession>(sessionPath(tokenHash)),

    async updateSession(tokenHash, patch: SessionPatch) {
      return withLock(`session:${tokenHash}`, async () => {
        const current = await readJson<StoredSession>(sessionPath(tokenHash));
        if (!current) return;
        await writeJson(sessionPath(tokenHash), { ...current, ...patch });
      });
    },

    async deleteSession(tokenHash) {
      await rm(sessionPath(tokenHash), { force: true });
    },

    async deleteUserSessions(userId) {
      const hashes = await userSessions(userId);
      for (const tokenHash of hashes) await rm(sessionPath(tokenHash), { force: true });
      return hashes.length;
    },

    readThrottle: (key) => readJson<ThrottleRecord>(throttlePath(key)),

    async writeThrottle(key, record: ThrottleRecord) {
      await withLock(`throttle:${key}`, async () => {
        await writeJson(throttlePath(key), record);
      });
    },
  };
}

/** Directory names are derived from ids and hashes; keep them path-safe. */
function safeSegment(value: string): string {
  const clean = String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  return clean.length ? clean : authKeyHash(value);
}

/** True when `rootDir` exists as a directory (used by diagnostics only). */
export async function fileAuthStoreAvailable(rootDir: string): Promise<boolean> {
  try {
    await mkdir(rootDir, { recursive: true });
    const handle = await open(join(rootDir, ".probe"), constants.O_WRONLY | constants.O_CREAT);
    await handle.close();
    await rm(join(rootDir, ".probe"), { force: true });
    return true;
  } catch {
    return false;
  }
}
