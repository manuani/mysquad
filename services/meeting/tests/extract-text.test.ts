/**
 * The agenda upload took .txt and .md only, so a founder whose material is a
 * pitch deck or a board doc had to paste it by hand.
 *
 * A bad extraction is worse than no file: the advisors treat the brief as fact
 * and will reason confidently from a garbled agenda. So every path either
 * produces something legible or fails loudly.
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { extractText, kindForFilename, MAX_FILE_BYTES } from '../src/extract-text.js';

/** A minimal but real .pptx — two slides, one with speaker notes. */
async function buildPptx(
  slides: Array<{ text: string; notes?: string }>,
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
  slides.forEach((slide, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld><a:t>${slide.text}</a:t></p:sld>`);
    if (slide.notes) {
      zip.file(`ppt/notesSlides/notesSlide${i + 1}.xml`, `<p:notes><a:t>${slide.notes}</a:t></p:notes>`);
    }
  });
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('kindForFilename', () => {
  it.each([
    ['agenda.txt', 'text'],
    ['agenda.md', 'markdown'],
    ['board.PDF', 'pdf'],
    ['update.docx', 'docx'],
    ['deck.pptx', 'pptx'],
  ])('%s → %s', (name, kind) => {
    expect(kindForFilename(name)).toBe(kind);
  });

  it('refuses formats it cannot read rather than guessing', () => {
    expect(kindForFilename('notes.pages')).toBeNull();
    expect(kindForFilename('sheet.xlsx')).toBeNull();
    expect(kindForFilename('noextension')).toBeNull();
  });
});

describe('plain text', () => {
  it('reads a text file', async () => {
    const result = await extractText('agenda.txt', Buffer.from('Runway is six months.'));
    expect(result.text).toBe('Runway is six months.');
    expect(result.kind).toBe('text');
  });

  it('collapses the whitespace every extractor leaves behind', async () => {
    const result = await extractText('a.md', Buffer.from('Line one\n\n\n\n   Line   two   '));
    expect(result.text).toBe('Line one\n\nLine two');
  });
});

describe('powerpoint', () => {
  it('keeps slides in numeric order, not lexicographic', async () => {
    // slide10 must not sort before slide2.
    const slides = Array.from({ length: 11 }, (_, i) => ({ text: `Point ${i + 1}` }));
    const result = await extractText('deck.pptx', await buildPptx(slides));

    const second = result.text.indexOf('Point 2');
    const tenth = result.text.indexOf('Point 10');
    expect(second).toBeLessThan(tenth);
    expect(result.sections).toBe(11);
  });

  it('pulls speaker notes alongside the slide', async () => {
    // Slide text alone reads as a word cloud — the argument usually lives in
    // the notes.
    const result = await extractText(
      'deck.pptx',
      await buildPptx([{ text: '40 percent growth', notes: 'Emphasise the retention curve' }]),
    );

    expect(result.text).toContain('40 percent growth');
    expect(result.text).toContain('Emphasise the retention curve');
    expect(result.text).toContain('Slide 1');
  });

  it('skips slides with nothing on them', async () => {
    const result = await extractText(
      'deck.pptx',
      await buildPptx([{ text: 'Real content' }, { text: '' }]),
    );
    expect(result.text).toContain('Real content');
    expect(result.text).not.toContain('Slide 2');
  });
});

describe('refusals', () => {
  it('rejects a format it cannot read, and says what it can', async () => {
    await expect(extractText('notes.pages', Buffer.from('x'))).rejects.toThrow(
      /Supported: \.txt, \.md, \.pdf, \.docx, \.pptx/,
    );
  });

  it('rejects an empty file', async () => {
    await expect(extractText('a.txt', Buffer.alloc(0))).rejects.toThrow(/empty/);
  });

  it('rejects a file too large to parse or to fit a prompt', async () => {
    const oversized = Buffer.alloc(MAX_FILE_BYTES + 1);
    await expect(extractText('big.txt', oversized)).rejects.toThrow(/maximum/);
  });

  it('fails loudly when a document yields no text', async () => {
    // A scanned PDF is images of text: it parses without error and produces
    // nothing. Accepting that silently hands the advisors an empty brief they
    // believe is the founder's agenda.
    await expect(extractText('scanned.pptx', await buildPptx([{ text: '' }]))).rejects.toThrow(
      /no text could be read/,
    );
  });

  it('reports a corrupt archive rather than throwing something opaque', async () => {
    await expect(extractText('broken.docx', Buffer.from('not a zip at all'))).rejects.toThrow(
      /could not read broken\.docx/,
    );
  });
});
