'use strict';

/**
 * 余料库存与复用页存储型脚本注入回归测试。
 *
 * 手工录入的纸型名 / 订单号 / 来源批次号与复用预占的关联单据号会原样入库，
 * 并进入：余料列表（ocListTableHtml）、预占明细分组（ocAllocationsHtml）、
 * 复用结果提示（ocAllocationResultHtml）。这些纯 HTML 构造函数与浏览器
 * innerHTML 使用的字符串完全一致，这里直接断言：
 *  1. 标签 / 事件属性载荷只以实体转义后的原文出现，HTML 中不存在可执行形态；
 *  2. 属性上下文（title / data-allocation）无法被引号突破；
 *  3. 正常中文与符号（中文、·、（）等）照常显示，不被误转义。
 */

const assert = require('node:assert');
const { test, beforeEach } = require('node:test');

const { ocEscape } = require('../public/oc-escape');
const view = require('../public/offcuts');
const {
  _resetStore,
  createOffcut,
  listOffcuts,
  allocateOffcuts,
} = require('../src/offcuts');

beforeEach(() => _resetStore());

// 标签 + 事件属性型载荷（存储型 XSS 的典型形态）
const TAG_PAYLOAD = '<img src=x onerror=alert(1)>';
// 引号突破属性型载荷（试图从 title="…" / data-allocation="…" 中逃逸）
const ATTR_PAYLOAD = '" onmouseover="alert(2)" x="';
// 脚本标签载荷
const SCRIPT_PAYLOAD = '<script>alert(3)</script>';
// 正常文本：中文与常用符号必须原样保留
const NORMAL_TEXT = '大度全张余料 · A3（备用）';

/** 载荷的可执行形态不得出现；其实体转义形态必须出现（即“只显示原文”） */
function assertPayloadEscaped(html, payload, label) {
  assert.ok(!html.includes(payload), `${label}：原始载荷 ${payload} 不应出现在 HTML 中`);
  assert.ok(html.includes(ocEscape(payload)),
    `${label}：载荷应以转义原文 ${ocEscape(payload)} 显示`);
}

/** 不得出现载荷对应的可解析标签或可触发的事件属性 */
function assertNoExecutablePayload(html, label) {
  for (const raw of ['<img', '<script', '</script', '" onmouseover=', '" onerror=']) {
    assert.ok(!html.includes(raw), `${label}：HTML 中不应出现 ${raw}`);
  }
}

/* ---------------- 转义函数本身 ---------------- */

