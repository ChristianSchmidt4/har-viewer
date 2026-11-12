// Landing screen shown before any HAR file is loaded: a full-screen drop
// zone plus a "Browse" button that opens the native file picker. All file
// reading happens locally via the File/FileReader APIs - nothing is ever
// uploaded to a server.

export interface FileDropZoneOptions {
  onFileSelected: (file: File) => void;
  onError: (message: string) => void;
}

export class FileDropZone {
  private readonly onFileSelected: (file: File) => void;
  private readonly onError: (message: string) => void;
  private readonly screenEl: HTMLElement;
  private dropPanelEl: HTMLElement;
  private fileInputEl: HTMLInputElement;
  private browseBtnEl: HTMLElement;

  constructor({ onFileSelected, onError }: FileDropZoneOptions) {
    this.onFileSelected = onFileSelected;
    this.onError = onError;

    this.screenEl = document.getElementById('drop-screen')!;
    this.dropPanelEl = document.getElementById('drop-panel')!;
    this.fileInputEl = document.getElementById('har-file-input') as HTMLInputElement;
    this.browseBtnEl = document.getElementById('browse-btn')!;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Browse button opens the hidden native file input.
    this.browseBtnEl.addEventListener('click', () => this.fileInputEl.click());
    this.fileInputEl.addEventListener('change', (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) this.handleFile(file);
      // Reset so selecting the same file again still fires "change".
      this.fileInputEl.value = '';
    });

    // Drag and drop on the panel (and the whole screen, so missing the
    // panel by a few pixels still works).
    ['dragenter', 'dragover'].forEach(eventName => {
      this.screenEl.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.dropPanelEl.classList.add('drag-active');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      this.screenEl.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        const dragEvent = event as DragEvent;
        if (eventName === 'dragleave' && event.target !== this.screenEl && this.screenEl.contains(dragEvent.relatedTarget as Node)) {
          return;
        }
        this.dropPanelEl.classList.remove('drag-active');
      });
    });

    this.screenEl.addEventListener('drop', (event) => {
      const file = (event as DragEvent).dataTransfer?.files?.[0];
      if (file) this.handleFile(file);
    });
  }

  private handleFile(file: File): void {
    const isHarByName = /\.har$/i.test(file.name);
    const isGzipByName = /\.gz$/i.test(file.name);
    const isJsonByType = file.type === 'application/json' || file.type === '';
    const isGzipByType = file.type === 'application/gzip' || file.type === 'application/x-gzip';
    if (!isHarByName && !isGzipByName && !isJsonByType && !isGzipByType) {
      this.onError('Please select a .har file (JSON format), optionally gzip-compressed (.har.gz).');
      return;
    }
    this.onFileSelected(file);
  }

  show(): void {
    this.screenEl.classList.remove('hidden');
  }

  hide(): void {
    this.screenEl.classList.add('hidden');
  }
}
