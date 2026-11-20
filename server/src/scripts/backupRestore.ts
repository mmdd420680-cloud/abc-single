import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { connectToMongoAtlas, disconnectFromMongoAtlas } from '../database/connection';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface CollectionChecksumEntry {
  collection: string;
  fileName: string;
  documentCount: number;
  byteSize: number;
  sha256: string;
}

export interface BackupManifest {
  version: number;
  createdAt: string;
  databaseName: string;
  collections: CollectionChecksumEntry[];
  totalDocuments: number;
}

export function computeSha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function buildBackupManifest(params: {
  databaseName: string;
  collections: CollectionChecksumEntry[];
  createdAt?: string;
}): BackupManifest {
  return {
    version: 1,
    createdAt: params.createdAt || new Date().toISOString(),
    databaseName: params.databaseName,
    collections: params.collections,
    totalDocuments: params.collections.reduce((sum, entry) => sum + entry.documentCount, 0),
  };
}

export async function verifyBackupManifest(backupDir: string): Promise<{
  valid: boolean;
  manifest: BackupManifest | null;
  errors: string[];
}> {
  const errors: string[] = [];
  const manifestPath = path.join(backupDir, 'manifest.json');

  let manifest: BackupManifest;
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(raw) as BackupManifest;
  } catch (err) {
    return {
      valid: false,
      manifest: null,
      errors: [`Unable to read manifest.json: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  if (!Array.isArray(manifest.collections) || manifest.collections.length === 0) {
    errors.push('Manifest contains no collection entries.');
  }

  for (const entry of manifest.collections || []) {
    const targetFile = path.join(backupDir, entry.fileName);
    try {
      const compressed = await fs.readFile(targetFile);
      const actualHash = computeSha256(compressed);
      if (actualHash !== entry.sha256) {
        errors.push(
          `Checksum mismatch for ${entry.collection} (${entry.fileName}): expected ${entry.sha256}, got ${actualHash}`,
        );
        continue;
      }
      const decompressed = await gunzip(compressed);
      const docs = JSON.parse(decompressed.toString('utf8')) as unknown[];
      if (!Array.isArray(docs) || docs.length !== entry.documentCount) {
        errors.push(
          `Document count mismatch for ${entry.collection}: manifest=${entry.documentCount}, archive=${Array.isArray(docs) ? docs.length : 'invalid'}`,
        );
      }
    } catch (err) {
      errors.push(`Archive check failed for ${entry.fileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    valid: errors.length === 0,
    manifest,
    errors,
  };
}

export async function pruneOldBackups(rootDir: string, retainCount = 7): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const backupDirs = entries
    .filter((d) => d.isDirectory() && d.name.startsWith('backup-'))
    .map((d) => d.name)
    .sort()
    .reverse();

  const toDelete = backupDirs.slice(Math.max(1, retainCount));
  for (const dirName of toDelete) {
    await fs.rm(path.join(rootDir, dirName), { recursive: true, force: true });
  }
  return toDelete;
}

export async function createDatabaseBackup(options?: {
  outputRoot?: string;
  retainCount?: number;
}): Promise<{ backupDir: string; manifest: BackupManifest; pruned: string[] }> {
  const outputRoot = path.resolve(options?.outputRoot || path.join(process.cwd(), 'backups'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(outputRoot, `backup-${stamp}`);
  await fs.mkdir(backupDir, { recursive: true });

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection is not active. Set MONGODB_URI before running backup.');
  }

  const collections = await db.listCollections().toArray();
  const manifestEntries: CollectionChecksumEntry[] = [];

  for (const colInfo of collections) {
    const colName = colInfo.name;
    if (colName.startsWith('system.')) continue;

    const docs = await db.collection(colName).find({}).toArray();
    const jsonBuffer = Buffer.from(JSON.stringify(docs), 'utf8');
    const compressed = await gzip(jsonBuffer);
    const fileName = `${colName}.json.gz`;
    await fs.writeFile(path.join(backupDir, fileName), compressed);

    manifestEntries.push({
      collection: colName,
      fileName,
      documentCount: docs.length,
      byteSize: compressed.byteLength,
      sha256: computeSha256(compressed),
    });
  }

  const manifest = buildBackupManifest({
    databaseName: db.databaseName,
    collections: manifestEntries,
  });

  await fs.writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  const pruned = await pruneOldBackups(outputRoot, options?.retainCount ?? 7);
  return { backupDir, manifest, pruned };
}

export async function restoreDatabaseBackup(params: {
  backupDir: string;
  dryRun?: boolean;
  dropExisting?: boolean;
}): Promise<{ verified: boolean; restoredCollections: number; totalDocuments: number }> {
  const verification = await verifyBackupManifest(params.backupDir);
  if (!verification.valid || !verification.manifest) {
    throw new Error(`Backup verification failed:\n${verification.errors.join('\n')}`);
  }

  if (params.dryRun) {
    return {
      verified: true,
      restoredCollections: verification.manifest.collections.length,
      totalDocuments: verification.manifest.totalDocuments,
    };
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection is not active. Set MONGODB_URI before running restore.');
  }

  let totalDocuments = 0;
  for (const entry of verification.manifest.collections) {
    const compressed = await fs.readFile(path.join(params.backupDir, entry.fileName));
    const decompressed = await gunzip(compressed);
    const docs = JSON.parse(decompressed.toString('utf8')) as Array<Record<string, unknown>>;

    const col = db.collection(entry.collection);
    if (params.dropExisting) {
      await col.deleteMany({});
    }
    if (docs.length > 0) {
      await col.insertMany(docs as never[], { ordered: false });
      totalDocuments += docs.length;
    }
  }

  return {
    verified: true,
    restoredCollections: verification.manifest.collections.length,
    totalDocuments,
  };
}

async function runCli() {
  const args = process.argv.slice(2);
  const isRestore = args.includes('--restore');
  const verifyOnly = args.includes('--verify');
  const dryRun = args.includes('--dry-run');
  const dropExisting = args.includes('--drop');
  const dirArgIndex = args.findIndex((a) => a === '--dir');
  const targetDir = dirArgIndex >= 0 ? args[dirArgIndex + 1] : '';

  if (isRestore || verifyOnly) {
    if (!targetDir) {
      console.error('Usage: npm run db:backup -- --restore --dir <backup-folder> [--verify] [--dry-run] [--drop]');
      process.exitCode = 1;
      return;
    }
    if (verifyOnly && !isRestore) {
      const res = await verifyBackupManifest(path.resolve(targetDir));
      console.log(JSON.stringify(res, null, 2));
      if (!res.valid) process.exitCode = 1;
      return;
    }
    const connected = await connectToMongoAtlas();
    if (!connected) {
      console.error('Failed to connect to MongoDB Atlas. Ensure MONGODB_URI is configured.');
      process.exitCode = 1;
      return;
    }
    try {
      const result = await restoreDatabaseBackup({
        backupDir: path.resolve(targetDir),
        dryRun,
        dropExisting,
      });
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    } finally {
      await disconnectFromMongoAtlas();
    }
    return;
  }

  const connected = await connectToMongoAtlas();
  if (!connected) {
    console.error('Failed to connect to MongoDB Atlas. Ensure MONGODB_URI is configured.');
    process.exitCode = 1;
    return;
  }
  try {
    const result = await createDatabaseBackup();
    console.log(
      JSON.stringify(
        {
          ok: true,
          backupDir: result.backupDir,
          collections: result.manifest.collections.length,
          totalDocuments: result.manifest.totalDocuments,
          pruned: result.pruned,
        },
        null,
        2,
      ),
    );
  } finally {
    await disconnectFromMongoAtlas();
  }
}

const isEntrypoint = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isEntrypoint) {
  runCli().catch((err) => {
    console.error('[db:backup] Fatal error:', err);
    process.exitCode = 1;
  });
}
