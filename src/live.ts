// Fans calculation events out to browsers over Server-Sent Events.
//
// Publishing never blocks a request: when a subscriber's socket buffer is
// full, the event is dropped for that subscriber and counted. Each process
// streams its own events; cross-replica fan-out is in docs/PLAN.md.

import type { ServerResponse } from 'node:http';

/** The part of a response the broker writes to. */
export type Sink = Pick<ServerResponse, 'write' | 'end' | 'writableNeedDrain'>;

export class Broker {
  readonly subs = new Set<Sink>();
  dropped = 0;
  private closed = false;

  constructor(
    readonly maxStreams: number,
    private readonly heartbeatMs = 15_000,
  ) {}

  get subscribers(): number {
    return this.subs.size;
  }

  get accepting(): boolean {
    return !this.closed && this.subs.size < this.maxStreams;
  }

  publish(value: unknown): void {
    const frame = `event: calc\ndata: ${JSON.stringify(value)}\n\n`;
    for (const sink of this.subs) {
      if (sink.writableNeedDrain) this.dropped++;
      else sink.write(frame);
    }
  }

  /** Ends every stream and refuses new ones; the server would wait on them otherwise. */
  close(): void {
    this.closed = true;
    for (const sink of this.subs) sink.end();
    this.subs.clear();
  }

  /** Takes over a raw response. Call only when `accepting` is true. */
  attach(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.subs.add(res);

    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), this.heartbeatMs);
    heartbeat.unref();
    res.on('close', () => {
      clearInterval(heartbeat);
      this.subs.delete(res);
    });
  }
}
