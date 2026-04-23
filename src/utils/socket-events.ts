import type { Application } from 'express';
import type { Server } from 'socket.io';

export function getIo(app: Application): Server | undefined {
  return app.get('io') as Server | undefined;
}

export function ioEmit(app: Application, event: string, payload: unknown): void {
  const io = getIo(app);
  if (io) {
    io.emit(event, payload);
  }
}
