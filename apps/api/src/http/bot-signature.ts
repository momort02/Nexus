import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

const MAX_CLOCK_SKEW_SECONDS = 300;
const NONCE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare module 'http' {
  interface IncomingMessage {
    rawBody?: Buffer;
  }
}

function isValidSignature(supplied: string, expected: Buffer): boolean {
  if (!/^[\da-f]{64}$/i.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied, 'hex'), expected);
}

export function createBotRequestAuthentication(options: {
  secret: string;
  consumeNonce: (nonce: string, expiresAt: Date) => Promise<boolean>;
}): RequestHandler {
  return (request, response, next) => {
    const timestamp = request.get('x-nexus-timestamp') ?? '';
    const nonce = request.get('x-nexus-nonce') ?? '';
    const signature = request.get('x-nexus-signature') ?? '';
    const rawBody = request.rawBody;
    const timestampSeconds = /^\d{1,12}$/.test(timestamp)
      ? Number(timestamp)
      : Number.NaN;
    const nowSeconds = Date.now() / 1000;

    if (
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS ||
      !NONCE_PATTERN.test(nonce) ||
      !rawBody
    ) {
      response.status(401).json({ error: { code: 'invalid_bot_signature' } });
      return;
    }

    const path = request.originalUrl.split('?')[0] ?? '';
    const canonicalRequest = [
      'nexus-v1',
      timestamp,
      nonce,
      request.method.toUpperCase(),
      path,
      rawBody.toString('utf8'),
    ].join('\n');
    const expected = createHmac('sha256', options.secret)
      .update(canonicalRequest)
      .digest();

    if (!isValidSignature(signature, expected)) {
      response.status(401).json({ error: { code: 'invalid_bot_signature' } });
      return;
    }

    void options
      .consumeNonce(
        nonce,
        new Date((timestampSeconds + MAX_CLOCK_SKEW_SECONDS) * 1000),
      )
      .then((accepted) => {
        if (!accepted) {
          response
            .status(401)
            .json({ error: { code: 'invalid_bot_signature' } });
          return;
        }
        next();
      })
      .catch(next);
  };
}
