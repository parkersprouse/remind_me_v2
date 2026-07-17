import { DB } from '~lib/db.ts';
import { notification_manager } from '~lib/notifications.ts';
import { parseRepeat } from '~lib/repeat.ts';

import type { AndroidNativeBridge } from '~lib/androidNative.ts';
import type { RepeatSpec } from '~lib/repeat.ts';

/**
 * Export / import of scheduled reminders as a user-chosen JSON file.
 *
 * The file pickers are Android Storage Access Framework intents launched by
 * MainActivity.kt through the `window.AndroidNative` bridge; each flow's
 * outcome is delivered back via `window.androidBackupResult(event, payload)`.
 *
 * Importing deliberately re-schedules every reminder through
 * notification_manager rather than writing DB rows: scheduling is what arms
 * the OS alarm. Restoring rows alone (what Android Auto Backup used to do
 * before it was disabled in the manifest) leaves reminders visible in the
 * list but silent forever.
 */

const BACKUP_APP_ID = 'remind_me';
const BACKUP_FORMAT_VERSION = 1;

interface BackupEntry {
  details: string;
  scheduledForEpochMillis: number;
  timezone?: string;
  repeat: RepeatSpec | null;
}

interface BackupFile {
  app: typeof BACKUP_APP_ID;
  formatVersion: number;
  exportedAt: string;
  reminders: BackupEntry[];
}

export type ExportResult =
  | {
    status: 'exported';
    count: number;
  } |
  { status: 'empty'; } |
  { status: 'cancelled'; } |
  { status: 'error'; };

export interface ImportCounts {
  imported: number;
  /** Entries identical to a reminder already scheduled. */
  duplicates: number;
  /** One-shot entries whose scheduled time had already passed. */
  expired: number;
  /** Entries the app couldn't understand (hand-edited / corrupted). */
  invalid: number;
}

export type ImportResult =
  | ({ status: 'imported'; } & ImportCounts) |
  { status: 'cancelled'; } |
  { status: 'invalid-file'; } |
  { status: 'error'; };

declare global {
  interface Window {
    /** Result sink for MainActivity's backup document-picker flows. */
    androidBackupResult?: (event: string, payload: string) => void;
  }
}

interface BridgeResult {
  event: string;
  payload: string;
}

let pending_bridge: ((result: BridgeResult) => void) | null = null;

/**
 * Launch a picker flow on the native bridge and await its result. Returns
 * null when the bridge is missing or a flow is already in flight (the OS
 * can't show two pickers anyway).
 */
function bridgeCall(launch: (bridge: AndroidNativeBridge) => void): Promise<BridgeResult> | null {
  const bridge = window.AndroidNative;
  if (bridge === undefined || pending_bridge !== null) return null;

  window.androidBackupResult ??= (event, payload): void => {
    const resolve = pending_bridge;
    pending_bridge = null;
    resolve?.({
      event,
      payload,
    });
  };

  const result = new Promise<BridgeResult>((resolve) => {
    pending_bridge = resolve;
  });
  launch(bridge);
  return result;
}

/** Export every scheduled reminder to a JSON file the user picks. */
export async function exportBackup(): Promise<ExportResult> {
  const reminders = await DB.getAll();
  if (reminders.length === 0) return { status: 'empty' };

  const file: BackupFile = {
    app: BACKUP_APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    reminders: reminders.map((reminder) => ({
      details: reminder.details,
      scheduledForEpochMillis: reminder.scheduledForEpochMillis,
      timezone: reminder.timezone,
      repeat: parseRepeat(reminder.repeat),
    })),
  };

  const result = bridgeCall((bridge) => {
    bridge.exportBackup(JSON.stringify(file, null, 2), backupFileName());
  });
  if (result === null) return { status: 'error' };

  const { event } = await result;
  if (event === 'export-done') {
    return {
      status: 'exported',
      count: reminders.length,
    };
  }
  if (event === 'export-cancelled') return { status: 'cancelled' };
  return { status: 'error' };
}

