/**
 * Every outbound call to the LINE Messaging API, and nothing else.
 *
 * Dependency-free and I/O-injectable so the whole surface is testable without a
 * network or a token — the same shape as `escalation-policy.mjs`, and for the
 * same reason: the interesting bugs here are in *which* endpoint gets called
 * with *what* body, and those are worth pinning without hitting api.line.me.
 *
 * **Nothing in this file reads the environment.** The token arrives as an
 * argument, so a caller cannot accidentally send with the wrong channel's
 * credentials and the tests cannot accidentally send at all.
 */

const API = 'https://api.line.me/v2/bot';

/** Injected so tests never touch the network. */
let fetchImpl = globalThis.fetch;
export function _setFetchForTests(fn) { fetchImpl = fn ?? globalThis.fetch; }

/**
 * The five ways this bot can put a message in front of somebody.
 *
 * **`reply` is free and the others are not**, which is the single most important
 * thing to know here. A reply answers an inbound event using its `replyToken`
 * and does not count against the monthly quota; every other kind does. So the
 * webhook should reply wherever it can, and push is the fallback for when there
 * is no token or it has expired.
 */
export const KINDS = ['reply', 'push', 'multicast', 'broadcast', 'narrowcast'];

/**
 * How each kind addresses its recipients. The console renders its form from
 * this, so a kind that takes no target cannot grow a target field by accident.
 *
 *   - `token`  — a replyToken, valid for a single use and a short window
 *   - `one`    — a single userId / groupId / roomId
 *   - `many`   — up to 500 userIds
 *   - `none`   — everyone who has ever added the bot
 *   - `audience` — a narrowcast recipient object
 */
export const TARGETING = {
    reply: 'token',
    push: 'one',
    multicast: 'many',
    broadcast: 'none',
    narrowcast: 'audience',
};

/** LINE's own cap. Exceeding it is a 400, so the caller chunks rather than hopes. */
export const MULTICAST_LIMIT = 500;

/** A LINE text message is capped at 5000 characters. Longer is rejected outright. */
export const TEXT_LIMIT = 5000;

/**
 * Normalise anything the console or the product hands us into LINE's message
 * array.
 *
 * **Truncation is explicit rather than incidental.** A 6000-character LLM answer
 * silently becoming a 400 from LINE is the kind of failure that looks like the
 * bot ignoring somebody, so it is cut here with a marker that says so.
 */
export function toMessages(input) {
    const arr = Array.isArray(input) ? input : [input];
    return arr.filter(Boolean).map((m) => {
        if (typeof m !== 'string') return m;
        return {
            type: 'text',
            text: m.length > TEXT_LIMIT ? `${m.slice(0, TEXT_LIMIT - 1)}…` : m,
        };
    });
}

/**
 * One call to LINE, with the outcome shaped the way the log wants it.
 *
 * **Never throws on an API error.** A caller logging the attempt needs the
 * failure as data — status, body, request id — because a thrown exception in a
 * Lambda becomes a stack trace in CloudWatch and an empty row in the console.
 * Only a genuinely unusable response (no network) produces `ok: false` with no
 * status, and that is still returned rather than raised.
 */
