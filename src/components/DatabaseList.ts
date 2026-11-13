// Landing-screen list of the HAR databases stored in IndexedDB. Only complete
// databases can be opened; databases that are still being imported show their
// progress, and incomplete ones are flagged. Imports cannot be deleted until
// they finish.
import type { DatabaseSummary } from '../utils/harStore.js';
import { moveName } from '../utils/dbOrder.js';

export interface DatabaseListItem extends DatabaseSummary {
  // True while a background import is still writing this database.
  importing: boolean;
  // Share of the compressed file read so far (0..1), while importing.
  fraction: number;
}

export interface DatabaseListOptions {
  onOpen: (name: string) => void;
  onDelete: (name: string) => void;
  onEditComment: (name: string, comment: string) => void;
  // Called with the full list of names in their new order after a drag-and-drop.
  onReorder: (names: string[]) => void;
  formatBytes: (bytes: number) => string;
  formatDateTime: (timeMs: number) => string;
}

type IconName = 'open' | 'edit' | 'delete';

const STATE_LABELS = {complete: 'Complete', incomplete: 'Incomplete', importing: 'Importing'} as const;

// 24x24 stroke icons (Lucide-style paths).
const ICON_PATHS: Record<IconName, string[]> = {
  open: ['M5 12h14', 'M13 6l6 6-6 6'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  delete: ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 14h10l1-14'],
};

function createIcon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  paths.forEach(d => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  });
  return svg;
}

export class DatabaseList {
  private readonly containerEl: HTMLElement;
  private readonly options: DatabaseListOptions;
  private names: string[] = [];
  private draggedName: string | null = null;

  constructor(containerEl: HTMLElement, options: DatabaseListOptions) {
    this.containerEl = containerEl;
    this.options = options;
  }

  render(items: DatabaseListItem[]): void {
    this.containerEl.replaceChildren();

    const heading = document.createElement('h2');
    heading.className = 'db-list-heading';
    heading.textContent = 'Stored databases';
    this.containerEl.append(heading);

    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'db-list-empty';
      empty.textContent = 'No databases yet. Drop a HAR file above to create one.';
      this.containerEl.append(empty);
      return;
    }

