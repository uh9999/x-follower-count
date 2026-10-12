const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../bridge.js'), 'utf8');

function harness(fetchImpl = async () => response({})) {
  const messages = [];
  const timers = [];
  const listeners = new Map();
  class XHR {
    constructor() { this.listeners = new Map(); this.responseType = ''; }
    open(method, url) { this.method = method; this.url = url; }
    send(body) { this.sentBody = body; if (this.sendError) throw this.sendError; }
    addEventListener(name, fn, options) {
      const entries = this.listeners.get(name) || [];
      entries.push({ fn, once: options?.once }); this.listeners.set(name, entries);
    }
    removeEventListener(name, fn) {
      this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item.fn !== fn));
    }
    emit(name) {
      for (const item of [...(this.listeners.get(name) || [])]) {
        if (item.once) this.removeEventListener(name, item.fn);
        item.fn.call(this, { type: name });
      }
    }
  }
  const window = {
    fetch: fetchImpl, XMLHttpRequest: XHR,
    postMessage(data, origin) { messages.push({ data, origin }); },
    addEventListener(name, fn) { listeners.set(name, fn); }
  };
  const context = vm.createContext({ window, URL,
    location: { href: 'https://x.com/example/followers', origin: 'https://x.com' },
    setTimeout(fn) { timers.push(fn); } });
  vm.runInContext(source, context);
  async function flush() {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    let count = 0;
    while (timers.length) {
      assert.ok(++count < 10000, 'bounded scheduled work');
      timers.shift()();
    }
  }
  function request(overrides = {}) {
    listeners.get('message')({ source: window, origin: 'https://x.com',
      data: { source: 'x-follower-count', type: 'REQUEST_COUNTS' }, ...overrides });
  }
  return { window, context, messages, timers, flush, request,
    records: () => JSON.parse(JSON.stringify(messages.filter(item => item.data.type === 'FOLLOWER_COUNTS')
      .flatMap(item => item.data.records))),
    status: () => JSON.parse(JSON.stringify(messages.filter(item => item.data.type === 'BRIDGE_STATUS')
      .map(item => item.data))) };
}

function response(data, url = 'https://x.com/i/api/graphql/example') {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return { url, json: async () => JSON.parse(text), text: async () => text,
    clone: () => ({ json: async () => JSON.parse(text) }) };
}

test('fetch returns the original response and leaves original json/text readable', async () => {
  const body = { data: { users: [{ legacy: { screen_name: 'Alice', followers_count: 123 } },
    { core: { screen_name: 'Bob_2' }, legacy: { followers_count: 0 } }] } };
  const original = response(body);
  let call;
  const h = harness(function (...args) { call = { thisValue: this, args }; return Promise.resolve(original); });
  const options = { method: 'POST', body: 'page-owned' };
  assert.equal(await h.window.fetch('/i/api/graphql/example', options), original);
  assert.equal(call.thisValue, h.window);
  assert.equal(call.args[1], options);
  assert.deepEqual(await original.json(), body);
  assert.equal(await original.text(), JSON.stringify(body));
  await h.flush();
  assert.deepEqual(h.records().sort((a, b) => a.screenName.localeCompare(b.screenName)),
    [{ screenName: 'Alice', followersCount: 123 }, { screenName: 'Bob_2', followersCount: 0 }]);
});

test('fetch rejection identity, malformed JSON, clone failures and unrelated origins', async () => {
  const error = new Error('network failed');
  const rejected = harness(() => Promise.reject(error));
  await assert.rejects(rejected.window.fetch('/i/api/graphql/example'), e => e === error);
  const badResponses = [response('not json'), response({ screen_name: 'Alice', followers_count: 2 },
    'https://other.example/api'), { url: 'https://x.com/api', clone() { throw error; } }];
  const h = harness(async () => badResponses.shift());
  for (let i = 0; i < 3; i++) await h.window.fetch('/api');
  await h.flush(); assert.deepEqual(h.records(), []);
});

