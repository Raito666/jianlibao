import type { BodyMetric, MeasurementKey } from './types';
import { displayWeight, fromWeight } from './units';

export type BodyField = 'date' | 'weight' | 'bodyFat' | MeasurementKey | 'note';
export type BodyForm = Partial<Record<BodyField, string>>;
export type BodySeriesKey = 'weight' | 'bodyFat' | MeasurementKey;
export const bodyLabels: Record<BodySeriesKey, string> = {
  weight: '体重',
  bodyFat: '体脂率',
  chest: '胸围',
  waist: '腰围',
  hip: '臀围',
  arm: '臂围',
  thigh: '腿围',
};
export const measurementKeys: MeasurementKey[] = ['chest', 'waist', 'hip', 'arm', 'thigh'];

export function parseBodyForm(
  form: BodyForm,
  unit: 'kg' | 'lb',
  id: string,
): { record?: BodyMetric; errors: Partial<Record<BodyField, string>> } {
  const errors: Partial<Record<BodyField, string>> = {};
  const date = form.date ?? '';
  const time = Date.parse(`${date}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    date < '1970-01-01' ||
    date > '2100-01-01' ||
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== date
  )
    errors.date = '请选择有效日期（1970–2100年）';
  const record: BodyMetric = { id, date };
  for (const key of ['weight', 'bodyFat', ...measurementKeys] as const) {
    const text = form[key]?.trim();
    if (!text) continue;
    const value = key === 'weight' ? fromWeight(Number(text), unit) : Number(text);
    if (
      !Number.isFinite(value) ||
      value > (key === 'bodyFat' ? 100 : 1000) ||
      (key === 'bodyFat' ? value < 0 : value <= 0)
    ) {
      errors[key] =
        `${bodyLabels[key]}须${key === 'bodyFat' ? '在0–100%之间' : `大于0且不超过${key === 'weight' ? `${displayWeight(1000, unit)} ${unit}` : '1000 cm'}`}`;
      continue;
    }
    if (key === 'weight') record.weightKg = value;
    else if (key === 'bodyFat') record.bodyFatPct = value;
    else {
      record.measurements ??= {};
      record.measurements[key] = value;
    }
  }
  if (
    record.weightKg === undefined &&
    record.bodyFatPct === undefined &&
    !Object.keys(record.measurements ?? {}).length &&
    !Object.keys(errors).length
  )
    errors.weight = '体重、体脂或围度至少填写一项';
  const note = form.note?.trim();
  if (note && (note.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(note)))
    errors.note = '备注含无效字符或超过5000字';
  if (note) record.note = note;
  return Object.keys(errors).length ? { errors } : { record, errors };
}

function assertUnchanged(records: BodyMetric[], original: BodyMetric): void {
  if (JSON.stringify(records.find((item) => item.id === original.id)) !== JSON.stringify(original))
    throw new Error('这条身体记录已变化，请关闭后重新查看；当前输入仍保留');
}
export function putBodyMetric(records: BodyMetric[], record: BodyMetric, original?: BodyMetric): BodyMetric[] {
  if (original) assertUnchanged(records, original);
  if (original && original.id !== record.id) throw new Error('编辑不能改变身体记录标识');
  if (records.some((item) => item.date === record.date && item.id !== original?.id))
    throw new Error('该日期已有身体记录，请编辑当天记录，或选择其他日期');
  if (!original && records.some((item) => item.id === record.id)) throw new Error('身体记录标识重复，请重新打开表单');
  return original ? records.map((item) => (item.id === original.id ? record : item)) : [...records, record];
}
export function removeBodyMetric(records: BodyMetric[], original: BodyMetric): BodyMetric[] {
  assertUnchanged(records, original);
  return records.filter((item) => item.id !== original.id);
}
function valueOf(record: BodyMetric, key: BodySeriesKey, unit: 'kg' | 'lb'): number | undefined {
  return key === 'weight'
    ? record.weightKg === undefined
      ? undefined
      : displayWeight(record.weightKg, unit)
    : key === 'bodyFat'
      ? record.bodyFatPct
      : record.measurements?.[key];
}
export function bodySeries(
  records: BodyMetric[],
  key: BodySeriesKey,
  unit: 'kg' | 'lb',
  from = '1970-01-01',
  to = '2100-01-01',
) {
  return records
    .filter((record) => record.date >= from && record.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((record) => {
      const value = valueOf(record, key, unit);
      return value === undefined ? [] : [{ date: record.date, value }];
    });
}
export function latestBodyValue(records: BodyMetric[], key: BodySeriesKey, unit: 'kg' | 'lb') {
  return bodySeries(records, key, unit).at(-1);
}
