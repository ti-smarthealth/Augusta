/**
 * Tests for the webhook's boundary behaviour.
 *
 * **The signature check is the only thing standing between the public internet
 * and the bindings table**, so it gets the most attention here: a passing test
 * suite with a broken verify is the worst outcome this file can produce.
 *
 * Run with `npm test` from `line/webhook/`.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

process.env.LINE_CHANNEL_SECRET = 'test-secret';

const { handler, verify, rawBodyOf, copyFor, _setInvokerForTests, _setSenderForTests } =
    await import('./index.mjs');

const SECRET = 'test-secret';

const sign = (body, secret = SECRET) =>
    crypto.createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('base64');

const req = (body, signature) => ({
    httpMethod: 'POST',
    headers: { 'X-Line-Signature': signature ?? sign(body) },
    body,
});

/** Records every db/send call so a test can assert on side effects. */
function spy() {
    const calls = [];
    return {
        calls,
        db: async (p) => {
            calls.push(p);
            if (p.op === 'seen') return { fresh: true };
            if (p.op === 'sender') return { userId: null, locale: null };
            if (p.op === 'redeem-code') {
                return p.code?.toUpperCase() === 'ABC123'
                    ? { linked: true, userId: 2, locale: 'zh-Hant' }
                    : { linked: false };
            }
            return {};
        },
        send: async (p) => { calls.push(p); },
    };
}

function install() {
    const s = spy();
    _setInvokerForTests(s.db);
    _setSenderForTests(s.send);
    return s;
}

// --- signature ---------------------------------------------------------------

test('a correctly signed body is accepted', () => {
    const body = '{"events":[]}';
    assert.equal(verify(Buffer.from(body), sign(body), SECRET), true);
});

test('a body signed with a different secret is rejected', () => {
    const body = '{"events":[]}';
    assert.equal(verify(Buffer.from(body), sign(body, 'other'), SECRET), false);
});

test('a tampered body is rejected even with a valid-looking signature', () => {
    const signature = sign('{"events":[]}');
    assert.equal(verify(Buffer.from('{"events":[{"type":"follow"}]}'), signature, SECRET), false);
});

test('a missing signature or secret is rejected rather than skipped', () => {
    const body = Buffer.from('{}');
    assert.equal(verify(body, null, SECRET), false);
    assert.equal(verify(body, sign('{}'), null), false);
});

test('a signature of the wrong length cannot crash timingSafeEqual', () => {
    // timingSafeEqual throws on a length mismatch, which would turn a malformed
    // request into a 500 and an alarm rather than a clean 403.
    assert.equal(verify(Buffer.from('{}'), 'c2hvcnQ=', SECRET), false);
    assert.equal(verify(Buffer.from('{}'), 'not-base64!!', SECRET), false);
});

test('re-serialising the body would break the signature, so raw bytes are used', () => {
    // This is the trap the implementation exists to avoid: same data, different
    // bytes. If rawBodyOf ever parsed and re-stringified, this would fail.
    //
    // Whitespace is the difference that actually bites, not key order — V8
    // preserves insertion order for string keys, so a round trip of
    // `{"b":1,"a":2}` is byte-identical and would prove nothing. LINE sends
    // pretty-printed JSON, so the spaces below are the realistic case.
    const original = '{"events": [], "destination": "U0"}';
    const reserialised = JSON.stringify(JSON.parse(original));
    assert.notEqual(original, reserialised);
    assert.equal(verify(Buffer.from(original), sign(original), SECRET), true);
    assert.equal(verify(Buffer.from(reserialised), sign(original), SECRET), false);
});

test('a base64 body from the gateway is decoded to the bytes LINE signed', () => {
    const body = '{"events":[]}';
    const encoded = Buffer.from(body, 'utf8').toString('base64');
    assert.deepEqual(rawBodyOf({ body: encoded, isBase64Encoded: true }), Buffer.from(body, 'utf8'));
    assert.deepEqual(rawBodyOf({ body, isBase64Encoded: false }), Buffer.from(body, 'utf8'));
});

