import test from 'node:test';
import assert from 'node:assert/strict';
import { storageStatus } from '../src/services/ops-storage.js';

const layout = {
  version: 1, checkedAt: '2026-09-30T08:00:00Z',
  disks: [
    { id: 'system', label: '系统盘', path: '/', device: '/dev/vda1', filesystem: 'xfs', probePath: '/run/calendar-storage/system' },
    { id: 'data', label: '数据盘', path: '/data', device: '/dev/vdb1', filesystem: 'ext4', probePath: '/run/calendar-storage/data' }
  ],
  locations: [{ kind: 'database', label: '日历数据库', diskId: 'system', hostPath: '/var/lib/docker/volumes/calendar_db/_data', containerPath: '/var/lib/postgresql/data' }]
};
const readLayout = async () => JSON.stringify(layout);

test('server disk probes report live capacity and map the database to its real disk', async () => {
  let free = 800;
  const reads = [];
  const readStats = async (path) => {
    reads.push(path);
    return { blocks: 1000, bsize: 1024, bfree: free, bavail: free - 50 };
  };
  const first = await storageStatus({ readLayout, readStats });
  assert.equal(first.scope, 'host');
  assert.deepEqual(first.disks.map((disk) => disk.device), ['/dev/vda1', '/dev/vdb1']);
  assert.equal(first.locations[0].diskLabel, '系统盘');
  assert.equal(first.locations[0].hostPath, layout.locations[0].hostPath);
  assert.equal(first.disks[0].usedPercent, 20);
  assert.equal(first.disks[0].availableBytes, 750 * 1024);
  free = 70;
  const refreshed = await storageStatus({ readLayout, readStats });
  assert.equal(refreshed.disks[0].usedPercent, 93);
  assert.equal(refreshed.disks[0].level, 'danger');
  assert(!reads.includes('/app') && !reads.includes('/tmp'));
  assert(!JSON.stringify(refreshed).includes('probePath'));
});

test('unconnected monitor shows one container sample without claiming a host disk or data location', async () => {
  const result = await storageStatus({
    readLayout: async () => { throw new Error('ENOENT'); },
    readStats: async (path) => { assert.equal(path, '/'); return { blocks: 100, bsize: 1024, bfree: 50, bavail: 50 }; }
  });
  assert.equal(result.scope, 'container');
  assert.equal(result.disks.length, 1);
  assert.deepEqual(result.locations, []);
  assert.equal(result.disks[0].label, '容器可见存储');
});

test('unreadable data disk is unavailable, never displayed as an empty zero-capacity disk', async () => {
  const result = await storageStatus({ readLayout, readStats: async (path) => {
    if (path.endsWith('/data')) throw new Error('EACCES');
    return { blocks: 100, bsize: 1024, bfree: 50, bavail: 50 };
  } });
  assert.equal(result.disks[1].available, false);
  assert.equal(result.disks[1].level, 'warning');
  assert.equal(result.disks[1].totalBytes, undefined);
  assert.equal(result.locations[0].device, '/dev/vda1');
});
