// Errors whose message is safe to show to the user. Anything that is not an
// HttpError is treated as an internal failure: it is logged, and the client
// only receives a generic message (no provider responses, SQL or env names).
// This module has no Node-only imports, so client code may import it too.
export class HttpError extends Error {
  constructor(status, message, { transient = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'HttpError';
    this.status = status;
    // true = worth retrying later (provider busy, timeout), not a user mistake.
    this.transient = transient;
  }
}

export const badRequest = message => new HttpError(400, message);
export const unauthorized = message => new HttpError(401, message);
export const paymentRequired = message => new HttpError(402, message);
export const notFound = message => new HttpError(404, message);
export const conflict = message => new HttpError(409, message);

export function isTransient(error) {
  return error instanceof HttpError && error.transient;
}

function providerDetail(data) {
  const detail = data?.error?.message || data?.error || data?.message || data?.detail;
  return typeof detail === 'string' ? detail.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
}

// Maps a failed AI-provider HTTP response to an error that is safe to expose.
// 400/422 usually describe the user's media, so a short detail is passed on.
// Auth/quota problems with OUR key are hidden from the user and only logged.
export function providerError(name, status, data) {
  const detail = providerDetail(data);
  if (status === 429 || status >= 500) {
    return new HttpError(503, `${name} is busy right now. Please try again in a minute.`, {
      transient: true, cause: `${name} ${status}: ${detail}`,
    });
  }
  if (status === 400 || status === 422) {
    return new HttpError(400, `${name} rejected this request${detail ? `: ${detail}` : '.'}`);
  }
  return new HttpError(502, `${name} is not available right now. Please try again later.`, {
    cause: `${name} ${status}: ${detail}`,
  });
}

// Network failures and timeouts while talking to a provider.
export function providerUnreachable(name, error) {
  return new HttpError(503, `${name} is busy right now. Please try again in a minute.`, {
    transient: true, cause: error,
  });
}

// Parses a JSON request body; malformed input is the client's fault (400).
export async function readJson(request) {
  let body;
  try { body = await request.json(); } catch { throw badRequest('Invalid JSON body'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Invalid JSON body');
  return body;
}

export function jsonError(error) {
  if (error instanceof HttpError) {
    if (error.status >= 500) console.error('[API]', error.message, error.cause ?? '');
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error('[API] Unexpected error:', error);
  return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}
