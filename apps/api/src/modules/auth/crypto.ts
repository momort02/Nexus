import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function encryptAccessToken(token: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, Buffer.from(key, 'hex'), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ]);

  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptAccessToken(value: string, key: string): string {
  const [encodedIv, encodedTag, encodedData] = value.split('.');

  if (!encodedIv || !encodedTag || !encodedData) {
    throw new Error('Stored OAuth credential has an invalid format.');
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    Buffer.from(key, 'hex'),
    Buffer.from(encodedIv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encodedData, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
