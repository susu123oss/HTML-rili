import sharp from 'sharp';
import { pool, query } from '../db/pool.js';
import { fileStorage } from './file-storage.js';
import { avatarKeyPattern } from './user-profile.js';

export const avatarMaxBytes = 5 * 1024 * 1024;
export const avatarMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function encodeAvatar(buffer, crop) {
  if (!buffer?.length || buffer.length > avatarMaxBytes) throw Object.assign(new Error('头像图片不能超过 5 MB'), { status: 413 });
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isWebp = buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw Object.assign(new Error('请选择有效的 JPG、PNG 或 WebP 图片'), { status: 400 });
  try {
    const image = sharp(buffer, { limitInputPixels: 25_000_000, failOn: 'warning', animated: true });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1) throw new Error('Unsupported image');
    image.autoOrient();
    if (crop !== undefined) {
      // Coordinates refer to the oriented image, as displayed by the browser.
      const rotated = [5, 6, 7, 8].includes(metadata.orientation);
      const width = rotated ? metadata.height : metadata.width;
      const height = rotated ? metadata.width : metadata.height;
      if (!crop || typeof crop !== 'object' || Array.isArray(crop) || Object.keys(crop).length !== 3
        || !['left', 'top', 'size'].every(key => Object.hasOwn(crop, key) && Number.isSafeInteger(crop[key]))
        || crop.left < 0 || crop.top < 0 || crop.size < 1 || crop.left + crop.size > width || crop.top + crop.size > height) {
        throw Object.assign(new Error('头像取景无效，请重新选择图片并调整取景'), { status: 400 });
      }
      image.extract({ left: crop.left, top: crop.top, width: crop.size, height: crop.size });
    }
    return await image.resize(256, 256, { fit: 'cover', position: 'centre' }).webp({ quality: 82 }).toBuffer();
  } catch (error) {
    if (error.status === 400) throw error;
    throw Object.assign(new Error('图片无法读取，请使用普通 JPG、PNG 或 WebP 图片（不超过 2500 万像素）'), { status: 400 });
  }
}

export async function removeUnreferencedAvatar(key) {
  if (!avatarKeyPattern.test(key || '')) return;
  try {
    const refs = await query('SELECT id FROM users WHERE avatar_key = $1 LIMIT 1', [key]);
    if (!refs.rowCount) await fileStorage.remove('avatars', key);
  } catch (error) {
    console.warn('头像旧资源暂未清理:', error.code || error.status || 'storage-error');
  }
}

export async function replaceUserAvatar(userId, key) {
  const client = await pool.connect();
  let oldKey = '';
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT avatar_key FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!current.rowCount) throw Object.assign(new Error('账号不存在'), { status: 404 });
    oldKey = current.rows[0].avatar_key;
    await client.query('UPDATE users SET avatar_key = $2 WHERE id = $1', [userId, key]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await removeUnreferencedAvatar(oldKey);
}
