import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOapiClient, OapiError } from '../src/lib/oapi.ts';

const code = { code: '483915', expires_at: '2026-10-24 12:15:00.000Z', device_id: 'device123' };
const device = { id: 'device123', label: 'Ma console', created: '2026-10-24 12:00:00.000Z', updated: '2026-10-24 12:00:00.000Z', is_disabled: false };

test('generates a ROM code with the session cookie, encoded label, and a bodiless POST', async () => {
  const calls = [];
  const client = createOapiClient('https://oapi.example/api', async (url, options) => {
    calls.push([String(url), options]);
    return Response.json(code);
  });
  assert.deepEqual(await client.createRomCode(' Ma console & moi '), code);
  const [url, options] = calls[0];
  assert.equal(url, 'https://oapi.example/api/auth/rom/code?label=Ma%20console%20%26%20moi');
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'include');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.headers, undefined);
  assert.equal(options.body, undefined);
});

test('can generate an unnamed code and never exchanges it for a ROM token', async () => {
  const calls = [];
  const client = createOapiClient('https://oapi.example/api', async (url) => {
    calls.push(String(url));
    return Response.json(code);
  });
  await client.createRomCode();
  assert.deepEqual(calls, ['https://oapi.example/api/auth/rom/code']);
});

test('rejects malformed codes and dates rather than displaying unusable connection details', async () => {
  for (const invalid of [
    { ...code, code: '012345' }, { ...code, code: '12345' }, { ...code, code: 483915 },
    { ...code, expires_at: 'tomorrow' }, { ...code, device_id: '../other' },
  ]) {
    const client = createOapiClient('https://oapi.example/api', async () => Response.json(invalid));
    await assert.rejects(client.createRomCode(), /réponse/i);
  }
});

test('reads linked and disabled devices without generating a code', async () => {
  const calls = [];
  const devices = [device, { ...device, id: 'device456', label: 'Ancienne console', is_disabled: true }];
  const client = createOapiClient('https://oapi.example/api', async (url, options) => {
    calls.push([String(url), options]);
    return Response.json({ devices });
  });
  assert.deepEqual(await client.getRomDevices(), devices);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://oapi.example/api/auth/rom/devices');
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[0][1].credentials, 'include');
});

test('rejects malformed device lists before rendering', async () => {
  for (const data of [null, { devices: null }, { devices: [{ ...device, label: {} }] }, { devices: [{ ...device, is_disabled: 'false' }] }]) {
    const client = createOapiClient('https://oapi.example/api', async () => Response.json(data));
    await assert.rejects(client.getRomDevices(), /réponse/i);
  }
});

test('revokes only the selected device by a bodiless POST and handles the 204 response', async () => {
  const calls = [];
  const client = createOapiClient('https://oapi.example/api', async (url, options) => {
    calls.push([String(url), options]);
    return new Response(null, { status: 204 });
  });
  assert.equal(await client.revokeRomDevice('device123'), undefined);
  assert.equal(calls[0][0], 'https://oapi.example/api/auth/rom/devices/device123/revoke');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].body, undefined);
  assert.equal(calls[0][1].headers, undefined);
  assert.equal(calls[0][1].credentials, 'include');
  await assert.rejects(client.revokeRomDevice('../other'), (error) => error.status === 400);
  assert.equal(calls.length, 1);
});

test('preserves session expiry and rate limit errors for the linking page', async () => {
  for (const status of [401, 429, 502]) {
    const client = createOapiClient('https://oapi.example/api', async () => new Response(null, { status, headers: { 'Retry-After': '30' } }));
    await assert.rejects(client.createRomCode(), (error) => {
      assert.ok(error instanceof OapiError);
      assert.equal(error.status, status);
      if (status === 429) assert.equal(error.retryAfter, 30);
      return true;
    });
    if (status === 429) await assert.rejects(client.getRomDevices(), (error) => error.status === 429);
  }
});
