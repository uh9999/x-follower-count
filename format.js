(() => {
  "use strict";
  function formatCount(count, mode = "compact") {
    if (!Number.isSafeInteger(count) || count < 0) return null;
    if (mode === "exact" || count < 10000) return count.toLocaleString("en-US");
    const divisor = count >= 100000000 ? 100000000 : 10000;
    // 截断到一位小数，避免 99,999 被舍入为 10万。
    const number = Math.floor(count / divisor * 10) / 10;
    return `${number}${divisor === 100000000 ? "亿" : "万"}`;
  }
  globalThis.XFollowerFormat = Object.freeze({ formatCount });
})();
