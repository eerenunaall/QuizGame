// Document text extraction for the Soru Stüdyosu (ADR-0028 §6). Plain JavaScript on purpose: it runs
// inside a worker thread (worker.mjs) that must start without a TypeScript loader, and it is the only
// code that touches an untrusted PDF/DOCX. It never writes to disk, never opens a socket and never
// evaluates anything from the document. Every function returns {ok:true,...} or {ok:false,code}.
import { TextDecoder } from 'node:util';
import { inflateRawSync } from 'node:zlib';
import { getDocumentProxy } from 'unpdf';

/** The error codes the web maps to Turkish sentences (studio.extract.*). */
export const ERROR_CODES = [
  'too_big',
  'too_long',
  'unsupported',
  'pdf_encrypted',
  'corrupt',
  'no_text',
  'binary',
  'timeout',
];

const fail = (code) => ({ ok: false, code });

// Control characters, bidi overrides and zero-width characters have no place in a quiz question; the
// last two classes are also how text is hidden from a human reviewer.
// Built from a string so the invisible characters stay visible as escapes in the source.
// eslint-disable-next-line no-control-regex -- stripping them is the point
const STRIP = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]',
  'gu',
);

/** NFC, control/bidi characters removed, runs of blanks collapsed, at most one empty line in a row. */
export function cleanDocumentText(text) {
  return text
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(STRIP, '')
    .replace(/\t/gu, ' ')
    .replace(new RegExp('[ \\u00A0]{2,}', 'gu'), ' ')
    .replace(/ ?\n ?/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** Plain text: UTF-8 (BOM allowed), UTF-16 with BOM, else Windows-1254 like the CSV import. */
export function decodeText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
    return { ok: true, text: new TextDecoder('utf-16le').decode(bytes.subarray(2)) };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Uint8Array.from(bytes.subarray(2));
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const a = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = a;
    }
    return { ok: true, text: new TextDecoder('utf-16le').decode(swapped) };
  }
  // A NUL byte in a "text" file means a binary file with the wrong extension.
  if (bytes.includes(0)) return fail('binary');
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: true, text: new TextDecoder('windows-1254').decode(bytes) };
  }
}

/** Splits running text (TXT/MD/DOCX have no pages) into labelled sections of about `size` characters. */
export function sectionsOf(text, size) {
  const parts = [];
  let current = '';
  for (const paragraph of text.split(/\n{2,}/u)) {
    if (paragraph.length > size) {
      if (current) parts.push(current);
      current = '';
      // One enormous paragraph (a text file without blank lines): cut at a sentence end or a space.
      for (let at = 0; at < paragraph.length;) {
        let end = Math.min(paragraph.length, at + size);
        if (end < paragraph.length) {
          const cut = Math.max(paragraph.lastIndexOf('. ', end), paragraph.lastIndexOf(' ', end));
          if (cut > at + size / 2) end = cut + 1;
        }
        parts.push(paragraph.slice(at, end).trim());
        at = end;
      }
    } else if (current.length > 0 && current.length + paragraph.length > size) {
      parts.push(current);
      current = paragraph;
    } else current += (current ? '\n\n' : '') + paragraph;
  }
  if (current) parts.push(current);
  return parts
    .filter((part) => part.length > 0)
    .map((part, i) => ({ label: `bölüm ${i + 1}`, text: part }));
}

// ───────────── DOCX: a small, bounded zip reader ─────────────

const u16 = (b, at) => b[at] | (b[at + 1] << 8);
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/**
 * Reads `word/document.xml` of a .docx. Only the central directory is trusted (never the local headers'
 * sizes), at most `maxZipEntries` entries are looked at, a name that could climb out of a directory is
 * refused outright (nothing is ever extracted to disk, but such a file is not a Word file), and the
 * single entry we inflate is capped at `maxInflate` bytes whatever the headers claim.
 */
export function readDocxXml(bytes, limits) {
  const eocdMin = 22;
  if (bytes.length < eocdMin) return fail('corrupt');
  let eocd = -1;
  for (let at = bytes.length - eocdMin; at >= Math.max(0, bytes.length - eocdMin - 65_535); at--)
    if (u32(bytes, at) === 0x06054b50) {
      eocd = at;
      break;
    }
  if (eocd < 0) return fail('corrupt');
  const count = u16(bytes, eocd + 10);
  const dirSize = u32(bytes, eocd + 12);
  const dirAt = u32(bytes, eocd + 16);
  if (count > limits.maxZipEntries) return fail('too_big');
  if (dirAt + dirSize > eocd || dirAt > bytes.length) return fail('corrupt');

  let at = dirAt;
  let declaredTotal = 0;
  let target = null;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== 0x02014b50) return fail('corrupt');
    const flags = u16(bytes, at + 8);
    const method = u16(bytes, at + 10);
    const compressed = u32(bytes, at + 20);
    const size = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const localAt = u32(bytes, at + 42);
    if (at + 46 + nameLength > bytes.length) return fail('corrupt');
    const name = new TextDecoder('utf-8').decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (/(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[A-Za-z]:/u.test(name) || name.includes('\0'))
      return fail('corrupt');
    if (flags & 1) return fail('corrupt'); // an encrypted entry
    declaredTotal += size;
    if (declaredTotal > limits.maxInflate) return fail('too_big');
    if (name === 'word/document.xml') {
      if (target) return fail('corrupt'); // two entries of the same name: a smuggling trick
      target = { method, compressed, size, localAt };
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (!target) return fail('corrupt');
  const local = target.localAt;
  if (local + 30 > bytes.length || u32(bytes, local) !== 0x04034b50) return fail('corrupt');
  const dataAt = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
  if (dataAt + target.compressed > bytes.length) return fail('corrupt');
  const raw = bytes.subarray(dataAt, dataAt + target.compressed);
  try {
    let xml;
    if (target.method === 0) xml = raw;
    else if (target.method === 8) xml = inflateRawSync(raw, { maxOutputLength: limits.maxInflate });
    else return fail('corrupt');
    return { ok: true, xml: new TextDecoder('utf-8').decode(xml) };
  } catch (error) {
    // zlib throws ERR_BUFFER_TOO_LARGE when the stream expands past the cap: a zip bomb.
    return fail(error && error.code === 'ERR_BUFFER_TOO_LARGE' ? 'too_big' : 'corrupt');
  }
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeEntities = (text) =>
  text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-z]{2,4});/gu, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED[body] ?? whole;
  });

