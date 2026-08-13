/**
 * Strips markup that a text-to-speech voice cannot say.
 *
 * Advisors are told not to use headings, lists or emphasis in voice mode, and
 * mostly comply — but "what I *can* tell you" still gets through, and ElevenLabs
 * reads the asterisks or stumbles on them. Prompt guidance sets the intent;
 * this guarantees the result.
 *
 * Deliberately conservative: it removes formatting characters and rewrites list
 * structure into speech, and never rewords. Anything it cannot handle safely is
 * left alone — a stray symbol read aloud is a smaller failure than a mangled
 * sentence.
 */

/** Numbered or bulleted list markers at the start of a line. */
const LIST_MARKER = /^[\s]*(?:[-*+•]|\d+[.)])\s+/gm;

export function toSpeakable(text: string): string {
  if (!text) return '';

  let out = text;

  // Code fences and inline code: keep the contents, drop the backticks.
  out = out.replace(/```[a-z]*\n?([\s\S]*?)```/gi, '$1');
  out = out.replace(/`([^`]+)`/g, '$1');

  // Headings become plain sentences. Spoken, a heading is just a short line, so
  // it needs terminal punctuation or the voice runs it into what follows.
  out = out.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*$/gm, (_m, heading: string) =>
    /[.!?:]$/.test(heading) ? heading : `${heading}.`,
  );

  // Bold and italic. Longest markers first so ***x*** does not leave stray runs.
  out = out.replace(/\*\*\*(.+?)\*\*\*/gs, '$1');
  out = out.replace(/\*\*(.+?)\*\*/gs, '$1');
  out = out.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/gs, '$1');
  out = out.replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/gs, '$1');

  // Links: say the label, not the URL.
  out = out.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');

  // List items become separate sentences, so the voice pauses between them
  // instead of running them together into one breathless clause.
  out = out.replace(LIST_MARKER, '');

  // Horizontal rules have no spoken equivalent.
  out = out.replace(/^\s*([-*_]\s*){3,}$/gm, '');

  // Blockquote markers.
  out = out.replace(/^\s{0,3}>\s?/gm, '');

  // A line that ends without punctuation runs into the next when spoken.
  out = out
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      return /[.!?:,;]$/.test(trimmed) ? trimmed : `${trimmed}.`;
    })
    .filter(Boolean)
    .join(' ');

  return out.replace(/\s+/g, ' ').trim();
}
