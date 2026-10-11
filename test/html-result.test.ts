import * as assert from 'node:assert/strict';
import { detectHtml, ensureSelfContainedHtml, extractHtmlTitle, looksLikeHtmlFragment, unwrapHtmlFence } from '../src/agent/htmlResult';

describe('htmlResult', () => {
  it('detects full documents and fragments', () => {
    assert.equal(detectHtml('<!DOCTYPE html><html></html>'), true);
    assert.equal(detectHtml('<html lang="en"></html>'), true);
    assert.equal(detectHtml('# Title'), false);
    assert.equal(looksLikeHtmlFragment('<h1>x</h1>'), true);
    assert.equal(looksLikeHtmlFragment('not html'), false);
  });

  it('unwraps ```html fences', () => {
    assert.equal(unwrapHtmlFence('```html\n<!DOCTYPE html><html></html>\n```'), '<!DOCTYPE html><html></html>');
  });

  it('passes through a full HTML document and injects a missing title', () => {
    const html = ensureSelfContainedHtml('<!DOCTYPE html><html><head></head><body><p>hi</p></body></html>', 'Fallback');
    assert.match(html, /<title>Fallback<\/title>/);
    assert.match(html, /<p>hi<\/p>/);
  });

  it('wraps an HTML fragment into a document', () => {
    const html = ensureSelfContainedHtml('<h1>Warp roles</h1><p>body</p>');
    assert.match(html, /^<!DOCTYPE html>/i);
    assert.equal(extractHtmlTitle(html), 'Warp roles');
    assert.match(html, /<h1>Warp roles<\/h1><p>body<\/p>/);
  });

  it('converts Markdown into a styled self-contained page', () => {
    const html = ensureSelfContainedHtml('# Hello\n\n`code`');
    assert.match(html, /^<!DOCTYPE html>/i);
    assert.equal(extractHtmlTitle(html), 'Hello');
    assert.match(html, /<article class="xplain">/);
    assert.match(html, /<code>/);
  });
});