/**
 * The text of a WordprocessingML body: the content of `<w:t>` runs, tabs and breaks, one line per
 * paragraph. This is a tokenizer, not an XML parser: nothing is resolved, so a DOCTYPE with entities
 * (XXE, "billion laughs") cannot expand to anything; the file is refused instead because Word never
 * writes one.
 */
export function docxXmlText(xml) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) return fail('corrupt');
  const out = [];
  const token = /<\/w:p>|<w:tab\s*\/>|<w:br\b[^>]*\/>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/gu;
  let match;
  while ((match = token.exec(xml)) !== null) {
    const piece = match[0];
    if (match[1] !== undefined) out.push(decodeEntities(match[1]));
    else if (piece === '</w:p>') out.push('\n');
    else if (piece.startsWith('<w:tab')) out.push(' ');
    else out.push('\n');
  }
  return { ok: true, text: out.join('') };
}

// ───────────── PDF ─────────────

const toLatin1 = (bytes) => new TextDecoder('latin1').decode(bytes);

export async function extractPdf(bytes, limits) {
  // The trailer/xref dictionary is never compressed, so an encrypted file names /Encrypt in plain bytes.
  if (/\/Encrypt\b/u.test(toLatin1(bytes))) return fail('pdf_encrypted');
  let pdf;
  try {
    pdf = await getDocumentProxy(Uint8Array.from(bytes), {
      // pdf.js options: nothing is evaluated, no font is loaded from anywhere, nothing is fetched.
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      disableAutoFetch: true,
      disableStream: true,
      enableXfa: false,
      verbosity: 0,
    });
  } catch (error) {
    return fail(error && error.name === 'PasswordException' ? 'pdf_encrypted' : 'corrupt');
  }
  try {
    if (pdf.numPages > limits.maxPages) return fail('too_long');
    const pages = [];
    let chars = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
        else if (item.str !== '' && !item.str.endsWith(' ')) text += ' ';
      }
      const cleaned = cleanDocumentText(text);
      chars += cleaned.length;
      if (chars > limits.maxChars) return fail('too_long');
      pages.push({ label: `s. ${n}`, text: cleaned });
    }
    return { ok: true, sections: pages.filter((page) => page.text.length > 0) };
  } catch {
    return fail('corrupt');
  } finally {
    await pdf.loadingTask?.destroy?.()?.catch?.(() => undefined);
  }
}

// ───────────── entry point ─────────────

/** What the bytes are, from the content first (a renamed .exe is not a text file) then the extension. */
export function detectKind(bytes, fileName) {
  const ext = /\.([A-Za-z0-9]{1,8})$/u.exec(fileName)?.[1]?.toLowerCase() ?? '';
  if (toLatin1(bytes.subarray(0, 1024)).includes('%PDF-')) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return ext === 'docx' ? 'docx' : null;
  if (['txt', 'md', 'markdown', 'text'].includes(ext)) return 'text';
  return null;
}

/**
 * Bytes in, `{ok:true, kind, sections:[{label,text}], chars}` or `{ok:false, code}` out. `limits`:
 * maxBytes, maxPages, maxChars, minChars, maxInflate, maxZipEntries, sectionChars.
 */
export async function extractDocument(bytes, fileName, limits) {
  if (bytes.length > limits.maxBytes) return fail('too_big');
  const kind = detectKind(bytes, fileName);
  if (!kind) return fail('unsupported');
  let sections;
  if (kind === 'pdf') {
    const pdf = await extractPdf(bytes, limits);
    if (!pdf.ok) return pdf;
    sections = pdf.sections;
  } else {
    let raw;
    if (kind === 'docx') {
      const zip = readDocxXml(bytes, limits);
      if (!zip.ok) return zip;
      const parsed = docxXmlText(zip.xml);
      if (!parsed.ok) return parsed;
      raw = parsed.text;
    } else {
      const decoded = decodeText(bytes);
      if (!decoded.ok) return decoded;
      raw = decoded.text;
    }
    const cleaned = cleanDocumentText(raw);
    if (cleaned.length > limits.maxChars) return fail('too_long');
    sections = sectionsOf(cleaned, limits.sectionChars);
  }
  const chars = sections.reduce((sum, section) => sum + section.text.length, 0);
  if (chars < limits.minChars) return fail('no_text');
  return { ok: true, kind, sections, chars };
}
