export function calculateReport({ cSteel, thickness, sealant }) {
  if ([cSteel, thickness, sealant].some((value) => value === '' || value === null || value === undefined)) return null;
  const values = [cSteel, thickness, sealant].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [c, t, s] = values;
  return { result: c + t - s, expression: `${c} + ${t} - ${s}` };
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
    .replace(/[，,。；;：:\s]/g, '');
  const match = normalized.match(/^(\d+(?:\.\d+)?)\+(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const [cSteel, thickness, sealant] = match.slice(1).map(Number);
  return { cSteel, thickness, sealant };
}
