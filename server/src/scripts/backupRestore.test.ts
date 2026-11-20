import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import {
  buildBackupManifest,
  computeSha256,
  pruneOldBackups,
  verifyBackupManifest,
} from './backupRestore';

const gzip = promisify(zlib.gzip);

test('backupRestore verifies gzipped collection archives and SHA-256 checksums, detecting tampering', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'novara-backup-test-'));
  const backupDir = path.join(tempRoot, 'backup-2026-11-17T10-00-00-000Z');
  await fs.mkdir(backupDir, { recursive: true });

  try {
    const orders = [
      { _id: 'o1', orderNumber: 'NOV-1001', total: 1500 },
      { _id: 'o2', orderNumber: 'NOV-1002', total: 2990 },
    ];
    const gz = await gzip(Buffer.from(JSON.stringify(orders), 'utf8'));
    const fileName = 'orders.json.gz';
    await fs.writeFile(path.join(backupDir, fileName), gz);

    const manifest = buildBackupManifest({
      databaseName: 'novara_test',
      collections: [
        {
          collection: 'orders',
          fileName,
          documentCount: 2,
          byteSize: gz.byteLength,
          sha256: computeSha256(gz),
        },
      ],
    });
    await fs.writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const validRes = await verifyBackupManifest(backupDir);
    assert.equal(validRes.valid, true);
    assert.equal(validRes.errors.length, 0);
    assert.equal(validRes.manifest?.totalDocuments, 2);

    // Tamper archive -> SHA-256 mismatch must fail verification
    const tamperedGz = await gzip(Buffer.from(JSON.stringify([{ _id: 'o1', total: 0 }]), 'utf8'));
    await fs.writeFile(path.join(backupDir, fileName), tamperedGz);

    const invalidRes = await verifyBackupManifest(backupDir);
    assert.equal(invalidRes.valid, false);
    assert.ok(invalidRes.errors.some((e) => e.includes('Checksum mismatch')));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('pruneOldBackups retains the newest N backup directories', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'novara-prune-test-'));
  try {
    const dirs = [
      'backup-2026-11-10',
      'backup-2026-11-11',
      'backup-2026-11-12',
      'backup-2026-11-13',
      'backup-2026-11-14',
    ];
    for (const d of dirs) {
      await fs.mkdir(path.join(tempRoot, d));
    }

    const deleted = await pruneOldBackups(tempRoot, 2);
    assert.deepEqual(deleted, ['backup-2026-11-12', 'backup-2026-11-11', 'backup-2026-11-10']);

    const remaining = await fs.readdir(tempRoot);
    assert.deepEqual(remaining.sort(), ['backup-2026-11-13', 'backup-2026-11-14']);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
