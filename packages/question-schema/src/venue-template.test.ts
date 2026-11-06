import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VENUE_CSV_TEMPLATE, VENUE_JSONL_TEMPLATE, venuePrompt } from './venue-template';

/** The owner's guide quotes the template and the prompt; they must be the very texts the server serves. */
const doc = readFileSync(
  fileURLToPath(new URL('../../../docs/venue-question-template.md', import.meta.url)),
  'utf8',
).replace(/\r\n/gu, '\n');

describe('docs/venue-question-template.md', () => {
  it('contains the served CSV template, the JSONL example and both prompts verbatim', () => {
    expect(doc).toContain(VENUE_CSV_TEMPLATE.trimEnd().replace(/\r\n/gu, '\n'));
    expect(doc).toContain(VENUE_JSONL_TEMPLATE.trim());
    expect(doc).toContain(venuePrompt('CSV'));
    expect(doc).toContain(venuePrompt('JSONL'));
  });
});
