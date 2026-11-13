/**
 * Minimal PDF 1.4 writer for formal text documents (payslips, letters) without a dependency.
 * ponytail: text, rules and two columns only (Helvetica, WinAnsi). Use a PDF library if documents
 * ever need images, tables that wrap, or non-Latin scripts.
 */
export interface PdfLine {
  text: string;
  right?: string;
  size?: number;
  bold?: boolean;
  gap?: number;
  rule?: boolean;
}

const esc = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\()]/g, '\\$&');
const width = (s: string, size: number) => s.length * size * 0.5; // Helvetica average glyph width

export function renderPdf(lines: PdfLine[]): Buffer {
  const W = 595;
  const H = 842;
  const M = 50;
  const pages: string[] = [];
  let ops: string[] = [];
  let y = H - M;
  for (const l of lines) {
    const size = l.size ?? 10;
    y -= (l.gap ?? 0) + size + 4;
    if (y < M) {
      pages.push(ops.join('\n'));
      ops = [];
      y = H - M - size;
    }
    if (l.rule) {
      ops.push(`0.8 G 0.5 w ${M} ${y + size / 2} m ${W - M} ${y + size / 2} l S 0 G`);
      continue;
    }
    const font = l.bold ? 'F2' : 'F1';
    ops.push(`BT /${font} ${size} Tf ${M} ${y} Td (${esc(l.text)}) Tj ET`);
    if (l.right)
      ops.push(
        `BT /${font} ${size} Tf ${W - M - width(l.right, size)} ${y} Td (${esc(l.right)}) Tj ET`,
      );
  }
  pages.push(ops.join('\n'));

  const objs: string[] = [];
  const add = (o: string) => objs.push(o);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  const pageIds = pages.map((_, i) => 5 + i * 2);
  add(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((content, i) => {
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
    );
    add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
