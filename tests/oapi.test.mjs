import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOapiClient, OapiError } from '../src/lib/oapi.ts';

const profile = { id: 'friend123', username: 'Loutre', discord_id: '123456789012345678', discord_tag: 'loutre', avatar_url: '' };
const relation = { friendship_id: 'relation123', user: profile, status: 'pending', since: '2026-10-24 12:00:00.000Z' };

test('reads session and friendships using the member cookie without caching', async () => {
  const calls = [];
  const client = createOapiClient('https://oapi.example/api/', async (url, options) => {
    calls.push([String(url), options]);
    return Response.json(calls.length === 1
      ? { authenticated: true, username: 'Moi', discord_id: '42', discord_tag: null, avatar_url: null, role: 'Normal' }
      : { friends: [], incoming: [relation], outgoing: [] });
  });
  assert.equal((await client.getSession()).username, 'Moi');
  assert.equal((await client.getFriends()).incoming[0].user.id, 'friend123');
  assert.deepEqual(calls.map(([url]) => url), ['https://oapi.example/api/auth/site/me', 'https://oapi.example/api/friends/me']);
  for (const [, options] of calls) {
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers, undefined);
  }
});

test('treats the OAPI authenticated:false response as signed out', async () => {
  const client = createOapiClient('https://oapi.example/api', async () => Response.json({ authenticated: false }));
  assert.equal(await client.getSession(), null);
});

test('posts actions against the other member ID, with no body or custom headers, and accepts 204', async () => {
  const calls = [];
  const client = createOapiClient('https://oapi.example/api', async (url, options) => {
    calls.push([String(url), options]);
    return String(url).endsWith('/remove') ? new Response(null, { status: 204 })
      : Response.json({ friendship_id: 'relation123', status: 'accepted' });
  });
  assert.equal((await client.mutate('friend123', 'accept')).status, 'accepted');
  assert.equal(await client.mutate('friend123', 'remove'), undefined);
  assert.deepEqual(calls.map(([url]) => url), [
    'https://oapi.example/api/friends/me/friend123/accept',
    'https://oapi.example/api/friends/me/friend123/remove',
  ]);
  for (const [, options] of calls) {
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    assert.equal(options.body, undefined);
    assert.equal(options.headers, undefined);
  }
});

test('rejects invalid member IDs before making any request', async () => {
  let calls = 0;
  const client = createOapiClient('https://oapi.example/api', async () => { calls++; return new Response(); });
  for (const id of ['', '../admin', 'a/b', 'x'.repeat(65), 'membre avec espaces']) {
    await assert.rejects(client.mutate(id, 'remove'), (error) => error instanceof OapiError && error.status === 400);
  }
  assert.equal(calls, 0);
});

test('sends a friend request by exact Discord tag with a bodiless cookie-authenticated POST', async () => {
  const calls = [];
  const client = createOapiClient('https://oapi.example/api', async (url, options) => {
    calls.push([String(url), options]);
    return Response.json({ friendship_id: 'relation123', status: 'pending' });
  });
  assert.equal((await client.requestByTag(' @RereBleue ')).status, 'pending');
  assert.equal(calls[0][0], 'https://oapi.example/api/friends/me/rerebleue/request');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].credentials, 'include');
  assert.equal(calls[0][1].body, undefined);
  assert.equal(calls[0][1].headers, undefined);
});

test('rejects invalid Discord tags without contacting OAPI', async () => {
  let calls = 0;
  const client = createOapiClient('https://oapi.example/api', async () => { calls++; return new Response(); });
  for (const tag of ['', '@', 'a', 'a'.repeat(33), 'hello world', 'a/b', "rere' || true", 'double..point']) {
    await assert.rejects(client.requestByTag(tag), (error) => error instanceof OapiError && error.status === 400);
  }
  assert.equal(calls, 0);
});

test('disallows sending requests through the internal-ID mutation method', async () => {
  let calls = 0;
  const client = createOapiClient('https://oapi.example/api', async () => { calls++; return new Response(); });
  await assert.rejects(client.mutate('friend123', 'request'), (error) => error.status === 400);
  assert.equal(calls, 0);
});

