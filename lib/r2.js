import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'node:stream';
import { mp4Duration } from './mp4-duration.js';

const allowed = {
  'image/jpeg': {ext:'jpg',max:10*1024*1024,mode:'image'},
  'image/png': {ext:'png',max:10*1024*1024,mode:'image'},
  'image/webp': {ext:'webp',max:10*1024*1024,mode:'image'},
  'video/mp4': {ext:'mp4',max:50*1024*1024,mode:'video'},
};
export function rule(type) { return allowed[type] || null; }
export function client() {
  for (const k of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET']) {
    if (!process.env[k]) throw new Error(`Missing ${k}`);
  }
  return new S3Client({
    region:'auto', endpoint:`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY},
  });
}
export async function signedUpload(key,type) {
  return getSignedUrl(client(),new PutObjectCommand({Bucket:process.env.R2_BUCKET,Key:key,ContentType:type}),{expiresIn:900});
}
export async function signedDownload(key,expiresIn=3600) {
  return getSignedUrl(client(),new GetObjectCommand({Bucket:process.env.R2_BUCKET,Key:key}),{expiresIn});
}
export async function verifySource(key,userId,mode) {
  if (typeof key !== 'string' || !key.startsWith(`uploads/${userId}/`) || !/^uploads\/[\w-]+\/[0-9a-f-]+\.(jpg|png|webp|mp4)$/.test(key)) {
    throw new Error('Invalid source file');
  }
  const head = await client().send(new HeadObjectCommand({Bucket:process.env.R2_BUCKET,Key:key}));
  const mime = head.ContentType?.split(';')[0];
  const r = rule(mime);
  if (!r || r.mode !== mode || !head.ContentLength || head.ContentLength > r.max) throw new Error('Invalid file size or type');
  return signedDownload(key, 14400); // 4h for Runway to read source
}
export async function saveResult(url, key) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Invalid Runway output URL');
  const response = await fetch(url, {signal:AbortSignal.timeout(90000)});
  if (!response.ok || !response.body) throw new Error(`Runway result download: ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 150*1024*1024) throw new Error('Runway video too large');
  const upload = new Upload({
    client:client(),
    params:{Bucket:process.env.R2_BUCKET,Key:key,Body:Readable.fromWeb(response.body),ContentType:'video/mp4'},
    queueSize:2,partSize:5*1024*1024,leavePartsOnError:false,
  });
  await upload.done();
}

export async function verifiedVideoSeconds(key,userId) {
  // 50 MB cap from rule('video/mp4'); we need trusted real metadata for per-second billing.
  await verifySource(key,userId,'video');
  const response=await client().send(new GetObjectCommand({Bucket:process.env.R2_BUCKET,Key:key}));
  const body=await response.Body.transformToByteArray();
  const duration=mp4Duration(body);
  if (duration>10.01 || duration<1.99) throw new Error('Please upload a 2–10 second MP4 video');
  return Math.ceil(duration);
}