test('ocEscape：文本与属性上下文中的危险字符统一转义', () => {
  assert.equal(ocEscape(NORMAL_TEXT), NORMAL_TEXT); // 中文 / · / （） 不动
  assert.equal(ocEscape('<b>粗体</b>'), '&lt;b&gt;粗体&lt;/b&gt;');
  // 先转义 &，避免二次拼接形成实体
  assert.equal(ocEscape('A & B'), 'A &amp; B');
  assert.equal(ocEscape('"引号"'), '&quot;引号&quot;');
  assert.equal(ocEscape("'单引号'"), '&#39;单引号&#39;');
  assert.equal(ocEscape('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(ocEscape(null), '');
  assert.equal(ocEscape(undefined), '');
});

/* ---------------- 余料列表 ---------------- */

test('列表：纸型名 / 订单号 / 批次号中的标签与事件属性只显示原文不执行', () => {
  createOffcut({
    paperName: `${TAG_PAYLOAD}${ATTR_PAYLOAD}`,
    width: 300, height: 200,
    batchId: `${SCRIPT_PAYLOAD}-批次·01`,
    orderNo: TAG_PAYLOAD,
  });
  // 正常中文与符号的记录作为对照
  createOffcut({ paperName: NORMAL_TEXT, width: 100, height: 80, batchId: 'B-正常' });

  const list = listOffcuts().offcuts;
  const html = view.ocListTableHtml(list);

  assertPayloadEscaped(html, TAG_PAYLOAD, '纸型名/订单号');
  assertPayloadEscaped(html, ATTR_PAYLOAD, '纸型名属性突破');
  assertPayloadEscaped(html, SCRIPT_PAYLOAD, '批次号脚本标签');
  assertNoExecutablePayload(html, '列表');

  // 属性突破载荷里的引号必须被实体化，无法闭合任何属性
  assert.ok(!html.includes('" onmouseover='), '列表：不得出现未转义的属性突破');

  // 正常中文与符号照常显示
  assert.ok(html.includes(NORMAL_TEXT), '正常纸型名应原样显示');
  assert.ok(html.includes('B-正常'), '正常批次号应原样显示');
  assert.ok(html.includes('批次·01'), '批次号中的中文与间隔号应原样显示');
});

/* ---------------- 预占明细（预占单分组 / 状态单元格 / title 属性） ---------------- */

test('预占明细：单据号 / 批次号 / 订单号进入预占单与 title 属性时安全渲染', () => {
  createOffcut({
    paperName: TAG_PAYLOAD, width: 300, height: 200,
    batchId: ATTR_PAYLOAD, orderNo: SCRIPT_PAYLOAD,
  });
  createOffcut({
    paperName: NORMAL_TEXT, width: 250, height: 150,
    batchId: 'B-正常', orderNo: 'SO-正常',
  });
  const out = allocateOffcuts({
    width: 100, height: 100, quantity: 2, grain: 'any',
    ref: `${TAG_PAYLOAD}${ATTR_PAYLOAD}`,
  });
  assert.equal(out.status, 'fulfilled');

  const list = listOffcuts({ status: 'reserved' }).offcuts;

  // 列表状态单元格中的预占单号 / 单据号
  const tableHtml = view.ocListTableHtml(list);
  assertPayloadEscaped(tableHtml, TAG_PAYLOAD, '列表单据号');
  assertPayloadEscaped(tableHtml, ATTR_PAYLOAD, '列表单据号属性突破');
  assertPayloadEscaped(tableHtml, SCRIPT_PAYLOAD, '列表订单号');
  assertNoExecutablePayload(tableHtml, '列表预占状态');
  assert.ok(tableHtml.includes(`单据 ${ocEscape(TAG_PAYLOAD + ATTR_PAYLOAD)}`),
    '单据号应以转义原文出现在预占信息中');
  assert.ok(tableHtml.includes('SO-正常'), '正常订单号应原样显示');

  // 预占明细分组：头部单据号、chips 的 title（来源含批次号）、
  // data-allocation 属性均不得被突破
  const allocHtml = view.ocAllocationsHtml(list);
  assertPayloadEscaped(allocHtml, TAG_PAYLOAD, '预占分组单据号');
  assertPayloadEscaped(allocHtml, ATTR_PAYLOAD, '预占分组批次号/单据号属性突破');
  assertNoExecutablePayload(allocHtml, '预占分组');

  // title 属性内容（来源纯文本，批次号为属性突破载荷）必须整体转义后出现，
  // 引号变为 &quot;，无法闭合 title
  const malicious = list.find((o) => o.source.batchId === ATTR_PAYLOAD);
  assert.ok(malicious, '应能找到批次号为恶意载荷的记录');
  const expectedTitle = view.ocSourceText(malicious);
  assert.ok(allocHtml.includes(`title="${ocEscape(expectedTitle)}"`),
    'chip 的 title 属性应承载转义后的来源文本');
  assert.ok(!allocHtml.includes('title=""'), 'title 属性不应被载荷闭合为空');

  // data-allocation 为服务端生成单号（AL-000001），应保持可用以驱动释放按钮
  assert.ok(allocHtml.includes(`data-allocation="${out.allocationId}"`),
    '释放按钮的 data-allocation 应保留可用单号');
});

/* ---------------- 复用结果（成功 / 缺口） ---------------- */

test('复用成功结果：预占单号与单据号只显示原文', () => {
  createOffcut({ paperName: NORMAL_TEXT, width: 300, height: 200 });
  const out = allocateOffcuts({
    width: 100, height: 100, quantity: 1, ref: TAG_PAYLOAD,
  });
  assert.equal(out.allocated, true);
  const html = view.ocAllocationResultHtml(out);
  assertPayloadEscaped(html, TAG_PAYLOAD, '成功结果单据号');
  assertNoExecutablePayload(html, '成功结果');
  assert.ok(html.includes(out.allocationId), '预占单号应正常显示');
});

test('复用缺口结果：候选纸型名中的标签与属性突破载荷不执行', () => {
  // 只有一块可行余料，请求 3 块 → 原子缺口，候选明细回显该纸型名
  createOffcut({ paperName: `${SCRIPT_PAYLOAD}${ATTR_PAYLOAD}`, width: 300, height: 100 });
  createOffcut({ paperName: NORMAL_TEXT, width: 30, height: 30 });
  const out = allocateOffcuts({ width: 200, height: 80, quantity: 3, grain: 'any' });
  assert.equal(out.status, 'shortfall');
  assert.equal(out.allocated, false);
  assert.equal(out.feasibleCount, 1);
  // 原子失败语义：未预占任何余料
  assert.equal(listOffcuts({ status: 'reserved' }).count, 0);

  const html = view.ocAllocationResultHtml(out);
  assertPayloadEscaped(html, SCRIPT_PAYLOAD, '缺口候选纸型名');
  assertPayloadEscaped(html, ATTR_PAYLOAD, '缺口候选属性突破');
  assertNoExecutablePayload(html, '缺口结果');
});

/* ---------------- 端到端：经 HTTP 接口入库后渲染仍安全 ---------------- */

test('HTTP 入库 → 查询 → 列表渲染：存储的恶意字段全程不被解析为 HTML', async () => {
  const app = require('../server');
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const createResp = await fetch(`${base}/api/offcuts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paperName: TAG_PAYLOAD,
        width: 120, height: 90,
        batchId: SCRIPT_PAYLOAD,
        orderNo: ATTR_PAYLOAD,
      }),
    });
    assert.equal(createResp.status, 201);
    const created = await createResp.json();

    const listResp = await fetch(`${base}/api/offcuts`);
    const data = await listResp.json();
    assert.equal(data.offcuts.length, 1);
    // 服务端原样存储（不篡改输入）
    assert.equal(data.offcuts[0].paperName, TAG_PAYLOAD);
    assert.equal(data.offcuts[0].source.batchId, SCRIPT_PAYLOAD);
    assert.equal(data.offcuts[0].source.orderNo, ATTR_PAYLOAD);
    assert.equal(created.offcut.id, data.offcuts[0].id);

    // 页面渲染层统一转义：只显示原文，不形成标签 / 不突破属性
    const html = view.ocListTableHtml(data.offcuts);
    assertPayloadEscaped(html, TAG_PAYLOAD, 'HTTP 纸型名');
    assertPayloadEscaped(html, SCRIPT_PAYLOAD, 'HTTP 批次号');
    assertPayloadEscaped(html, ATTR_PAYLOAD, 'HTTP 订单号');
    assertNoExecutablePayload(html, 'HTTP 列表');
    assert.ok(html.includes('手工'), '来源类型中文标签照常显示');
  } finally {
    server.close();
  }
});
