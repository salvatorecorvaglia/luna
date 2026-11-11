import { LIMITS } from './constants';

export function textByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

export function isEditableContent(content: string): boolean {
  return textByteLength(content) <= LIMITS.MAX_EDITABLE_BYTES;
}
