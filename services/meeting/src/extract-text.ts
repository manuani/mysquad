/**
 * Pulls readable text out of the documents founders actually have.
 *
 * The agenda upload took `.txt` and `.md` only, because reading a text file in
 * the browser is one line and everything else needs a parser. But a founder's
 * material is a pitch deck, a board doc, or a one-pager, and pasting it by hand
 * is friction in the moment the feature exists to remove.
 *
 * Extraction happens here rather than in the browser: one implementation to fix
 * when it is wrong, and no shipping three parsers to the client. A bad
 * extraction is worse than no file — the advisors treat the brief as fact and
 * will reason confidently from a garbled agenda — so every path either produces
 * something legible or fails loudly, and the caller shows the founder what was
 * read before the meeting starts.
 */

import JSZip from 'jszip';
import mammoth from 'mammoth';
import { ValidationError } from '@voai/errors';

export type DocumentKind = 'text' | 'markdown' | 'pdf' | 'docx' | 'pptx';

export interface ExtractedDocument {
  readonly kind: DocumentKind;
  readonly text: string;
  /** Slide or page count, where the format has such a thing. */
  readonly sections: number | null;
}

/** Largest file accepted. Beyond this, extraction is slow and the text will not fit a prompt anyway. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

const EXTENSION_KINDS: Record<string, DocumentKind> = {
  txt: 'text',
  md: 'markdown',
  markdown: 'markdown',
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
};

export function kindForFilename(filename: string): DocumentKind | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? (EXTENSION_KINDS[ext] ?? null) : null;
}

/** Collapses the runs of whitespace every extractor leaves behind. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Strips XML tags, keeping the text and the element boundaries as spaces. */
function textFromXml(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * PowerPoint, slide by slide.
 *
 * Decks are the awkward format. Slide text extracts as disconnected fragments —
 * a title, three bullets, a number with no label — because the argument lives in
 * the layout and, more often, in the speaker notes. Notes are pulled alongside
 * the slide text for that reason: without them a deck reads as a word cloud.
 */
async function extractPptx(buffer: Buffer): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(buffer);

  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    // Numeric order, not lexicographic: slide10 must not precede slide2.
    .sort((a, b) => {
      const num = (n: string) => Number.parseInt(n.match(/slide(\d+)\.xml$/)?.[1] ?? '0', 10);
      return num(a) - num(b);
    });

  const parts: string[] = [];
  for (const [index, name] of slideNames.entries()) {
    const slideXml = await zip.file(name)!.async('string');
    const slideText = tidy(textFromXml(slideXml));

    const notesName = `ppt/notesSlides/notesSlide${index + 1}.xml`;
    const notesFile = zip.file(notesName);
    const notesText = notesFile ? tidy(textFromXml(await notesFile.async('string'))) : '';

    const slide = [
      `Slide ${index + 1}`,
      slideText,
      notesText ? `Speaker notes: ${notesText}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    if (slideText || notesText) parts.push(slide);
  }

  return { kind: 'pptx', text: tidy(parts.join('\n\n')), sections: slideNames.length };
}

async function extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
  const result = await mammoth.extractRawText({ buffer });
  return { kind: 'docx', text: tidy(result.value), sections: null };
}

async function extractPdf(buffer: Buffer): Promise<ExtractedDocument> {
  // Imported lazily: the parser pulls in a sizeable dependency tree, and most
  // uploads are not PDFs.
  const { default: pdfParse } = (await import('pdf-parse')) as unknown as {
    default: (data: Buffer) => Promise<{ text: string; numpages?: number }>;
  };
  const parsed = await pdfParse(buffer);
  return { kind: 'pdf', text: tidy(parsed.text), sections: parsed.numpages ?? null };
}

/**
 * Extracts text from an uploaded document.
 *
 * Throws rather than returning empty when nothing legible comes out. A scanned
 * PDF is images of text: it parses without error and yields nothing, and
 * silently accepting that would hand the advisors an empty brief they believe
 * is the founder's agenda.
 */
export async function extractText(
  filename: string,
  buffer: Buffer,
): Promise<ExtractedDocument> {
  if (buffer.length === 0) throw new ValidationError('file is empty');
  if (buffer.length > MAX_FILE_BYTES) {
    throw new ValidationError(
      `file is ${Math.round(buffer.length / 1024 / 1024)}MB; the maximum is ${MAX_FILE_BYTES / 1024 / 1024}MB`,
    );
  }

  const kind = kindForFilename(filename);
  if (!kind) {
    throw new ValidationError(
      `cannot read ${filename}. Supported: .txt, .md, .pdf, .docx, .pptx — paste the text for anything else`,
    );
  }

  let extracted: ExtractedDocument;
  try {
    switch (kind) {
      case 'pdf':
        extracted = await extractPdf(buffer);
        break;
      case 'docx':
        extracted = await extractDocx(buffer);
        break;
      case 'pptx':
        extracted = await extractPptx(buffer);
        break;
      default:
        extracted = { kind, text: tidy(buffer.toString('utf8')), sections: null };
    }
  } catch (err) {
    throw new ValidationError(
      `could not read ${filename}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!extracted.text) {
    throw new ValidationError(
      `no text could be read from ${filename}. If it is a scanned document, the pages are images — paste the text instead`,
    );
  }

  return extracted;
}
