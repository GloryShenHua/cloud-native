import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, describeError, fieldErrorsOf } from '../api/client';
import type { Reservation, Venue } from '../api/types';
import { formatTime, timeRange } from '../lib/format';

interface Props {
  venue: Venue;
  /** 已选日期，由父组件持有，便于同时加载该日期的已占用时段。 */
  date: string;
  onDateChange: (date: string) => void;
  /** 该场地当日的有效预约，仅作为时间参考；冲突判定仍由后端完成。 */
  bookedSlots: Reservation[];
  slotsLoading?: boolean;
  slotsUnavailable?: boolean;
  onCreated: (reservation: Reservation) => void;
  onRefreshSlots: () => void;
  /** 提交前通知父组件，用于收起上一次的成功提示。 */
  onSubmitStart?: () => void;
}

interface FormValues {
  organizer: string;
  startTime: string;
  endTime: string;
  purpose: string;
}

const initialValues: FormValues = {
  organizer: '',
  startTime: '10:00',
  endTime: '11:00',
  purpose: '',
};

export function BookingForm({
  venue,
  date,
  onDateChange,
  bookedSlots,
  slotsLoading = false,
  slotsUnavailable = false,
  onCreated,
  onRefreshSlots,
  onSubmitStart,
}: Props) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const alertRef = useRef<HTMLDivElement | null>(null);

  const disabled = venue.status !== 'OPEN';

  // 失败信息在表单下方，提交后滚动到可见位置，避免用户以为没有反应。
  useEffect(() => {
    if (failure !== null) {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [failure]);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (current[key] === undefined) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (values.organizer.trim() === '') {
      next.organizer = '请填写预约人或组织名称';
    }
    if (date === '') {
      next.reservationDate = '请选择预约日期';
    }
    if (values.startTime === '') {
      next.startTime = '请选择开始时间';
    }
    if (values.endTime === '') {
      next.endTime = '请选择结束时间';
    }
    if (values.startTime !== '' && values.endTime !== '' && values.startTime >= values.endTime) {
      next.endTime = '结束时间必须晚于开始时间';
    }
    if (values.purpose.trim() === '') {
      next.purpose = '请填写使用目的';
    }
    return next;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFailure(null);
      return;
    }

    setSubmitting(true);
    setFailure(null);
    onSubmitStart?.();
    try {
      const created = await api.createReservation({
        venueId: venue.id,
        organizer: values.organizer.trim(),
        reservationDate: date,
        startTime: values.startTime,
        endTime: values.endTime,
        purpose: values.purpose.trim(),
      });
      setValues((current) => ({ ...current, purpose: '' }));
      setErrors({});
      onCreated(created);
    } catch (error) {
      setFailure(error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', String(error)));
      setErrors(fieldErrorsOf(error));
      // 409 说明服务端拒绝了重叠时段，刷新该场地当日占用情况便于重新选择。
      if (error instanceof ApiError && error.code === 'RESERVATION_CONFLICT') {
        onRefreshSlots();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const failureInfo = failure === null ? null : describeError(failure);

  return (
    <form className="card booking-form" onSubmit={handleSubmit} noValidate>
      <div className="card-head">
        <h2>创建预约</h2>
        <p className="muted">
          开放时间 {formatTime(venue.openingTime)}–{formatTime(venue.closingTime)}，预约时段需落在此范围内。
        </p>
      </div>

      {disabled ? (
        <div className="alert alert--warning" role="status">
          该场地当前为「停用」状态，无法创建预约。
        </div>
      ) : null}

      <div className="form-grid">
        <label className="field field--full">
          <span className="field-label">预约人 / 组织</span>
          <input
            className={errors.organizer === undefined ? '' : 'is-invalid'}
            value={values.organizer}
            maxLength={100}
            placeholder="例如：研发团队"
            onChange={(event) => update('organizer', event.target.value)}
          />
          {errors.organizer === undefined ? null : <span className="field-error">{errors.organizer}</span>}
        </label>

        <label className="field">
          <span className="field-label">预约日期</span>
          <input
            type="date"
            className={errors.reservationDate === undefined ? '' : 'is-invalid'}
            value={date}
            onChange={(event) => onDateChange(event.target.value)}
          />
          {errors.reservationDate === undefined ? null : (
            <span className="field-error">{errors.reservationDate}</span>
          )}
        </label>

        <div className="field field--times">
          <span className="field-label">时间段</span>
          <div className="time-inputs">
            <input
              type="time"
              aria-label="开始时间"
              className={errors.startTime === undefined ? '' : 'is-invalid'}
              value={values.startTime}
              onChange={(event) => update('startTime', event.target.value)}
            />
            <span className="time-sep">至</span>
            <input
              type="time"
              aria-label="结束时间"
              className={errors.endTime === undefined ? '' : 'is-invalid'}
              value={values.endTime}
              onChange={(event) => update('endTime', event.target.value)}
            />
          </div>
          {errors.startTime === undefined && errors.endTime === undefined ? null : (
            <span className="field-error">{errors.endTime ?? errors.startTime}</span>
          )}
        </div>

        <label className="field field--full">
          <span className="field-label">使用目的</span>
          <textarea
            className={errors.purpose === undefined ? '' : 'is-invalid'}
            value={values.purpose}
            rows={3}
            maxLength={500}
            placeholder="例如：需求评审"
            onChange={(event) => update('purpose', event.target.value)}
          />
          {errors.purpose === undefined ? null : <span className="field-error">{errors.purpose}</span>}
        </label>
      </div>

      <div className="slot-hint">
        <span className="slot-hint-title">当日已占用时段</span>
        {slotsLoading ? (
          <span className="muted" role="status">正在加载占用时段…</span>
        ) : slotsUnavailable ? (
          <span role="status">
            暂时无法加载占用时段，请刷新后确认。
            <button type="button" className="button button--ghost button--sm" onClick={onRefreshSlots}>重试</button>
          </span>
        ) : bookedSlots.length === 0 ? (
          <span className="muted">暂无有效预约</span>
        ) : (
          <div className="slot-chips">
            {bookedSlots.map((slot) => (
              <span
                key={slot.id}
                className="chip chip--booked"
                title={`${slot.organizer} · ${slot.purpose}`}
              >
                {timeRange(slot.startTime, slot.endTime)}
              </span>
            ))}
          </div>
        )}
        <span className="slot-hint-note">
          已占用时段不可重复预约，相邻时段可正常预约。
        </span>
      </div>

      {failure !== null && failureInfo !== null ? (
        <div className="alert alert--error" role="alert" ref={alertRef}>
          <div className="alert-body">
            <strong>{failureInfo.title}</strong>
            <p>{failureInfo.hint}</p>
          </div>
        </div>
      ) : null}

      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={submitting || disabled}>
          {submitting ? '提交中…' : '提交预约'}
        </button>
        <button
          type="button"
          className="button button--ghost"
          disabled={submitting}
          onClick={() => {
            setValues(initialValues);
            setErrors({});
            setFailure(null);
          }}
        >
          重置
        </button>
      </div>
    </form>
  );
}
