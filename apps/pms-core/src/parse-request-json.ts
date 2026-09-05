/** Malformed JSON → Response 400 invalid_json. Empty body → null. No Content-Type gate. */
export async function parseRequestJson(
  request: Request,
): Promise<unknown | Response | null> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
}
