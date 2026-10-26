import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, describeError, fieldErrorsOf } from '../api/client';
import type { CreateVenueInput, Venue, VenueStatus } from '../api/types';
import { EmptyState, ErrorBanner, LoadingBlock } from '../components/Feedback';
import { VenueBadge } from '../components/Badge';
import { useToast } from '../components/ToastProvider';
import { venueStatusLabel } from '../lib/format';
import { Icon } from '../components/Icon';

type StatusFilter = 'ALL' | VenueStatus;
const PAGE_SIZE = 12;

export function VenuesPage() {
  const toast = useToast();
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listAllVenues();
      setVenues(list);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (venues === null) {
      return [];
    }
    const needle = keyword.trim().toLowerCase();
    return venues.filter((venue) => {
      const matchesStatus = statusFilter === 'ALL' || venue.status === statusFilter;
      const matchesKeyword =
        needle === '' ||
        venue.name.toLowerCase().includes(needle) ||
        venue.location.toLowerCase().includes(needle);
      return matchesStatus && matchesKeyword;
    });
  }, [venues, keyword, statusFilter]);

  const errorInfo = loadError === null ? null : describeError(loadError);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleVenues = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>场地列表</h1>
        </div>
        <div className="page-head-actions">
          <button type="button" className="button button--ghost" onClick={() => void load()} disabled={loading}>
            <Icon name="refresh" width={15} height={15} />
            刷新
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => setShowCreate((current) => !current)}
          >
            <Icon name="plus" width={16} height={16} />
            {showCreate ? '收起新建表单' : '新建场地'}
          </button>
        </div>
      </div>

      {showCreate ? (
        <CreateVenuePanel
          onCreated={(venue) => {
            toast.push({
              kind: 'success',
              title: `已创建场地 #${venue.id}`,
              message: `${venue.name}（${venue.location}）`,
            });
            setShowCreate(false);
            setPage(1);
            void load();
          }}
        />
      ) : null}

      <div className="toolbar venue-toolbar">
        <label className="field field--inline">
          <span className="field-label">关键词</span>
          <span className="search-input">
            <Icon name="search" width={16} height={16} />
            <input
              value={keyword}
              placeholder="按名称或位置筛选"
              onChange={(event) => {
                setKeyword(event.target.value);
                setPage(1);
              }}
            />
          </span>
        </label>
        <label className="field field--inline">
          <span className="field-label">状态</span>
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as StatusFilter);
              setPage(1);
            }}
          >
            <option value="ALL">全部</option>
            <option value="OPEN">{venueStatusLabel.OPEN}</option>
            <option value="DISABLED">{venueStatusLabel.DISABLED}</option>
          </select>
        </label>
        <span className="toolbar-meta muted">
          {venues === null ? '正在加载场地…' : `共 ${venues.length} 个场地，匹配 ${filtered.length} 个`}
        </span>
      </div>

      {errorInfo !== null ? (
        <ErrorBanner title={errorInfo.title} hint={errorInfo.hint} onRetry={() => void load()} />
      ) : null}

      {loading && venues === null ? <LoadingBlock label="正在加载场地列表…" /> : null}

      {venues !== null && filtered.length === 0 ? (
        <EmptyState
          title="没有匹配的场地"
          description={
            venues.length === 0
              ? '还没有可用场地，可以先新建场地。'
              : '调整关键词或状态筛选后再试。'
          }
        />
      ) : null}

      <div className="venue-grid">
        {visibleVenues.length > 0 ? (
          <div className="venue-directory-head" aria-hidden="true">
            <span>场地 / 位置</span><span>容量 / 开放时间</span><span>状态</span><span>操作</span>
          </div>
        ) : null}
        {visibleVenues.map((venue) => (
          <article key={venue.id} className="card venue-card">
            <div className="venue-card-head">
              <span className="venue-index" title={`场地编号 ${venue.id}`}>#{venue.id}</span>
              <div>
                <h2 title={venue.name}><Link to={`/venues/${venue.id}`}>{venue.name}</Link></h2>
                <p className="muted" title={venue.location}>{venue.location}</p>
              </div>
            </div>

            <dl className="venue-meta">
              <div>
                <dt>容纳人数</dt>
                <dd>{venue.capacity} 人</dd>
              </div>
              <div>
                <dt>开放时间</dt>
                <dd>
                  {venue.openingTime.slice(0, 5)}–{venue.closingTime.slice(0, 5)}
                </dd>
              </div>
            </dl>

            <VenueBadge status={venue.status} />
            <div className="venue-card-actions">
              <Link
                className="venue-record-link"
                to={`/reservations?venueId=${venue.id}`}
                aria-label={`查看${venue.name}的预约记录`}
              >
                记录
              </Link>
              <Link className="button button--outline button--sm" to={`/venues/${venue.id}`}
                aria-label={venue.status === 'OPEN' ? `预约${venue.name}` : `查看${venue.name}详情`}>
                {venue.status === 'OPEN' ? '预约' : '详情'}
                <Icon name="arrow-right" width={14} height={14} />
              </Link>
            </div>
          </article>
        ))}
      </div>
      {filtered.length > 0 ? (
        <nav className="pager" aria-label="场地分页">
          <span className="muted">第 {currentPage} / {pageCount} 页 · 每页 {PAGE_SIZE} 个</span>
          <div className="pager-actions">
            <button type="button" className="button button--ghost button--sm"
              disabled={loading || currentPage === 1} onClick={() => setPage(currentPage - 1)}>
              上一页
            </button>
            <button type="button" className="button button--ghost button--sm"
              disabled={loading || currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>
              下一页
            </button>
          </div>
        </nav>
      ) : null}
    </section>
  );
}

