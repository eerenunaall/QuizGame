import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Real, tiny documents built byte by byte for the Soru Stüdyosu tests (ADR-0028 §6): a PDF with a text
 * layer, a DOCX (zip) and their hostile variants. No fixtures on disk: the structure is the test.
 */

const enc = new TextEncoder();

export interface PdfOptions {
  /** One string per page; each is drawn as a few lines of Helvetica. */
  pages: string[];
  /** Extra entries of the document catalog, e.g. `/OpenAction 5 0 R`. */
  catalog?: string;
  /** Extra objects, numbered from 100. */
  extraObjects?: string[];
  /** Adds an /Encrypt entry to the trailer (the file is then refused before parsing). */
  encrypt?: boolean;
  /** Declared /Count of the page tree if it should lie. */
  declaredCount?: number;
}

const escapePdf = (text: string): string =>
  text.replace(/[\\()]/gu, (c) => `\\${c}`).replace(/[^\x20-\x7e]/gu, '?');

/** A valid single-font PDF 1.4 with a classic xref table. Text is ASCII-only (WinAnsi, no fancy fonts). */
export function buildPdf(options: PdfOptions): Uint8Array {
  const objects: string[] = [];
  const pageCount = options.pages.length;
  // 1 catalog, 2 pages, 3 font, then (page, content) pairs from 4, extra objects from 100.
  objects[1] = `<< /Type /Catalog /Pages 2 0 R ${options.catalog ?? ''} >>`;
  const kids = options.pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${options.declaredCount ?? pageCount} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  options.pages.forEach((text, i) => {
    const lines = text.split('\n');
    const stream = `BT /F1 12 Tf 14 TL 40 760 Td ${lines
      .map((line) => `(${escapePdf(line)}) Tj T*`)
      .join(' ')} ET`;
    objects[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objects[5 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  (options.extraObjects ?? []).forEach((body, i) => {
    objects[100 + i] = body;
  });

  let out = '%PDF-1.4\n';
  const offsets = new Map<number, number>();
  const numbers = objects.map((_, n) => n).filter((n) => objects[n] !== undefined);
  for (const n of numbers) {
    offsets.set(n, out.length);
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const size = Math.max(...numbers) + 1;
  const xrefAt = out.length;
  out += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) {
    const at = offsets.get(n);
    out +=
      at === undefined ? '0000000000 65535 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${size} /Root 1 0 R ${options.encrypt ? '/Encrypt << /Filter /Standard /V 1 /R 2 /O (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) /U (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) /P -4 >>' : ''} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(out, 'latin1'));
}

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
  /** Declared uncompressed size when it should lie (zip bomb headers). */
  declaredSize?: number;
  stored?: boolean;
}

/** A zip writer: deflate (or stored) entries, central directory, end record. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw =
      typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : Buffer.from(entry.data);
    const body = entry.stored ? raw : deflateRawSync(raw, { level: 9 });
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(raw);
    const size = entry.declaredSize ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(entry.stored ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(entry.stored ? 0 : 8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(size, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Uint8Array.from(Buffer.concat([...parts, directory, end]));
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const xmlEscape = (text: string): string =>
  text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

export function documentXml(paragraphs: string[], prolog = ''): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${prolog}<w:document ${W}><w:body>${paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r></w:p>`)
    .join('')}</w:body></w:document>`;
}

/** A minimal .docx: content types, relationships and the body. */
export function buildDocx(paragraphs: string[], extra: ZipEntry[] = [], prolog = ''): Uint8Array {
  return buildZip([
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    },
    { name: 'word/document.xml', data: documentXml(paragraphs, prolog) },
    ...extra,
  ]);
}

/** Roughly 1.5 KB of Turkish prose per call: enough to pass the "has text" threshold. */
export const SAMPLE_PARAGRAPHS = [
  "Galata Kulesi, Istanbul'un en bilinen simgelerinden biridir ve 1348 yilinda Cenevizliler tarafindan insa edilmistir.",
  "Kule, Haliç'in kuzeyinde yer alir ve yüzyıllar boyunca gözetleme kulesi olarak kullanılmıştır.",
  'Kulenin yüksekliği yaklaşık 67 metredir ve tepesinden şehrin panoramik manzarası görülebilir.',
  "Osmanlı döneminde kule yangın gözetleme kulesi olarak görev yapmış, 1960'larda onarılarak müzeye dönüştürülmüştür.",
  "Hezarfen Ahmed Çelebi'nin kuleden uçtuğu rivayet edilir ve bu hikaye şehir efsanelerinin en meşhurlarındandır.",
  'Bugün kule her yıl yüz binlerce ziyaretçiyi ağırlar ve İstanbul turizminin en önemli duraklarından biridir.',
];
export const SAMPLE_TEXT = SAMPLE_PARAGRAPHS.join('\n\n');
export { enc as textBytes };
