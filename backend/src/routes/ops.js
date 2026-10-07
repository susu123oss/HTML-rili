import express from 'express';
import os from 'os';
import process from 'process';
import { query, poolStatus } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';
import { storageStatus } from '../services/ops-storage.js';

export const opsRouter = express.Router();

const percent = (used, total) => (total > 0 ? Math.round((used / total) * 1000) / 10 : 0);
const usageLevel = (value) => {
  if (value >= 90) return 'danger';
  if (value >= 75) return 'warning';
  return 'normal';
};

const numberValue = (value) => Number(value || 0);

async function databaseStatus() {
  const result = await query(`
    SELECT
      pg_database_size(current_database()) AS "databaseSizeBytes",
      (SELECT count(*) FROM users) AS "userCount",
      (SELECT count(*) FROM memos) AS "memoCount",
      (SELECT count(*) FROM departments) AS "departmentCount"
  `);
  const row = result.rows[0] || {};
  return {
    databaseSizeBytes: numberValue(row.databaseSizeBytes),
    userCount: numberValue(row.userCount),
    memoCount: numberValue(row.memoCount),
    departmentCount: numberValue(row.departmentCount),
    connectionPool: poolStatus()
  };
}

function runtimeStatus() {
  const totalMemoryBytes = os.totalmem();
  const freeMemoryBytes = os.freemem();
  const usedMemoryBytes = totalMemoryBytes - freeMemoryBytes;
  const memoryUsedPercent = percent(usedMemoryBytes, totalMemoryBytes);
  const cpuCount = os.cpus().length;
  const loadAverage = os.loadavg();
  const loadPercent = percent(loadAverage[0], Math.max(cpuCount, 1));

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    cpuCount,
    loadAverage,
    loadPercent,
    memory: {
      totalBytes: totalMemoryBytes,
      freeBytes: freeMemoryBytes,
      usedBytes: usedMemoryBytes,
      usedPercent: memoryUsedPercent,
      level: usageLevel(memoryUsedPercent)
    },
    uptimeSeconds: Math.floor(os.uptime()),
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage()
    }
  };
}

function overallLevel(runtime, disks) {
  const levels = [runtime.memory.level, ...disks.map((disk) => disk.level)];
  if (levels.includes('danger')) return 'danger';
  if (levels.includes('warning')) return 'warning';
  return 'normal';
}

opsRouter.get('/status', authRequired, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: '只有管理员可以查看运维监控' });
  }

  const [storage, database] = await Promise.all([
    storageStatus(),
    databaseStatus()
  ]);
  const runtime = runtimeStatus();

  return res.json({
    checkedAt: new Date().toISOString(),
    level: overallLevel(runtime, storage.disks),
    runtime,
    storage,
    disks: storage.disks,
    mounts: storage.disks.map((disk) => ({ source: disk.device, target: disk.path, type: disk.filesystem })),
    database,
    notes: storage.notes
  });
});
