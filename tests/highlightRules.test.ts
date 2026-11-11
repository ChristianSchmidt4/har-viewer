import * as fs from 'fs';
import * as path from 'path';
import {
  parseHighlightRule,
  computeHighlightClasses,
  NAMED_COLORS,
  HIGHLIGHT_EMOJIS,
  TEXT_STYLE_CLASSES,
  type HighlightRule
} from '../src/utils/highlightRules.js';
import type { ParsedEntry, ParsedRequest, ParsedResponse } from '../src/types/har.js';

function makeEntry(overrides: {
  method?: string;
  url?: string;
  status?: number;
} = {}): ParsedEntry {
  const request: ParsedRequest = {
    method: overrides.method ?? 'GET',
    url: overrides.url ?? 'https://example.com/',
    httpVersion: '',
    cookies: [],
    headers: [],
    queryString: [],
    postData: null,
    headersSize: -1,
    bodySize: -1,
    comment: ''
  };
  const response: ParsedResponse = {
    status: overrides.status ?? 200,
    statusText: '',
    httpVersion: '',
    cookies: [],
    headers: [],
    content: { size: 0, compression: 0, mimeType: '', text: '', encoding: '', comment: '' },
    redirectURL: '',
    headersSize: -1,
    bodySize: 500,
    comment: ''
  };
  return {
    id: 0,
    startedDateTime: '',
    startedTimeMs: 0,
    relativeStartMs: 0,
    time: 100,
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0 },
    host: 'example.com',
    path: '/',
    protocol: 'HTTP/1.1',
    contentType: '',
    request,
    response,
    comment: ''
  } as unknown as ParsedEntry;
}

function ruleOf(input: string): HighlightRule {
  const result = parseHighlightRule(input);
  if (!('rule' in result)) throw new Error(`expected a rule for "${input}": ${result.error}`);
  return result.rule;
}

describe('parseHighlightRule', () => {
  it('parses filter, action and classes', () => {
    const rule = ruleOf('status:>=400 => add red');
    expect(rule.action).toBe('add');
    expect(rule.classes).toEqual(['red']);
    expect(rule.text).toBe('status:>=400 => add red');
  });

  it('defaults the action to add when omitted', () => {
    const rule = ruleOf('status:>=400 => red bold, underline');
    expect(rule.action).toBe('add');
    expect(rule.classes).toEqual(['red', 'bold', 'underline']);
    expect(rule.text).toBe('status:>=400 => add red bold underline');
  });

  it('does not treat a class starting with an action word as the action', () => {
    const rule = ruleOf('status:200 => address-lock');
    expect(rule.action).toBe('add');
    expect(rule.classes).toEqual(['address-lock']);
  });

  it('accepts toggle and remove, and multiple classes separated by spaces or commas', () => {
    expect(ruleOf('method:POST => toggle green').action).toBe('toggle');
    expect(ruleOf('method:POST => REMOVE red, lock').classes).toEqual(['red', 'lock']);
  });

  it('supports the text style classes', () => {
    expect(ruleOf('status:500 => bold italic underline strikethrough').classes).toEqual(['bold', 'italic', 'underline', 'strikethrough']);
  });

  it('supports grouping and numeric operators in the filter part', () => {
    const rule = ruleOf('(status:404 or duration:>2s) => fire red');
    expect(rule.classes).toEqual(['fire', 'red']);
    expect(rule.matches(makeEntry({ status: 404 }))).toBe(true);
    expect(rule.matches(makeEntry({ status: 200 }))).toBe(false);
  });

  it('uses the last "=>" as the separator', () => {
    const rule = ruleOf('reqheader:x=>y => red');
    expect(rule.classes).toEqual(['red']);
  });

  it('reports errors for malformed input', () => {
    expect(parseHighlightRule('status:200 red')).toHaveProperty('error');
    expect(parseHighlightRule('=> red')).toHaveProperty('error');
    expect(parseHighlightRule('status:200 =>')).toHaveProperty('error');
    expect(parseHighlightRule('status:200 => add')).toHaveProperty('error');
    expect(parseHighlightRule('status:200 => toggle')).toHaveProperty('error');
    expect(parseHighlightRule('status:200 => add bad class!')).toHaveProperty('error');
  });
});

describe('computeHighlightClasses', () => {
  const entry = makeEntry({ method: 'POST', status: 500 });

  it('applies add, remove and toggle in rule order', () => {
    const rules = [
      ruleOf('method:POST => add red lock'),
      ruleOf('status:500 => remove red'),
      ruleOf('method:POST => toggle fire'),
      ruleOf('method:POST => toggle fire')
    ];
    expect(computeHighlightClasses(rules, entry).sort()).toEqual(['lock']);
  });

  it('ignores rules whose filter does not match', () => {
    const rules = [ruleOf('status:404 => add red')];
    expect(computeHighlightClasses(rules, entry)).toEqual([]);
  });
});

describe('highlight CSS and emoji coverage', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'main.css'), 'utf8');

  it('has a class rule for every CSS named color', () => {
    expect(NAMED_COLORS).toHaveLength(148);
    NAMED_COLORS.forEach(color => {
      expect(css).toContain(`#requests-table tbody tr.hl-${color} {`);
    });
  });

  it('has an emoji mapping for every emoji class name', () => {
    expect(Object.keys(HIGHLIGHT_EMOJIS).length).toBeGreaterThan(0);
    Object.keys(HIGHLIGHT_EMOJIS).forEach(name => {
      expect(name).toMatch(/^[a-z0-9_-]+$/);
    });
  });

  it('has a CSS rule for every text style class', () => {
    TEXT_STYLE_CLASSES.forEach(cls => {
      expect(css).toContain(`tr.hl-${cls}`);
    });
  });
});
