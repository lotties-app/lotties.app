import { describe, expect, it } from 'vitest';
import { renderUi } from '../test/renderUi';
import { parseInline, parseMarkdown, safeHref } from './markdown';
import { MarkdownView } from './MarkdownView';

function rendered(source: string) {
  const { container } = renderUi(<MarkdownView source={source} />);
  return container.querySelector('[data-testid="board-markdown"]')!;
}

describe('safeHref', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['http://example.com', 'http://example.com/'],
    ['  HTTPS://Example.com/x  ', 'https://example.com/x'],
    ['javascript:alert(1)', null],
    ['JavaScript:alert(1)', null],
    [' javascript:alert(1)', null],
    ['java&#115;cript:alert(1)', null],
    ['data:text/html;base64,PHNjcmlwdD4=', null],
    ['vbscript:msgbox(1)', null],
    ['file:///etc/passwd', null],
    ['//evil.example/x', null],
    ['/relative/path', null],
    ['mailto:someone@example.com', null],
    ['https://', null],
  ])('%s -> %s', (raw, expected) => {
    expect(safeHref(raw)).toBe(expected);
  });
});

describe('parseMarkdown', () => {
  it('reads headings, paragraphs, lists, quotes, rules and fenced code', () => {
    const blocks = parseMarkdown(
      '# Title\n\nSome *text*\nnext line\n\n- one\n- two\n\n3. three\n4. four\n\n> quoted\n\n---\n\n```\nconst a = 1;\n```',
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'quote',
      'rule',
      'code',
    ]);
    expect(blocks[3]).toMatchObject({ kind: 'list', ordered: true, start: 3 });
    expect(blocks[6]).toEqual({ kind: 'code', text: 'const a = 1;' });
  });

  it('reads emphasis, code and links inline, keeping snake_case words intact', () => {
    expect(parseInline('a **bold** and *it* and `x` and some_snake_case')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'bold' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'em', children: [{ kind: 'text', text: 'it' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'x' },
      { kind: 'text', text: ' and some_snake_case' },
    ]);
  });

  it('never recurses without bound', () => {
    const deep = `${'*'.repeat(200)}x${'*'.repeat(200)}`;
    expect(() => parseMarkdown(deep)).not.toThrow();
    expect(() => parseMarkdown('['.repeat(5000))).not.toThrow();
  });
});

describe('MarkdownView safety', () => {
  it.each([
    ['<script>alert(1)</script>', 'script'],
    ['<img src=x onerror=alert(1)>', 'img'],
    ['<iframe src="/evil"></iframe>', 'iframe'],
    ['<a href="javascript:alert(1)">x</a>', 'a'],
    ['<div onclick="alert(1)">x</div>', 'div div'],
    ['<style>body{display:none}</style>', 'style'],
  ])('keeps raw HTML %s as text, no element', (source, selector) => {
    const root = rendered(source);
    expect(root.textContent).toContain(source);
    expect(root.querySelector(selector)).toBeNull();
  });

  it.each([
    '[click](javascript:alert(1))',
    '[click](JAVASCRIPT:alert(1))',
    '[click](data:text/html,<script>alert(1)</script>)',
    '[click](vbscript:x)',
    '[click](/local)',
    '[click](//evil.example)',
  ])('renders %s without a link', (source) => {
    const root = rendered(source);
    expect(root.querySelector('a')).toBeNull();
    expect(root.textContent).toContain('click');
  });

  it('turns http(s) links into safe anchors that open in a new tab', () => {
    const root = rendered('See [the docs](https://example.com/docs) or https://example.org/x.');
    const anchors = [...root.querySelectorAll('a')];
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com/docs',
      'https://example.org/x',
    ]);
    for (const a of anchors) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    }
    // The trailing full stop is not part of the address.
    expect(root.textContent).toContain('example.org/x');
  });

  it('links an address inside raw HTML as a plain safe link, never as markup', () => {
    const root = rendered('<iframe src="https://evil.example"></iframe>');
    expect(root.querySelector('iframe')).toBeNull();
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://evil.example/');
  });

  it('shows an image as its alt text and never loads it', () => {
    const root = rendered('![a diagram](https://example.com/x.png)');
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toBe('a diagram');
  });

  it('keeps entities literal (no decoding into markup)', () => {
    const root = rendered('&lt;b&gt;not bold&lt;/b&gt;');
    expect(root.querySelector('b')).toBeNull();
    expect(root.textContent).toBe('&lt;b&gt;not bold&lt;/b&gt;');
  });

  it('renders the supported subset as elements', () => {
    const root = rendered('# Head\n\n**b** *i* `c`\n\n- x\n- y\n\n```\n<b>code</b>\n```');
    expect(root.querySelector('h3')?.textContent).toBe('Head');
    expect(root.querySelector('strong')?.textContent).toBe('b');
    expect(root.querySelector('em')?.textContent).toBe('i');
    expect(root.querySelector('code')?.textContent).toBe('c');
    expect(root.querySelectorAll('ul li')).toHaveLength(2);
    expect(root.querySelector('pre code')?.textContent).toBe('<b>code</b>');
    expect(root.querySelector('pre b')).toBeNull();
  });
});
