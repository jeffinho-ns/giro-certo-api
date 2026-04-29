import type { Application } from 'express';
import type { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { queryOne } from '../lib/db';
import { UserRole } from '../types';

export function getIo(app: Application): Server | undefined {
  return app.get('io') as Server | undefined;
}

export function ioEmit(app: Application, event: string, payload: unknown): void {
  const io = getIo(app);
  if (io) {
    io.emit(event, payload);
  }
}

export function ioEmitToRoom(
  app: Application,
  room: string,
  event: string,
  payload: unknown
): void {
  const io = getIo(app);
  if (io) {
    io.to(room).emit(event, payload);
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

type SocketAuthUser = {
  id: string;
  role: UserRole;
  partnerId: string | null;
};

export async function resolveSocketUserFromToken(
  rawToken?: string | null
): Promise<SocketAuthUser | null> {
  const token = rawToken?.trim();
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId?: string };
    if (!decoded.userId) return null;
    const user = await queryOne<SocketAuthUser>(
      `SELECT id, role, "partnerId"
       FROM "User"
       WHERE id = $1`,
      [decoded.userId]
    );
    return user ?? null;
  } catch {
    return null;
  }
}

export async function canJoinOrderTrackingRoom(
  user: SocketAuthUser,
  orderId: string
): Promise<boolean> {
  if (!orderId || orderId.trim().length === 0) return false;
  if (user.role === UserRole.ADMIN) return true;
  const order = await queryOne<{ storeId: string; riderId: string | null }>(
    `SELECT "storeId", "riderId"
     FROM "DeliveryOrder"
     WHERE id = $1`,
    [orderId]
  );
  if (!order) return false;
  if (order.riderId && order.riderId === user.id) return true;
  if (user.partnerId && order.storeId === user.partnerId) return true;
  return false;
}
