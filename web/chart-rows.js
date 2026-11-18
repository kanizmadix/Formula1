export function chartCsvRows({ labels, series, dataHeading = 'Round', exportUnit = '' }) {
  const heading = line => exportUnit ? `${line.name} (${exportUnit})` : line.name;
  const rows = labels.map((entry, index) => [entry.detail ?? entry.short, ...series.map(line => {
    const value = line.values?.[index];
    return Number.isFinite(value) ? value : null;
  })]);
  return [[dataHeading, ...series.map(heading)], ...rows];
}