const emptyVenue: CreateVenueInput = {
  name: '',
  location: '',
  capacity: 20,
  openingTime: '08:00',
  closingTime: '22:00',
  status: 'OPEN',
};

function CreateVenuePanel({ onCreated }: { onCreated: (venue: Venue) => void }) {
  const [values, setValues] = useState<CreateVenueInput>(emptyVenue);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof CreateVenueInput>(key: K, value: CreateVenueInput[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (values.name.trim() === '') next.name = '请填写场地名称';
    if (values.location.trim() === '') next.location = '请填写所在位置';
    if (!Number.isInteger(values.capacity) || values.capacity <= 0) next.capacity = '容纳人数需为正整数';
    if (values.openingTime >= values.closingTime) next.closingTime = '关闭时间必须晚于开放时间';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      return;
    }

    setSubmitting(true);
    setFailure(null);
    try {
      const created = await api.createVenue({
        ...values,
        name: values.name.trim(),
        location: values.location.trim(),
      });
      setValues(emptyVenue);
      onCreated(created);
    } catch (error) {
      setFailure(error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', String(error)));
      setErrors(fieldErrorsOf(error));
    } finally {
      setSubmitting(false);
    }
  }

  const failureInfo = failure === null ? null : describeError(failure);

  return (
    <form className="card create-panel" onSubmit={handleSubmit} noValidate>
      <div className="card-head">
        <h2>新建场地</h2>
        <p className="muted">填写场地信息和每日开放时间。</p>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">名称</span>
          <input
            value={values.name}
            maxLength={100}
            placeholder="例如：第三会议室"
            className={errors.name === undefined ? '' : 'is-invalid'}
            onChange={(event) => update('name', event.target.value)}
          />
          {errors.name === undefined ? null : <span className="field-error">{errors.name}</span>}
        </label>

        <label className="field">
          <span className="field-label">所在位置</span>
          <input
            value={values.location}
            maxLength={255}
            placeholder="例如：办公楼 A303"
            className={errors.location === undefined ? '' : 'is-invalid'}
            onChange={(event) => update('location', event.target.value)}
          />
          {errors.location === undefined ? null : <span className="field-error">{errors.location}</span>}
        </label>

        <label className="field">
          <span className="field-label">容纳人数</span>
          <input
            type="number"
            min={1}
            step={1}
            value={values.capacity}
            className={errors.capacity === undefined ? '' : 'is-invalid'}
            onChange={(event) => update('capacity', Number(event.target.value))}
          />
          {errors.capacity === undefined ? null : <span className="field-error">{errors.capacity}</span>}
        </label>

        <label className="field">
          <span className="field-label">状态</span>
          <select
            value={values.status}
            onChange={(event) => update('status', event.target.value as VenueStatus)}
          >
            <option value="OPEN">{venueStatusLabel.OPEN}</option>
            <option value="DISABLED">{venueStatusLabel.DISABLED}</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label">开放时间</span>
          <input
            type="time"
            value={values.openingTime}
            onChange={(event) => update('openingTime', event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">关闭时间</span>
          <input
            type="time"
            value={values.closingTime}
            className={errors.closingTime === undefined ? '' : 'is-invalid'}
            onChange={(event) => update('closingTime', event.target.value)}
          />
          {errors.closingTime === undefined ? null : (
            <span className="field-error">{errors.closingTime}</span>
          )}
        </label>
      </div>

      {failure !== null && failureInfo !== null ? (
        <div className="alert alert--error" role="alert">
          <div className="alert-body">
            <strong>{failureInfo.title}</strong>
            <p>{failureInfo.hint}</p>
          </div>
        </div>
      ) : null}

      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={submitting}>
          {submitting ? '提交中…' : '创建场地'}
        </button>
      </div>
    </form>
  );
}
