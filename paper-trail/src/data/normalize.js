/**
 * Turns a connector CallToolResult into rows. The Quiver connector answers
 * in four observed shapes, and every caller must survive all of them:
 *
 *  1. One text block per row: content = [{type:"text", text:"{...row...}"}, ...]
 *  2. A truncated wrapper when the response passes ~75,000 characters:
 *     {"truncated":true,"original_item_count":N,"returned_item_count":M,"items":[...]}
 *  3. An empty-result wrapper: {"count":0,"results":[],"message":"No data found..."}
 *  4. A single object for profile-style tools (ownership, politician).
 *
 * structuredContent and the runtime's `payload` convenience are honoured
 * when present.
 */

const LIST_KEYS = ['items', 'results', 'result', 'rows', 'data'];

function listOf(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  for (const k of LIST_KEYS) if (Array.isArray(obj[k])) return obj[k];
  return null;
}

function wrapperMeta(obj) {
  return {
    truncated: obj.truncated === true,
    original: Number.isFinite(obj.original_item_count) ? obj.original_item_count : null,
    returned: Number.isFinite(obj.returned_item_count) ? obj.returned_item_count : null,
    message: typeof obj.message === 'string' ? obj.message : null
  };
}

/** @returns {{rows: object[], object: object|null, meta: {truncated:boolean, original:number|null, returned:number|null, message:string|null}}} */
export function parseResult(res) {
  const meta = { truncated: false, original: null, returned: null, message: null };
  if (!res) return { rows: [], object: null, meta };

  const sc = res.structuredContent;
  if (Array.isArray(sc)) return { rows: sc, object: null, meta };
  if (sc && typeof sc === 'object') {
    const list = listOf(sc);
    if (list) return { rows: list, object: null, meta: { ...meta, ...wrapperMeta(sc) } };
    return { rows: [sc], object: sc, meta };
  }

  const rows = [];
  let object = null;
  let blocks = 0;
  for (const b of res.content || []) {
    if (!b || b.type !== 'text' || typeof b.text !== 'string') continue;
    let v;
    try { v = JSON.parse(b.text); } catch { continue; }
    blocks++;
    if (Array.isArray(v)) { rows.push(...v); continue; }
    if (!v || typeof v !== 'object') continue;
    const list = listOf(v);
    if (list && ('truncated' in v || 'count' in v || 'returned_item_count' in v || 'items' in v || 'results' in v)) {
      rows.push(...list);
      Object.assign(meta, wrapperMeta(v));
      continue;
    }
    rows.push(v);
    if (blocks === 1) object = v;
  }
  if (blocks === 0 && res.payload != null) {
    const p = res.payload;
    if (Array.isArray(p)) return { rows: p, object: null, meta };
    if (p && typeof p === 'object') {
      const list = listOf(p);
      if (list) return { rows: list, object: null, meta: { ...meta, ...wrapperMeta(p) } };
      return { rows: [p], object: p, meta };
    }
  }
  return { rows, object: rows.length === 1 ? object : null, meta };
}

export const rowsOf = res => parseResult(res).rows;
export const objectOf = res => {
  const r = parseResult(res);
  return r.object || r.rows[0] || null;
};
