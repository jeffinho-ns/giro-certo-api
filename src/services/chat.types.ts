import {
  ChatMemberRole,
  ChatMessageType,
  ConversationDto,
  MessageDto,
} from '../types';

export class ChatHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ChatHttpError';
    this.status = status;
  }
}

export interface ChatIo {
  to(room: string): { emit(event: string, payload: unknown): void };
}

export interface ChatAccess {
  id: string;
  type: 'private' | 'group';
  title: string | null;
  imageUrl: string | null;
  participant1Id: string | null;
  participant2Id: string | null;
  eventId: string | null;
  meetupLabel: string | null;
  meetupLat: number | null;
  meetupLng: number | null;
  meetupAt: Date | string | null;
  myRole: ChatMemberRole | null;
}

export interface ConversationRow {
  id: string;
  type: string;
  title: string | null;
  imageUrl: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: Date | string | null;
  eventId: string | null;
  meetupLabel: string | null;
  meetupLat: number | string | null;
  meetupLng: number | string | null;
  meetupAt: Date | string | null;
  otherId: string | null;
  otherName: string | null;
  otherPhotoUrl: string | null;
  myRole: string | null;
  pinned: boolean | string | number | null;
  archived: boolean | string | number | null;
  muted: boolean | string | number | null;
  unreadCount: number | string | null;
}

export interface MessageRow {
  id: string;
  senderId: string;
  senderName: string | null;
  text: string | null;
  createdAt: Date | string | null;
  type: string | null;
  mediaUrl: string | null;
  mediaDurationMs: number | string | null;
  replyToId: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  locationLabel: string | null;
  deletedAt: Date | string | null;
  replyText: string | null;
  replyType: string | null;
  replyDeletedAt: Date | string | null;
}

export interface OutgoingMessage {
  type: 'text' | 'voice' | 'image' | 'location';
  text: string;
  mediaUrl: string | null;
  mediaDurationMs: number | null;
  replyToId: string | null;
  latitude: number | null;
  longitude: number | null;
  locationLabel: string | null;
}

export interface GroupPatch {
  title?: string;
  imageUrl?: string | null;
}

export interface MeetupPatch {
  label?: string | null;
  lat?: number | null;
  lng?: number | null;
  at?: Date | null;
}

export interface ReportInput {
  userId: string | null;
  chatId: string | null;
  messageId: string | null;
  reason: string;
}

const MESSAGE_TYPES = ['text', 'voice', 'image', 'location'] as const;

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

export function isMemberRole(value: string | null | undefined): value is ChatMemberRole {
  return value === 'leader' || value === 'support' || value === 'sweep' || value === 'member';
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toBool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1;
}

export function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function previewFor(type: string, text: string): string {
  if (type === 'voice') return 'Mensagem de voz';
  if (type === 'image') return 'Foto';
  if (type === 'location') return 'Localização';
  return text.trim().slice(0, 80);
}

export function normalizeMessageType(value: string | null | undefined): ChatMessageType {
  if (
    value === 'voice' ||
    value === 'image' ||
    value === 'location' ||
    value === 'system' ||
    value === 'text'
  ) {
    return value;
  }
  return 'text';
}

export function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ChatHttpError(400, 'Corpo inválido');
  }
  return body as Record<string, unknown>;
}

export function parseFlag(body: unknown, key: string): boolean {
  const value = asRecord(body)[key];
  if (typeof value !== 'boolean') {
    throw new ChatHttpError(400, `${key} deve ser boolean`);
  }
  return value;
}

export function parseUserId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ChatHttpError(400, `${field} inválido`);
  }
  return value.trim();
}

export function parseTitle(value: unknown): string {
  if (typeof value !== 'string') throw new ChatHttpError(400, 'title é obrigatório');
  const title = value.trim();
  if (title.length < 1 || title.length > 80) {
    throw new ChatHttpError(400, 'O título deve ter entre 1 e 80 caracteres.');
  }
  return title;
}

export function parseOptionalImage(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ChatHttpError(400, 'imageUrl inválido');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2000) throw new ChatHttpError(400, 'imageUrl demasiado longo');
  return trimmed;
}

