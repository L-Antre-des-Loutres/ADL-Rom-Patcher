import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOapiClient, isRawMkdsSave, MKDS_SAVE_SIZE, OapiError } from '../src/lib/oapi.ts';
import { linkedFileName } from '../src/lib/save-file.ts';

function save(fill = 0) {
  const bytes = new Uint8Array(MKDS_SAVE_SIZE).fill(fill);
  bytes.set(new TextEncoder().encode('MKDSSV10'));
  return bytes;
}

const linkedResponse = (outcome = 'created') => new Response(save(7), {
  headers: { 'Content-Type': 'application/octet-stream', 'X-ADLN-Link': outcome },
});

test('uploads only the save in a single multipart field with the session cookie', async () => {
  const calls = [];
  const client = createOapiClient('https://oapi.example/api', async (url, options) => {
    calls.push([String(url), options]);
    return linkedResponse();
  });
  const original = new Blob([save(1)]);
  const linked = await client.linkMkdsSave(original);
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, 'https://oapi.example/api/saves/mkds/link');
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'include');
  assert.equal(options.cache, 'no-store');
  // No custom header: a simple multipart request, no identifiers chosen by the browser.
  assert.equal(options.headers, undefined);
  assert.ok(options.body instanceof FormData);
  assert.deepEqual([...options.body.keys()], ['save']);
  const sent = new Uint8Array(await options.body.get('save').arrayBuffer());
  assert.deepEqual(sent, save(1));
  assert.equal(linked.outcome, 'created');
  assert.equal(linked.file.size, MKDS_SAVE_SIZE);
  assert.deepEqual(new Uint8Array(await linked.file.arrayBuffer()), save(7));
  // The original upload is untouched.
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), save(1));
});

test('reports a reused credential', async () => {
  const client = createOapiClient('https://oapi.example/api', async () => linkedResponse('reused'));
  assert.equal((await client.linkMkdsSave(new Blob([save()]))).outcome, 'reused');
});

test('refuses non-raw saves before contacting OAPI', async () => {
  let calls = 0;
  const client = createOapiClient('https://oapi.example/api', async () => { calls++; return linkedResponse(); });
  const appended = new Uint8Array(MKDS_SAVE_SIZE + 122);
  appended.set(save());
  const wrongMagic = save();
  wrongMagic.set(new TextEncoder().encode('MKDSSV11'));
  for (const bytes of [save().slice(1), appended, wrongMagic, new Uint8Array(0)]) {
    assert.equal(await isRawMkdsSave(new Blob([bytes])), false);
    await assert.rejects(client.linkMkdsSave(new Blob([bytes])), (error) => error instanceof OapiError && error.status === 400);
  }
  assert.equal(calls, 0);
});

test('shows OAPI refusals but never upstream details', async () => {
  const refusal = 'Cette sauvegarde est liée à un autre compte.';
  let client = createOapiClient('https://oapi.example/api', async () => new Response(refusal, {
    status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  }));
  await assert.rejects(client.linkMkdsSave(new Blob([save()])), { status: 403, message: refusal });

  client = createOapiClient('https://oapi.example/api', async () => new Response('pocketbase said token=abc', {
    status: 502, headers: { 'Content-Type': 'text/plain' },
  }));
  await assert.rejects(client.linkMkdsSave(new Blob([save()])), (error) => error.status === 502 && !error.message.includes('abc') && /même fichier/.test(error.message));

  client = createOapiClient('https://oapi.example/api', async () => new Response('<html>', { status: 409, headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(client.linkMkdsSave(new Blob([save()])), (error) => error.status === 409 && !error.message.includes('<html>'));
});

test('respects the rate limit and rejects unusable downloads', async () => {
  let calls = 0;
  let client = createOapiClient('https://oapi.example/api', async () => {
    calls++;
    return new Response('', { status: 429, headers: { 'Retry-After': '30' } });
  });
  await assert.rejects(client.linkMkdsSave(new Blob([save()])), { status: 429 });
  await assert.rejects(client.linkMkdsSave(new Blob([save()])), { status: 429 });
  assert.equal(calls, 1);

  client = createOapiClient('https://oapi.example/api', async () => new Response(new Uint8Array(10)));
  await assert.rejects(client.linkMkdsSave(new Blob([save()])), /illisible/);
});

test('names the linked copy after the original file without unsafe characters', () => {
  assert.equal(linkedFileName('MKDS.sav'), 'MKDS-adl.sav');
  assert.equal(linkedFileName('../../evil<>.SAV'), '....evil-adl.sav');
  assert.equal(linkedFileName('.sav'), 'mario-kart-ds-adl.sav');
});