test('explains that a Discord tag was not found and preserves session and quota errors', async () => {
  for (const status of [400, 401, 404, 409, 429, 502]) {
    const client = createOapiClient('https://oapi.example/api', async () => new Response(null, { status }));
    await assert.rejects(client.requestByTag('rerebleue'), (error) => {
      assert.equal(error.status, status);
      if (status === 400 || status === 404) assert.match(error.message, /tag Discord/);
      if (status === 429) assert.equal(error.retryAfter, 60);
      return true;
    });
  }
});

test('reports session expiry separately from a service outage without exposing response bodies', async () => {
  for (const status of [401, 403, 404, 409, 502]) {
    const client = createOapiClient('https://oapi.example/api', async () => new Response('private upstream detail', { status }));
    await assert.rejects(client.getFriends(), (error) => {
      assert.ok(error instanceof OapiError);
      assert.equal(error.status, status);
      assert.ok(!error.message.includes('private upstream detail'));
      return true;
    });
  }
});

test('honours Retry-After and prevents requests during the cooldown', async () => {
  let calls = 0;
  const client = createOapiClient('https://oapi.example/api', async () => {
    calls++;
    return new Response(null, { status: 429, headers: { 'Retry-After': '30' } });
  });
  await assert.rejects(client.getFriends(), (error) => error.status === 429 && error.retryAfter === 30);
  await assert.rejects(client.mutate('friend123', 'accept'), (error) => error.status === 429);
  assert.equal(calls, 1);
  assert.ok(client.retryAt > Date.now());
});

test('uses a one-minute cooldown when CORS hides Retry-After', async () => {
  const client = createOapiClient('https://oapi.example/api', async () => new Response(null, { status: 429 }));
  await assert.rejects(client.getFriends(), (error) => error.retryAfter === 60);
});

test('keeps deleted members visible and rejects malformed friendship responses', async () => {
  const client = createOapiClient('https://oapi.example/api', async () => Response.json({
    friends: [{ ...relation, status: 'accepted', user: { id: 'deleted123' } }], incoming: [], outgoing: [],
  }));
  assert.equal((await client.getFriends()).friends[0].user.id, 'deleted123');
  const broken = createOapiClient('https://oapi.example/api', async () => Response.json({ incoming: 'wrong' }));
  await assert.rejects(broken.getFriends(), /réponse/i);
});

test('rejects malformed profile fields before they can break rendering', async () => {
  for (const field of ['username', 'discord_tag', 'discord_id', 'avatar_url']) {
    const client = createOapiClient('https://oapi.example/api', async () => Response.json({
      friends: [], incoming: [{ ...relation, user: { ...profile, [field]: 42 } }], outgoing: [],
    }));
    await assert.rejects(client.getFriends(), /réponse/i);
  }
  const client = createOapiClient('https://oapi.example/api', async () => Response.json({
    authenticated: true, username: 'Moi', discord_id: '42', avatar_url: {}, discord_tag: null,
  }));
  await assert.rejects(client.getSession(), /réponse/i);
});

test('builds login and logout links with the current website origin and a local return path', () => {
  const client = createOapiClient('https://oapi.example/api/');
  const login = new URL(client.authUrl('login', 'https://rom.example', '/amis'));
  assert.equal(login.pathname, '/api/auth/site/login');
  assert.equal(login.searchParams.get('origin'), 'https://rom.example');
  assert.equal(login.searchParams.get('return_to'), '/amis');
  assert.equal(new URL(client.authUrl('logout', 'https://rom.example', '/amis')).pathname, '/api/auth/site/logout');
});

test('requires a safe API base while allowing local development', () => {
  for (const base of ['javascript:alert(1)', 'http://remote.example/api', 'https://user:secret@oapi.example/api', 'https://oapi.example/api?x=1']) {
    assert.throws(() => createOapiClient(base));
  }
  assert.doesNotThrow(() => createOapiClient('http://localhost:3000/api'));
});
