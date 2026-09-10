-- The LINE bot's four tables.
--
-- One migration because they are one feature and there is no useful state in
-- which some exist and others do not: the webhook cannot dedupe without
-- `line_events`, cannot attribute without `line_accounts`, and the console
-- cannot show anything without `line_messages`.
--
-- **The same VPC divide that shapes escalation and telemetry shapes this too.**
-- `api.line.me` is on the internet and RDS is private, so the webhook runs
-- outside the VPC and every row below is written by a VPC-attached function it
-- invokes. Nothing here is reachable from the half that talks to LINE.


-- Which LINE user is which Tish user.
--
-- **The binding is authorised on the Cognito side, never asserted by LINE.** A
-- webhook request arrives unauthenticated with an opaque `userId`; letting that
-- claim a `users.id` would let anyone who can reach the endpoint attach
-- themselves to a patient. So the app issues a short-lived code to an
-- authenticated session, the user sends that code to the bot, and the webhook
-- matches it. Same rule as the telemetry ingest taking `cognito_id` from the
-- JWT and never from the body.
CREATE TABLE IF NOT EXISTS line_accounts (
    id SERIAL PRIMARY KEY,

    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,

    -- **UNIQUE on the LINE id alone**, not on (user_id, line_user_id) — the same
    -- reasoning as push_tokens 2.5. The id identifies a LINE account, and one
    -- LINE account is one person; allowing it to appear against two users would
    -- mean a message from it could not be attributed.
    line_user_id TEXT NOT NULL UNIQUE,

    -- What LINE calls the source: 'user', 'group' or 'room'. A group has no
    -- single owner, so `user_id` is null for one and the row exists to record
    -- that the bot is present in that conversation at all.
    source_type TEXT NOT NULL DEFAULT 'user'
        CHECK (source_type IN ('user', 'group', 'room')),

    display_name TEXT,

    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- **Unfollow is soft, and that is deliberate.** Blocking the bot and
    -- unblocking it later returns the same `userId`, so a hard delete would make
    -- the user redo the linking dance to get back something they never lost.
    unfollowed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS line_accounts_user_idx
    ON line_accounts (user_id) WHERE user_id IS NOT NULL;


-- The other half of the binding: a short-lived code issued to an authenticated
-- session and redeemed by sending it to the bot.
--
-- **This table is the entire security model for linking**, so the constraints on
-- it matter more than its size suggests. The code is a bearer token that will be
-- typed into a chat window, so it is short-lived (15 minutes), single-use
-- (`used_at`), and unique. Without the expiry, a code screenshotted into a group
-- chat stays valid forever; without single-use, one code links every LINE
-- account that sends it.
CREATE TABLE IF NOT EXISTS line_link_codes (
    code TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS line_link_codes_user_idx ON line_link_codes (user_id);


-- Webhook dedupe.
--
-- **LINE retries.** Any non-200, or a response slower than its timeout, and the
-- same delivery arrives again — so without this a retried `message` event gets
-- answered twice, and a retried link code gets consumed twice. LINE stamps every
-- event with `webhookEventId`, which is exactly the idempotency key needed, so
-- the primary key does the work and the handler just lets the conflict happen.
CREATE TABLE IF NOT EXISTS line_events (
    webhook_event_id TEXT PRIMARY KEY,
    event_type TEXT,
    line_user_id TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The table only ever grows and only the recent rows matter. Indexed so a prune
-- job can find old ones without a sequential scan over the whole history.
CREATE INDEX IF NOT EXISTS line_events_received_idx ON line_events (received_at);


-- Every message the bot sends, and what became of it.
--
-- **This is the log the console reads, so it records attempts rather than
-- successes.** A row is written before the LINE call and updated with the
-- outcome; a send that fails must leave a trace, because "nothing happened" and
-- "it failed silently" are the two states this feature exists to tell apart.
CREATE TABLE IF NOT EXISTS line_messages (
    id SERIAL PRIMARY KEY,

    -- reply | push | multicast | broadcast | narrowcast
    kind TEXT NOT NULL,

    -- Who it went to, as LINE understands it: a userId, groupId, roomId, or a
    -- comma-joined list for multicast. Null for broadcast, which by definition
    -- has no addressee.
    target TEXT,

    -- The message array as sent, stringified. **Stored as text rather than
    -- JSONB on purpose**: it is a record of what was sent, never queried by
    -- shape, and text cannot fail to insert because LINE introduced a block type
    -- Postgres would have to understand.
    payload TEXT,

    -- queued | sent | failed
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sent', 'failed')),

    -- LINE's X-Line-Request-Id. The only handle support will ask for.
    line_request_id TEXT,

    error TEXT,

    -- Who pressed the button, when it came from the console rather than the
    -- product. Null for a message the bot sent on its own initiative.
    triggered_by TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS line_messages_created_idx ON line_messages (created_at DESC);


-- Work the bot owes but has not done.
--
-- **The same outbox as 5.9's, for the same forced reason**, and the console's
-- "pending actions" panel reads it. A product event that should reach LINE is
-- raised inside the VPC, where `api.line.me` is unreachable — so it is queued
-- here and drained by a function that can. Durability and coalescing come free
-- with the shape, exactly as `push_outbox` argues.
CREATE TABLE IF NOT EXISTS line_outbox (
    id SERIAL PRIMARY KEY,

    kind TEXT NOT NULL,
    target TEXT,
    payload TEXT,

    reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Set when handed to LINE, or when there was nobody to send to. Both are
    -- done: a user with no linked LINE account is not a failure to retry.
    sent_at TIMESTAMPTZ,

    -- Abandoned past a threshold so an unreachable LINE cannot build a backlog
    -- every later run re-reads. Same guard as push_outbox.
    attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS line_outbox_pending_idx
    ON line_outbox (created_at) WHERE sent_at IS NULL;