// --- handler -----------------------------------------------------------------

test('an unsigned request is a 403 and touches nothing', async () => {
    const s = install();
    const res = await handler({ httpMethod: 'POST', headers: {}, body: '{"events":[]}' });
    assert.equal(res.statusCode, 403);
    assert.equal(s.calls.length, 0, 'a rejected request must have no side effects');
});

test('the console verification ping is answered without side effects', async () => {
    const s = install();
    const body = JSON.stringify({
        events: [{ type: 'message', replyToken: '0'.repeat(32), message: { type: 'text', text: 'hi' } }],
    });
    const res = await handler(req(body));
    assert.equal(res.statusCode, 200);
    assert.equal(s.calls.length, 0);
});

test('a duplicate delivery is ignored rather than replayed', async () => {
    const calls = [];
    _setInvokerForTests(async (p) => { calls.push(p); return { fresh: false }; });
    _setSenderForTests(async (p) => { calls.push(p); });

    const body = JSON.stringify({
        events: [{ type: 'follow', webhookEventId: 'evt-1', source: { userId: 'U1', type: 'user' } }],
    });
    await handler(req(body));

    assert.deepEqual(calls.map((c) => c.op), ['seen'], 'a duplicate stops at the dedupe check');
});

test('a follow records the account and greets them', async () => {
    const s = install();
    const body = JSON.stringify({
        events: [{ type: 'follow', webhookEventId: 'evt-2', replyToken: 'rt-f', source: { userId: 'U2', type: 'user' } }],
    });
    await handler(req(body));
    const follow = s.calls.find((c) => c.op === 'follow');
    assert.equal(follow.lineUserId, 'U2');

    // Adding the bot and hearing nothing is indistinguishable from adding a
    // broken bot, which is the failure this product avoids everywhere else.
    const sent = s.calls.find((c) => c.op === 'reply');
    assert.equal(sent.messages, copyFor(null).greeting);
    assert.equal(sent.to, 'U2', 'the greeting is attributed in the log like any other send');
});

test('joining a group greets the group, not the person who added it', async () => {
    const s = install();
    const body = JSON.stringify({
        events: [{ type: 'join', webhookEventId: 'evt-j', replyToken: 'rt-j', source: { groupId: 'C1', type: 'group' } }],
    });
    await handler(req(body));
    const sent = s.calls.find((c) => c.op === 'reply');
    assert.equal(sent.messages, copyFor(null).greetingGroup);
    assert.equal(sent.to, 'C1');
});

test('every locale carries a greeting for both a person and a group', () => {
    for (const locale of ['zh-Hant', 'en']) {
        assert.ok(copyFor(locale).greeting.length > 0, `${locale}.greeting`);
        assert.ok(copyFor(locale).greetingGroup.length > 0, `${locale}.greetingGroup`);
    }
    // A group has no locale of its own, so its greeting must exist on the default.
    assert.notEqual(copyFor(null).greetingGroup, copyFor('en').greetingGroup);
});

test('a valid link code binds the account and confirms in the user own language', async () => {
    const s = install();
    const body = JSON.stringify({
        events: [{
            type: 'message', webhookEventId: 'evt-3', replyToken: 'rt-1',
            source: { userId: 'U3', type: 'user' }, message: { type: 'text', text: 'abc123' },
        }],
    });
    await handler(req(body));

    const redeem = s.calls.find((c) => c.op === 'redeem-code');
    assert.equal(redeem.code, 'abc123');
    const sent = s.calls.find((c) => c.op === 'reply');
    // The redeem is the first moment the sender's locale is knowable, so the
    // confirmation must use what it returned rather than the null before it.
    assert.equal(sent.messages, copyFor('zh-Hant').linked);
});

test('an invalid link code is refused without claiming success', async () => {
    const s = install();
    const body = JSON.stringify({
        events: [{
            type: 'message', webhookEventId: 'evt-4', replyToken: 'rt-2',
            source: { userId: 'U4', type: 'user' }, message: { type: 'text', text: 'ZZZ999' },
        }],
    });
    await handler(req(body));
    const sent = s.calls.find((c) => c.op === 'reply');
    assert.equal(sent.messages, copyFor(null).badCode);
});

