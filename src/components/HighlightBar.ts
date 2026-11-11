// Input below the request table for highlight rules (see highlightRules.ts).
// Enter adds a rule; each active rule is shown as a removable chip.
import { parseHighlightRule, HIGHLIGHT_EMOJIS, NAMED_COLORS, TEXT_STYLE_CLASSES, HIGHLIGHT_SEPARATOR } from '../utils/highlightRules.js';
import type { HighlightRule } from '../utils/highlightRules.js';
import { escapeHtml } from '../utils/domUtils.js';

export interface HighlightBarOptions {
  onChange: (rules: HighlightRule[]) => void;
}

const ERROR_DISPLAY_MS = 4000;

export class HighlightBar {
  private onChange: (rules: HighlightRule[]) => void;
  private rules: HighlightRule[];

  private inputEl: HTMLInputElement;
  private hintEl: HTMLElement;
  private rulesEl: HTMLElement;
  private errorEl: HTMLElement;
  private errorTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor({ onChange }: HighlightBarOptions) {
    this.onChange = onChange;
    this.rules = [];

    this.inputEl = document.getElementById('highlight-input') as HTMLInputElement;
    this.hintEl = document.getElementById('highlight-hint')!;
    this.rulesEl = document.getElementById('highlight-rules')!;
    this.errorEl = document.getElementById('highlight-error')!;

    this.renderHint();
    this.bindEvents();
  }

  private bindEvents(): void {
    this.inputEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const text = this.inputEl.value.trim();
      if (!text) return;
      this.addRule(text);
    });

    this.inputEl.addEventListener('focus', () => this.hintEl.classList.add('visible'));
    this.inputEl.addEventListener('blur', () => this.hintEl.classList.remove('visible'));

    this.rulesEl.addEventListener('click', (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>('.highlight-chip-remove');
      if (!btn) return;
      const index = parseInt(btn.dataset.index!, 10);
      this.rules.splice(index, 1);
      this.commit();
    });
  }

  getRules(): HighlightRule[] {
    return [...this.rules];
  }

  private addRule(text: string): void {
    const result = parseHighlightRule(text);
    if ('error' in result) {
      this.showError(result.error);
      return;
    }
    this.rules.push(result.rule);
    this.inputEl.value = '';
    this.commit();
  }

  private commit(): void {
    this.renderRules();
    this.onChange([...this.rules]);
  }

  private renderRules(): void {
    this.rulesEl.innerHTML = this.rules.map((rule, index) => `
      <span class="highlight-chip" title="${escapeHtml(rule.text)}">
        <span class="highlight-chip-text">${escapeHtml(rule.text)}</span>
        <button type="button" class="highlight-chip-remove" data-index="${index}" title="Remove highlight rule">&times;</button>
      </span>
    `).join('');
  }

  private showError(message: string): void {
    this.errorEl.textContent = message;
    this.errorEl.classList.add('visible');
    clearTimeout(this.errorTimeout);
    this.errorTimeout = setTimeout(() => this.errorEl.classList.remove('visible'), ERROR_DISPLAY_MS);
  }

  private renderHint(): void {
    const emojis = Object.entries(HIGHLIGHT_EMOJIS)
      .map(([name, emoji]) => `${emoji} <code>${name}</code>`)
      .join(' · ');

    this.hintEl.innerHTML = `
      <div><b>Syntax</b> <code>&lt;filter&gt; ${HIGHLIGHT_SEPARATOR} [toggle|add|remove] &lt;class&gt;...</code>
      - the filter uses the same syntax as the request filter above</div>
      <div><b>Action</b> optional, defaults to <code>add</code>; <code>toggle</code> flips the class, <code>remove</code> clears it; rules run in order, top to bottom</div>
      <div><b>Colors</b> all ${NAMED_COLORS.length} CSS named colors tint the row, e.g. <code>red</code>, <code>tomato</code>, <code>steelblue</code></div>
      <div><b>Text</b> ${TEXT_STYLE_CLASSES.map(c => `<code>${c}</code>`).join(', ')}</div>
      <div><b>Emoji</b> ${emojis}</div>
      <div><b>Examples</b>
        <code>status:&gt;=400 =&gt; red</code> ·
        <code>method:POST =&gt; green bold</code> ·
        <code>host:cdn.example.com -type:image =&gt; toggle gray</code> ·
        <code>(status:404 or status:500) =&gt; red underline error</code> ·
        <code>status:301 =&gt; strikethrough</code> ·
        <code>reqheader:authorization =&gt; lock</code> ·
        <code>duration:&gt;2s =&gt; toggle orange italic fire</code> ·
        <code>status:200 =&gt; remove red</code>
      </div>
    `;
  }
}
