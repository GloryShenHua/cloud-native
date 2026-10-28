import type { ReservationStatus, VenueStatus } from '../api/types';

export const venueStatusLabel: Record<VenueStatus, string> = {
  OPEN: '开放',
  DISABLED: '停用',
};

export const reservationStatusLabel: Record<ReservationStatus, string> = {
  ACTIVE: '有效',
  CANCELLED: '已取消',
};

/** 后端返回 HH:mm:ss，界面统一展示到分钟；提交时也使用 HH:mm。 */
export function formatTime(value: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value;
}

export function timeRange(start: string, end: string): string {
  return `${formatTime(start)}–${formatTime(end)}`;
}

/** 用本地时区取当日日期，避免 toISOString() 的 UTC 偏移导致日期差一天。 */
export function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
