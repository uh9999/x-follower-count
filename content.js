(() => {
  "use strict";
  const source = "x-follower-count";
  const selector = '[data-testid="UserCell"], [data-testid="User-Name"]';
  const badgeSelector = '[data-xfc-badge]';
  const counts = new Map();
  let settings = { enabled: true, mode: "compact" };
  let pending = false;
  let bridgeStatus = null;

  function profileName(link) {
    try {
      const url = new URL(link.getAttribute("href"), location.href);
      if (url.origin !== location.origin) return null;
      const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})(?:\/(?:with_replies|verified_followers))?\/?$/);
      return match ? match[1].toLowerCase() : null;
    } catch { return null; }
  }

  function render() {
    pending = false;
    for (const cell of document.querySelectorAll(selector)) {
      // 只在当前用户行或作者标题内匹配，不从正文、引用卡片或其他作者取账号。
      const links = [...cell.querySelectorAll('a[href]')].filter(link => link.closest(selector) === cell);
      const handleLink = links.find(link => /^@[A-Za-z0-9_]{1,15}$/.test(link.textContent.trim()) && profileName(link));
      const profileLinks = links.filter(link => profileName(link) && link.getAttribute("aria-hidden") !== "true" && link.textContent.trim());
      // 详情页作者标题有时隐藏 @handle；仅在作者标题且账号唯一时使用昵称链接。
      const headerNames = new Set(profileLinks.map(profileName));
      const name = handleLink ? profileName(handleLink) :
        cell.matches('[data-testid="User-Name"]') && headerNames.size === 1 ? [...headerNames][0] : null;
      const nameLink = name && links.find(link => profileName(link) === name &&
        link !== handleLink && link.getAttribute("aria-hidden") !== "true" && link.textContent.trim());
      const target = nameLink && (nameLink.firstElementChild || nameLink);
      const count = name ? counts.get(name) : undefined;
      const ownedBadges = [...cell.querySelectorAll(badgeSelector)].filter(b => b.closest(selector) === cell);
      let badge = ownedBadges[0];
      if (!settings.enabled || !target || count === undefined) {
        badge?.remove();
        continue;
      }
      // React 会回收列表节点；每次从当前行账号重新匹配，禁止沿用旧标签。
      for (const duplicate of ownedBadges) {
        if (duplicate !== badge) duplicate.remove();
      }
      if (badge && badge.parentElement !== target) { badge.remove(); badge = null; }
      if (!badge) {
        badge = document.createElement("span");
        badge.setAttribute("data-xfc-badge", "");
        badge.className = "xfc-badge";
        target.appendChild(badge);
      }
      const text = `粉丝 ${globalThis.XFollowerFormat.formatCount(count, settings.mode)}`;
      const title = `@${name} · 粉丝 ${count.toLocaleString("en-US")}（来自 X 本次页面数据）`;
      if (badge.textContent !== text) badge.textContent = text;
      if (badge.title !== title) badge.title = title;
      if (badge.dataset.xfcUser !== name) badge.dataset.xfcUser = name;
      const label = `粉丝数量：${count.toLocaleString("zh-CN")}`;
      if (badge.getAttribute("aria-label") !== label) badge.setAttribute("aria-label", label);
    }
  }

  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(render, 80);
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.source === source && data.type === "BRIDGE_STATUS") {
      bridgeStatus = { records: Number.isSafeInteger(data.records) ? data.records : 0,
        responses: Number.isSafeInteger(data.responses) ? data.responses : 0 };
      return;
    }
    if (data?.source !== source || data.type !== "FOLLOWER_COUNTS" || !Array.isArray(data.records)) return;
    for (const record of data.records.slice(0, 500)) {
      if (!record || typeof record.screenName !== "string" ||
          !/^[A-Za-z0-9_]{1,15}$/.test(record.screenName) ||
          !Number.isSafeInteger(record.followersCount) || record.followersCount < 0) continue;
      const name = record.screenName.toLowerCase();
      counts.delete(name);
      counts.set(name, record.followersCount);
      if (counts.size > 2000) counts.delete(counts.keys().next().value);
    }
    schedule();
  });

  const observer = new MutationObserver(mutations => {
    // 忽略自身文字/属性变动，避免无限渲染循环。
    if (mutations.some(m => !(m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest(badgeSelector))) schedule();
  });
  observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href"] });

  function applySettings(value) {
    settings = { enabled: value.enabled !== false, mode: value.mode === "exact" ? "exact" : "compact" };
    schedule();
  }
  if (globalThis.chrome?.storage?.local) {
    chrome.storage.local.get("settings").then(result => applySettings(result.settings || {})).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.settings) applySettings(changes.settings.newValue || {});
    });
  }
  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      if (message?.type !== "XFC_STATUS") return;
      respond({ enabled: settings.enabled, bridge: bridgeStatus,
        records: counts.size, rows: document.querySelectorAll(selector).length,
        userRows: document.querySelectorAll('[data-testid="UserCell"]').length,
        authors: document.querySelectorAll('[data-testid="User-Name"]').length,
        badges: document.querySelectorAll(badgeSelector).length });
    });
  }
  window.postMessage({ source, type: "REQUEST_COUNTS" }, location.origin);
  // 两个世界注入顺序不同也能完成握手；仅重放内存数据，不发网络请求。
  setTimeout(() => window.postMessage({ source, type: "REQUEST_COUNTS" }, location.origin), 500);
  schedule();
})();
