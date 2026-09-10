/**
 * `tish-line-db` — VPC-attached, and the only LINE function that can see RDS.
 *
 * Has the database and no internet, which is the exact inverse of `line/send`
 * and `line/webhook`. Every row in migration 017 is written here, by invocation
 * from one of those two. It has no API Gateway integration and no schedule.
 *
 * **This file must never call api.line.me.** Not as a rule of taste — it
 * physically cannot, and code written as though it could would fail by hanging
 * until the timeout rather than by erroring, which is the worst way to find out.
 */

import pg from 'pg';

const { Pool } = pg;

// Credentials come only from the environment. This file is committed to a repo
// with a remote, same rule as index.mjs and escalate.mjs.
let pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 5432,
    ssl: { rejectUnauthorized: false },
});
export function _setPoolForTests(p) { pool = p; }

/** How many log rows the console asks for at once. */
const LOG_LIMIT = 100;

/** A link code is short-lived on purpose — it is a bearer token in a chat message. */
const LINK_CODE_TTL_MINUTES = 15;

export const handler = async (event = {}) => {
    const op = event.op;

    // --- webhook dedupe ------------------------------------------------------
    //
    // **Returns whether this is the first sighting, and the caller acts on that
    // rather than on an exception.** LINE retries deliveries, so a duplicate is
    // an ordinary event and not an error condition.
    if (op === 'seen') {
        if (!event.webhookEventId) return { fresh: true };
        const res = await pool.query(
            `INSERT INTO line_events (webhook_event_id, event_type, line_user_id)
             VALUES ($1, $2, $3) ON CONFLICT (webhook_event_id) DO NOTHING`,
            [event.webhookEventId, event.eventType ?? null, event.lineUserId ?? null],
        );
        return { fresh: res.rowCount === 1 };
    }

    // --- follow / unfollow ---------------------------------------------------
    //
    // A follow with no binding still gets a row: knowing the bot is in a
    // conversation is useful before anybody has linked an account, and it is
    // what lets the console offer a real recipient to test against.
    if (op === 'follow') {
        const res = await pool.query(
            `INSERT INTO line_accounts (line_user_id, source_type, display_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (line_user_id)
             DO UPDATE SET unfollowed_at = NULL,
                           display_name = COALESCE(EXCLUDED.display_name, line_accounts.display_name)
             RETURNING id, user_id`,
            [event.lineUserId, event.sourceType ?? 'user', event.displayName ?? null],
        );
        return { account: res.rows[0] ?? null };
    }

    if (op === 'unfollow') {
        // Soft, so a block-then-unblock does not cost the user their link.
        const res = await pool.query(
            `UPDATE line_accounts SET unfollowed_at = now() WHERE line_user_id = $1`,
            [event.lineUserId],
        );
        return { updated: res.rowCount };
    }

    // --- account linking -----------------------------------------------------
    //
    // **The code is issued to an authenticated session and redeemed here.** This
    // op only ever *matches* a code that already exists; it cannot create a
    // binding from a LINE id alone, which is the property that stops an
    // unauthenticated webhook attaching itself to a patient.
    if (op === 'redeem-code') {
        const res = await pool.query(
            `UPDATE line_accounts
             SET user_id = c.user_id, linked_at = now()
             FROM line_link_codes c
             WHERE c.code = $1
               AND c.used_at IS NULL
               AND c.created_at > now() - ($2 || ' minutes')::interval
               AND line_accounts.line_user_id = $3
             RETURNING line_accounts.user_id`,
            [String(event.code ?? '').trim().toUpperCase(), String(LINK_CODE_TTL_MINUTES), event.lineUserId],
        );
        if (res.rowCount === 0) return { linked: false };
        await pool.query(
            `UPDATE line_link_codes SET used_at = now() WHERE code = $1`,
            [String(event.code).trim().toUpperCase()],
        );
        // The locale comes back with the link because this is the first moment
        // the webhook can know what language to confirm in — before this, the
        // sender was an opaque LINE id with no user behind it.
        const who = await pool.query('SELECT locale FROM users WHERE id = $1', [res.rows[0].user_id]);
        return { linked: true, userId: res.rows[0].user_id, locale: who.rows[0]?.locale ?? null };
    }

    // What language to answer this sender in, or null if nobody is behind the
    // id yet. **Null is a real answer, not a failure** — an unlinked sender gets
    // the product's default, which the webhook decides rather than this half.
    if (op === 'sender') {
        const res = await pool.query(
            `SELECT a.user_id, u.locale
             FROM line_accounts a
             LEFT JOIN users u ON u.id = a.user_id
             WHERE a.line_user_id = $1`,
            [event.lineUserId],
        );
        return { userId: res.rows[0]?.user_id ?? null, locale: res.rows[0]?.locale ?? null };
    }

    // --- the send log --------------------------------------------------------
    if (op === 'log-start') {
        const res = await pool.query(
            `INSERT INTO line_messages (kind, target, payload, status, triggered_by)
             VALUES ($1, $2, $3, 'queued', $4) RETURNING id`,
            [event.kind, event.target ?? null, event.payload ?? null, event.triggeredBy ?? null],
        );
        return { id: res.rows[0]?.id ?? null };
    }

    if (op === 'log-finish') {
        if (event.id == null) return { updated: 0 };
        const res = await pool.query(
            `UPDATE line_messages
             SET status = $2,
                 line_request_id = $3,
                 error = $4,
                 sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
             WHERE id = $1`,
            [event.id, event.status, event.lineRequestId ?? null, event.error ?? null],
        );
        return { updated: res.rowCount };
    }

    // --- what the console reads ----------------------------------------------
    if (op === 'recent') {
        const limit = Math.min(Number(event.limit) || LOG_LIMIT, LOG_LIMIT);
        const messages = await pool.query(
            `SELECT id, kind, target, payload, status, line_request_id, error,
                    triggered_by, created_at, sent_at
             FROM line_messages ORDER BY created_at DESC LIMIT $1`,
            [limit],
        );
        // Pending is a separate query rather than a filter on the above: the
        // console shows it as its own panel, and a backlog older than the last
        // hundred sends is exactly the case worth surfacing.
        const pending = await pool.query(
            `SELECT id, kind, target, reason, attempts, created_at
             FROM line_outbox WHERE sent_at IS NULL ORDER BY created_at ASC LIMIT 50`,
        );
        const stuck = await pool.query(
            `SELECT count(*)::int AS n FROM line_messages
             WHERE status = 'queued' AND created_at < now() - interval '5 minutes'`,
        );
        return {
            messages: messages.rows,
            pending: pending.rows,
            stuckCount: stuck.rows[0]?.n ?? 0,
        };
    }

    // Cheap check so the webhook only pays for a LINE profile call when it would
    // actually learn something. Names do not change often and the lookup is a
    // network round trip on a path that must stay fast.
    if (op === 'needs-name') {
        const res = await pool.query(
            `SELECT 1 FROM line_accounts
             WHERE line_user_id = $1 AND (display_name IS NULL OR display_name = '')`,
            [event.lineUserId],
        );
        return { needsName: res.rowCount > 0 };
    }

    if (op === 'set-display-name') {
        const res = await pool.query(
            `UPDATE line_accounts SET display_name = $2 WHERE line_user_id = $1`,
            [event.lineUserId, event.displayName],
        );
        return { updated: res.rowCount };
    }

    if (op === 'recipients') {
        // Real addressees for the console's test buttons, so somebody testing a
        // push does not have to paste an opaque id from a log somewhere — and
        // the audience list in its own right.
        const res = await pool.query(
            `SELECT a.line_user_id, a.source_type, a.display_name, a.user_id,
                    u.full_name, u.locale, a.unfollowed_at, a.linked_at,
                    (SELECT count(*)::int FROM line_messages m WHERE m.target = a.line_user_id) AS message_count
             FROM line_accounts a
             LEFT JOIN users u ON u.id = a.user_id
             ORDER BY a.linked_at DESC LIMIT 200`,
        );
        return { recipients: res.rows };
    }

    return { error: `unknown op: ${String(op)}` };
};
