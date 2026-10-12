(() => {
  'use strict';

  // Runs in the page's MAIN world. Observe responses the page already requests;
  // never make requests or inspect authentication material.
  const installed = Symbol.for('x-follower-count.bridge.installed');
  if (window[installed]) return;
  window[installed] = true;

  const MAX_NODES = 20000;
  const MAX_DEPTH = 32;
  const MAX_RECORDS = 2000;
  const BATCH_SIZE = 100;
  const CHUNK_SIZE = 400;
  const queue = [];
  const cache = new Map();
  let running = false;
  let responses = 0;
  const RESPONSE_HOSTS = new Set([
    'x.com', 'www.x.com', 'api.x.com',
    'twitter.com', 'www.twitter.com', 'api.twitter.com'
  ]);

  function publishStatus() {
    window.postMessage({ source: 'x-follower-count', type: 'BRIDGE_STATUS',
      records: cache.size, responses }, location.origin);
  }

  function publish(records) {
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      window.postMessage({ source: 'x-follower-count', type: 'FOLLOWER_COUNTS',
        records: records.slice(i, i + BATCH_SIZE) }, location.origin);
    }
    publishStatus();
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin ||
        event.data?.source !== 'x-follower-count' || event.data?.type !== 'REQUEST_COUNTS') return;
    publish(Array.from(cache.values()));
  });

  function isAllowedResponse(url) {
    try {
      const parsed = new URL(url, location.href);
      return parsed.protocol === 'https:' && RESPONSE_HOSTS.has(parsed.host);
    } catch (_) { return false; }
  }

  function recordFrom(value) {
    if (!value || typeof value !== 'object') return null;
    const legacy = value.legacy;
    const core = value.core;
    const screenName = value.screen_name ?? legacy?.screen_name ?? core?.screen_name;
    const followersCount = value.followers_count ?? legacy?.followers_count ?? value.relationship_counts?.followers;
    if (typeof screenName !== 'string' || !/^[a-zA-Z0-9_]{1,15}$/.test(screenName) ||
        !Number.isSafeInteger(followersCount) || followersCount < 0) return null;
    const record = { screenName, followersCount };
    for (const key of ['following', 'followed_by']) {
      const relation = value.relationship_perspectives?.[key] ?? value[key] ?? legacy?.[key];
      if (typeof relation === 'boolean') record[key === 'followed_by' ? 'followedBy' : key] = relation;
    }
    return record;
  }

  function enqueue(root) {
    if (!root || typeof root !== 'object' || queue.length >= 8) return;
    queue.push(root);
    responses += 1;
    publishStatus();
    if (!running) {
      running = true;
      setTimeout(next, 0);
    }
  }

  function next() {
    if (!queue.length) { running = false; return; }
    const stack = [{ value: queue.shift(), depth: 0 }];
    const seen = new WeakSet();
    const records = new Map();
    let nodes = 0;

    function step() {
      let work = 0;
      while (stack.length && nodes < MAX_NODES && records.size < MAX_RECORDS && work < CHUNK_SIZE) {
        const { value, depth } = stack.pop();
        work += 1;
        nodes += 1;
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        seen.add(value);
        let record;
        try { record = recordFrom(value); } catch (_) { continue; }
        if (record) {
          const key = record.screenName.toLowerCase();
          records.set(key, { ...records.get(key), ...record });
        }
        if (depth >= MAX_DEPTH) continue;
        // Bound the pending stack too, even for exceptionally wide responses.
        const keys = Object.keys(value);
        for (let i = 0; i < keys.length && stack.length < MAX_NODES - nodes; i += 1) {
          let child;
          try { child = value[keys[i]]; } catch (_) { continue; }
          if (child && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
        }
      }
      if (stack.length && nodes < MAX_NODES && records.size < MAX_RECORDS) {
        setTimeout(step, 0);
        return;
      }
      const values = Array.from(records.values());
      for (const record of values) {
        const key = record.screenName.toLowerCase();
        const previous = cache.get(key);
        cache.delete(key);
        cache.set(key, { ...previous, ...record });
        if (cache.size > MAX_RECORDS) cache.delete(cache.keys().next().value);
      }
      publish(values.map(record => cache.get(record.screenName.toLowerCase())));
      setTimeout(next, 0);
    }
    step();
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (...args) {
      return originalFetch.apply(this, args).then(response => {
        try {
          const requestedUrl = typeof args[0] === 'string' || args[0] instanceof URL
            ? String(args[0]) : args[0]?.url;
          if (isAllowedResponse(response.url || requestedUrl)) {
            // Parse only the clone so json()/text() on the original remain usable.
            response.clone().json().then(enqueue).catch(() => {});
          }
        } catch (_) { /* Observation must never affect the page's response. */ }
        return response;
      });
    };
  }

  const xhrPrototype = window.XMLHttpRequest?.prototype;
  if (xhrPrototype) {
    const originalOpen = xhrPrototype.open;
    const originalSend = xhrPrototype.send;
    const urls = new WeakMap();
    xhrPrototype.open = function (...args) {
      const result = originalOpen.apply(this, args);
      urls.set(this, args[1]);
      return result;
    };
    xhrPrototype.send = function (...args) {
      const xhr = this;
      function observe() {
        try {
          if (!isAllowedResponse(xhr.responseURL || urls.get(xhr))) return;
          if (xhr.responseType === 'json') enqueue(xhr.response);
          else if (!xhr.responseType || xhr.responseType === 'text') enqueue(JSON.parse(xhr.responseText));
        } catch (_) { /* Malformed/non-JSON responses are irrelevant. */ }
      }
      xhr.addEventListener('loadend', observe, { once: true });
      try { return originalSend.apply(xhr, args); }
      catch (error) {
        xhr.removeEventListener('loadend', observe);
        throw error;
      }
    };
  }
})();
