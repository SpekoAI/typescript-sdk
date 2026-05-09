import { SpekoApiError } from '../lib/errors.js';

export interface JsonOption {
  json?: boolean;
}

export type Writable = Pick<NodeJS.WritableStream, 'write'>;

export function writeLine(stream: Writable, line = ''): void {
  stream.write(`${line}\n`);
}

export function writeJson(stream: Writable, value: unknown): void {
  writeLine(stream, JSON.stringify(value, null, 2));
}

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const format = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  ');
  return [format(headers), format(widths.map((width) => '-'.repeat(width))), ...rows.map(format)].join(
    '\n',
  );
}

export function formatError(error: unknown): string {
  if (error instanceof SpekoApiError) {
    const trace = error.traceId ? ` trace_id=${error.traceId}` : '';
    return `${error.message} (${error.code}, HTTP ${error.status})${trace}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function versionLabel(version: number): string {
  return `v${version}`;
}
