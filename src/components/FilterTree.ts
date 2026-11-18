import type { FilterSummary } from '../utils/harStore.js';

export interface FilterTreeOptions {
  onNavigate: (id: number) => void;
  onDelete: () => void;
}

// One compact line showing the path from all requests to the current saved
// filter, plus the direct subfilters as clickable chips (sorted by row count, fewest first).
export class FilterTree {
  private readonly el: HTMLElement;
  private readonly options: FilterTreeOptions;

  constructor(el: HTMLElement, options: FilterTreeOptions) {
    this.el = el;
    this.options = options;
  }

  // `path` starts with the root (all requests) and ends with the current filter.
  render(path: FilterSummary[], children: FilterSummary[]): void {
    this.el.replaceChildren();
    const pathEl = document.createElement('div');
    pathEl.className = 'ft-path';
    path.forEach((node, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'ft-sep';
        sep.textContent = '›';
        pathEl.append(sep);
      }
      const isCurrent = index === path.length - 1;
      const item = document.createElement(isCurrent ? 'span' : 'button');
      item.className = isCurrent ? 'ft-node ft-current' : 'ft-node ft-ancestor';
      if (item instanceof HTMLButtonElement) {
        item.type = 'button';
        item.addEventListener('click', () => this.options.onNavigate(node.id));
      }
      item.textContent = `${this.label(node)} (${node.count})`;
      item.title = node.query || 'All requests';
      pathEl.append(item);
    });
    if (path.length > 1) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ft-delete';
      del.textContent = '×';
      del.title = 'Delete this filter and its subfilters';
      del.setAttribute('aria-label', 'Delete this filter');
      del.addEventListener('click', () => this.options.onDelete());
      pathEl.append(del);
    }
    this.el.append(pathEl);

    if (children.length > 0) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'ft-children';
      const caption = document.createElement('span');
      caption.className = 'ft-caption';
      caption.textContent = 'Subfilters:';
      childrenEl.append(caption);
      for (const child of children) {
        childrenEl.append(this.buildChip(child));
      }
      this.el.append(childrenEl);
    }
    this.el.hidden = false;
  }

  hide(): void {
    this.el.replaceChildren();
    this.el.hidden = true;
  }

  private buildChip(child: FilterSummary): HTMLButtonElement {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ft-child';
    chip.textContent = `${child.query} (${child.count})`;
    chip.title = child.query;
    chip.addEventListener('click', () => this.options.onNavigate(child.id));
    return chip;
  }

  private label(node: FilterSummary): string {
    return node.query || 'All requests';
  }
}
