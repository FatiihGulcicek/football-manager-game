import { randomUUID } from 'crypto';
import { AuthenticatedHttpRequest } from '../types/authenticated-user';

export function readHeader(
  request: Pick<AuthenticatedHttpRequest, 'headers'>,
  headerName: string
): string | undefined {
  const value = request.headers[headerName.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function createRequestId(request: Pick<AuthenticatedHttpRequest, 'headers'>): string {
  const requestId = readHeader(request, 'x-request-id') ?? randomUUID();
  const normalizedRequestId = requestId.trim();

  if (!normalizedRequestId || containsControlCharacter(normalizedRequestId)) {
    return 'invalid';
  }

  return Array.from(normalizedRequestId).slice(0, 128).join('');
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && ((codePoint >= 1 && codePoint <= 31) || codePoint === 127)) {
      return true;
    }
  }

  return false;
}
