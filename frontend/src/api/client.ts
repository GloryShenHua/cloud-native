import { apiBaseUrl } from '../config';
import type {
  CreateReservationInput,
  CreateVenueInput,
  FieldIssue,
  Reservation,
  ReservationQuery,
  Venue,
} from './types';

/** 统一的前端错误对象：保留后端 HTTP 状态码与 error.code，供界面分支判断。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: FieldIssue[];

  constructor(status: number, code: string, message: string, details: FieldIssue[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: FieldIssue[];
  };
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = `${apiBaseUrl}${path}`;
  if (!query) {
    return url;
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const queryString = search.toString();
  return queryString === '' ? url : `${url}?${queryString}`;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init?.headers,
      },
    });
  } catch {
    // fetch 只在网络层失败（含代理不可达、请求被浏览器拦截）时抛错。
    throw new ApiError(
      0,
      'NETWORK_UNREACHABLE',
      `无法连接后端服务（${apiBaseUrl}），请确认 API 已启动。`,
      [],
    );
  }

  const body = await readBody(response);

  if (!response.ok) {
    const envelope = body as ErrorEnvelope | undefined;
    const error = envelope?.error;
    throw new ApiError(
      response.status,
      error?.code ?? `HTTP_${response.status}`,
      error?.message ?? `请求失败（HTTP ${response.status}）`,
      Array.isArray(error?.details) ? error.details : [],
    );
  }

  return body as T;
}

function queryOf(query: ReservationQuery): Record<string, string | number | undefined> {
  return {
    venueId: query.venueId,
    date: query.date,
    status: query.status,
    limit: query.limit,
    offset: query.offset,
  };
}

export const api = {
  listVenues(limit = 100, offset = 0): Promise<Venue[]> {
    return request<Venue[]>(buildUrl('/venues', { limit, offset }));
  },

  getVenue(id: number): Promise<Venue> {
    return request<Venue>(buildUrl(`/venues/${id}`));
  },

  createVenue(input: CreateVenueInput): Promise<Venue> {
    return request<Venue>(buildUrl('/venues'), {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  listReservations(query: ReservationQuery = {}): Promise<Reservation[]> {
    return request<Reservation[]>(buildUrl('/reservations', queryOf(query)));
  },

  getReservation(id: number): Promise<Reservation> {
    return request<Reservation>(buildUrl(`/reservations/${id}`));
  },

  createReservation(input: CreateReservationInput): Promise<Reservation> {
    return request<Reservation>(buildUrl('/reservations'), {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /** 显式取消接口；后端同时提供等价的 DELETE /reservations/{id}。 */
  cancelReservation(id: number): Promise<Reservation> {
    return request<Reservation>(buildUrl(`/reservations/${id}/cancel`), { method: 'POST' });
  },
};

/** 把错误码翻译成面向用户的标题与处理建议，业务分支判断使用 status / code。 */
export function describeError(error: unknown): { title: string; hint: string } {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RESERVATION_CONFLICT':
        return {
          title: '预约时间冲突',
          hint: '可参考表单中的「当日已占用时段」调整时间，或先取消原预约后重新提交。',
        };
      case 'INVALID_ARGUMENT':
        return {
          title: '请求参数有误',
          hint: error.details.length > 0
            ? '请检查标红的字段后重新提交。'
            : '请检查必填项、日期格式、时间范围与场地状态。',
        };
      case 'NOT_FOUND':
        return { title: '资源不存在', hint: '记录可能已被删除或编号错误，请刷新列表。' };
      case 'DATABASE_UNAVAILABLE':
        return { title: '数据库暂不可用', hint: '后端正在重连或等待锁超时，请稍后重试。' };
      case 'INTERNAL_ERROR':
        return { title: '服务端内部错误', hint: '后端处理失败，请查看 api 容器日志。' };
      case 'NETWORK_UNREACHABLE':
        return { title: '无法连接后端', hint: error.message };
      case 'HTTP_403':
        // Spring 的 CORS 拒绝不返回 JSON 错误体，只能靠状态码判断。
        return {
          title: '请求被后端拒绝（403）',
          hint: `当前页面来源 ${
            typeof window === 'undefined' ? '' : window.location.origin
          } 可能不在后端跨域白名单中：把该 origin 加入 CORS_ALLOWED_ORIGINS 后重启 api。`,
        };
      default:
        return {
          title: `请求失败（HTTP ${error.status}）`,
          hint: '请结合状态码检查请求内容与浏览器控制台，服务端日志见 api 容器。',
        };
    }
  }
  return { title: '请求失败', hint: error instanceof Error ? error.message : '未知错误' };
}

export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.details.length === 0) {
    return {};
  }
  return Object.fromEntries(error.details.map((issue) => [issue.field, issue.message]));
}
