import { HttpStatus } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';

type BodyParserError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
  body?: unknown;
};

type HttpRequest = {
  headers: Record<string, string | string[] | undefined>;
};

type HttpResponse = {
  status: (statusCode: number) => {
    json: (body: unknown) => void;
  };
};

type NextFunction = (error?: unknown) => void;

export function applySafeBodyParser(app: NestExpressApplication): void {
  app.useBodyParser('json', { strict: false });
  app.useBodyParser('urlencoded', { extended: true });
  app.use(safeBodyParserErrorHandler);
}

function safeBodyParserErrorHandler(
  error: unknown,
  request: HttpRequest,
  response: HttpResponse,
  next: NextFunction
): void {
  if (!isBodyParserJsonError(error)) {
    next(error);
    return;
  }

  response.status(HttpStatus.BAD_REQUEST).json({
    error: {
      code: 'INVALID_JSON_BODY',
      message: 'Istek govdesi gecerli JSON olmalidir.',
      requestId: createRequestId(request)
    }
  });
}

function isBodyParserJsonError(error: unknown): error is BodyParserError {
  if (!(error instanceof Error)) {
    return false;
  }

  const bodyParserError = error as BodyParserError;

  return (
    (bodyParserError.status === HttpStatus.BAD_REQUEST ||
      bodyParserError.statusCode === HttpStatus.BAD_REQUEST) &&
    bodyParserError.type === 'entity.parse.failed'
  );
}

function createRequestId(request: HttpRequest): string {
  const headerValue = request.headers['x-request-id'];
  const requestId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const normalizedRequestId = (requestId ?? randomUUID()).trim();

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
