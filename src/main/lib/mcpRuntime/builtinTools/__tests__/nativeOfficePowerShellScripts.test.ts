import { describe, expect, it } from 'vitest';
import {
  buildExcelPowerShellScript,
  buildPowerPointPowerShellScript,
  buildWordPowerShellScript,
} from '../nativeOfficePowerShellScripts';

describe('native Office PowerShell scripts', () => {
  it.each([
    [buildWordPowerShellScript, 'Word.Application', 'Documents.Open'],
    [buildPowerPointPowerShellScript, 'PowerPoint.Application', 'Presentations.Open'],
    [buildExcelPowerShellScript, 'Excel.Application', 'Workbooks.Open'],
  ])('builds a read-only script with escaped paths', (buildScript, application, openMethod) => {
    const script = buildScript("C:\\Users\\O'Brien\\report.docx");

    expect(script).toContain(`New-Object -ComObject ${application}`);
    expect(script).toContain(openMethod);
    expect(script).toContain("C:\\\\Users\\\\O''Brien\\\\report.docx");
    expect(script).toContain('TEXT_START');
    expect(script).toContain('TEXT_END');
  });
});
