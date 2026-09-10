/**
 * `tish-line-webhook` — the bot's public entrance.
 *
 * `LINE → API Gateway /line/webhook (authorization NONE) → THIS`
 *
 * **Not VPC-attached**, because it must reach `api.line.me` to answer with a
 * reply token, and a VPC-attached function in this account reaches the database
 * and nothing else.
 *
 * **The one unauthenticated route in the product, and deliberately so** — LINE
 * has no Cognito token to present. The signature check below is therefore the
 * entire boundary between the public internet and the bindings table, which is
 * why it happens before anything else and why the body is never parsed until it
 * passes.
 *
 * ---------------------------------------------------------------------------
 * THIS IS A ROUTER, NOT A BRAIN
 * ---------------------------------------------------------------------------
 *
 * It verifies, dedupes, decides who handles the event, and returns 200. Nothing
 * slow belongs here: LINE retries on a timeout, so a handler that waits on
 * something expensive turns one inbound message into several. When the LLM
 * arrives it goes behind a queue as a separate consumer, and this file does not
 * change.
 */

import crypto from 'node:crypto';

const SECRET = process.env.LINE_CHANNEL_SECRET;

/**
 * Everything the bot can say, in every language it can say it.
 *
 * **Kept here rather than in the app's locale files, and that is a compromise
 * rather than a preference.** This is a separate package with no access to
 * `tish-app/locales/`, so `npm run validate-translations` cannot see these
 * strings and will not catch one added in English only. Mirrors the same
 * arrangement `escalate.mjs` already makes for push copy — if a third place
 * ever needs server-rendered copy, that is the moment to extract a shared
 * module rather than write this table a third time.
 *
 * **`zh-Hant` first because it is the default, not because it is the
 * translation.** Every user row defaults to it, the patients are in Taiwan, and
 * an unlinked sender the bot knows nothing about should be answered in the
 * language most of them read.
 */
const MESSAGES = {
    'zh-Hant': {
        linked: '您的 LINE 帳號已成功連結至 TISH。',
        badCode: '這組代碼無效或已過期。請在 TISH 應用程式中重新產生一組。',
        holding: '已收到您的訊息。目前還無法回答問題。',
    },
    en: {
        linked: 'Your LINE account is now linked to TISH.',
        badCode: 'That code is not valid, or it has expired. You can generate a new one in the TISH app.',
        holding: 'Thanks — I have received your message. I cannot answer questions yet.',
    },
};

/** Matches `users.locale`'s own default, so the fallback agrees with the column. */
const DEFAULT_LOCALE = 'zh-Hant';

/**
 * Copy for a locale, degrading rather than failing.
 *
 * The same chain as `escalate.mjs`: an unrecognised locale — or none at all,
 * which is every sender who has not linked an account — falls to the product's
 * language rather than to no reply. A bot that says nothing is
 * indistinguishable from a bot that is broken.
 */
export function copyFor(locale) {
    return MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE] ?? MESSAGES.en;
}

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

let invokeSend = async (payload) => {
    const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
    const client = new LambdaClient({});
    const res = await client.send(new InvokeCommand({
        FunctionName: process.env.LINE_SEND_FUNCTION,
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }));
    // The response matters now: identity lookups go through this too, and a
    // fire-and-forget invoke cannot return a display name.
    const raw = res.Payload ? new TextDecoder().decode(res.Payload) : '';
    return raw ? JSON.parse(raw) : {};
};
export function _setSenderForTests(fn) { invokeSend = fn; }

/**
 * Resolve a display name, best effort.
 *
 * **The webhook events carry ids and nothing else** — a `follow` gives a
 * `userId`, a `join` gives a `groupId`, and neither carries a name. Without this
 * every row in the console reads as an opaque `U1a2b3c…`, which makes the
 * follower list useless for the one job it has.
 *
 * Never throws and never blocks the event: a nameless row is a cosmetic loss,
 * a dropped follow is a person the bot does not know exists.
 */
async function resolveName(id, sourceType) {
    if (!id) return null;
    try {
        const res = sourceType === 'group'
            ? await invokeSend({ op: 'group-summary', id })
            : sourceType === 'user'
                ? await invokeSend({ op: 'profile', id })
                : null; // Rooms have no name endpoint at all on LINE's side.
        if (!res?.ok) return null;
        return res.data?.displayName ?? res.data?.groupName ?? null;
    } catch (err) {
        console.error('[line] could not resolve display name', err);
        return null;
    }
}

