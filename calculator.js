export function calculateReport({ cSteel, thickness, sealant, measurementExpression }) {
  if ([cSteel, thickness, sealant].some((value) => value === '' || value === null || value === undefined)) return null;
  const values = [cSteel, thickness, sealant].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [c, t, s] = values;
  return { result: c + t - s, expression: `${measurementExpression || c} + ${t} - ${s}` };
}

export function formatReport(values) {
  const calculation = calculateReport(values);
  return calculation ? `${calculation.expression} = ${calculation.result}` : '請輸入完整尺寸';
}

export function parseSpokenMeasurement(text) {
  const normalized = String(text ?? '')
    .replace(/加上|加/g, '+')
    .replace(/減去|減掉|扣掉|減|扣/g, '-')
    .replace(/[＋﹢]/g, '+')
    .replace(/[－−–—]/g, '-')
    .replace(/毫米|公釐|mm/gi, '')
    .replace(/[，,。；;：:\s]/g, '');
  if (!/^[^+-]+(?:[+-][^+-]+)*$/.test(normalized)) return null;
  const parts = normalized.split(/([+-])/);
  const values = parts.filter((_, index) => index % 2 === 0).map(parseSpokenNumber);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const result = parts.filter((_, index) => index % 2 === 1)
    .reduce((total, operator, index) => operator === '+' ? total + values[index + 1] : total - values[index + 1], values[0]);
  if (!Number.isFinite(result) || result < 0) return null;
  if (values.length === 1) return { cSteel: result };
  const measurementExpression = parts.map((part, index) => index % 2 ? ` ${part} ` : values[index / 2]).join('');
  return { cSteel: result, measurementExpression };
}

function parseSpokenNumber(text) {
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const [integer, decimal] = text.replace('点', '點').split('點');
  let value = 0; let digit = 0; let hasUnit = false;
  for (const character of integer) {
    if (character in digits) { digit = digits[character]; continue; }
    const unit = { 十: 10, 百: 100, 千: 1000 }[character];
    if (!unit) return NaN;
    value += (digit || 1) * unit; digit = 0; hasUnit = true;
  }
  if (!hasUnit) value = Number([...integer].map((character) => digits[character]).join(''));
  else value += digit;
  if (decimal !== undefined) {
    if (![...decimal].every((character) => character in digits)) return NaN;
    value += Number(`0.${[...decimal].map((character) => digits[character]).join('')}`);
  }
  return value;
}