// --- localisation ------------------------------------------------------------

test('an unknown sender is answered in the product default, not in English', () => {
    // The patients are in Taiwan and every user row defaults to zh-Hant, so a
    // sender the bot knows nothing about is far more likely to read Chinese.
    assert.equal(copyFor(null), copyFor('zh-Hant'));
    assert.equal(copyFor('de'), copyFor('zh-Hant'));
    assert.notEqual(copyFor(null).holding, copyFor('en').holding);
});

test('every locale carries every message, so none can degrade to a blank reply', () => {
    // A missing key would send `undefined` to a real person. Cheap to pin, and
    // this table cannot be checked by npm run validate-translations.
    const keys = Object.keys(copyFor('zh-Hant'));
    for (const locale of ['zh-Hant', 'en']) {
        for (const k of keys) {
            assert.equal(typeof copyFor(locale)[k], 'string', `${locale}.${k} must be a string`);
            assert.ok(copyFor(locale)[k].length > 0, `${locale}.${k} must not be empty`);
        }
    }
});

test('an English speaker gets English', async () => {
    const calls = [];
    _setInvokerForTests(async (p) => {
        calls.push(p);
        if (p.op === 'seen') return { fresh: true };
        if (p.op === 'sender') return { userId: 7, locale: 'en' };
        return {};
    });
    _setSenderForTests(async (p) => { calls.push(p); });

    const body = JSON.stringify({
        events: [{
            type: 'message', webhookEventId: 'evt-5', replyToken: 'rt-3',
            source: { userId: 'U5', type: 'user' }, message: { type: 'text', text: 'hello there' },
        }],
    });
    await handler(req(body));
    assert.equal(calls.find((c) => c.op === 'reply').messages, copyFor('en').holding);
});

test('a locale lookup that fails still gets the user a reply', async () => {
    // Losing the language is a degradation; losing the reply is a bot that
    // looks broken to somebody who just messaged it.
    _setInvokerForTests(async (p) => {
        if (p.op === 'seen') return { fresh: true };
        if (p.op === 'sender') throw new Error('vpc half down');
        return {};
    });
    let sent = null;
    _setSenderForTests(async (p) => { sent = p; });

    const body = JSON.stringify({
        events: [{
            type: 'message', webhookEventId: 'evt-6', replyToken: 'rt-4',
            source: { userId: 'U6', type: 'user' }, message: { type: 'text', text: 'hello' },
        }],
    });
    const res = await handler(req(body));
    assert.equal(res.statusCode, 200);
    assert.equal(sent.messages, copyFor(null).holding);
});

test('one failing event does not stop the batch or the 200', async () => {
    // A non-200 makes LINE redeliver everything, including events that already
    // succeeded — so a single bad event must not take the batch down.
    let seen = 0;
    _setInvokerForTests(async (p) => {
        if (p.op === 'seen') { seen += 1; return { fresh: true }; }
        if (p.op === 'follow' && p.lineUserId === 'BOOM') throw new Error('db down');
        return {};
    });
    _setSenderForTests(async () => {});

    const body = JSON.stringify({
        events: [
            { type: 'follow', webhookEventId: 'e1', source: { userId: 'BOOM', type: 'user' } },
            { type: 'follow', webhookEventId: 'e2', source: { userId: 'OK', type: 'user' } },
        ],
    });
    const res = await handler(req(body));
    assert.equal(res.statusCode, 200);
    assert.equal(seen, 2, 'the second event is still processed');
});

test('an unknown event type is logged, not fatal', async () => {
    install();
    const body = JSON.stringify({
        events: [{ type: 'somethingNew', webhookEventId: 'e9', source: { userId: 'U9', type: 'user' } }],
    });
    const res = await handler(req(body));
    assert.equal(res.statusCode, 200);
});
