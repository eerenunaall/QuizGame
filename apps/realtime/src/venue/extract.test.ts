import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  SAMPLE_PARAGRAPHS,
  SAMPLE_TEXT,
  buildDocx,
  buildPdf,
  buildZip,
  documentXml,
  textBytes,
} from '../../../../tests/helpers/documents';
import { EXTRACT_LIMITS, extractDocument } from './extract';

const ASCII_PAGE = [
  'The Galata Tower was built in 1348 by the Genoese and stands north of the Golden Horn.',
  'Its height is about 67 metres, and visitors can see the whole city from the gallery.',
  'During the Ottoman period it served as a fire watch tower until it became a museum.',
  'Hezarfen Ahmed Celebi is said to have flown from the tower across the Bosphorus.',
].join('\n');

describe('extractDocument: text files', () => {
  it('reads UTF-8 and keeps Turkish letters', async () => {
    const result = await extractDocument(textBytes.encode(SAMPLE_TEXT), 'kule.txt');
    expect(result).toMatchObject({ ok: true, kind: 'text' });
    expect(result.ok && result.sections.map((s) => s.text).join('\n')).toContain('Haliç');
  });

  it('reads the Windows-1254 file a Turkish Notepad writes', async () => {
    // "Şişli, İstanbul'un ilçesidir" ... repeated to pass the minimum length
    const line = 'Şişli İstanbul ilçesidir ve ığdır ğüzel çöl. '.repeat(12);
    const bytes = Uint8Array.from(
      [...line].map((ch) => {
        const map: Record<string, number> = {
          Ş: 0xde,
          İ: 0xdd,
          ı: 0xfd,
          ğ: 0xf0,
          ü: 0xfc,
          ş: 0xfe,
          ç: 0xe7,
          ö: 0xf6,
        };
        return map[ch] ?? ch.charCodeAt(0);
      }),
    );
    const result = await extractDocument(bytes, 'eski.md');
    expect(result.ok && result.sections[0]?.text).toContain('Şişli İstanbul');
  });

  it('strips control and bidi characters', async () => {
    const dirty = `${SAMPLE_TEXT}\u0007\u202E gizli \u200B`;
    const result = await extractDocument(textBytes.encode(dirty), 'a.txt');
    const all = result.ok ? result.sections.map((s) => s.text).join('\n') : '';
    for (const bad of ['\u0007', '\u202E', '\u200B']) expect(all.includes(bad)).toBe(false);
  });

  it('refuses a binary file with a text name and a file with no text', async () => {
    expect(await extractDocument(new Uint8Array([1, 2, 0, 3, 4]), 'a.txt')).toEqual({
      ok: false,
      code: 'binary',
    });
    expect(await extractDocument(textBytes.encode('kısa'), 'a.txt')).toEqual({
      ok: false,
      code: 'no_text',
    });
    expect(await extractDocument(textBytes.encode(SAMPLE_TEXT), 'a.exe')).toEqual({
      ok: false,
      code: 'unsupported',
    });
  });

  it('refuses too much text and too many bytes', async () => {
    const big = textBytes.encode('Bir cümle daha. '.repeat(EXTRACT_LIMITS.maxChars / 10));
    expect(await extractDocument(big, 'b.txt')).toEqual({ ok: false, code: 'too_long' });
    const huge = new Uint8Array(EXTRACT_LIMITS.maxBytes + 1);
    expect(await extractDocument(huge, 'h.txt')).toEqual({ ok: false, code: 'too_big' });
  });
});

describe('extractDocument: PDF', () => {
  it('reads the text layer, page by page', async () => {
    const result = await extractDocument(
      buildPdf({ pages: [ASCII_PAGE, ASCII_PAGE.replace('1348', '1349')] }),
      'kule.pdf',
    );
    expect(result).toMatchObject({ ok: true, kind: 'pdf' });
    if (!result.ok) return;
    expect(result.sections.map((s) => s.label)).toEqual(['s. 1', 's. 2']);
    expect(result.sections[1]?.text).toContain('1349');
  });

  it('does not run an embedded JavaScript action and still reads the text', async () => {
    const hostile = buildPdf({
      pages: [ASCII_PAGE],
      catalog: '/OpenAction 100 0 R /AA << /O 100 0 R >>',
      extraObjects: [
        '<< /S /JavaScript /JS (app.alert\\(1\\); this.submitForm\\("http://127.0.0.1:1/x"\\);) >>',
      ],
    });
    const result = await extractDocument(hostile, 'js.pdf');
    expect(result).toMatchObject({ ok: true, kind: 'pdf' });
  });

  it('refuses an encrypted PDF', async () => {
    const result = await extractDocument(buildPdf({ pages: [ASCII_PAGE], encrypt: true }), 'k.pdf');
    expect(result).toEqual({ ok: false, code: 'pdf_encrypted' });
  });

  it('refuses a page bomb (more pages than allowed)', async () => {
    const pages = Array.from({ length: EXTRACT_LIMITS.maxPages + 5 }, () => ASCII_PAGE);
    expect(await extractDocument(buildPdf({ pages }), 'bomb.pdf')).toEqual({
      ok: false,
      code: 'too_long',
    });
  });

  it('does not trust a page tree that claims a huge page count', async () => {
    const result = await extractDocument(
      buildPdf({ pages: [ASCII_PAGE], declaredCount: 900_000 }),
      'lie.pdf',
    );
    // Either refused or read as the one page it really has; never 900 000 pages of work.
    if (result.ok) expect(result.sections).toHaveLength(1);
  });

  it('refuses malformed and truncated PDFs without hanging', async () => {
    const good = buildPdf({ pages: [ASCII_PAGE] });
    for (const bytes of [
      good.subarray(0, Math.floor(good.length / 2)),
      textBytes.encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj garbage'),
      Uint8Array.from([...textBytes.encode('%PDF-1.7\n'), ...new Uint8Array(500).fill(255)]),
    ]) {
      const result = await extractDocument(bytes, 'x.pdf', { timeoutMs: 8000 });
      expect(result.ok).toBe(false);
    }
  });
});

