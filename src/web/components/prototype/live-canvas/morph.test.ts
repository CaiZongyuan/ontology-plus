// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BORN_ATTR, morphChildren } from './morph.js';

function bodyOf(html: string): HTMLElement {
  return new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html').body;
}

function record(target: Node): () => MutationRecord[] {
  const observer = new MutationObserver(() => undefined);
  observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
  return () => observer.takeRecords();
}

describe('morphChildren: update a live document in place', () => {
  it('appends streamed content without replacing the nodes already there', () => {
    const live = bodyOf('<section><h1>早上好</h1></section>');
    const heading = live.querySelector('h1')!;
    morphChildren(live, bodyOf('<section><h1>早上好</h1><p>今天有 3 单货要收</p></section>'));
    expect(live.querySelector('h1')).toBe(heading);
    expect(live.querySelector('p')?.textContent).toBe('今天有 3 单货要收');
    expect(live.querySelector('p')?.hasAttribute(BORN_ATTR)).toBe(true);
    expect(heading.hasAttribute(BORN_ATTR)).toBe(false);
  });

  it('makes no mutation at all when nothing changed', () => {
    const html = '<section class="a" data-screen-id="S"><table><tbody><tr><td>DH-1025</td></tr></tbody></table></section>';
    const live = bodyOf(html);
    const takeRecords = record(live);
    morphChildren(live, bodyOf(html));
    expect(takeRecords()).toHaveLength(0);
  });

  it('updates text and attributes in place and removes what disappeared', () => {
    const live = bodyOf('<div class="x" title="old"><span>a</span><span>b</span><em>c</em></div>');
    const div = live.querySelector('div')!;
    const firstSpan = live.querySelector('span')!;
    morphChildren(live, bodyOf('<div class="y"><span>a2</span><span>b</span></div>'));
    expect(live.querySelector('div')).toBe(div);
    expect(div.getAttribute('class')).toBe('y');
    expect(div.hasAttribute('title')).toBe(false);
    expect(live.querySelector('span')).toBe(firstSpan);
    expect(firstSpan.textContent).toBe('a2');
    expect(live.querySelector('em')).toBeNull();
  });

  it('keeps the born marker while a new node fades in, and replaces nodes whose tag changed', () => {
    const live = bodyOf('<div><p>x</p></div>');
    morphChildren(live, bodyOf('<div><p>x</p><ul><li>1</li></ul></div>'));
    const ul = live.querySelector('ul')!;
    expect(ul.hasAttribute(BORN_ATTR)).toBe(true);
    morphChildren(live, bodyOf('<div><p>x</p><ul><li>1</li><li>2</li></ul></div>'));
    expect(live.querySelector('ul')).toBe(ul);
    expect(ul.hasAttribute(BORN_ATTR)).toBe(true);
    morphChildren(live, bodyOf('<div><h2>x</h2><ul><li>1</li><li>2</li></ul></div>'));
    expect(live.querySelector('p')).toBeNull();
    expect(live.querySelector('h2')?.textContent).toBe('x');
  });

  it('leaves an element the keep rule names exactly as it is, and morphs the rest', () => {
    const live = bodyOf('<section data-screen-id="A"><p>DH-1025</p></section><section data-screen-id="B"><p>新</p></section>');
    live.querySelector('[data-screen-id="A"] p')!.textContent = '已点';
    morphChildren(
      live,
      bodyOf('<section data-screen-id="A"><p>DH-1025</p></section><section data-screen-id="B"><p>新建订货单</p></section>'),
      (el) => el.getAttribute('data-screen-id') === 'A',
    );
    expect(live.querySelector('[data-screen-id="A"] p')!.textContent).toBe('已点');
    expect(live.querySelector('[data-screen-id="B"] p')!.textContent).toBe('新建订货单');
  });
});
