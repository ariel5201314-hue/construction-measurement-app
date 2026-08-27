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