    this.names = items.map(item => item.name);
    const list = document.createElement('ul');
    list.className = 'db-list';
    items.forEach(item => list.append(this.buildRow(item)));
    this.containerEl.append(list);
  }

  private buildRow(item: DatabaseListItem): HTMLElement {
    const state = item.importing ? 'importing' : item.complete ? 'complete' : 'incomplete';
    const li = document.createElement('li');
    li.className = 'db-row';
    li.dataset.state = state;

    const status = document.createElement('div');
    status.className = 'db-status';
    const badge = document.createElement('span');
    badge.className = `db-badge ${state}`;
    badge.textContent = STATE_LABELS[state];
    status.append(badge);

    const main = document.createElement('div');
    main.className = 'db-main';
    const title = document.createElement('div');
    title.className = 'db-title';
    title.textContent = item.fileName;
    const fileTime = document.createElement('div');
    fileTime.className = 'db-file-time';
    fileTime.textContent = this.options.formatDateTime(item.fileModified);
    const lastUsed = document.createElement('div');
    lastUsed.className = 'db-file-time';
    lastUsed.textContent = `Last used: ${item.lastUsedMs != null ? this.options.formatDateTime(item.lastUsedMs) : 'never'}`;
    const details = document.createElement('div');
    details.className = 'db-details';
    details.textContent = this.describe(item);
    main.append(title, fileTime, lastUsed, details);
    if (item.importing) {
      const track = document.createElement('div');
      track.className = 'db-progress-track';
      const bar = document.createElement('div');
      bar.className = 'db-progress-bar';
      bar.style.width = `${Math.round(item.fraction * 100)}%`;
      track.append(bar);
      main.append(track);
    }

    // The edit icon is hidden until the comment cell is hovered or focused.
    const commentCell = document.createElement('div');
    commentCell.className = 'db-comment-cell';
    const comment = document.createElement('span');
    comment.className = item.comment ? 'db-comment' : 'db-comment empty';
    comment.textContent = item.comment || 'No comment';
    const editBtn = this.iconButton('edit', 'Edit comment', 'db-edit-comment',
      () => this.options.onEditComment(item.name, item.comment));
    commentCell.append(comment, editBtn);

    const actions = document.createElement('div');
    actions.className = 'db-actions';
    const openBtn = this.iconButton('open', item.complete ? 'Open database' : 'Only complete databases can be opened', 'db-open',
      () => this.options.onOpen(item.name));
    openBtn.disabled = !item.complete;
    const deleteBtn = this.iconButton('delete', item.importing ? 'Wait for the import to finish before deleting' : 'Delete database', 'db-delete',
      () => this.options.onDelete(item.name));
    deleteBtn.disabled = item.importing;
    actions.append(openBtn, deleteBtn);

    const handle = document.createElement('span');
    handle.className = 'db-drag-handle';
    handle.draggable = true;
    handle.title = 'Drag to change the order';
    handle.textContent = '⋮⋮';
    this.attachDragHandlers(li, handle, item.name);

    li.append(status, main, commentCell, actions, handle);
    return li;
  }

  private iconButton(icon: IconName, label: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `db-icon-btn ${className}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(createIcon(ICON_PATHS[icon]));
    button.addEventListener('click', onClick);
    return button;
  }

  // Drag-and-drop reordering. Row drags stop propagation so the file drop
  // zone (which covers the whole screen) does not react to them.
  // Only the grip handle starts a drag, so text in the row stays selectable.
  private attachDragHandlers(li: HTMLElement, handle: HTMLElement, name: string): void {
    handle.addEventListener('dragstart', (event) => {
      this.draggedName = name;
      event.dataTransfer?.setData('text/plain', name);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setDragImage(li, 0, 0);
      }
      li.classList.add('dragging');
      event.stopPropagation();
    });
    handle.addEventListener('dragend', () => {
      this.draggedName = null;
      this.clearDropIndicators();
    });
    li.addEventListener('dragenter', (event) => {
      if (this.draggedName) event.stopPropagation();
    });
    li.addEventListener('dragover', (event) => {
      if (!this.draggedName) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      this.clearDropIndicators();
      if (this.draggedName === name) return;
      const after = this.isBelowMiddle(li, event);
      li.classList.add(after ? 'drop-after' : 'drop-before');
    });
    li.addEventListener('drop', (event) => {
      if (!this.draggedName) return;
      event.preventDefault();
      event.stopPropagation();
      const after = this.isBelowMiddle(li, event);
      const dragged = this.draggedName;
      this.draggedName = null;
      this.clearDropIndicators();
      if (dragged === name) return;
      this.options.onReorder(moveName(this.names, dragged, name, after));
    });
  }

  private isBelowMiddle(li: HTMLElement, event: DragEvent): boolean {
    const rect = li.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  private clearDropIndicators(): void {
    this.containerEl.querySelectorAll('.db-row.drop-before, .db-row.drop-after, .db-row.dragging')
      .forEach(el => el.classList.remove('drop-before', 'drop-after', 'dragging'));
  }

  private describe(item: DatabaseListItem): string {
    const { formatBytes } = this.options;
    const sizes = item.uncompressedSize != null
      ? `${formatBytes(item.fileSize)} compressed, ${formatBytes(item.uncompressedSize)} uncompressed`
      : formatBytes(item.fileSize);
    if (item.importing) {
      return `Importing… ${Math.round(item.fraction * 100)}% read · ${item.count} requests · ${sizes}`;
    }
    if (!item.complete) {
      return `Incomplete: upload did not finish (${item.count} requests stored) · ${sizes}. Delete it and import the file again.`;
    }
    return `${item.count} requests · ${sizes}`;
  }
}
