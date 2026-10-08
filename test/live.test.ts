import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { Broker, type Sink } from '../src/live.js';

async function serve(broker: Broker) {
  const server = createServer((req, res) => broker.attach(res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string) {
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`stream ended before ${needle}`);
    text += decoder.decode(value);
  }
}

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};

describe('Broker', () => {
  it('publishes to subscribers, sends heartbeats and forgets closed streams', async () => {
    const broker = new Broker(10, 20);
    const srv = await serve(broker);
    try {
      const reader = (await fetch(srv.url)).body!.getReader();
      await readUntil(reader, 'retry: 3000');
      await waitFor(() => broker.subscribers === 1);

      broker.publish({ operation: 'sum' });
      await readUntil(reader, 'event: calc\ndata: {"operation":"sum"}');
      await readUntil(reader, ': keep-alive');

      await reader.cancel();
      await waitFor(() => broker.subscribers === 0);
    } finally {
      await srv.close();
    }
  });

  it('stops accepting at the limit and after close', () => {
    const broker = new Broker(1);
    expect(broker.accepting).toBe(true);
    const ended: Sink[] = [];
    const sink: Sink = {
      write: () => true,
      end: function (this: Sink) {
        ended.push(this);
        return this;
      } as Sink['end'],
      writableNeedDrain: false,
    };
    broker.subs.add(sink);
    expect(broker.accepting).toBe(false);
    broker.close();
    expect(ended).toHaveLength(1);
    expect(broker.subscribers).toBe(0);
    expect(broker.accepting).toBe(false);
  });

  it('drops events for a subscriber whose buffer is full', () => {
    const broker = new Broker(10);
    const writes: string[] = [];
    const make = (full: boolean): Sink => ({
      writableNeedDrain: full,
      write: ((s: string) => writes.push(s) > 0) as Sink['write'],
      end: (() => undefined) as unknown as Sink['end'],
    });
    broker.subs.add(make(true));
    broker.subs.add(make(false));
    broker.publish({ n: 1 });
    broker.publish({ n: 2 });
    expect(broker.dropped).toBe(2);
    expect(writes).toHaveLength(2);
  });
});
