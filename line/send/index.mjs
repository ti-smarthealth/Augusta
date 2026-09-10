/**
 * `tish-line-send` — the only function that talks outbound to LINE.
 *
 * **Not VPC-attached**, because `api.line.me` is on the internet and this
 * account has no NAT gateway and no interface endpoints; a VPC-attached function
 * here reaches the database and nothing else. Verified 2026-07-31 and recorded
 * in PLAN.md §0.6 — the same fact that makes escalation two Lambdas and the
 * telemetry rollup two Lambdas makes this one live outside.
 *
 * **Not reachable through API Gateway.** It has no integration and no public
 * route; the admin API invokes it through the Lambda API. That is deliberate:
 * a function that can broadcast to every follower of the account should not have
 * a URL, and the authorisation for using it should be the admin pool membership
 * the dashboard already enforces rather than anything reimplemented here.
 *
 * **Why the console goes through this rather than calling LINE itself.** The
 * dashboard's test buttons are worth having only if they exercise the code the
 * product actually uses. Giving the admin API its own copy of the LINE client
 * would mean testing a parallel implementation — green buttons proving nothing
 * about the path a real escalation takes.
 */

import {
    KINDS, TARGETING,
    reply, push, multicast, broadcast, narrowcast,
    info, quota, quotaConsumption, narrowcastProgress, audienceGroups,
    profile, groupSummary, groupMemberCount,
} from './line-api.mjs';

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

/**
 * Invoke the VPC-attached half to write the log.
 *
 * Lazily imported so tests never load the SDK, and `@aws-sdk/client-lambda` is a
 * devDependency rather than a dependency for the reason `escalate.mjs` spells
 * out: the managed runtime already provides the v3 SDK, so bundling it adds
 * megabytes for a module that is present anyway.
 */
let invokeDb = async (payload) => {
    const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
    const client = new LambdaClient({});
    const res = await client.send(new InvokeCommand({
        FunctionName: process.env.LINE_DB_FUNCTION,
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }));
    const raw = res.Payload ? new TextDecoder().decode(res.Payload) : '';
    if (res.FunctionError) throw new Error(`line db half failed: ${raw.slice(0, 300)}`);
    return raw ? JSON.parse(raw) : {};
};
export function _setInvokerForTests(fn) { invokeDb = fn; }

/**
 * Log an attempt, then the outcome.
 *
 * **Two writes rather than one, and the first happens before the send.** A
 * single write afterwards loses precisely the case worth keeping: the send that
 * was issued and never came back. The console showing a `queued` row that never
 * moved is how a hung LINE call becomes visible instead of vanishing.
 *
 * A logging failure never fails the send. The message really did go; refusing to
 * say so because the audit write failed would be the worse of the two lies, and
 * the send is not retryable anyway once LINE has accepted it.
 */
async function logged(entry, run) {
    let id = null;
    try {
        ({ id = null } = await invokeDb({ op: 'log-start', ...entry }));
    } catch (e) {
        console.error('[line] could not record send attempt', e);
    }

    const result = await run();

    try {
        await invokeDb({
            op: 'log-finish',
            id,
            status: result.ok ? 'sent' : 'failed',
            lineRequestId: result.requestId ?? null,
            error: result.error ?? null,
        });
    } catch (e) {
        console.error('[line] could not record send outcome', e);
    }

    return result;
}

/**
 * Invoked by the admin API, and by the product when something needs to reach
 * LINE. Returns a summary rather than throwing, so one bad request from the
 * console cannot look like the function being broken.
 */
export const handler = async (event = {}) => {
    if (!TOKEN) {
        return { ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN is not set on this function.' };
    }

    const op = event.op;

    // --- read-only probes, none of which send anything -----------------------
    if (op === 'info') return info(TOKEN);
    if (op === 'quota') {
        // Both halves in one round trip, because the console shows them together
        // and a limit without a consumption figure says nothing useful.
        const [limit, used] = await Promise.all([quota(TOKEN), quotaConsumption(TOKEN)]);
        return { ok: limit.ok && used.ok, data: { quota: limit.data, consumption: used.data }, error: limit.error ?? used.error };
    }
    if (op === 'audiences') return audienceGroups(TOKEN);
    if (op === 'narrowcast-progress') return narrowcastProgress(TOKEN, event.requestId);

    // Identity lookups. **Not sends**, so they cost no quota and are not logged
    // — a name resolution appearing in the message log would make the log lie
    // about what the bot has said to people.
    if (op === 'profile') return profile(TOKEN, event.id);
    if (op === 'group-summary') {
        const [summary, count] = await Promise.all([
            groupSummary(TOKEN, event.id),
            groupMemberCount(TOKEN, event.id),
        ]);
        return {
            ok: summary.ok,
            error: summary.error ?? count.error,
            data: summary.ok ? { ...summary.data, count: count.data?.count ?? null } : null,
        };
    }

    // --- sends ---------------------------------------------------------------
    if (!KINDS.includes(op)) {
        return { ok: false, error: `unknown op: ${String(op)}` };
    }

    const messages = event.messages;
    if (!messages || (Array.isArray(messages) && messages.length === 0)) {
        return { ok: false, error: 'messages is required' };
    }

    const entry = {
        kind: op,
        target: targetFor(op, event),
        payload: JSON.stringify(messages).slice(0, 4000),
        triggeredBy: event.triggeredBy ?? null,
    };

    switch (op) {
        case 'reply':
            if (!event.replyToken) return { ok: false, error: 'replyToken is required for a reply' };
            return logged(entry, () => reply(TOKEN, event.replyToken, messages));
        case 'push':
            if (!event.to) return { ok: false, error: 'to is required for a push' };
            return logged(entry, () => push(TOKEN, event.to, messages));
        case 'multicast':
            return logged(entry, () => multicast(TOKEN, event.to, messages));
        case 'broadcast':
            return logged(entry, () => broadcast(TOKEN, messages));
        case 'narrowcast':
            return logged(entry, () => narrowcast(TOKEN, event.recipient, messages, event.filter, event.limit));
        default:
            return { ok: false, error: `unhandled kind: ${op}` };
    }
};

/** What to record as the addressee, given how this kind addresses people. */
export function targetFor(kind, event) {
    switch (TARGETING[kind]) {
        // **Never the token itself.** A reply token is single-use and expires in
        // about a minute, so a stored one is a dead credential by the time
        // anybody reads the log — all risk, no value.
        //
        // What the log actually wants is *who was replied to*, which the caller
        // passes as `to`. `reply-token` is the fallback for a caller that did
        // not, and a row reading that means the conversation is unrecoverable
        // rather than that the reply was anonymous.
        case 'token': return event.to ?? (event.replyToken ? 'reply-token' : null);
        case 'one': return event.to ?? null;
        case 'many': return Array.isArray(event.to) ? event.to.join(',') : (event.to ?? null);
        case 'audience': return event.recipient ? JSON.stringify(event.recipient).slice(0, 200) : 'all';
        case 'none': return null;
        default: return null;
    }
}
