import express from 'express';
import os from 'os';
import process from 'process';
import { readFile, statfs } from 'fs/promises';
import { query, poolStatus } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

export const opsRouter = express.Router();

const percent = (used, total) => (total > 0 ? Math.round((used / total) * 1000) / 10 : 0);
const usageLevel = (value) => {
  if (value >= 90) return 'danger';
  if (value >= 75) return 'warning';
  return 'normal';
};

const numberValue = (value) => Number(value || 0);

async function diskUsage(label, path) {
  const stats = await statfs(path);
  const totalBytes = numberValue(stats.blocks) * numberValue(stats.bsize);
  const freeBytes = numberValue(stats.bfree) * numberValue(stats.bsize);
  const availableBytes = numberValue(stats.bavail) * numberValue(stats.bsize);
  const usedBytes = totalBytes - freeBytes;
  const usedPercent = percent(usedBytes, totalBytes);
  return {
    label,
    path,
    totalBytes,
    usedBytes,
    freeBytes,
    availableBytes,
    usedPercent,
    level: usageLevel(usedPercent)
  };
}

async function mountedFilesystems() {
  try {
    const content = await readFile('/proc/mounts', 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [source, target, type] = line.split(' ');
        return { source, target, type };
      })
      .filter((item) => ['/', '/app', '/tmp'].includes(item.target));
  } catch (error) {
    return [];
  }
}

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

  const [rootDisk, appDisk, tmpDisk, mounts, database] = await Promise.all([
    diskUsage('容器根目录', '/'),
    diskUsage('后端运行目录', '/app'),
    diskUsage('临时目录', '/tmp'),
    mountedFilesystems(),
    databaseStatus()
  ]);
  const runtime = runtimeStatus();

  return res.json({
    checkedAt: new Date().toISOString(),
    level: overallLevel(runtime, [rootDisk, appDisk, tmpDisk]),
    runtime,
    disks: [rootDisk, appDisk, tmpDisk],
    mounts,
    database,
    notes: [
      '当前数据来自后端容器可观测到的运行环境。',
      '未挂载到系统的数据盘不会出现在磁盘列表中；如需纳入监控，请先把数据盘挂载到服务器目录。'
    ]
  });
});