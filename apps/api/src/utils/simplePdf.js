/**
 * Minimal single-page PDF writer (no dependencies) for text documents such as demo receipts.
 * Lines: [{ text, size?, bold?, gap? }]. Text is reduced to printable ASCII (PDF standard fonts),
 * so accents are dropped ("Cabdi" stays, "Ç" → "C") and anything else becomes "?".
 */
const ascii = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[•·]/g, '*')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e]/g, '?');
const escapePdf = (s) => ascii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Builds a simple text PDF (Buffer) from line objects { text, size, bold, gap, rule }. */
export function renderTextPdf(lines, { title = 'Document' } = {}) {
  const width = 595; // A4 portrait, points
  const height = 842;
  let y = height - 64;
  const ops = [];
  for (const line of lines) {
    const size = line.size ?? 11;
    y -= line.gap ?? Math.round(size * 1.6);
    if (line.rule) {
      ops.push(`0.8 w 56 ${y + 6} m ${width - 56} ${y + 6} l S`);
      continue;
    }
    ops.push(`BT /${line.bold ? 'F2' : 'F1'} ${size} Tf 56 ${y} Td (${escapePdf(line.text)}) Tj ET`);
  }
  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    `<< /Title (${escapePdf(title)}) /Producer (Fogaan Dawo) >>`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