test('new core/relationship_counts structure supports zero and never substitutes following', async () => {
  const users = [
    { core: { screen_name: 'NewUser' }, relationship_counts: { followers: 13799, following: 13810 } },
    { core: { screen_name: 'ZeroUser' }, relationship_counts: { followers: 0, following: 42 } },
    { core: { screen_name: 'MissingUser' }, relationship_counts: { following: 999 } },
    { core: { screen_name: 'LegacyFirst' }, legacy: { followers_count: 1 }, relationship_counts: { followers: 2 } },
    { screen_name: 'TopFirst', followers_count: 3, legacy: { followers_count: 4 }, relationship_counts: { followers: 5 } }
  ];
  const h = harness(async () => response(users)); await h.window.fetch('/api'); await h.flush();
  assert.deepEqual(h.records().sort((a, b) => a.screenName.localeCompare(b.screenName)), [
    { screenName: 'LegacyFirst', followersCount: 1 },
    { screenName: 'NewUser', followersCount: 13799 },
    { screenName: 'TopFirst', followersCount: 3 },
    { screenName: 'ZeroUser', followersCount: 0 }
  ]);
});

test('XHR text/json observation preserves application loadend handlers and send arguments', async () => {
  const h = harness();
  let events = 0;
  const xhr = new h.window.XMLHttpRequest();
  xhr.addEventListener('loadend', () => events++);
  xhr.open('GET', '/i/api/graphql/users'); xhr.send('body');
  xhr.responseText = JSON.stringify({ nested: { screen_name: 'TextUser', followers_count: 75 } });
  xhr.emit('loadend');
  assert.equal(xhr.sentBody, 'body');
  xhr.open('GET', '/i/api/graphql/users'); xhr.send();
  xhr.responseType = 'json'; xhr.response = { legacy: { screen_name: 'JsonUser', followers_count: 9 } };
  xhr.emit('loadend');
  await h.flush();
  assert.equal(events, 2);
  assert.deepEqual(h.records(), [{ screenName: 'TextUser', followersCount: 75 },
    { screenName: 'JsonUser', followersCount: 9 }]);
});

test('XHR send errors are rethrown and malformed responses do not affect page events', async () => {
  const h = harness(); const xhr = new h.window.XMLHttpRequest(); const error = new Error('send');
  xhr.open('GET', '/api'); xhr.sendError = error;
  assert.throws(() => xhr.send(), e => e === error);
  assert.equal(xhr.listeners.get('loadend').length, 0);
  delete xhr.sendError; let events = 0;
  xhr.addEventListener('loadend', () => events++); xhr.send(); xhr.responseText = 'bad'; xhr.emit('loadend');
  await h.flush(); assert.equal(events, 1); assert.deepEqual(h.records(), []);
});

test('rejects malformed records, handles nested/cyclic objects and yields between chunks', async () => {
  const h = harness(); const xhr = new h.window.XMLHttpRequest();
  xhr.open('GET', '/api'); xhr.send(); xhr.responseType = 'json';
  const root = { valid: { screen_name: 'Good', followers_count: 35000 }, invalid: [
    { screen_name: 'bad-name', followers_count: 1 }, { screen_name: 'Negative', followers_count: -1 },
    { screen_name: 'Float', followers_count: 2.2 }, { screen_name: 'String', followers_count: '20' },
    { screen_name: 'Unsafe', followers_count: Number.MAX_SAFE_INTEGER + 1 }], many: Array.from({ length: 1000 }, () => ({})) };
  root.cycle = root; xhr.response = root; xhr.emit('loadend');
  assert.equal(h.records().length, 0);
  h.timers.shift()(); assert.ok(h.timers.length > 0);
  await h.flush(); assert.deepEqual(h.records(), [{ screenName: 'Good', followersCount: 35000 }]);
});

test('handshake replays latest cached counts only for same-window same-origin messages', async () => {
  let value = 1; const h = harness(async () => response({ screen_name: 'Alice', followers_count: value }));
  await h.window.fetch('/api'); await h.flush(); value = 2;
  await h.window.fetch('/api'); await h.flush(); h.messages.length = 0;
  h.request({ origin: 'https://evil.example' }); h.request({ source: {} });
  assert.equal(h.messages.length, 0); h.request();
  assert.deepEqual(h.records(), [{ screenName: 'Alice', followersCount: 2 }]);
  const patched = h.window.fetch; vm.runInContext(source, h.context); assert.equal(h.window.fetch, patched);
});

