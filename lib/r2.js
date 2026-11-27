import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'node:stream';
import { mp4Duration } from './mp4-duration.js';
import { badRequest } from './errors.js';

const allowed = {
  'image/jpeg': { ext: 'jpg', max: 10 * 1024 * 1024, mode: 'image' },
  'image/png': { ext: 'png', max: 10 * 1024 * 1024, mode: 'image' },
  'image/webp': { ext: 'webp', max: 10 * 1024 * 1024, mode: 'image' },
  'video/mp4': { ext: 'mp4', max: 50 * 1024 * 1024, mode: 'video' },
};
export function rule(type) { return allowed[type] || null; }
export function client() {
  for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
    if (!process.env[k]) throw new Error(`Missing ${k}`);
  }
  return new S3Client({
    region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    // AWS SDK >=3.729 adds CRC32 checksums by default. In a presigned PUT that is
    // the checksum of an EMPTY body, which the real upload cannot match; R2's docs
    // recommend turning the default off. PutObject does not require a checksum.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
// The URL is only valid for a PUT with exactly this Content-Type and byte size:
// both headers are part of the signature, so a larger (or different) file is
// rejected by R2 instead of being stored. Browsers set Content-Length from the
// body automatically, so the client must declare the file's real size.
export async function signedUpload(key, type, size) {
  if (!rule(type) || !Number.isSafeInteger(size) || size <= 0 || size > rule(type).max) {
    throw new Error('signedUpload needs a validated type and size');
  }
  const command = new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: type, ContentLength: size });
  return getSignedUrl(client(), command, { expiresIn: 900, signableHeaders: new Set(['content-type', 'content-length']) });
}
export async function signedDownload(key, expiresIn = 3600) {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }), { expiresIn });
}
export async function verifySource(key, userId, mode) {
  if (typeof key !== 'string' || !key.startsWith(`uploads/${userId}/`) || !/^uploads\/[\w-]+\/[0-9a-f-]+\.(jpg|png|webp|mp4)$/.test(key)) {
    throw badRequest('Invalid source file');
  }
  let head;
  try {
    head = await client().send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  } catch (error) {
    if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) {
      throw badRequest('Uploaded file not found. Please upload it again.');
    }
    throw error;
  }
  const mime = head.ContentType?.split(';')[0];
  const r = rule(mime);
  if (!r || r.mode !== mode || !head.ContentLength || head.ContentLength > r.max) throw badRequest('Invalid file size or type');
  return signedDownload(key, 14400); // 4h for Runway to read source
}
export async function saveResult(url, key) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Invalid Runway output URL');
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok || !response.body) throw new Error(`Runway result download: ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 150 * 1024 * 1024) throw new Error('Runway video too large');
  const upload = new Upload({
    client: client(),
    params: { Bucket: process.env.R2_BUCKET, Key: key, Body: Readable.fromWeb(response.body), ContentType: 'video/mp4' },
    queueSize: 2, partSize: 5 * 1024 * 1024, leavePartsOnError: false,
  });
  await upload.done();
}
const RESULT_TYPES = new Set(['video/mp4', 'image/png', 'image/jpeg', 'image/webp']);
// For results we already hold in memory: videos a provider handed back as bytes
// (Omni) and every generated image.
export async function saveResultBytes(bytes, key, contentType = 'video/mp4') {
  if (!RESULT_TYPES.has(contentType)) throw new Error(`Unsupported result type: ${contentType}`);
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('Empty result');
  if (bytes.length > 150 * 1024 * 1024) throw new Error('Result too large');
  await client().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET, Key: key, Body: bytes, ContentType: contentType, ContentLength: bytes.length,
  }));
}

// Downloads a provider's (small) output file into memory, refusing anything over maxBytes.
export async function downloadResult(url, maxBytes) {
  if (new URL(url).protocol !== 'https:') throw new Error('Invalid provider output URL');
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Result download: ${response.status}`);
  if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('Result too large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error('Result is empty or too large');
  return bytes;
}

// What an image really is, from its first bytes (providers do not all say, and
// a header can be wrong). Returns null for anything that is not PNG, JPEG or WebP.
export function imageKind(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  const ascii = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return { type: 'image/png', ext: 'png' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

export async function verifiedVideoSeconds(
  key,
  userId,
  { minSeconds = 2, maxSeconds = 10 } = {}
) {
  await verifySource(key, userId, 'video');

  const response = await client().send(
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key
    })
  );

  const body = await response.Body.transformToByteArray();
  const duration = mp4Duration(body);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw badRequest(
      'Video davomiyligini aniqlab bo‘lmadi. MP4 formatidagi videoni yuklang.'
    );
  }

  if (duration < minSeconds) {
    throw badRequest(
      `Videongiz ${duration.toFixed(1)} soniya. ` +
      `Minimal davomiylik ${minSeconds} soniya. ` +
      `Uzunroq video yuklang.`
    );
  }

  if (duration > maxSeconds) {
    throw badRequest(
      `Videongiz ${duration.toFixed(1)} soniya. ` +
      `Maksimal davomiylik ${maxSeconds} soniya. ` +
      `Videoni qisqartirib qayta yuklang.`
    );
  }

  return Math.ceil(duration);
}

