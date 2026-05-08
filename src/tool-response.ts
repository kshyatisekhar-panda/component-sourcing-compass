export function text(payload: unknown, opts: { error?: boolean } = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text" as const, text: body }],
    ...(opts.error ? { isError: true } : {}),
  };
}
