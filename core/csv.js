import { monthAt } from './months.js';

const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ');

/**
 * STUB layout (columns may change in M1). Metadata header lines start with "# ", then a
 * `month,value` table. Null values are written empty. The table holds only a month
 * and a number, so there is no free text to guard; metadata lines start with "# " and are
 * flattened to one line. The formula-injection guard for free text is planned for M1.
 * @param {object} series Series to export
 * @param {Record<string, string>} [meta] extra header lines, for example region and citation
 * @returns {string} CSV text ending in a newline
 */
export const toCsv = (series, meta = {}) => {
  const head = {
    series: series.id,
    unit: series.unit,
    method: `${series.method.id}@${series.method.version}`,
    comparable: String(series.comparable),
    ...meta,
  };
  const lines = Object.entries(head).map(([k, v]) => `# ${oneLine(k)}: ${oneLine(v)}`);
  lines.push('month,value');
  series.values.forEach((v, i) => lines.push(`${monthAt(series.start, i)},${v === null ? '' : v}`));
  return `${lines.join('\n')}\n`;
};