/**
 * Import reminders from a backup file the user picks, merging with what's
 * already scheduled: duplicates and expired one-shots are skipped, everything
 * else is scheduled fresh (new ids — ids are random and carry no meaning).
 */
export async function importBackup(): Promise<ImportResult> {
  const result = bridgeCall((bridge) => {
    bridge.importBackup();
  });
  if (result === null) return { status: 'error' };

  const { event, payload } = await result;
  if (event === 'import-cancelled') return { status: 'cancelled' };
  if (event !== 'import-data') return { status: 'error' };

  const entries = parseBackupFile(payload);
  if (entries === null) return { status: 'invalid-file' };

  const existing = await DB.getAll();
  const existing_keys = new Set(existing.map((reminder) => dedupKey(
    reminder.details,
    reminder.scheduledForEpochMillis,
    parseRepeat(reminder.repeat),
  )));

  const counts: ImportCounts = {
    imported: 0,
    duplicates: 0,
    expired: 0,
    invalid: 0,
  };

  for (const raw of entries) {
    const entry = validateEntry(raw);
    if (entry === null) {
      counts.invalid += 1;
      continue;
    }
    if (entry.repeat === null && entry.scheduledForEpochMillis <= Date.now()) {
      counts.expired += 1;
      continue;
    }
    const key = dedupKey(entry.details, entry.scheduledForEpochMillis, entry.repeat);
    if (existing_keys.has(key)) {
      counts.duplicates += 1;
      continue;
    }

    try {
      // schedule() inserts the row AND arms the OS alarm; for repeats it
      // recomputes the next occurrence from now (preserving a chained rule's
      // anchor, so "every 2nd Tuesday" cycles don't shift).
      await notification_manager.schedule(
        new Date(entry.scheduledForEpochMillis),
        entry.details,
        entry.timezone,
        entry.repeat,
      );
    } catch {
      return { status: 'error' };
    }
    existing_keys.add(key);
    counts.imported += 1;
  }

  return {
    status: 'imported',
    ...counts,
  };
}

function backupFileName(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `remind-me-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** Validate the envelope; returns the raw entries or null for a foreign file. */
function parseBackupFile(text: string): unknown[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  const file = value as Partial<BackupFile>;
  if (
    file.app !== BACKUP_APP_ID ||
    typeof file.formatVersion !== 'number' ||
    file.formatVersion > BACKUP_FORMAT_VERSION ||
    !Array.isArray(file.reminders)
  ) {
    return null;
  }
  return file.reminders;
}

function validateEntry(raw: unknown): BackupEntry | null {
  if (raw === null || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;

  if (typeof entry.details !== 'string' || entry.details.trim() === '') return null;
  if (
    typeof entry.scheduledForEpochMillis !== 'number' ||
    !Number.isFinite(entry.scheduledForEpochMillis)
  ) {
    return null;
  }

  // Round-trip the rule through the serialized form so only rules the app
  // understands survive (anchors ride along, keeping chained cycles stable).
  const has_repeat = entry.repeat !== null && entry.repeat !== undefined;
  const repeat = has_repeat ? parseRepeat(JSON.stringify(entry.repeat)) : null;
  if (has_repeat && repeat === null) return null;

  return {
    details: entry.details,
    scheduledForEpochMillis: entry.scheduledForEpochMillis,
    timezone: typeof entry.timezone === 'string' ? entry.timezone : undefined,
    repeat,
  };
}

/**
 * Identity of a reminder for merge purposes: same details plus either the
 * same fire time (one-shots) or the same repeat rule. Repeat keys sort the
 * spec's keys so logically identical rules always compare equal.
 */
function dedupKey(details: string, epochMillis: number, repeat: RepeatSpec | null): string {
  const rule =
    repeat === null ?
      `@${epochMillis}` :
      JSON.stringify(repeat, Object.keys(repeat).sort());
  return `${details}\u0000${rule}`;
}
