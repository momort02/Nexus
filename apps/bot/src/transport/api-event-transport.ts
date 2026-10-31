import type { DiscordBotEvent } from '@nexus/shared';
import { createSignedBotHeaders } from './signature.js';

const MAX_QUEUE_SIZE = 10_000;
const MAX_BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;

class NonRetryableDeliveryError extends Error {}

export interface EventTransportOptions {
  endpoint: string;
  secret: string;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export class ApiEventTransport {
  private readonly queue = new Map<string, DiscordBotEvent>();
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private flushChain: Promise<void> = Promise.resolve();
  private readonly flushTimer: NodeJS.Timeout;

  constructor(private readonly options: EventTransportOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.flushTimer = setInterval(() => {
      this.flushInBackground();
    }, 1000);
    this.flushTimer.unref();
  }

  enqueue(event: DiscordBotEvent): boolean {
    if (this.queue.has(event.eventId)) {
      return true;
    }
    if (this.queue.size >= MAX_QUEUE_SIZE) {
      console.error(JSON.stringify({ event: 'bot_event_queue_full' }));
      return false;
    }

    this.queue.set(event.eventId, event);
    if (this.queue.size >= MAX_BATCH_SIZE) {
      this.flushInBackground();
    }
    return true;
  }

  flush(): Promise<void> {
    const operation = this.flushChain.then(
      () => this.flushPending(),
      () => this.flushPending(),
    );
    this.flushChain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async close(): Promise<void> {
    clearInterval(this.flushTimer);
    await this.flush();
  }

  private flushInBackground(): void {
    void this.flush().catch((error: unknown) => {
      console.error(
        JSON.stringify({
          event: 'bot_event_flush_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    });
  }

  private async flushPending(): Promise<void> {
    while (this.queue.size > 0) {
      const batch = [...this.queue.values()].slice(0, MAX_BATCH_SIZE);
      try {
        await this.sendBatch(batch);
        for (const event of batch) {
          this.queue.delete(event.eventId);
        }
      } catch (error) {
        if (error instanceof NonRetryableDeliveryError) {
          for (const event of batch) {
            this.queue.delete(event.eventId);
          }
        }
        console.error(
          JSON.stringify({
            event: 'bot_event_delivery_failed',
            count: batch.length,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
        throw error;
      }
    }
  }

  private async sendBatch(events: DiscordBotEvent[]): Promise<void> {
    const body = JSON.stringify({ events });
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const timestamp = Math.floor(this.now() / 1000).toString();
      const path = new URL(this.options.endpoint).pathname;
      const signatureHeaders = createSignedBotHeaders({
        secret: this.options.secret,
        method: 'POST',
        path,
        body,
        timestamp,
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await this.fetchImplementation(this.options.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...signatureHeaders,
          },
          body,
          signal: controller.signal,
        });

        if (response.ok) {
          return;
        }
        if (response.status < 500 && response.status !== 429) {
          throw new NonRetryableDeliveryError(
            `Bot event API rejected the batch with status ${response.status}.`,
          );
        }
        if (attempt === MAX_ATTEMPTS) {
          throw new Error(
            `Bot event API failed after ${MAX_ATTEMPTS} attempts.`,
          );
        }
        await this.sleep(250 * 2 ** (attempt - 1));
      } catch (error) {
        if (attempt === MAX_ATTEMPTS) {
          throw error;
        }
        if (error instanceof NonRetryableDeliveryError) {
          throw error;
        }
        await this.sleep(250 * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timeout);
      }
    }
  }
}
