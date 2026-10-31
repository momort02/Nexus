import { createHmac, randomUUID } from 'node:crypto';

export function createSignedBotHeaders(input: {
  secret: string;
  method: string;
  path: string;
  body: string;
  timestamp: string;
}): Record<string, string> {
  const nonce = randomUUID();
  const canonicalRequest = [
    'nexus-v1',
    input.timestamp,
    nonce,
    input.method.toUpperCase(),
    input.path,
    input.body,
  ].join('\n');
  const signature = createHmac('sha256', input.secret)
    .update(canonicalRequest)
    .digest('hex');

  return {
    'X-Nexus-Timestamp': input.timestamp,
    'X-Nexus-Nonce': nonce,
    'X-Nexus-Signature': signature,
  };
}
