import { createHash } from 'crypto';

export function buildWeakEtag(prefix, payload) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const digest = createHash('sha1').update(raw).digest('hex');
  return prefix ? `W/"${prefix}-${digest}"` : `W/"${digest}"`;
}

const normalizeEtag = (tag) => String(tag || '').trim().replace(/^W\//i, '');

export function isNotModified(req, res, etag) {
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, no-cache');
  const ifNoneMatch = req.get('if-none-match');
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === '*') return true;
  const target = normalizeEtag(etag);
  if (!target) return false;
  return ifNoneMatch.split(',').some((candidate) => normalizeEtag(candidate) === target);
}
