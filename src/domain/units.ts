/**
 * 参考自 wger (https://github.com/wger-project/wger)
 * 原文件：wger/utils/units.py，提交 8f72cb2feba9f5f1cc40aa9855b185ab315a3cd8
 * 授权：AGPL-3.0-or-later
 * 采用内部统一存kg、只在展示/输入边界转换的设计；保留健力宝原换算常数、
 * 展示两位小数及存储全精度，不移植上游Decimal四位量化，避免改变旧记录。
 */
const POUNDS_PER_KILOGRAM = 2.2046226218;

export const displayWeight = (kg: number, unit: 'kg' | 'lb') =>
  Math.round(kg * (unit === 'lb' ? POUNDS_PER_KILOGRAM : 1) * 100) / 100;
export const fromWeight = (n: number, unit: 'kg' | 'lb') => (unit === 'lb' ? n / POUNDS_PER_KILOGRAM : n);