async function call(token, path, body) {
    let res;
    try {
        res = await fetchImpl(`${API}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });
    } catch (e) {
        return { ok: false, status: 0, requestId: null, error: `line-unreachable: ${String(e)}` };
    }

    // **The request id is the only handle LINE support will accept**, and it is
    // present on failures too — which is exactly when it is needed.
    const requestId = res.headers?.get?.('x-line-request-id') ?? null;

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return { ok: false, status: res.status, requestId, error: `line-http-${res.status}: ${detail.slice(0, 400)}` };
    }

    return { ok: true, status: res.status, requestId, error: null };
}

export function reply(token, replyToken, messages) {
    return call(token, '/message/reply', { replyToken, messages: toMessages(messages) });
}

export function push(token, to, messages) {
    return call(token, '/message/push', { to, messages: toMessages(messages) });
}

/**
 * Up to 500 userIds in one call.
 *
 * **Group and room ids are not valid here** — multicast addresses individuals
 * only, and passing a groupId produces a confusing 400 rather than an obvious
 * one. The console filters by prefix before it offers this.
 */
export function multicast(token, to, messages) {
    const ids = (Array.isArray(to) ? to : [to]).filter(Boolean);
    if (ids.length > MULTICAST_LIMIT) {
        return Promise.resolve({
            ok: false, status: 0, requestId: null,
            error: `multicast takes at most ${MULTICAST_LIMIT} recipients, got ${ids.length}`,
        });
    }
    return call(token, '/message/multicast', { to: ids, messages: toMessages(messages) });
}

/**
 * Everyone who has ever added the bot.
 *
 * **There is no undo and no recipient list to review first.** For a medication
 * product this is the most dangerous button in the console, which is why the UI
 * makes it type-to-confirm rather than one click.
 */
export function broadcast(token, messages) {
    return call(token, '/message/broadcast', { messages: toMessages(messages) });
}

/**
 * Targeted send against an audience or demographic filter.
 *
 * **Narrowcast is asynchronous and its 202 means "accepted", not "delivered".**
 * The result carries a request id that must be polled through
 * `narrowcastProgress` to learn what actually happened — unlike every other kind
 * here, where the HTTP response is the answer. It also enforces a minimum
 * audience size, so a filter matching a handful of people fails rather than
 * sending; that is a privacy guard on LINE's side, not a bug.
 */
export function narrowcast(token, recipient, messages, filter, limit) {
    const body = { messages: toMessages(messages) };
    if (recipient) body.recipient = recipient;
    if (filter) body.filter = filter;
    if (limit) body.limit = limit;
    return call(token, '/message/narrowcast', body);
}

/** GET helpers — identity, quota and narrowcast progress. */
async function get(token, path) {
    try {
        const res = await fetchImpl(`${API}${path}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const text = await res.text().catch(() => '');
        if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 400), data: null };
        return { ok: true, status: res.status, error: null, data: text ? JSON.parse(text) : null };
    } catch (e) {
        return { ok: false, status: 0, error: `line-unreachable: ${String(e)}`, data: null };
    }
}

/**
 * Who the bot is, according to LINE.
 *
 * The console calls this first: it is the cheapest possible proof that the token
 * is valid and points at the channel somebody thinks it does. A bot answering
 * with an unexpected `basicId` is the failure that otherwise gets discovered by
 * messaging the wrong customers.
 */
export const info = (token) => get(token, '/info');

/** Monthly quota and how much of it is spent. Broadcast makes this matter. */
export const quota = (token) => get(token, '/message/quota');
export const quotaConsumption = (token) => get(token, '/message/quota/consumption');

/** What a narrowcast actually did, once LINE has finished with it. */
export const narrowcastProgress = (token, requestId) =>
    get(token, `/message/progress/narrowcast?requestId=${encodeURIComponent(requestId)}`);

/** The bot's own list of audience groups, for the narrowcast form. */
export const audienceGroups = (token) =>
    get(token, '/audienceGroup/list?page=1&size=40');

/**
 * A follower's display name and picture.
 *
 * **Only works for users who have added the bot**, which is exactly the set
 * `line_accounts` holds, so a 404 here is meaningful: it says the person blocked
 * the bot rather than that the id is wrong.
 *
 * Worth knowing why this call exists at all: the `follow` webhook event carries
 * a `userId` and nothing else. Without this, every row in the console reads as
 * an opaque `U1a2b3c…` and the list is useless for the one job it has.
 */
export const profile = (token, userId) =>
    get(token, `/profile/${encodeURIComponent(userId)}`);

/**
 * A group's name and member count.
 *
 * Groups have no profile endpoint — this is a different path with a different
 * shape, which is why the caller has to know which kind of id it holds. Rooms
 * have neither, and stay nameless by design on LINE's side.
 */
export const groupSummary = (token, groupId) =>
    get(token, `/group/${encodeURIComponent(groupId)}/summary`);

/** How many people are in a group the bot belongs to. */
export const groupMemberCount = (token, groupId) =>
    get(token, `/group/${encodeURIComponent(groupId)}/members/count`);
