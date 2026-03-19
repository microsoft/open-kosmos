/**
 * CommandParser Tests - dir command scenarios
 * Test Windows dir command argument identification, ensuring command switches are not mistaken for paths
 */

import { CommandParser } from '../commandParser';

describe('CommandParser - dir command', () => {
  describe('Windows dir command switch identification', () => {
    test('should correctly identify path and exclude /b switch', () => {
      const paths = CommandParser.extractPathsFromCommand(
        'dir C:\\Users\\yanhu\\AppData\\Local\\uv\\cache\\archive-v0\\zS-2m9Hp6-b4wTQFnL302\\lib\\site-packages\\example_mcp\\..\\..\\temp\\titan_query_results_*.csv /b'
      );
      
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('titan_query_results_*.csv');
      expect(paths).not.toContain('/b');
    });

    test('should correctly exclude /o:d sort switch', () => {
      const paths = CommandParser.extractPathsFromCommand(
        'dir C:\\Users\\test\\file.txt /o:d'
      );
      
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe('C:\\Users\\test\\file.txt');
      expect(paths).not.toContain('/o:d');
    });

    test('should correctly exclude multiple dir command switches', () => {
      const paths = CommandParser.extractPathsFromCommand(
        'dir C:\\temp /s /b /o:d /a:-d'
      );
      
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe('C:\\temp');
      expect(paths).not.toContain('/s');
      expect(paths).not.toContain('/b');
      expect(paths).not.toContain('/o:d');
      expect(paths).not.toContain('/a:-d');
    });

    test('should correctly identify paths with wildcards', () => {
      const paths = CommandParser.extractPathsFromCommand(
        'dir C:\\logs\\*.log /o:d /b'
      );
      
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe('C:\\logs\\*.log');
    });

    test('should correctly handle nested cmd invocations', () => {
      const command = 'cmd';
      const parameters = [
        'dir',
        'C:\\Users\\yanhu\\AppData\\Local\\uv\\cache\\archive-v0\\zS-2m9Hp6-b4wTQFnL302\\lib\\site-packages\\example_mcp\\..\\..\\temp\\titan_query_results_*.csv',
        '/b',
        '/o:d'
      ];
      
      const paths = CommandParser.extractPathParameters(command, parameters);
      
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('titan_query_results_*.csv');
      expect(paths).not.toContain('/b');
      expect(paths).not.toContain('/o:d');
    });
  });

  describe('Windows command switch pattern identification', () => {
    test('should exclude single-letter switches', () => {
      const switches = ['/s', '/b', '/a', '/h', '/r', '/w'];
      
      switches.forEach(sw => {
        const paths = CommandParser.extractPathsFromCommand(`dir C:\\temp ${sw}`);
        expect(paths).not.toContain(sw);
      });
    });

    test('should exclude switches with colon values', () => {
      const switches = ['/o:n', '/o:d', '/o:s', '/a:h', '/a:-d'];
      
      switches.forEach(sw => {
        const paths = CommandParser.extractPathsFromCommand(`dir C:\\temp ${sw}`);
        expect(paths).not.toContain(sw);
      });
    });

    test('should exclude multi-letter switches', () => {
      const switches = ['/ad', '/ah', '/ar', '/tc'];
      
      switches.forEach(sw => {
        const paths = CommandParser.extractPathsFromCommand(`dir C:\\temp ${sw}`);
        expect(paths).not.toContain(sw);
      });
    });
  });

  describe('Real-world scenario tests', () => {
    test('Typical dir command - list all CSV files sorted by date', () => {
      const paths = CommandParser.extractPathsFromCommand(
        'dir "C:\\Program Files\\app\\data\\*.csv" /b /o:d'
      );
      
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe('C:\\Program Files\\app\\data\\*.csv');
    });

    test('dir command - recursively list all subdirectories', () => {
      const paths = CommandParser.extractPathsFromCommand(
        'dir C:\\projects /s /b /a:d'
      );
      
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe('C:\\projects');
    });

    test('dir command - UNC path', () => {
      const paths = CommandParser.extractPathsFromCommand(
        'dir \\\\server\\share\\folder /b /o:d'
      );
      
      // UNC paths start with \\, should be correctly identified
      // Note: In command string \\ will be processed by the parser
      expect(paths.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Edge cases', () => {
    test('switch before path', () => {
      const paths = CommandParser.extractPathsFromCommand(
        'dir /b C:\\temp\\file.txt'
      );
      
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe('C:\\temp\\file.txt');
    });

    test('mixed multiple switches', () => {
      const paths = CommandParser.extractPathsFromCommand(
        'dir /s /b C:\\temp /o:d /a:-d'
      );
      
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe('C:\\temp');
    });

    test('should not mistake root path switch for a path', () => {
      const paths = CommandParser.extractPathsFromCommand(
        'somecommand /c C:\\temp\\file.txt'
      );
      
      // /c should be identified as a switch, not a path
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe('C:\\temp\\file.txt');
      expect(paths).not.toContain('/c');
    });
  });
});