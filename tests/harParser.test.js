// Mock DOM for testing
global.document = {
  createElement: () => ({ style: {} }),
  querySelector: () => ({ style: {} }),
  querySelectorAll: () => []
};

// Import the module to test
import { HarParser } from '../src/utils/harParser.js';

describe('HarParser', () => {
  let parser;

  beforeEach(() => {
    parser = new HarParser();
  });

  describe('parse', () => {
    it('should parse a valid HAR file', () => {
      const mockHarData = {
        log: {
          version: '1.2',
          creator: { name: 'Test', version: '1.0' },
          entries: []
        }
      };

      const result = parser.parse(mockHarData);

      expect(result.version).toBe('1.2');
      expect(result.creator.name).toBe('Test');
      expect(result.entries).toEqual([]);
    });

    it('should throw error for invalid HAR format', () => {
      const invalidHarData = {};

      expect(() => parser.parse(invalidHarData)).toThrow('Invalid HAR format: Missing log object');
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(parser.formatBytes(0)).toBe('0 Bytes');
      expect(parser.formatBytes(1023)).toBe('1023 Bytes');
      expect(parser.formatBytes(1024)).toBe('1 KB');
      expect(parser.formatBytes(1048576)).toBe('1 MB');
    });
  });

  describe('formatTime', () => {
    it('should format time correctly', () => {
      expect(parser.formatTime(0.5)).toBe('500μs');
      expect(parser.formatTime(50)).toBe('50ms');
      expect(parser.formatTime(1500)).toBe('1.50s');
    });
  });

  describe('getContentType', () => {
    it('should identify content types correctly', () => {
      expect(parser.getContentType('text/html')).toBe('html');
      expect(parser.getContentType('text/css')).toBe('css');
      expect(parser.getContentType('application/javascript')).toBe('js');
      expect(parser.getContentType('image/png')).toBe('image');
      expect(parser.getContentType('application/json')).toBe('json');
      expect(parser.getContentType('text/xml')).toBe('xml');
      expect(parser.getContentType('unknown/type')).toBe('other');
    });
  });
});