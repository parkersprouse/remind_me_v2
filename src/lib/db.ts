import Database from '@tauri-apps/plugin-sql';

import { currentTimezone } from '~lib/format.ts';

/** Mirrors the Reminder model + sqflite table from the Flutter app. */
export interface Reminder {
  id: number;
  details: string;
  /** Serialized RepeatSpec JSON (see repeat.ts); null for one-shot reminders. */
  repeat: string | null;
  scheduledForEpochMillis: number;
  timezone: string;
}

export interface ReminderStore {
  insert: (
    id: number,
    details: string,
    scheduledForEpochMillis: number,
    zone?: string,
    repeat?: string | null,
  ) => Promise<void>;
  getAll: () => Promise<Reminder[]>;
  getById: (id: number) => Promise<Reminder | null>;
  getExpired: (epochMillis: number) => Promise<Reminder[]>;
  remove: (id: number) => Promise<void>;
}

let instance: Database | null = null;

async function db(): Promise<Database> {
  // The `reminders` table itself is created by the tauri-plugin-sql migration
  // registered in src-tauri/src/lib.rs.
  instance ??= await Database.load('sqlite:reminders.db');
  return instance;
}

export const DB: ReminderStore = {
  async insert(
    id: number,
    details: string,
    scheduledForEpochMillis: number,
    zone?: string,
    repeat?: string | null,
  ): Promise<void> {
    await (await db()).execute(
      'INSERT OR REPLACE INTO reminders (id, details, scheduledForEpochMillis, timezone, repeat) VALUES ($1, $2, $3, $4, $5)',
      [id, details, scheduledForEpochMillis, zone ?? currentTimezone(), repeat ?? null],
    );
  },

  async getAll(): Promise<Reminder[]> {
    return (await db()).select<Reminder[]>('SELECT * FROM reminders ORDER BY scheduledForEpochMillis ASC');
  },

  async getById(id: number): Promise<Reminder | null> {
    const rows = await (await db()).select<Reminder[]>(
      'SELECT * FROM reminders WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  },

  async getExpired(epochMillis: number): Promise<Reminder[]> {
    // Repeating reminders never expire: the OS keeps re-firing them, so a
    // past scheduledForEpochMillis just means "already fired at least once".
    return (await db()).select<Reminder[]>(
      'SELECT * FROM reminders WHERE scheduledForEpochMillis < $1 AND repeat IS NULL ORDER BY scheduledForEpochMillis ASC',
      [epochMillis],
    );
  },

  async remove(id: number): Promise<void> {
    await (await db()).execute('DELETE FROM reminders WHERE id = $1', [id]);
  },
};