/**
 * HMAC-SHA256 of the **raw body** with the channel secret, base64, compared
 * against `x-line-signature`.
 *
 * **The raw body, byte for byte.** Parsing and re-stringifying changes key order
 * and whitespace and every signature then fails — a failure that looks like a
 * wrong secret and is not. API Gateway may also hand the body base64-encoded, so
 * that is decoded to bytes first rather than to a string.
 *
 * `timingSafeEqual` because a plain `===` on an HMAC leaks its own answer
 * through how long it takes to say no.
 */
export function verify(rawBody, signature, secret) {
    if (!secret || !signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
    let given;
    try {
        given = Buffer.from(signature, 'base64');
    } catch {
        return false;
    }
    if (given.length !== expected.length) return false;
    return crypto.timingSafeEqual(expected, given);
}

/** The body as the bytes LINE signed, whatever shape the gateway used. */
export function rawBodyOf(event) {
    const body = event?.body ?? '';
    return event?.isBase64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf8');
}

/** LINE's console sends this when you save the webhook URL. It must answer 200. */
const VERIFY_TOKEN = '00000000000000000000000000000000';

export const handler = async (event = {}) => {
    const method = event?.httpMethod || event?.requestContext?.http?.method;
    if (method && method !== 'POST') return respond(405, { message: 'Only POST is supported.' });

    if (!SECRET) {
        // Fail closed and loudly. Answering 200 with no secret configured would
        // accept unsigned traffic, which is worse than being visibly broken.
        console.error('[line] LINE_CHANNEL_SECRET is not set; refusing every request');
        return respond(500, { message: 'Webhook is not configured.' });
    }

    const raw = rawBodyOf(event);
    const signature = headerOf(event, 'x-line-signature');

    if (!verify(raw, signature, SECRET)) {
        console.warn('[line] rejected a request with a bad or missing signature');
        return respond(403, { message: 'Bad signature.' });
    }

    let payload;
    try {
        payload = JSON.parse(raw.toString('utf8') || '{}');
    } catch {
        return respond(400, { message: 'Body is not JSON.' });
    }

    const events = Array.isArray(payload.events) ? payload.events : [];

    // **Always 200, even when an individual event fails.** A non-200 makes LINE
    // redeliver the whole batch, so one unhandled event type would replay every
    // event beside it — including the ones that already succeeded.
    for (const e of events) {
        try {
            await handleEvent(e);
        } catch (err) {
            console.error('[line] event failed', e?.type, err);
        }
    }

    return respond(200, { accepted: events.length });
};

async function handleEvent(e) {
    if (!e || typeof e !== 'object') return;

    // The console's verification ping: a real event shape with a dummy token and
    // ids that do not exist. Answering it is the whole job.
    if (e.replyToken === VERIFY_TOKEN) {
        console.log('[line] webhook verification ping');
        return;
    }

    const lineUserId = e.source?.userId ?? null;
    const sourceType = e.source?.type ?? 'user';
    const groupId = e.source?.groupId ?? e.source?.roomId ?? null;

    // Dedupe before doing anything with side effects. A retried delivery must
    // not consume a link code or answer twice.
    if (e.webhookEventId) {
        const { fresh } = await invokeDb({
            op: 'seen',
            webhookEventId: e.webhookEventId,
            eventType: e.type,
            lineUserId,
        });
        if (!fresh) {
            console.log('[line] duplicate delivery ignored', e.webhookEventId);
            return;
        }
    }

    switch (e.type) {
        case 'follow':
            await invokeDb({
                op: 'follow', lineUserId, sourceType,
                displayName: await resolveName(lineUserId, 'user'),
            });
            return;

        case 'join':
            // Added to a group. Recorded under the group id, with no owner —
            // a group is not a person and cannot be bound to one.
            await invokeDb({
                op: 'follow', lineUserId: groupId, sourceType,
                displayName: await resolveName(groupId, sourceType),
            });
            return;

        case 'unfollow':
        case 'leave':
            await invokeDb({ op: 'unfollow', lineUserId: lineUserId ?? groupId });
            return;

        case 'message':
            await handleMessage(e, lineUserId, sourceType, groupId);
            return;

        default:
            // Unknown types are logged, not errors. LINE adds event types and an
            // unrecognised one must not make the batch fail.
            console.log('[line] unhandled event type', e.type);
    }
}

/**
 * A text message. Today that means: is it a link code, or is it conversation?
 *
 * **Conversation currently gets an honest holding reply rather than silence.**
 * The LLM is not wired up yet, and a bot that says nothing is indistinguishable
 * from a bot that is broken — which is the failure this product spends most of
 * its effort avoiding elsewhere.
 */
/**
 * Fill in a name for somebody we already know about but never named.
 *
 * **This is the path that rescues followers who predate the webhook.** Anyone
 * who added the bot before the endpoint was live produced no `follow` event, and
 * `followers/ids` is unavailable on this account — so their first message is the
 * only chance to learn they exist. Doing the lookup here means they arrive in
 * the console named rather than as a raw id.
 */
async function backfillName(lineUserId, sourceType) {
    if (sourceType !== 'user') return;
    try {
        const { needsName } = await invokeDb({ op: 'needs-name', lineUserId });
        if (!needsName) return;
        const displayName = await resolveName(lineUserId, 'user');
        if (displayName) await invokeDb({ op: 'set-display-name', lineUserId, displayName });
    } catch (err) {
        console.error('[line] name backfill failed', err);
    }
}

async function handleMessage(e, lineUserId, sourceType, groupId) {
    if (e.message?.type !== 'text') return;

    const text = String(e.message.text ?? '').trim();

    // **Record the sender before doing anything else with the message.** A
    // person who added the bot before the webhook was live produced no `follow`
    // event, and this account cannot list its own followers, so their first
    // message is the only chance to learn they exist. Doing this only on the
    // link-code path would leave every ordinary conversation invisible.
    const id = lineUserId ?? groupId;
    if (id) {
        try {
            await invokeDb({ op: 'follow', lineUserId: id, sourceType });
            await backfillName(id, sourceType);
        } catch (err) {
            // Knowing who they are is worth less than answering them.
            console.error('[line] could not record sender', err);
        }
    }

    // Whose language to answer in. Null for anyone not yet linked, which
    // `copyFor` turns into the product's default rather than into English.
    let locale = null;
    if (lineUserId) {
        try {
            ({ locale = null } = await invokeDb({ op: 'sender', lineUserId }));
        } catch (err) {
            // A locale lookup failing must not cost the user their reply.
            console.error('[line] could not resolve sender locale', err);
        }
    }

    // A link code is 6 characters, letters and digits. Checked before anything
    // conversational so a code is never treated as chat.
    if (/^[A-Z0-9]{6}$/i.test(text) && lineUserId) {
        const res = await invokeDb({ op: 'redeem-code', code: text, lineUserId });

        // **A successful redeem is the first moment the sender's language is
        // known**, so the confirmation uses the locale the link just revealed
        // rather than the null we started with.
        const copy = copyFor(res.linked ? (res.locale ?? locale) : locale);
        await reply(e.replyToken, res.linked ? copy.linked : copy.badCode, lineUserId);
        return;
    }

    await reply(e.replyToken, copyFor(locale).holding, id);
}

/**
 * Reply through the send function rather than calling LINE here.
 *
 * Costs a Lambda hop and buys the log: every outbound message the bot produces
 * lands in `line_messages` whatever produced it, so the console shows the whole
 * picture rather than only the sends somebody pressed a button for.
 */
async function reply(replyToken, text, to = null) {
    if (!replyToken) return;
    try {
        // `to` is for the log only — the reply is addressed by the token. Without
        // it every reply row reads `reply-token` and the console cannot say which
        // conversation it belonged to, which is the one thing that column is for.
        await invokeSend({ op: 'reply', replyToken, to, messages: text, triggeredBy: 'webhook' });
    } catch (err) {
        console.error('[line] reply failed', err);
    }
}

function headerOf(event, name) {
    const headers = event?.headers ?? {};
    const hit = Object.keys(headers).find((k) => k.toLowerCase() === name);
    return hit ? headers[hit] : null;
}

function respond(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    };
}
