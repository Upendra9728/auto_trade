export function formatHttpError(err: any): string {
  const status = err?.status;
  const statusText = err?.statusText;
  const prefix = status ? `HTTP ${status}${statusText ? ` ${statusText}` : ''}: ` : '';

  const body = err?.error;
  if (typeof body === 'string') {
    return prefix + body;
  }

  const detail = body?.detail;
  if (typeof detail === 'string') {
    return prefix + detail;
  }
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d: any) => {
        const loc = Array.isArray(d?.loc) ? d.loc.join('.') : undefined;
        const msg = d?.msg ?? JSON.stringify(d);
        return loc ? `${loc}: ${msg}` : String(msg);
      })
      .join('; ');
    return prefix + msgs;
  }

  if (body && typeof body === 'object') {
    try {
      return prefix + JSON.stringify(body);
    } catch {
      return prefix + String(body);
    }
  }

  const message = err?.message;
  if (typeof message === 'string' && message) {
    return prefix + message;
  }

  return prefix + String(err);
}
