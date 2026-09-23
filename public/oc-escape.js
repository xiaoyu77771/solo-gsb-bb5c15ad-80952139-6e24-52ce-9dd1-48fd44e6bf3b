'use strict';

/*
 * 余料库存与复用页的 HTML 转义工具。
 *
 * 手工录入的纸型名、订单号、来源批次号以及复用预占的关联单据号
 * 均为不可信动态文本，会出现在列表、预占明细与复用结果中。
 * 统一经 ocEscape 转义后再插入 innerHTML，既保留正常中文与符号
 * 的原文显示，也防止标签 / 事件属性注入（存储型 XSS）。
 *
 * 同一转义结果同时适用于：
 *  - HTML 文本上下文（<td>…</td>）：转义 & < >
 *  - 双引号属性上下文（title="…"、data-*="…"）：额外转义 "（及 '）
 */
const OC_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function ocEscape(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"']/g, (ch) => OC_ESCAPE_MAP[ch]);
}

// 浏览器：全局函数供 app.js / offcuts.js 直接调用；
// Node（node --test）：以 CommonJS 导出供回归测试复用。
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = { ocEscape };
}
