import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, describeError } from '../api/client';
import type { Reservation, ReservationStatus, Venue } from '../api/types';
import { ReservationBadge } from '../components/Badge';
import { EmptyState, ErrorBanner, LoadingBlock } from '../components/Feedback';
import { useToast } from '../components/ToastProvider';
import { formatTime, reservationStatusLabel, timeRange } from '../lib/format';
import { Icon } from '../components/Icon';

const PAGE_SIZE = 20;

type StatusFilter = 'ALL' | ReservationStatus;

export function ReservationsPage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState(searchParams.get('venueId') ?? '');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [offset, setOffset] = useState(0);

  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);

  const [detail, setDetail] = useState<Reservation | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const requestId = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    try {
      const list = await api.listReservations({
        venueId: venueId === '' ? undefined : Number(venueId),
        date: date === '' ? undefined : date,
        status: status === 'ALL' ? undefined : status,
        limit: PAGE_SIZE,
        offset,
      });
      if (current !== requestId.current) return;
      setRows(list);
      setLoadError(null);
    } catch (error) {
      if (current !== requestId.current) return;
      setLoadError(error);
      setRows([]);
    } finally {
      if (current === requestId.current) {
        setLoading(false);
      }
    }
  }, [venueId, date, status, offset]);

  useEffect(() => {
    void api
      .listAllVenues()
      .then(setVenues)
      .catch(() => setVenues([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const venueName = useMemo(() => {
    const map = new Map(venues.map((venue) => [venue.id, venue.name]));
    return (id: number) => map.get(id) ?? `场地 #${id}`;
  }, [venues]);

  const errorInfo = loadError === null ? null : describeError(loadError);
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  function resetFilters() {
    setVenueId('');
    setDate('');
    setStatus('ALL');
    setOffset(0);
    setSearchParams({}, { replace: true });
  }

  async function openDetail(id: number) {
    setDetailLoadingId(id);
    try {
      const reservation = await api.getReservation(id);
      setDetail(reservation);
    } catch (error) {
      const info = describeError(error);
      toast.push({ kind: 'error', title: info.title, message: info.hint });
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function cancel(reservation: Reservation) {
    const confirmed = window.confirm(
      `确认取消预约 #${reservation.id}？\n${reservation.reservationDate} ${timeRange(
        reservation.startTime,
        reservation.endTime,
      )} · ${reservation.organizer}\n\n取消后状态变为「已取消」，该时段可以被重新预约。`,
    );
    if (!confirmed) {
      return;
    }

    setCancellingId(reservation.id);
    try {
      const updated = await api.cancelReservation(reservation.id);
      toast.push({
        kind: 'success',
        title: `预约 #${updated.id} 已取消`,
        message: '记录保留并释放时段，可重新创建同一时段的预约。',
      });
      if (detail?.id === updated.id) {
        setDetail(updated);
      }
      await load();
    } catch (error) {
      const info = describeError(error);
      toast.push({ kind: 'error', title: info.title, message: info.hint });
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>预约记录</h1>
        </div>
        <div className="page-head-actions">
          <button type="button" className="button button--ghost" onClick={() => void load()} disabled={loading}>
            <Icon name="refresh" width={15} height={15} />
            刷新
          </button>
        </div>
      </div>

      <div className="toolbar toolbar--filters">
        <label className="field field--inline">
          <span className="field-label">场地</span>
          <select
            value={venueId}
            onChange={(event) => {
              const value = event.target.value;
              setVenueId(value);
              setOffset(0);
              setSearchParams(value === '' ? {} : { venueId: value }, { replace: true });
            }}
          >
            <option value="">全部场地</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}（#{venue.id}）
              </option>
            ))}
          </select>
        </label>

        <label className="field field--inline">
          <span className="field-label">日期</span>
          <input
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setOffset(0);
            }}
          />
        </label>

        <label className="field field--inline">
          <span className="field-label">状态</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as StatusFilter);
              setOffset(0);
            }}
          >
            <option value="ALL">全部</option>
            <option value="ACTIVE">{reservationStatusLabel.ACTIVE}</option>
            <option value="CANCELLED">{reservationStatusLabel.CANCELLED}</option>
          </select>
        </label>

        <button type="button" className="button button--ghost button--sm" onClick={resetFilters}>
          重置筛选
        </button>
      </div>

      {errorInfo !== null ? (
        <ErrorBanner title={errorInfo.title} hint={errorInfo.hint} onRetry={() => void load()} />
      ) : null}

      {rows === null && loading ? <LoadingBlock label="正在加载预约记录…" /> : null}

      {rows !== null && rows.length === 0 && errorInfo === null ? (
        <EmptyState
          title="没有符合条件的预约"
          description="调整筛选条件，或先到场地详情页创建一条预约。"
          action={
            <Link className="button button--primary button--sm" to="/">
              去场地列表
            </Link>
          }
        />
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>编号</th>
                  <th>场地</th>
                  <th>预约人</th>
                  <th>日期</th>
                  <th>时段</th>
                  <th>使用目的</th>
                  <th>状态</th>
                  <th className="table-actions-head">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((reservation) => (
                  <tr key={reservation.id} className={reservation.status === 'CANCELLED' ? 'is-cancelled' : ''}>
                    <td className="mono">#{reservation.id}</td>
                    <td>
                      <Link to={`/venues/${reservation.venueId}`}>{venueName(reservation.venueId)}</Link>
                    </td>
                    <td>{reservation.organizer}</td>
                    <td className="mono">{reservation.reservationDate}</td>
                    <td className="mono">
                      {formatTime(reservation.startTime)}–{formatTime(reservation.endTime)}
                    </td>
                    <td className="table-purpose" title={reservation.purpose}>
                      {reservation.purpose}
                    </td>
                    <td>
                      <ReservationBadge status={reservation.status} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          disabled={detailLoadingId === reservation.id}
                          onClick={() => void openDetail(reservation.id)}
                        >
                          {detailLoadingId === reservation.id ? '加载中…' : '详情'}
                        </button>
                        <button
                          type="button"
                          className="button button--danger button--sm"
                          disabled={
                            reservation.status === 'CANCELLED' || cancellingId === reservation.id
                          }
                          onClick={() => void cancel(reservation)}
                        >
                          {cancellingId === reservation.id ? '取消中…' : '取消'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pager">
            <span className="muted">
              第 {page} 页 · 每页 {PAGE_SIZE} 条
            </span>
            <div className="pager-actions">
              <button
                type="button"
                className="button button--ghost button--sm"
                disabled={offset === 0 || loading}
                onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              >
                上一页
              </button>
              <button
                type="button"
                className="button button--ghost button--sm"
                disabled={loading || rows.length < PAGE_SIZE}
                onClick={() => setOffset((current) => current + PAGE_SIZE)}
              >
                下一页
              </button>
            </div>
          </div>
        </>
      ) : null}

      {detail === null ? null : (
        <div className="modal-backdrop" role="presentation" onClick={() => setDetail(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`预约 #${detail.id} 详情`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>预约详情 #{detail.id}</h2>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setDetail(null)}>
                ×
              </button>
            </div>
            <dl className="detail-list">
              <div>
                <dt>场地</dt>
                <dd>
                  {venueName(detail.venueId)}（#{detail.venueId}）
                </dd>
              </div>
              <div>
                <dt>预约人</dt>
                <dd>{detail.organizer}</dd>
              </div>
              <div>
                <dt>日期</dt>
                <dd>{detail.reservationDate}</dd>
              </div>
              <div>
                <dt>时段</dt>
                <dd>{timeRange(detail.startTime, detail.endTime)}</dd>
              </div>
              <div>
                <dt>使用目的</dt>
                <dd>{detail.purpose}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  <ReservationBadge status={detail.status} />
                </dd>
              </div>
            </dl>
            <div className="modal-actions">
              <button type="button" className="button button--ghost" onClick={() => setDetail(null)}>
                关闭
              </button>
              <Link
                className="button button--primary"
                to={`/venues/${detail.venueId}`}
                onClick={() => setDetail(null)}
              >
                前往场地
              </Link>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
