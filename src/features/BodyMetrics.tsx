import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { AppData, BodyMetric } from '../domain/types';
import {
  bodyLabels,
  bodySeries,
  latestBodyValue,
  measurementKeys,
  parseBodyForm,
  putBodyMetric,
  removeBodyMetric,
  type BodyField,
  type BodyForm,
  type BodySeriesKey,
} from '../domain/body-metrics';
import { dayKey, shiftDate } from '../domain/analytics';
import { displayWeight } from '../domain/units';
import { uid } from '../domain/training';
import Modal from '../components/Modal';
import TrendChart from '../components/TrendChart';
import Presence from '../motion/Presence';

type Props = {
  data: AppData;
  writable: boolean;
  mutate: (fn: (data: AppData) => AppData) => Promise<boolean>;
  retry: () => Promise<boolean>;
  notify: (text: string) => void;
};
export default function BodyMetrics({ data, writable, mutate, retry, notify }: Props) {
  const [editor, setEditor] = useState<{ id: string; original?: BodyMetric } | null>(null);
  const [removing, setRemoving] = useState<BodyMetric | null>(null);
  const [key, setKey] = useState<BodySeriesKey>('weight');
  const [period, setPeriod] = useState('90');
  const [limit, setLimit] = useState(10);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const attempted = useRef<BodyMetric | undefined>(undefined);
  const pendingRemoval = useRef<string | null>(null);
  const removalIndex = useRef(0);
  const unit = data.settings.unit;
  const today = dayKey(new Date());
  const records = [...data.bodyMetrics].sort((a, b) => b.date.localeCompare(a.date));
  const points = bodySeries(
    records,
    key,
    unit,
    period === 'all' ? undefined : shiftDate(today, 1 - Number(period)),
    period === 'all' ? undefined : today,
  );
  const suffix = (metric: BodySeriesKey) => (metric === 'weight' ? unit : metric === 'bodyFat' ? '%' : 'cm');
  async function cancelEditor() {
    if (!editor) return;
    if (!attempted.current) {
      setEditor(null);
      return;
    }
    const pending = attempted.current;
    let restored = false;
    await mutate((latest) => {
      const bodyMetrics = editor.original
        ? putBodyMetric(latest.bodyMetrics, editor.original, pending)
        : removeBodyMetric(latest.bodyMetrics, pending);
      restored = true;
      return { ...latest, bodyMetrics };
    });
    if (restored) {
      attempted.current = undefined;
      setEditor(null);
      notify('已撤销这次身体记录更改，磁盘原数据保持；其他未保存内容可重试保存');
    }
  }
  async function cancelRemoval() {
    if (busy || !removing) return;
    if (pendingRemoval.current !== removing.id) {
      setRemoving(null);
      return;
    }
    setBusy(true);
    let restored = false;
    await mutate((latest) => {
      const restoredRecords = putBodyMetric(latest.bodyMetrics, removing);
      // Restore its original position as well as its values; do not replace unrelated records.
      const bodyMetrics = restoredRecords.slice(0, -1);
      bodyMetrics.splice(Math.min(removalIndex.current, bodyMetrics.length), 0, removing);
      restored = true;
      return { ...latest, bodyMetrics };
    });
    setBusy(false);
    if (restored) {
      pendingRemoval.current = null;
      setRemoving(null);
      notify('已撤销删除，身体记录保留；其他未保存内容可重试保存');
    } else setRemoveError('记录已变化，暂未关闭。请重新载入本机数据后核对。');
  }
  return (
    <section className="card body-metrics" aria-labelledby="body-metrics-title">
      <div className="section-heading body-heading">
        <div>
          <h2 id="body-metrics-title">身体数据</h2>
          <p className="muted">留意变化，按自己的节奏记录。</p>
        </div>
        <button
          className="btn btn-primary"
          disabled={!writable}
          onClick={() => {
            attempted.current = undefined;
            setEditor({ id: uid() });
          }}
        >
          记录身体数据
        </button>
      </div>
      <div className="body-latest">
        {(['weight', 'bodyFat', 'waist'] as const).map((metric) => {
          const latest = latestBodyValue(records, metric, unit);
          return (
            <div key={metric}>
              <span>{bodyLabels[metric]}</span>
              <div className="body-value">
                <strong>{latest?.value ?? '—'}</strong>
                <span>{suffix(metric)}</span>
              </div>
              <small>{latest?.date ?? '尚未记录'}</small>
            </div>
          );
        })}
      </div>
      <div className="body-trend-head">
        <h3>身体趋势</h3>
        <div className="body-controls">
          <label className="field">
            指标
            <select
              className="form-select"
              aria-label="身体趋势指标"
              value={key}
              onChange={(event) => setKey(event.target.value as BodySeriesKey)}
            >
              {Object.entries(bodyLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            范围
            <select
              className="form-select"
              aria-label="身体趋势范围"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            >
              <option value="30">最近30天</option>
              <option value="90">最近90天</option>
              <option value="all">全部记录</option>
            </select>
          </label>
        </div>
      </div>
      <TrendChart
        key={`${key}-${period}-${unit}`}
        title={`${bodyLabels[key]}趋势`}
        points={points}
        format={(value) => `${value} ${suffix(key)}`}
        empty="这个范围内尚未记录这项指标"
        emptyHint="填写实际测量值后显示趋势，缺项不会补成0。"
      />
      <div className="section-heading body-record-heading">
        <h3>记录明细</h3>
        <span className="tag">{records.length} 条</span>
      </div>
      {!records.length ? (
        <p className="muted body-empty">体重、体脂或围度任选一项即可。每天一条，随时可以补充或修正。</p>
      ) : (
        <ul className="body-records">
          {records.slice(0, limit).map((record) => (
            <li key={record.id}>
              <div className="body-record-copy">
                <strong>
                  <time dateTime={record.date}>{record.date}</time>
                </strong>
                <dl className="body-record-values">
                  {Object.keys(bodyLabels).map((metric) => {
                    const value = bodySeries([record], metric as BodySeriesKey, unit)[0]?.value;
                    return value === undefined ? null : (
                      <div key={metric}>
                        <dt>{bodyLabels[metric as BodySeriesKey]}</dt>
                        <dd>
                          {value} {suffix(metric as BodySeriesKey)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
                {record.note && <p className="wrap-cjk body-note">{record.note}</p>}
              </div>
              <div className="body-record-actions">
                <button
                  className="btn btn-ghost"
                  disabled={!writable}
                  aria-label={`编辑${record.date}身体记录`}
                  onClick={() => {
                    attempted.current = undefined;
                    setEditor({ id: record.id, original: record });
                  }}
                >
                  编辑
                </button>
                <button
                  className="btn btn-ghost danger-text"
                  disabled={!writable}
                  aria-label={`删除${record.date}身体记录`}
                  onClick={() => {
                    removalIndex.current = data.bodyMetrics.findIndex((item) => item.id === record.id);
                    pendingRemoval.current = null;
                    setRemoveError('');
                    setRemoving(record);
                  }}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {records.length > limit && (
        <button className="btn btn-secondary" onClick={() => setLimit(limit + 10)}>
          查看更多身体记录
        </button>
      )}
      <p className="notice">记录保存在本机，包含在 JSON 备份中。围度单位为 cm，缺少的指标留空。</p>
      <Presence>
        {editor && (
          <BodyEditor
            key={editor.id}
            original={editor.original}
            id={editor.id}
            unit={unit}
            writable={writable}
            onClose={() => void cancelEditor()}
            save={async (record) => {
              const retrying = attempted.current !== undefined;
              let accepted = false;
              let ok = await mutate((latest) => {
                const bodyMetrics = putBodyMetric(latest.bodyMetrics, record, attempted.current ?? editor.original);
                attempted.current = record;
                accepted = true;
                return { ...latest, bodyMetrics };
              });
              if (!ok && retrying && accepted) ok = await retry();
              if (ok) {
                setEditor(null);
                notify('身体记录已保存到本机');
              }
              return ok;
            }}
          />
        )}
      </Presence>
      <Presence>
        {removing && (
          <Modal
            title="删除身体记录？"
            onClose={() => void cancelRemoval()}
            footer={
              <>
                <button className="btn btn-secondary" disabled={busy} onClick={() => void cancelRemoval()}>
                  保留身体记录
                </button>
                <button
                  className="btn btn-danger"
                  disabled={busy || !writable}
                  onClick={async () => {
                    setBusy(true);
                    setRemoveError('');
                    try {
                      const ok =
                        pendingRemoval.current === removing.id
                          ? await retry()
                          : await mutate((latest) => {
                              const bodyMetrics = removeBodyMetric(latest.bodyMetrics, removing);
                              pendingRemoval.current = removing.id;
                              return { ...latest, bodyMetrics };
                            });
                      if (ok) {
                        setRemoving(null);
                        notify('身体记录已删除，趋势已重新计算');
                      } else
                        setRemoveError(
                          '删除尚未写入磁盘，磁盘原记录仍保留。可再次确认删除以重试保存，或关闭后重新载入。',
                        );
                    } catch (error) {
                      setRemoveError(error instanceof Error ? error.message : '删除失败，原记录仍保留');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  确认删除身体记录
                </button>
              </>
            }
          >
            <p>{removing.date} 的身体记录将被删除，相关趋势随之更新。删除不能撤销，建议先导出备份。</p>
            {removeError && (
              <p className="error-text" role="alert">
                {removeError}
              </p>
            )}
          </Modal>
        )}
      </Presence>
    </section>
  );
}

function BodyEditor({
  id,
  original,
  unit,
  writable,
  save,
  onClose,
}: {
  id: string;
  original?: BodyMetric;
  unit: 'kg' | 'lb';
  writable: boolean;
  save: (record: BodyMetric) => Promise<boolean>;
  onClose: () => void;
}) {
  const prefix = useId();
  const errorRef = useRef<HTMLDivElement>(null);
  // Capture the unit once: switching preferences cannot reinterpret an open form's inputs.
  const [formUnit] = useState(unit);
  const [form, setForm] = useState<BodyForm>(() => ({
    date: original?.date ?? dayKey(new Date()),
    weight: original?.weightKg === undefined ? '' : String(displayWeight(original.weightKg, unit)),
    bodyFat: original?.bodyFatPct === undefined ? '' : String(original.bodyFatPct),
    ...Object.fromEntries(
      measurementKeys.map((key) => [
        key,
        original?.measurements?.[key] === undefined ? '' : String(original.measurements[key]),
      ]),
    ),
    note: original?.note ?? '',
  }));
  const [errors, setErrors] = useState<Partial<Record<BodyField, string>>>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    if (Object.keys(errors).length || failure) errorRef.current?.focus();
  }, [errors, failure]);
  function input(key: BodyField, label: string, type = 'number') {
    return (
      <label className="field" key={key} htmlFor={`${prefix}-${key}`}>
        {label}
        <input
          id={`${prefix}-${key}`}
          className="form-input"
          aria-label={label}
          type={type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          enterKeyHint={type === 'number' ? 'next' : undefined}
          value={form[key] ?? ''}
          step={type === 'number' ? 'any' : undefined}
          min={type === 'date' ? '1970-01-01' : undefined}
          max={type === 'date' ? '2100-01-01' : undefined}
          disabled={!writable || busy}
          aria-invalid={!!errors[key]}
          aria-describedby={errors[key] ? `${prefix}-${key}-error` : undefined}
          onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
        />
        {errors[key] && (
          <small className="error-text" id={`${prefix}-${key}-error`}>
            {errors[key]}
          </small>
        )}
      </label>
    );
  }
  return (
    <Modal
      title={original ? '编辑身体记录' : '记录身体数据'}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <button className="btn btn-secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" type="submit" form={`${prefix}-form`} disabled={!writable || busy}>
            {busy ? '保存中…' : '保存身体记录'}
          </button>
        </>
      }
    >
      <form
        id={`${prefix}-form`}
        className="body-form"
        data-ios-input-scope=""
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !writable) return;
          const parsed = parseBodyForm(form, formUnit, id);
          setErrors(parsed.errors);
          setFailure('');
          if (!parsed.record) return;
          // Keep unedited raw kg precision when an lb display has rounded to two decimals.
          if (original?.weightKg !== undefined && form.weight === String(displayWeight(original.weightKg, formUnit)))
            parsed.record.weightKg = original.weightKg;
          setBusy(true);
          try {
            if (!(await save(parsed.record)))
              setFailure('未能保存，当前输入已保留。请查看页面保存提示，修正后再次保存可重试。');
          } catch (error) {
            setFailure(error instanceof Error ? error.message : '保存失败，当前输入已保留');
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">每天一条。只填实际测量的项目，其余留空。</p>
        {(Object.keys(errors).length > 0 || failure) && (
          <div className="notice error-text" role="alert" tabIndex={-1} ref={errorRef}>
            <strong>{failure || '请检查以下项目'}</strong>
            {Object.entries(errors).map(([key, message]) => (
              <a
                key={key}
                href={`#${prefix}-${key}`}
                onClick={(event) => {
                  event.preventDefault();
                  const field = document.getElementById(`${prefix}-${key}`);
                  field?.closest('details')?.setAttribute('open', '');
                  field?.focus();
                }}
              >
                {message}
              </a>
            ))}
          </div>
        )}
        {input('date', '记录日期', 'date')}
        <div className="body-form-grid">
          {input('weight', `体重 (${formUnit})`)}
          {input('bodyFat', '体脂率 (%)')}
        </div>
        <details
          className="body-measurements"
          open={
            Object.keys(errors).some((key) => measurementKeys.includes(key as (typeof measurementKeys)[number])) ||
            undefined
          }
        >
          <summary>补充围度 · cm</summary>
          <div className="body-form-grid">{measurementKeys.map((key) => input(key, `${bodyLabels[key]} (cm)`))}</div>
        </details>
        <label className="field" htmlFor={`${prefix}-note`}>
          备注（可选）
          <textarea
            id={`${prefix}-note`}
            aria-label="备注（可选）"
            className="form-textarea"
            enterKeyHint="enter"
            value={form.note ?? ''}
            maxLength={5000}
            disabled={!writable || busy}
            aria-invalid={!!errors.note}
            aria-describedby={errors.note ? `${prefix}-note-error` : undefined}
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            placeholder="例如：晨起测量、同一台体重秤"
          />
          {errors.note && (
            <small className="error-text" id={`${prefix}-note-error`}>
              {errors.note}
            </small>
          )}
        </label>
      </form>
    </Modal>
  );
}
