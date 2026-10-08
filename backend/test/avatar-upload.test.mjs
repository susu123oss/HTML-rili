import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { createFileStorage } from '../src/services/file-storage.js';
import { encodeAvatar, avatarMaxBytes, avatarMimeTypes } from '../src/services/avatar.js';
import { avatarKeyPattern, toPublicUser } from '../src/services/user-profile.js';

test('real multipart avatar lifecycle, image validation, account ownership and authenticated reads', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'calendar-avatar-test-'));
  assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
  const storage = createFileStorage({ root: directory, probe: directory });
  const users = new Map([[1, { id: 1, role: 'staff', displayName: '员工甲', avatarKey: '' }], [2, { id: 2, role: 'staff', displayName: '员工乙', avatarKey: '' }]]);
  const source = (await readFile(new URL('../src/routes/avatars.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replaceAll('export const ', 'const ');
  const ctx = {
    express, multer, avatarMaxBytes, avatarMimeTypes, encodeAvatar, avatarKeyPattern, toPublicUser, fileStorage: storage,
    query: async (sql, params) => ({ rowCount: [...users.values()].some(user => user.avatarKey === params[0]) ? 1 : 0 }),
    authRequired: (req, res, next) => {
      const user = users.get(Number(req.headers.authorization?.replace('Bearer ', '')));
      if (!user) return res.status(401).json({ message: '未登录' });
      req.user = { ...user }; next();
    },
    replaceUserAvatar: async (id, key) => {
      const user = users.get(id), previous = user.avatarKey; user.avatarKey = key;
      if (previous) await storage.remove('avatars', previous);
    },
    removeUnreferencedAvatar: async key => { if (key && ![...users.values()].some(user => user.avatarKey === key)) await storage.remove('avatars', key); }
  };
  vm.createContext(ctx);
  const routers = vm.runInContext(source + '\n({ avatarsRouter, profileAvatarRouter });', ctx);
  const app = express();
  app.use('/api/users/me/avatar', routers.profileAvatarRouter); app.use('/api/avatars', routers.avatarsRouter);
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const png = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#2563eb' } }).withExif({ IFD0: { Artist: 'isolated-avatar-fixture' } }).png().toBuffer();
  assert((await sharp(png).metadata()).exif);
  async function upload(bytes, mime = 'image/png', userId = 1, extra = false, crop) {
    const form = new FormData(); form.append('avatar', new Blob([bytes], { type: mime }), '../../should-not-control-path.png');
    if (extra) form.append('userId', '2');
    if (crop !== undefined) form.append('crop', typeof crop === 'string' ? crop : JSON.stringify(crop));
    return fetch(base + '/api/users/me/avatar', { method: 'POST', headers: userId ? { Authorization: `Bearer ${userId}` } : {}, body: form });
  }
  try {
    assert.equal((await upload(png, 'image/png', 0)).status, 401);
    let response = await upload(png);
    assert.equal(response.status, 200, await response.clone().text());
    const user = (await response.json()).user;
    assert(user.avatarUrl.startsWith('/api/avatars/'));
    assert.equal(users.get(2).avatarKey, '');
    const key = user.avatarUrl.split('/').at(-1);
    assert(avatarKeyPattern.test(key));
    assert.equal((await fetch(base + user.avatarUrl)).status, 401);
    response = await fetch(base + user.avatarUrl, { headers: { Authorization: 'Bearer 2' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/webp');
    const image = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(image).metadata();
    assert.equal(metadata.width, 256); assert.equal(metadata.height, 256); assert.equal(metadata.format, 'webp'); assert.equal(metadata.exif, undefined);
    assert.equal((await upload(Buffer.from('<svg></svg>'), 'image/svg+xml')).status, 400);
    assert.equal((await upload(Buffer.from('not an image'))).status, 400);
    const oversizedPixels = await sharp({ create: { width: 5001, height: 5000, channels: 3, background: '#ffffff' } }).png().toBuffer();
    assert(oversizedPixels.length < avatarMaxBytes);
    assert.equal((await upload(oversizedPixels)).status, 400);
    assert.equal((await upload(Buffer.alloc(avatarMaxBytes + 1))).status, 413);
    assert.equal((await upload(png, 'image/png', 1, true)).status, 400);
    for (const crop of ['invalid json', null, { left: -1, top: 0, size: 100 }, { left: 0, top: 501, size: 100 }, { left: 0, top: 0, size: 100.5 }, { left: 0, top: 0, size: 100, userId: 2 }]) {
      assert.equal((await upload(png, 'image/png', 1, false, crop)).status, 400);
    }
    assert.equal((await upload(png, 'image/png', 1, true, { left: 0, top: 0, size: 100 })).status, 400);
    assert.equal(users.get(1).avatarKey, key); // Invalid requests keep the existing avatar.
    assert.equal((await upload(png, 'image/png', 1, false, { left: 0, top: 100, size: 300 })).status, 200);
    await assert.rejects(stat(storage.resourcePath('avatars', key)), { code: 'ENOENT' });
    assert.equal((await fetch(base + '/api/avatars/' + key, { headers: { Authorization: 'Bearer 1' } })).status, 404);
    response = await fetch(base + '/api/users/me/avatar', { method: 'DELETE', headers: { Authorization: 'Bearer 1' } });
    assert.equal(response.status, 200); assert.equal((await response.json()).user.avatarUrl, '');
    assert.deepEqual(await readdir(path.join(directory, 'avatars')), []);
    assert.throws(() => storage.resourcePath('avatars', '../private.pdf'), error => error.status === 400);
    await assert.rejects(createFileStorage({ root: directory, probe: path.join(directory, 'missing-data-disk') }).create('avatars', png), error => error.status === 503);
    assert.deepEqual(await readdir(path.join(directory, 'avatars')), []);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('selected avatar region matches oriented portrait and landscape pixels', async () => {
  const portrait = await sharp(Buffer.from('<svg width="400" height="1200" xmlns="http://www.w3.org/2000/svg"><path fill="#e22" d="M0 0h400v400H0z"/><path fill="#2b5" d="M0 400h400v400H0z"/><path fill="#26e" d="M0 800h400v400H0z"/></svg>')).png().toBuffer();
  const oriented = await sharp(portrait).rotate(-90).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer();
  assert.equal((await sharp(oriented).metadata()).orientation, 6);
  const landscape = await sharp(portrait).rotate(90).png().toBuffer();
  for (const [input, crop] of [[portrait, { left: 0, top: 800, size: 400 }], [oriented, { left: 0, top: 800, size: 400 }], [landscape, { left: 0, top: 0, size: 400 }]]) {
    const output = await encodeAvatar(input, crop);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.width, 256); assert.equal(metadata.height, 256); assert.equal(metadata.exif, undefined);
    const pixel = await sharp(output).extract({ left: 128, top: 128, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert(pixel[2] > 220 && pixel[0] < 50 && pixel[1] < 120, `Expected selected blue band; got ${[...pixel]}`);
  }
  const centerPixel = await sharp(await encodeAvatar(portrait)).extract({ left: 128, top: 128, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert(centerPixel[1] > 160 && centerPixel[0] < 50 && centerPixel[2] < 100); // Existing clients retain centered cropping.
});
