import express from 'express';
import multer from 'multer';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';
import { fileStorage } from '../services/file-storage.js';
import { avatarMaxBytes, avatarMimeTypes, encodeAvatar, replaceUserAvatar, removeUnreferencedAvatar } from '../services/avatar.js';
import { avatarKeyPattern, toPublicUser } from '../services/user-profile.js';

export const avatarsRouter = express.Router();
export const profileAvatarRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: avatarMaxBytes, files: 1, fields: 0, parts: 1, fieldNameSize: 32 },
  fileFilter(req, file, callback) {
    callback(avatarMimeTypes.has(file.mimetype) ? null : Object.assign(new Error('头像仅支持 JPG、PNG 和 WebP 图片'), { status: 400 }), avatarMimeTypes.has(file.mimetype));
  }
}).single('avatar');

profileAvatarRouter.use(authRequired);
profileAvatarRouter.post('/', (req, res, next) => upload(req, res, (error) => {
  if (error) return res.status(error.status || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)).json({ message: error.code === 'LIMIT_FILE_SIZE' ? '头像图片不能超过 5 MB' : error.status ? error.message : '请只上传一张头像图片' });
  next();
}), async (req, res, next) => {
  let key = '';
  try {
    if (!req.file) return res.status(400).json({ message: '请选择要上传的头像图片' });
    const encoded = await encodeAvatar(req.file.buffer);
    key = await fileStorage.create('avatars', encoded);
    await replaceUserAvatar(req.user.id, key);
    return res.json({ user: toPublicUser({ ...req.user, avatarKey: key }) });
  } catch (error) {
    await removeUnreferencedAvatar(key);
    return next(error);
  }
});

profileAvatarRouter.delete('/', async (req, res, next) => {
  try {
    await replaceUserAvatar(req.user.id, '');
    return res.json({ user: toPublicUser({ ...req.user, avatarKey: '' }) });
  } catch (error) { return next(error); }
});

avatarsRouter.get('/:key', authRequired, async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!avatarKeyPattern.test(key)) return res.status(404).json({ message: '头像不存在' });
    const referenced = await query('SELECT id FROM users WHERE avatar_key = $1 LIMIT 1', [key]);
    if (!referenced.rowCount) return res.status(404).json({ message: '头像不存在' });
    await fileStorage.ensureAvailable();
    res.set({ 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400' });
    return res.sendFile(fileStorage.resourcePath('avatars', key), (error) => {
      if (error && !res.headersSent) error.status === 404 ? res.status(404).json({ message: '头像文件暂不可读' }) : next(error);
    });
  } catch (error) { return next(error); }
});
