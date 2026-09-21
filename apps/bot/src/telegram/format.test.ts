import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TELEGRAM_LIMIT, toTelegramHtmlChunks } from './format.js';

/** The rendering tests all expect exactly one chunk. */
function first(markdown: string): string {
  const chunks = toTelegramHtmlChunks(markdown);
  assert.equal(chunks.length, 1, `expected one chunk, got ${chunks.length}`);
  return chunks[0] as string;
}

describe('Telegram rendering', () => {
  it('escapes HTML that the model may emit', () => {
    const out = first('users < 5 & sessions > 2');
    assert.equal(out, 'users &lt; 5 &amp; sessions &gt; 2');
  });

  it('converts bold and inline code but leaves snake_case alone', () => {
    const out = first('**1,204** users fired `paywall_shown` on app_opened_today');
    assert.equal(out, '<b>1,204</b> users fired <code>paywall_shown</code> on app_opened_today');
  });

  it('renders a markdown table as aligned monospace', () => {
    const out = toTelegramHtmlChunks(['| step | users |', '| --- | --- |', '| paywall_shown | 1204 |', '| purchase | 88 |'].join('\n')).join('\n');
    assert.match(out, /^<pre>/);
    assert.match(out, /step {11}users/);
    assert.match(out, /paywall_shown {2}1204/);
  });

  it('keeps a fenced block intact and escapes inside it', () => {
    const out = first('```\na < b\n```');
    assert.equal(out, '<pre>a &lt; b</pre>');
  });

  it('turns bullets into • and headings into bold', () => {
    const out = first('## Summary\n- first\n- second');
    assert.equal(out, '<b>Summary</b>\n• first\n• second');
  });

  it('splits long output into Telegram-sized chunks without breaking tags', () => {
    const chunks = toTelegramHtmlChunks(Array.from({ length: 400 }, (_, i) => `line ${i} with **bold** text`).join('\n'));
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= TELEGRAM_LIMIT, `chunk of ${chunk.length}`);
      assert.equal((chunk.match(/<b>/g) ?? []).length, (chunk.match(/<\/b>/g) ?? []).length);
    }
  });

  it('splits a long table across chunks, each a complete pre block', () => {
    const rows = Array.from({ length: 300 }, (_, i) => `| event_number_${i} | ${i} |`);
    const chunks = toTelegramHtmlChunks(['| event | users |', '| --- | --- |', ...rows].join('\n'));
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= TELEGRAM_LIMIT);
      assert.equal((chunk.match(/<pre>/g) ?? []).length, (chunk.match(/<\/pre>/g) ?? []).length);
    }
  });

  it('drops empty output', () => {
    assert.deepEqual(toTelegramHtmlChunks('   \n\n'), []);
  });
});
