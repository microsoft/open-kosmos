import type { TranslationKey, TranslationParams } from '../../lib/i18n';

type Translate = (key: TranslationKey, params?: TranslationParams) => string;

export function formatFileSize(bytes?: number, unknownLabel = 'Unknown'): string {
  if (bytes === undefined || bytes === null) return unknownLabel;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function getOfficeLabel(ext: string, t: Translate): string {
  const map: Record<string, string> = {
    doc: t('viewer.file.wordDocument'),
    docx: t('viewer.file.wordDocument'),
    xls: t('viewer.file.excelSpreadsheet'),
    xlsx: t('viewer.file.excelSpreadsheet'),
    ppt: t('viewer.file.powerPointPresentation'),
    pptx: t('viewer.file.powerPointPresentation'),
    odt: t('viewer.file.openDocumentText'),
    ods: t('viewer.file.openDocumentSpreadsheet'),
    odp: t('viewer.file.openDocumentPresentation'),
  };
  return map[ext] || t('viewer.file.officeFile');
}

export function isLocalFile(url: string): boolean {
  if (url.startsWith('file://')) return true;
  if (url.startsWith('/')) return true;
  if (/^[a-zA-Z]:[/\\]/.test(url)) return true;
  return false;
}

export function getLocalPath(url: string): string {
  if (url.startsWith('file://')) {
    return decodeURIComponent(url.replace('file://', ''));
  }
  return url;
}