export function parseMemberIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ChatHttpError(400, 'memberIds é obrigatório');
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) ids.push(item.trim());
  }
  return ids;
}

export function parseRole(value: unknown): ChatMemberRole {
  if (isMemberRole(typeof value === 'string' ? value : null)) return value as ChatMemberRole;
  throw new ChatHttpError(400, 'Papel inválido.');
}

export function parseGroupPatch(body: unknown): GroupPatch {
  const record = asRecord(body);
  const hasTitle = Object.prototype.hasOwnProperty.call(record, 'title');
  const hasImage = Object.prototype.hasOwnProperty.call(record, 'imageUrl');
  if (!hasTitle && !hasImage) throw new ChatHttpError(400, 'Nada para atualizar.');
  const patch: GroupPatch = {};
  if (hasTitle) patch.title = parseTitle(record.title);
  if (hasImage) patch.imageUrl = parseOptionalImage(record.imageUrl);
  return patch;
}

export function parseMeetupPatch(body: unknown): MeetupPatch {
  const record = asRecord(body);
  const hasLabel = Object.prototype.hasOwnProperty.call(record, 'label');
  const hasLat = Object.prototype.hasOwnProperty.call(record, 'lat');
  const hasLng = Object.prototype.hasOwnProperty.call(record, 'lng');
  const hasAt = Object.prototype.hasOwnProperty.call(record, 'at');
  if (!hasLabel && !hasLat && !hasLng && !hasAt) {
    throw new ChatHttpError(400, 'Nada para atualizar.');
  }
  if (hasLat !== hasLng) {
    throw new ChatHttpError(400, 'lat e lng devem ser enviados juntos.');
  }
  const patch: MeetupPatch = {};
  if (hasLabel) patch.label = parseNullableString(record.label, 'label', 500);
  if (hasLat && hasLng) {
    const lat = parseNullableCoord(record.lat, 'lat', -90, 90);
    const lng = parseNullableCoord(record.lng, 'lng', -180, 180);
    if ((lat == null) !== (lng == null)) {
      throw new ChatHttpError(400, 'lat e lng devem ser ambos números ou ambos nulos.');
    }
    patch.lat = lat;
    patch.lng = lng;
  }
  if (hasAt) patch.at = parseNullableDate(record.at);
  return patch;
}

export function parseReport(body: unknown): ReportInput {
  const record = asRecord(body);
  if (typeof record.reason !== 'string') throw new ChatHttpError(400, 'reason é obrigatório');
  const reason = record.reason.trim();
  if (!reason || reason.length > 500) {
    throw new ChatHttpError(400, 'reason é obrigatório (máx. 500 caracteres).');
  }
  return {
    userId: optionalId(record.userId, 'userId'),
    chatId: optionalId(record.chatId, 'chatId'),
    messageId: optionalId(record.messageId, 'messageId'),
    reason,
  };
}

export function parseOutgoingMessage(body: unknown): OutgoingMessage {
  const record = asRecord(body);
  const typeValue = record.type == null || record.type === '' ? 'text' : record.type;
  if (typeof typeValue !== 'string' || !MESSAGE_TYPES.includes(typeValue as (typeof MESSAGE_TYPES)[number])) {
    throw new ChatHttpError(400, 'type inválido');
  }
  const type = typeValue as OutgoingMessage['type'];
  const text = parseOptionalText(record.text);
  if (type === 'text' && !text) throw new ChatHttpError(400, 'text é obrigatório');

  const mediaUrl = parseOptionalMedia(record.mediaUrl);
  if ((type === 'voice' || type === 'image') && !mediaUrl) {
    throw new ChatHttpError(400, 'mediaUrl é obrigatório');
  }

  let mediaDurationMs: number | null = null;
  if (type === 'voice' && record.mediaDurationMs != null && record.mediaDurationMs !== '') {
    mediaDurationMs = parseDuration(record.mediaDurationMs);
  }

  let latitude: number | null = null;
  let longitude: number | null = null;
  if (type === 'location') {
    latitude = parseRequiredCoord(record.latitude, 'latitude', -90, 90);
    longitude = parseRequiredCoord(record.longitude, 'longitude', -180, 180);
  }

  return {
    type,
    text,
    mediaUrl: type === 'voice' || type === 'image' ? mediaUrl : null,
    mediaDurationMs: type === 'voice' ? mediaDurationMs : null,
    replyToId: optionalId(record.replyToId, 'replyToId'),
    latitude,
    longitude,
    locationLabel: type === 'location' ? parseNullableString(record.locationLabel, 'locationLabel', 200) : null,
  };
}

