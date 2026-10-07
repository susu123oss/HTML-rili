import { readFile, statfs } from 'fs/promises';

const usageLevel = (value) => value >= 90 ? 'danger' : value >= 75 ? 'warning' : 'normal';

async function measureDisk(disk, readStats) {
  try {
    const stats = await readStats(disk.probePath);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bfree) * Number(stats.bsize);
    const usedBytes = totalBytes - freeBytes;
    const usedPercent = totalBytes > 0 ? Math.round(usedBytes / totalBytes * 1000) / 10 : 0;
    return {
      id: disk.id, label: disk.label, device: disk.device || '', path: disk.path,
      filesystem: disk.filesystem || '', purpose: disk.purpose || '', available: true,
      totalBytes, freeBytes, usedBytes,
      availableBytes: Number(stats.bavail) * Number(stats.bsize),
      usedPercent, level: usageLevel(usedPercent)
    };
  } catch {
    return {
      id: disk.id, label: disk.label, device: disk.device || '', path: disk.path,
      filesystem: disk.filesystem || '', purpose: disk.purpose || '',
      available: false, level: 'warning'
    };
  }
}

export async function storageStatus({
  layoutPath = process.env.OPS_STORAGE_LAYOUT || '/run/calendar-storage/layout.json',
  readLayout = readFile,
  readStats = statfs
} = {}) {
  let layout;
  try {
    layout = JSON.parse(await readLayout(layoutPath, 'utf8'));
    if (layout.version !== 1 || !Array.isArray(layout.disks) || !layout.disks.length
      || layout.disks.some((disk) => !disk.id || !disk.label || !disk.path
        || !disk.probePath?.startsWith('/run/calendar-storage/'))) {
      throw new Error('Invalid storage layout');
    }
  } catch {
    return {
      scope: 'container', locations: [],
      disks: [await measureDisk({ id: 'container', label: '容器可见存储', path: '/', probePath: '/' }, readStats)],
      notes: ['当前只读取了容器所在文件系统，不能据此判断服务器有几块盘。', '尚未连接服务器磁盘监控，数据库在宿主机上的存放位置暂不可读取。']
    };
  }

  // The probes are empty read-only bind mounts; no database or host files are exposed.
  const disks = await Promise.all(layout.disks.map((disk) => measureDisk(disk, readStats)));
  const locations = (Array.isArray(layout.locations) ? layout.locations : []).map((location) => {
    const disk = disks.find((item) => item.id === location.diskId);
    return {
      kind: location.kind, label: location.label, hostPath: location.hostPath,
      containerPath: location.containerPath || '', diskId: location.diskId,
      diskLabel: disk?.label || '尚未识别', device: disk?.device || '',
      mountPath: disk?.path || '', verified: Boolean(disk)
    };
  });
  return {
    scope: 'host', disks, locations, layoutCheckedAt: layout.checkedAt,
    notes: [
      '磁盘容量实时读取；数据库和项目路径在每次后端部署时重新核对。',
      '目录名称不代表独立磁盘，/app 和 /tmp 不再重复计为两块盘。',
      ...(disks.some((disk) => !disk.available) ? ['有磁盘暂时无法读取容量，请检查监控挂载。'] : [])
    ]
  };
}