test('bounded batches and bounded cache for large payloads', async () => {
  const users = Array.from({ length: 2500 }, (_, i) => ({ screen_name: `User${i}`, followers_count: i }));
  const h = harness(async () => response(users)); await h.window.fetch('/api'); await h.flush();
  assert.equal(h.records().length, 2000);
  assert.ok(h.messages.every(message => message.origin === 'https://x.com' &&
    (message.data.type !== 'FOLLOWER_COUNTS' || message.data.records.length <= 100)));
  h.messages.length = 0; h.request(); assert.equal(h.records().length, 2000);
});

test('observes existing HTTPS API responses across X hosts and rejects malicious or insecure hosts', async () => {
  const allowed = ['x.com', 'www.x.com', 'api.x.com', 'twitter.com', 'www.twitter.com', 'api.twitter.com'];
  const denied = ['https://evil.x.com/api', 'https://x.com.evil.example/api',
    'https://evil.example/api', 'http://api.x.com/api', 'https://api.x.com:8443/api'];
  let currentUrl;
  const h = harness(async () => response({ screen_name: 'APIUser', followers_count: 42 }, currentUrl));
  for (const host of allowed) {
    currentUrl = `https://${host}/api`; await h.window.fetch(currentUrl); await h.flush();
  }
  assert.equal(h.records().length, allowed.length);
  for (const url of denied) { currentUrl = url; await h.window.fetch(url); await h.flush(); }
  assert.equal(h.records().length, allowed.length);
  assert.equal(h.status().at(-1).responses, allowed.length);
  const xhr = new h.window.XMLHttpRequest(); xhr.open('GET', 'https://api.x.com/users'); xhr.send();
  xhr.responseType = 'json'; xhr.response = { core: { screen_name: 'XHRApiUser' }, relationship_counts: { followers: 7 } };
  xhr.emit('loadend'); await h.flush();
  assert.equal(h.records().at(-1).screenName, 'XHRApiUser');
  xhr.open('GET', 'https://api.x.com/users'); xhr.send();
  xhr.responseURL = 'https://evil.example/redirect'; xhr.emit('loadend'); await h.flush();
  assert.equal(h.status().at(-1).responses, allowed.length + 1);
});

test('handshake reports bridge installation and empty JSON responses are counted', async () => {
  const h = harness(async () => response({})); h.request();
  assert.deepEqual(h.status(), [{ source: 'x-follower-count', type: 'BRIDGE_STATUS', records: 0, responses: 0 }]);
  await h.window.fetch('/api'); await h.flush();
  assert.equal(h.status().at(-1).responses, 1);
  assert.equal(h.status().at(-1).records, 0);
  assert.deepEqual(h.records(), []);
  h.messages.length = 0; h.request({ source: {} }); h.request({ origin: 'https://api.x.com' });
  assert.equal(h.messages.length, 0); h.request();
  assert.deepEqual(h.status(), [{ source: 'x-follower-count', type: 'BRIDGE_STATUS', records: 0, responses: 1 }]);
});

test('mutual relationship booleans survive nested legacy records and partial updates', async () => {
  let body = { core: { screen_name: 'Mutual' }, relationship_counts: { followers: 35000 },
    relationship_perspectives: { following: true, followed_by: true },
    legacy: { screen_name: 'Mutual', followers_count: 35000 } };
  const h = harness(async () => response(body));
  await h.window.fetch('/api'); await h.flush();
  assert.deepEqual(h.records(), [{screenName:'Mutual',followersCount:35000,following:true,followedBy:true}]);
  body = { legacy: { screen_name: 'Mutual', followers_count: 35001 } };
  await h.window.fetch('/api'); await h.flush();
  assert.deepEqual(h.records().at(-1), {screenName:'Mutual',followersCount:35001,following:true,followedBy:true});
  body = { legacy: { screen_name: 'Mutual', followers_count: 35001, following: false, followed_by: true } };
  await h.window.fetch('/api'); await h.flush();
  assert.equal(h.records().at(-1).following, false);
});

test('relationship strings and follower counts do not imply mutual following', async () => {
  const h = harness(async () => response({screen_name:'Unknown',followers_count:10000,
    following:'true',followed_by:1}));
  await h.window.fetch('/api'); await h.flush();
  assert.deepEqual(h.records(), [{screenName:'Unknown',followersCount:10000}]);
});
