import { HarParser } from './utils/harParser.js';
import { UIManager } from './components/UIManager.js';

// Main application class
class HarViewerApp {
  constructor() {
    this.uiManager = new UIManager();
    this.harParser = new HarParser();
    this.currentHarData = null;

    this.init();
  }

  init() {
    // Set up event listeners
    const fileInput = document.getElementById('har-file-input');
    const refreshBtn = document.getElementById('refresh-btn');
    const exportBtn = document.getElementById('export-btn');

    fileInput.addEventListener('change', (event) => this.handleFileUpload(event));
    refreshBtn.addEventListener('click', () => this.refreshView());
    exportBtn.addEventListener('click', () => this.exportData());

    console.log('HAR Viewer App initialized');
  }

  async handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const harData = await this.readFileAsJson(file);
      this.currentHarData = harData;
      this.uiManager.displayFileInfo(file.name, file.size);
      this.uiManager.showHarContent();
      this.renderHarData(harData);
    } catch (error) {
      console.error('Error processing HAR file:', error);
      this.uiManager.showErrorMessage('Failed to process HAR file. Please ensure it is a valid JSON file.');
    }
  }

  readFileAsJson(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const jsonData = JSON.parse(event.target.result);
          resolve(jsonData);
        } catch (error) {
          reject(new Error('Invalid JSON format'));
        }
      };
      reader.onerror = () => reject(new Error('Error reading file'));
      reader.readAsText(file);
    });
  }

  renderHarData(harData) {
    try {
      const parsedData = this.harParser.parse(harData);
      this.uiManager.renderRequestList(parsedData.entries);
      this.uiManager.setupRequestDetailsHandler(parsedData.entries);
    } catch (error) {
      console.error('Error parsing HAR data:', error);
      this.uiManager.showErrorMessage('Failed to parse HAR data. Please ensure it follows the HAR specification.');
    }
  }

  refreshView() {
    if (this.currentHarData) {
      this.renderHarData(this.currentHarData);
    }
  }

  exportData() {
    if (!this.currentHarData) {
      this.uiManager.showErrorMessage('No data to export');
      return;
    }

    const dataStr = JSON.stringify(this.currentHarData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);

    const exportFileDefaultName = 'har-export.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new HarViewerApp();
});

export { HarViewerApp };