describe('extractDocument: DOCX', () => {
  it('reads paragraphs, entities and tabs', async () => {
    const result = await extractDocument(
      buildDocx([...SAMPLE_PARAGRAPHS, 'Tom & Jerry <3']),
      'kule.docx',
    );
    expect(result).toMatchObject({ ok: true, kind: 'docx' });
    const all = result.ok ? result.sections.map((s) => s.text).join('\n') : '';
    expect(all).toContain('Galata Kulesi');
    expect(all).toContain('Tom & Jerry <3');
  });

  it('refuses a zip bomb: declared size, and a header that lies about the size', async () => {
    const huge = Buffer.alloc(EXTRACT_LIMITS.maxInflate + 1024 * 1024, 0x61);
    const declared = buildZip([{ name: 'word/document.xml', data: huge }]);
    expect(await extractDocument(declared, 'b.docx')).toEqual({ ok: false, code: 'too_big' });
    const lying = buildZip([{ name: 'word/document.xml', data: huge, declaredSize: 100 }]);
    expect(await extractDocument(lying, 'l.docx')).toEqual({ ok: false, code: 'too_big' });
    // a heap-friendly check that a 10 MB-deflated-to-10 KB file is bigger than the entry cap too
    expect(deflateRawSync(huge).length).toBeLessThan(EXTRACT_LIMITS.maxBytes);
  });

  it('refuses too many entries', async () => {
    const entries = Array.from({ length: EXTRACT_LIMITS.maxZipEntries + 1 }, (_, i) => ({
      name: `f${i}.xml`,
      data: 'x',
    }));
    const zip = buildZip([{ name: 'word/document.xml', data: documentXml(['a']) }, ...entries]);
    expect(await extractDocument(zip, 'e.docx')).toEqual({ ok: false, code: 'too_big' });
  });

  it('refuses an entry that climbs out of the directory', async () => {
    for (const name of ['../../etc/passwd', '/etc/passwd', 'word/../../x', 'C:\\x.txt']) {
      const zip = buildDocx(SAMPLE_PARAGRAPHS, [{ name, data: 'pwned' }]);
      expect(await extractDocument(zip, 't.docx')).toEqual({ ok: false, code: 'corrupt' });
    }
  });

  it('never expands an XXE or entity-bomb prolog', async () => {
    const xxe = '<!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]>';
    const bomb = '<!DOCTYPE d [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>';
    for (const prolog of [xxe, bomb])
      expect(await extractDocument(buildDocx(SAMPLE_PARAGRAPHS, [], prolog), 'x.docx')).toEqual({
        ok: false,
        code: 'corrupt',
      });
    // An entity reference with no declaration is left alone, not resolved.
    const raw = documentXml(SAMPLE_PARAGRAPHS).replace(
      '</w:body>',
      '<w:p><w:r><w:t>&xxe; &#x41;</w:t></w:r></w:p></w:body>',
    );
    const plain = await extractDocument(
      buildZip([{ name: 'word/document.xml', data: raw }]),
      'p.docx',
    );
    const all = plain.ok ? plain.sections.map((s) => s.text).join('\n') : '';
    expect(all).toContain('&xxe; A');
  });

  it('refuses a zip without a document body, a damaged zip and a renamed zip', async () => {
    expect(await extractDocument(buildZip([{ name: 'a.txt', data: 'x' }]), 'n.docx')).toEqual({
      ok: false,
      code: 'corrupt',
    });
    const good = buildDocx(SAMPLE_PARAGRAPHS);
    expect(await extractDocument(good.subarray(0, good.length - 40), 'd.docx')).toMatchObject({
      ok: false,
    });
    expect(await extractDocument(good, 'z.txt')).toEqual({ ok: false, code: 'unsupported' });
  });
});

describe('extractDocument: the worker', () => {
  it('ends a worker that runs out of its heap, and the next file still works', async () => {
    // 15 MB of tiny runs: millions of small strings, far more than a 24 MB heap holds.
    const runs = '<w:p><w:r><w:t>a</w:t></w:r></w:p>'.repeat(450_000);
    const xml = documentXml([]).replace('</w:body>', `${runs}</w:body>`);
    const result = await extractDocument(
      buildZip([{ name: 'word/document.xml', data: xml }]),
      'm.docx',
      {
        heapMb: 24,
      },
    );
    // 'corrupt' is what the main thread reports when the worker dies; a parser verdict would be too_long.
    expect(result).toEqual({ ok: false, code: 'corrupt' });
    expect(await extractDocument(textBytes.encode(SAMPLE_TEXT), 'ok.txt')).toMatchObject({
      ok: true,
    });
  });

  it('ends a worker that takes too long', async () => {
    const result = await extractDocument(buildPdf({ pages: [ASCII_PAGE] }), 't.pdf', {
      timeoutMs: 1,
    });
    expect(result).toEqual({ ok: false, code: 'timeout' });
  });

  it('keeps the event loop free while a document is read', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 5);
    const pages = Array.from({ length: 40 }, () => ASCII_PAGE);
    await extractDocument(buildPdf({ pages }), 'p.pdf');
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(0);
  });
});
