// Import the module to test
import { HarParser } from '../src/utils/harParser.js';

describe('HarParser', () => {
  let parser: HarParser;

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
      const invalidHarData = {} as unknown as Parameters<HarParser['parse']>[0];

      expect(() => parser.parse(invalidHarData)).toThrow('Invalid HAR format: Missing log object');
    });

    it('should extract host, path, protocol and relative start time', () => {
      const mockHarData = {
        log: {
          version: '1.2',
          creator: { name: 'Test', version: '1.0' },
          entries: [
            {
              startedDateTime: '2023-01-01T12:00:00.000Z',
              time: 150,
              request: { method: 'GET', url: 'https://example.com/foo?x=1', httpVersion: 'HTTP/1.1', headers: [] },
              response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: [], content: { mimeType: 'text/html' } }
            },
            {
              startedDateTime: '2023-01-01T12:00:01.000Z',
              time: 80,
              request: { method: 'GET', url: 'https://example.com/bar', httpVersion: 'HTTP/1.1', headers: [] },
              response: { status: 404, statusText: 'Not Found', httpVersion: 'HTTP/1.1', headers: [], content: { mimeType: 'text/plain' } }
            }
          ]
        }
      };

      const result = parser.parse(mockHarData);

      expect(result.entries[0]!.host).toBe('example.com');
      expect(result.entries[0]!.path).toBe('/foo?x=1');
      expect(result.entries[0]!.protocol).toBe('HTTP/1.1');
      expect(result.entries[0]!.relativeStartMs).toBe(0);
      expect(result.entries[1]!.relativeStartMs).toBe(1000);
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(parser.formatBytes(0)).toBe('0 B');
      expect(parser.formatBytes(1023)).toBe('1023 B');
      expect(parser.formatBytes(1024)).toBe('1 KB');
      expect(parser.formatBytes(1048576)).toBe('1 MB');
      expect(parser.formatBytes(-1)).toBe('N/A');
    });
  });

  describe('formatTime', () => {
    it('should format time correctly', () => {
      expect(parser.formatTime(0.5)).toBe('500μs');
      expect(parser.formatTime(50)).toBe('50ms');
      expect(parser.formatTime(1500)).toBe('1.50s');
    });
  });

  describe('formatRelativeTime', () => {
    it('should always show a non-negative, prefixed offset', () => {
      expect(parser.formatRelativeTime(0)).toBe('+0ms');
      expect(parser.formatRelativeTime(250)).toBe('+250ms');
      expect(parser.formatRelativeTime(1500)).toBe('+1.50s');
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
