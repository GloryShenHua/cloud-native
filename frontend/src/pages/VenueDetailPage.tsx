import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, describeError } from '../api/client';
import type { Reservation, Venue } from '../api/types';
import { BookingForm } from '../components/BookingForm';
import { ReservationBadge, VenueBadge } from '../components/Badge';
import { EmptyState, ErrorBanner, LoadingBlock } from '../components/Feedback';
import { useToast } from '../components/ToastProvider';
import { formatTime, timeRange, todayIso } from '../lib/format';

export function VenueDetailPage() {
  const { id } = useParams<{ id: string }>();
  // 切换场地时重建页面状态，避免旧场地和预约表单在新地址下继续显示。
  return <VenueDetailContent key={id} venueId={Number(id)} />;
}

function VenueDetailContent({ venueId }: { venueId: number }) {
  const toast = useToast();

  const [venue, setVenue] = useState<Venue | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayIso());
  const [slots, setSlots] = useState<Reservation[]>([]);
  const [recent, setRecent] = useState<Reservation[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsUnavailable, setSlotsUnavailable] = useState(false);
  const [recentError, setRecentError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const refreshReservations = () => setRevision((current) => current + 1);
  const [created, setCreated] = useState<Reservation | null>(null);

  const loadVenue = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await api.getVenue(venueId);
      setVenue(detail);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (!Number.isSafeInteger(venueId) || venueId <= 0) {
      setLoadError(new ApiError(400, 'INVALID_ARGUMENT', '场地编号无效'));
      setLoading(false);
      setRecent([]);
      return;
    }
    void loadVenue();
  }, [venueId, loadVenue]);

  useEffect(() => {
    let active = true;
    setSlots([]);
    setSlotsUnavailable(false);
    if (!Number.isSafeInteger(venueId) || venueId <= 0 || date === '') {
      setSlotsLoading(false);
      return;
    }
    setSlotsLoading(true);
    void api.listReservations({ venueId, date, status: 'ACTIVE', limit: 200 })
      .then((list) => { if (active) setSlots(list); })
      .catch(() => { if (active) setSlotsUnavailable(true); })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [venueId, date, revision]);

  useEffect(() => {
    if (!Number.isSafeInteger(venueId) || venueId <= 0) return;
    let active = true;
    setRecent(null);
    setRecentError(null);
    void api.listReservations({ venueId, limit: 20, order: 'DESC' })
      .then((list) => { if (active) setRecent(list); })
      .catch((error: unknown) => { if (active) setRecentError(error); });
    return () => { active = false; };
  }, [venueId, revision]);

  const errorInfo = loadError === null ? null : describeError(loadError);

  if (loading && venue === null && errorInfo === null) {
    return <LoadingBlock label="正在加载场地详情…" />;
  }

  if (errorInfo !== null) {
    return (
      <section className="page">
        <Link to="/" className="back-link">
          ← 返回场地列表
        </Link>
        <ErrorBanner
          title={errorInfo.title}
          hint={errorInfo.hint}
          onRetry={() => {
            setLoadError(null);
            void loadVenue();
          }}
        />
      </section>
    );
  }

  if (venue === null) {
    return null;
  }

  return (
    <section className="page">
      <Link to="/" className="back-link">
        ← 返回场地列表
      </Link>

      <div className="venue-hero card">
        <div className="venue-hero-main">
          <div className="venue-hero-title">
            <h1>{venue.name}</h1>
            <VenueBadge status={venue.status} />
          </div>
          <dl className="venue-hero-meta">
            <div>
              <dt>编号</dt>
              <dd>#{venue.id}</dd>
            </div>
            <div>
              <dt>位置</dt>
              <dd>{venue.location}</dd>
            </div>
            <div>
              <dt>容纳人数</dt>
              <dd>{venue.capacity} 人</dd>
            </div>
            <div>
              <dt>开放时间</dt>
              <dd>
                {formatTime(venue.openingTime)}–{formatTime(venue.closingTime)}
              </dd>
            </div>
          </dl>
        </div>
        <Link className="button button--ghost" to={`/reservations?venueId=${venue.id}`}>
          查看该场地预约记录
        </Link>
      </div>

      {created === null ? null : (
        <div className="card created-card" role="status">
          <div className="created-card-head">
            <span className="check-mark" aria-hidden="true">
              ✓
            </span>
            <div>
              <h2>预约成功</h2>
              <p className="muted">预约编号 #{created.id}</p>
            </div>
          </div>
          <dl className="created-card-meta">
            <div>
              <dt>场地</dt>
              <dd>
                {venue.name}（#{venue.id}）
              </dd>
            </div>
            <div>
              <dt>日期</dt>
              <dd>{created.reservationDate}</dd>
            </div>
            <div>
              <dt>时段</dt>
              <dd>{timeRange(created.startTime, created.endTime)}</dd>
            </div>
            <div>
              <dt>预约人</dt>
              <dd>{created.organizer}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>
                <ReservationBadge status={created.status} />
              </dd>
            </div>
            <div>
              <dt>使用目的</dt>
              <dd>{created.purpose}</dd>
            </div>
          </dl>
          <div className="created-card-actions">
            <Link className="button button--primary button--sm" to={`/reservations?venueId=${venue.id}`}>
              在预约记录中查看
            </Link>
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => setCreated(null)}
            >
              继续预约
            </button>
          </div>
        </div>
      )}

      <div className="detail-grid">
        <BookingForm
          venue={venue}
          date={date}
          onDateChange={setDate}
          bookedSlots={slots}
          slotsLoading={slotsLoading}
          slotsUnavailable={slotsUnavailable}
          onCreated={(reservation) => {
            setCreated(reservation);
            toast.push({
              kind: 'success',
              title: '预约创建成功',
              message: `#${reservation.id} · ${reservation.reservationDate} ${timeRange(
                reservation.startTime,
                reservation.endTime,
              )}`,
            });
            refreshReservations();
          }}
          onRefreshSlots={refreshReservations}
          onSubmitStart={() => setCreated(null)}
        />

        <aside className="card recent-card">
          <div className="card-head">
            <h2>该场地近期预约</h2>
            <p className="muted">
              展示最近创建的 20 条预约，最新记录在前。
            </p>
          </div>

          {recentError !== null ? (
            <ErrorBanner title="预约记录暂时无法加载" hint="请稍后重试。" onRetry={refreshReservations} />
          ) : recent === null ? (
            <LoadingBlock label="正在加载…" />
          ) : recent.length === 0 ? (
            <EmptyState title="暂无预约记录" description="该场地还没有任何预约，创建第一条即可。" />
          ) : (
            <ul className="timeline">
              {recent.map((reservation) => (
                <li key={reservation.id} className={reservation.status === 'CANCELLED' ? 'is-cancelled' : ''}>
                  <div className="timeline-head">
                    <span className="timeline-id">#{reservation.id}</span>
                    <ReservationBadge status={reservation.status} />
                  </div>
                  <p className="timeline-when">
                    {reservation.reservationDate} · {timeRange(reservation.startTime, reservation.endTime)}
                  </p>
                  <p className="timeline-who">
                    {reservation.organizer} · {reservation.purpose}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
