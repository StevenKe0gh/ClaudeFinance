import { SERVER, CONCURRENCY } from '../core/config.js';
import { limiter, sleep, addDays, ts } from '../core/util.js';
import { parseResult } from './normalize.js';

/**
 * Connector client around claude.use("mcp"): bounded concurrency, one retry
 * for retryable failures, response caching through the runtime, truncation-
 * aware paging, date sharding, and a request log for the status bar.
 */
export function createConnector({ getMcp, maxLog = 400 }) {
  const run = limiter(CONCURRENCY);
  const log = [];
  const listeners = new Set();
  let seq = 0;

  const emit = () => { for (const fn of listeners) fn(log); };

  async function invoke(tool, input, opts) {
    const mcp = getMcp();
    if (!mcp) throw { code: 'not_granted', message: 'Live data needs the claude.ai viewer with the Quiver Quant connector.' };
    const cache = opts.refresh
      ? { staleTime: 300000, gcTime: 3600000, refresh: true }
      : { staleTime: 300000, gcTime: 3600000 };
    try {
      return await mcp.callTool(SERVER, tool, input, { cache, signal: opts.signal });
    } catch (e) {
      if (e && e.retryable && !opts.retried) {
        await sleep(Math.min(e.retryAfterMs || 900, 8000) + Math.random() * 700);
        return invoke(tool, input, { ...opts, retried: true });
      }
      throw e;
    }
  }

  async function call(tool, input = {}, opts = {}) {
    const entry = { id: ++seq, tool, input, stage: opts.stage || '', at: Date.now(), status: 'pending', rows: 0, ms: 0, cached: false, truncated: false };
    log.unshift(entry);
    if (log.length > maxLog) log.length = maxLog;
    emit();
    const t0 = performance.now();
    try {
      const res = await run(() => invoke(tool, input, opts));
      const parsed = parseResult(res);
      Object.assign(entry, {
        status: 'ok',
        rows: parsed.rows.length,
        ms: Math.round(performance.now() - t0),
        cached: !!(res && res.cache),
        storedAt: res && res.cache ? res.cache.storedAt : Date.now(),
        truncated: parsed.meta.truncated
      });
      emit();
      return { ...parsed, res };
    } catch (e) {
      Object.assign(entry, { status: 'error', ms: Math.round(performance.now() - t0), code: (e && e.code) || 'upstream_error', message: e && e.message });
      emit();
      throw e;
    }
  }

  /**
   * Offset paging that copes with server-side truncation: when a page comes
   * back wrapped, advance by what was actually returned and keep going while
   * the server says a full page existed.
   */
  async function paged(tool, input, { pageSize, maxPages = 10, ...opts } = {}) {
    const rows = [];
    let offset = 0;
    let pages = 0;
    let complete = false;
    while (pages < maxPages) {
      const { rows: got, meta } = await call(tool, { ...input, limit: pageSize, offset }, opts);
      rows.push(...got);
      pages++;
      if (meta.truncated) {
        const advanced = meta.returned || got.length;
        if (!advanced || (meta.original != null && meta.original < pageSize)) { complete = true; break; }
        offset += advanced;
        continue;
      }
      if (got.length < pageSize) { complete = true; break; }
      offset += got.length;
    }
    return { rows, pages, complete };
  }

  /** Splits [from, to] into date shards and pages each one in parallel. */
  async function sharded(tool, input, { from, to, shardDays = 7, ...opts }) {
    const shards = [];
    for (let start = from; ts(start) <= ts(to); start = addDays(start, shardDays)) {
      const end = addDays(start, shardDays - 1);
      shards.push([start, ts(end) > ts(to) ? to : end]);
    }
    const results = await Promise.all(
      shards.map(([a, b]) => paged(tool, { ...input, date_from: a, date_to: b }, opts))
    );
    return {
      rows: results.flatMap(r => r.rows),
      pages: results.reduce((s, r) => s + r.pages, 0),
      complete: results.every(r => r.complete),
      shards: shards.length
    };
  }

  return {
    call,
    paged,
    sharded,
    log,
    onLog(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}

/** UI copy per connector error code. Branch on code, never on message. */
export function connectorErrorCopy(e) {
  const code = (e && e.code) || 'upstream_error';
  const msg = e && e.message ? String(e.message) : '';
  switch (code) {
    case 'needs_reauth':
      return { title: 'Quiver Quant needs to reconnect', body: 'Reconnect Quiver Quant in claude.ai Settings → Connectors, then reload.', code };
    case 'server_not_connected':
    case 'server_not_found':
      return { title: 'Quiver Quant is not connected', body: 'Add the Quiver Quant connector in claude.ai Settings → Connectors, then reload.', code };
    case 'selection_required':
      return { title: 'Choose a Quiver Quant connector', body: 'You have more than one Quiver Quant connector. Pick one when claude.ai asks, then refresh.', code };
    case 'not_in_manifest':
    case 'consent_required':
      return { title: 'Quiver access is off for this page', body: 'Allow Quiver Quant in this page’s Permissions menu, then refresh.', code };
    case 'blocked_by_policy':
      return { title: 'Blocked by your organization', body: 'Your organization does not allow this Quiver Quant tool.', code };
    case 'approval_required':
      return { title: 'Approval needed', body: 'Approve the Quiver Quant request when claude.ai asks, then refresh.', code };
    case 'tool_error':
      return { title: 'Quiver rejected the request', body: msg || 'Check your Quiver subscription level.', code };
    case 'server_unavailable':
    case 'rate_limited':
      return { title: 'Quiver did not answer in time', body: 'Refresh to try again in a moment.', code };
    case 'not_granted':
    case 'capability_disabled':
    case 'capability_removed':
      return { title: 'Live data is not available in this view', body: 'Open this page on claude.ai, signed in to the account with the Quiver Quant connector.', code };
    default:
      return { title: 'Could not reach Quiver', body: (msg ? msg + ' ' : '') + 'Refresh to try again.', code };
  }
}