export function mapConversation(row: ConversationRow): ConversationDto {
  const isGroup = row.type === 'group';
  const imageUrl = isGroup ? row.imageUrl ?? null : row.otherPhotoUrl ?? null;
  return {
    id: row.id,
    title: isGroup ? row.title?.trim() || 'Grupo' : row.otherName?.trim() || 'Utilizador',
    lastMessagePreview: row.lastMessagePreview ?? '',
    lastMessageAt: toIso(row.lastMessageAt),
    isGroup,
    imageUrl,
    imageUrlOrUserId: isGroup ? imageUrl : row.otherId ?? null,
    unreadCount: toCount(row.unreadCount),
    pinned: toBool(row.pinned),
    archived: toBool(row.archived),
    muted: toBool(row.muted),
    eventId: row.eventId ?? null,
    myRole: isGroup && isMemberRole(row.myRole) ? row.myRole : null,
    meetupLabel: row.meetupLabel ?? null,
    meetupLat: toNumber(row.meetupLat),
    meetupLng: toNumber(row.meetupLng),
    meetupAt: toIso(row.meetupAt),
  };
}

export function mapMessage(row: MessageRow, currentUserId: string): MessageDto {
  const deleted = row.deletedAt != null;
  return {
    id: row.id,
    senderId: row.senderId,
    senderName: row.senderName || 'Utilizador',
    text: deleted ? '' : row.text ?? '',
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    isFromMe: row.senderId === currentUserId,
    type: normalizeMessageType(row.type),
    mediaUrl: deleted ? null : row.mediaUrl ?? null,
    mediaDurationMs: deleted ? null : toNumber(row.mediaDurationMs),
    replyToId: row.replyToId,
    replyPreview: buildReplyPreview(row),
    latitude: deleted ? null : toNumber(row.latitude),
    longitude: deleted ? null : toNumber(row.longitude),
    locationLabel: deleted ? null : row.locationLabel ?? null,
    deleted,
  };
}

function buildReplyPreview(row: MessageRow): string | null {
  if (!row.replyToId || !row.replyType) return null;
  if (row.replyDeletedAt) return '';
  return previewFor(row.replyType, row.replyText ?? '');
}

function optionalId(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  return parseUserId(value, field);
}

function parseOptionalText(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new ChatHttpError(400, 'text inválido');
  const text = value.trim();
  if (text.length > 4000) throw new ChatHttpError(400, 'text pode ter no máximo 4000 caracteres');
  return text;
}

function parseOptionalMedia(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new ChatHttpError(400, 'mediaUrl inválido');
  const url = value.trim();
  if (!url || url.length > 2000) throw new ChatHttpError(400, 'mediaUrl inválido');
  return url;
}

function parseDuration(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 120000) {
    throw new ChatHttpError(400, 'mediaDurationMs inválido');
  }
  return n;
}

function parseRequiredCoord(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ChatHttpError(400, `${field} inválido`);
  }
  return n;
}

function parseNullableCoord(value: unknown, field: string, min: number, max: number): number | null {
  if (value == null || value === '') return null;
  return parseRequiredCoord(value, field, min, max);
}

function parseNullableString(value: unknown, field: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ChatHttpError(400, `${field} inválido`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new ChatHttpError(400, `${field} demasiado longo`);
  return trimmed;
}

function parseNullableDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new ChatHttpError(400, 'at inválido');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ChatHttpError(400, 'at inválido');
  return date;
}
