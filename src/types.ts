export type RecordData = Record<string, unknown>;
export const record = (value: unknown): RecordData => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const string = (value: unknown): string => typeof value === 'string' ? value : '';
export const id = (value: unknown): number | null => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export interface PageResult {
  items: RecordData[];
  complete: boolean;
  total: number | null;
  pagesRead: number;
  warnings: string[];
}

export interface RichText {
  markdown: string;
  links: { url: string; text: string }[];
  inlineFileIds: number[];
  mentions: { userId: number | null; text: string }[];
  warnings: string[];
}

export interface Attachment {
  fileId: number;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  uploadedBy: number | null;
  createdAt: string | null;
  source: { kind: 'task' | 'comment'; id: number };
  inline: boolean;
}
