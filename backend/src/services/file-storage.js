import { randomUUID } from 'crypto';
import { mkdir, open, stat, statfs, unlink } from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

const namespaces = { avatars: 'webp', documents: 'pdf' };
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|pdf)$/;
const storageError = (status, message) => Object.assign(new Error(message), { status });

export function createFileStorage({ root = config.uploadDir, probe = config.uploadDiskProbe } = {}) {
  async function ensureAvailable() {
    if (!root || !probe || !path.isAbsolute(root) || !path.isAbsolute(probe)) {
      throw storageError(503, '上传资源存储尚未配置，请联系管理员');
    }
    try {
      const [directory, disk] = await Promise.all([stat(root), stat(probe)]);
      if (!directory.isDirectory() || !disk.isDirectory() || directory.dev !== disk.dev) throw new Error('Wrong filesystem');
    } catch {
      throw storageError(503, '数据盘资源目录暂不可用，请稍后重试');
    }
  }

  function resourcePath(namespace, key) {
    if (!Object.hasOwn(namespaces, namespace) || !keyPattern.test(key) || !key.endsWith(`.${namespaces[namespace]}`)) {
      throw storageError(400, '资源文件参数无效');
    }
    return path.join(root, namespace, key);
  }

  async function create(namespace, buffer) {
    if (!Object.hasOwn(namespaces, namespace)) throw storageError(400, '资源类型无效');
    await ensureAvailable();
    const capacity = await statfs(root);
    if (Number(capacity.bavail) * Number(capacity.bsize) < buffer.length + 1024 * 1024) {
      throw storageError(507, '数据盘可用空间不足，头像未保存');
    }
    await mkdir(path.join(root, namespace), { recursive: true, mode: 0o750 });
    const key = `${randomUUID()}.${namespaces[namespace]}`;
    const filename = resourcePath(namespace, key);
    let file;
    try {
      file = await open(filename, 'wx', 0o640);
      await file.writeFile(buffer);
      await file.sync();
      return key;
    } catch (error) {
      if (file) {
        await file.close();
        file = null;
        await unlink(filename).catch(() => {});
      }
      throw storageError(error.code === 'ENOSPC' ? 507 : 503, error.code === 'ENOSPC' ? '数据盘可用空间不足，头像未保存' : '资源文件保存失败，请稍后重试');
    } finally {
      await file?.close();
    }
  }

  async function remove(namespace, key) {
    if (!key) return;
    const filename = resourcePath(namespace, key);
    await ensureAvailable();
    try { await unlink(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  return { ensureAvailable, resourcePath, create, remove };
}

export const fileStorage = createFileStorage();
