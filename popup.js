(() => {
  "use strict";
  const enabled = document.getElementById("enabled");
  const mode = document.getElementById("mode");
  const status = document.getElementById("status");
  function preview() {
    document.getElementById("preview").textContent = mode.value === "exact" ? "粉丝 35,000" : "粉丝 3.5万";
    document.getElementById("preview").hidden = !enabled.checked;
  }
  async function save() {
    preview();
    try {
      await chrome.storage.local.set({ settings: { enabled: enabled.checked, mode: mode.value } });
      status.textContent = "已保存，当前 X 页面即时生效";
    } catch { status.textContent = "保存失败，请重新打开插件"; }
  }
  chrome.storage.local.get("settings").then(({ settings }) => {
    enabled.checked = settings?.enabled !== false;
    mode.value = settings?.mode === "exact" ? "exact" : "compact";
    preview();
  }).catch(() => { status.textContent = "无法读取设置"; });
  enabled.addEventListener("change", save);
  mode.addEventListener("change", save);
  async function diagnose() {
    const diagnostic = document.getElementById("diagnostic");
    try {
      const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
      const data = await chrome.tabs.sendMessage(tab.id, {type:"XFC_STATUS"});
      let advice = "";
      if (!data.enabled) advice = "请开启上方的显示开关。";
      else if (!data.bridge) advice = "数据观察脚本尚未就绪，请刷新 X 页面。";
      else if (!data.rows) advice = "当前没有用户或推文作者，请打开首页、推文详情或粉丝列表。";
      else if (!data.records) advice = "尚未读取到粉丝数据，请刷新列表；仍无显示时把此状态发给开发者。";
      else if (!data.badges) advice = "已读取数据但未匹配到用户行，请把此状态发给开发者。";
      else advice = "插件正在正常显示。";
      diagnostic.textContent = `页面脚本：已运行｜数据桥接：${data.bridge ? "已运行" : "未就绪"}｜用户行：${data.userRows ?? data.rows}｜推文作者：${data.authors ?? 0}｜已读取：${data.records}｜已显示：${data.badges}。${advice}`;
    } catch {
      diagnostic.textContent = "当前页未连接插件。请切到 x.com 并刷新；同时在扩展详情中确认允许访问 X 网站。";
    }
  }
  diagnose();
})();
