/**
 * Tests for the sender.
 *
 * The behaviour worth pinning is not "does it call LINE" — it is that **every
 * attempt leaves a log row whatever happens**, because the console is only
 * trustworthy if a failed send is visible as a failed send rather than as
 * nothing at all.
 *
 * Run with `npm test` from `line/send/`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';

const { handler, targetFor, _setInvokerForTests } = await import('./index.mjs');
const { _setFetchForTests, toMessages, TEXT_LIMIT, MULTICAST_LIMIT } = await import('./line-api.mjs');

/** Collects log ops so a test can assert the row a send produced. */
function logSpy() {
    const ops = [];
    _setInvokerForTests(async (p) => {
        ops.push(p);
        return p.op === 'log-start' ? { id: 42 } : {};
    });
    return ops;
}

const okFetch = () => async () => ({
    ok: true, status: 200,
    headers: { get: (h) => (h === 'x-line-request-id' ? 'req-1' : null) },
    text: async () => '',
});

const failFetch = (status, body) => async () => ({
    ok: false, status,
    headers: { get: () => 'req-2' },
    text: async () => body,
});

test('a successful send is logged queued then sent, with the request id', async () => {
    const ops = logSpy();
    _setFetchForTests(okFetch());

    const res = await handler({ op: 'push', to: 'U1', messages: 'hello', triggeredBy: 'console' });

    assert.equal(res.ok, true);
    assert.deepEqual(ops.map((o) => o.op), ['log-start', 'log-finish']);
    assert.equal(ops[0].kind, 'push');
    assert.equal(ops[0].target, 'U1');
    assert.equal(ops[0].triggeredBy, 'console');
    assert.equal(ops[1].status, 'sent');
    assert.equal(ops[1].lineRequestId, 'req-1');
});

test('a failed send is logged as failed, not dropped', async () => {
    const ops = logSpy();
    _setFetchForTests(failFetch(400, '{"message":"Invalid reply token"}'));

    const res = await handler({ op: 'push', to: 'U1', messages: 'hello' });

    assert.equal(res.ok, false);
    assert.equal(ops[1].status, 'failed');
    assert.match(ops[1].error, /line-http-400/);
    assert.match(ops[1].error, /Invalid reply token/);
});

test('an unreachable LINE is an error value, never a throw', async () => {
    // A thrown exception here becomes a stack trace in CloudWatch and a row
    // stuck at 'queued' forever. The outcome has to come back as data.
    const ops = logSpy();
    _setFetchForTests(async () => { throw new Error('ETIMEDOUT'); });

    const res = await handler({ op: 'push', to: 'U1', messages: 'hi' });

    assert.equal(res.ok, false);
    assert.match(res.error, /line-unreachable/);
    assert.equal(ops[1].status, 'failed');
});

test('a logging failure does not fail a send that really happened', async () => {
    _setInvokerForTests(async () => { throw new Error('vpc half down'); });
    _setFetchForTests(okFetch());

    const res = await handler({ op: 'push', to: 'U1', messages: 'hi' });

    assert.equal(res.ok, true, 'the message was delivered; the audit write is not the send');
});

test('read-only probes send nothing and log nothing', async () => {
    const ops = logSpy();
    _setFetchForTests(async () => ({
        ok: true, status: 200, headers: { get: () => null },
        text: async () => '{"userId":"Ubot","basicId":"@tish"}',
    }));

    const res = await handler({ op: 'info' });

    assert.equal(res.ok, true);
    assert.equal(res.data.basicId, '@tish');
    assert.equal(ops.length, 0, 'a probe is not a send and must not appear in the log');
});

test('a missing message is refused before anything is logged', async () => {
    const ops = logSpy();
    _setFetchForTests(okFetch());
    const res = await handler({ op: 'push', to: 'U1' });
    assert.equal(res.ok, false);
    assert.equal(ops.length, 0);
});

test('an unknown op is refused rather than guessed at', async () => {
    const res = await handler({ op: 'destroy' });
    assert.equal(res.ok, false);
    assert.match(res.error, /unknown op/);
});

test('multicast refuses more recipients than LINE accepts', async () => {
    const ops = logSpy();
    _setFetchForTests(okFetch());
    const res = await handler({ op: 'multicast', to: Array.from({ length: MULTICAST_LIMIT + 1 }, (_, i) => `U${i}`), messages: 'hi' });
    assert.equal(res.ok, false);
    assert.match(res.error, /at most 500/);
    // Still logged: an attempt that was refused locally is part of the record.
    assert.equal(ops[1].status, 'failed');
});

test('over-long text is truncated rather than rejected by LINE', async () => {
    // A 6000-character answer becoming a silent 400 reads as the bot ignoring
    // somebody, which is the failure mode this product exists to remove.
    const [msg] = toMessages('x'.repeat(TEXT_LIMIT + 500));
    assert.equal(msg.text.length, TEXT_LIMIT);
    assert.ok(msg.text.endsWith('…'), 'the cut is visible rather than silent');
});

test('strings become text messages and objects pass through untouched', async () => {
    assert.deepEqual(toMessages('hi'), [{ type: 'text', text: 'hi' }]);
    const flex = { type: 'flex', altText: 'a', contents: {} };
    assert.deepEqual(toMessages(flex), [flex]);
});

test('the logged target reflects how each kind addresses people', () => {
    assert.equal(targetFor('push', { to: 'U1' }), 'U1');
    assert.equal(targetFor('multicast', { to: ['U1', 'U2'] }), 'U1,U2');
    assert.equal(targetFor('broadcast', {}), null, 'broadcast has no addressee by definition');
    assert.equal(targetFor('reply', { replyToken: 'rt' }), 'reply-token');
});
