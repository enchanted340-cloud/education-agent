const { test } = require("node:test");
const assert = require("node:assert/strict");

class Element {
  constructor(tagName, parentElement) {
    this.tagName = tagName;
    this.parentElement = parentElement;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.classList = { remove() {}, toggle() {} };
    this.text = "";
  }

  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }

  get textContent() {
    return this.text + this.children.map((node) => node.textContent).join("");
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.textContent = "";
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  descendants(tagName) {
    return this.children.flatMap((child) => [
      ...(child.tagName === tagName ? [child] : []),
      ...child.descendants(tagName),
    ]);
  }
}

function browser(t, respond) {
  const ids = [
    "navigation", "nav-label", "learner-mode", "admin-mode", "student-label",
    "student", "profile-select", "refresh", "detail", "close-detail",
    "menu-toggle", "notice", "breadcrumb", "content",
  ];
  const nodes = Object.fromEntries(
    ids.map((id) => [id, new Element("div", new Element("div"))]),
  );
  const requests = [];
  const location = { hash: "#experiments" };
  const globals = {
    document: {
      querySelector(selector) { return nodes[selector.slice(1)]; },
      body: new Element("body"),
      createElement(tagName) { return new Element(tagName); },
      createElementNS(_namespace, tagName) { return new Element(tagName); },
    },
    Option: class extends Element {
      constructor(text, value) {
        super("option");
        this.textContent = text;
        this.value = value;
      }
    },
    window: { addEventListener() {} },
    location,
    history: { replaceState(_state, _title, hash) { location.hash = hash; } },
    async fetch(url) {
      requests.push(url);
      return { ok: true, json: async () => respond(url) };
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = global[key];
    global[key] = value;
    t.after(() => { global[key] = previous; });
  }
  return { nodes, requests, location };
}

const primary = {
  before_passed: 2, after_passed: 4, before_mean: 40, after_mean: 80,
  change_pp: 40,
};
const version = {
  version: 1, status: "已完成盲评", statement: "<b>多行题面</b>\n第二行",
  sample: { input: "1\n2", output: "3", explanation: "原始解析" },
  expected: "4", findings: ["样例的期望输出有误。"],
  scores: { primary_score: 0, sample_accuracy_score: 50, coverage_score: 100 },
};
const fixture = {
  available: true, taskCount: 2, armCount: 3, total: 6, paired: 5,
  improvedTaskCount: 1,
  metrics: {
    primary_score: primary,
    sample_accuracy_score: { before_mean: 65, after_mean: 80, change_pp: 15 },
    coverage_score: { before_mean: 70, after_mean: 75, change_pp: 5 },
  },
  skills: [
    {
      key: "B-A", included: 2, primary: { ...primary, change_pp: 0 },
      draftCounts: { improved: 1, regressed: 1, tied: 0 },
      final: {
        included: 6,
        primary: { before_passed: 5, after_passed: 4, change_pp: -50 / 3 },
      },
    },
    {
      key: "C-A", included: 1, primary: { ...primary, change_pp: 0 },
      draftCounts: { improved: 0, regressed: 0, tied: 1 },
      final: {
        included: 5,
        primary: { before_passed: 4, after_passed: 4, change_pp: 0 },
      },
    },
  ],
  cases: ["H08", "H03", "H01", "H06"].map((task) => ({
    task, arm: task === "H06" ? "B" : "A", title: "案例 " + task,
    subtitle: "样例问题", requirement: "教师要求",
    versions: [
      version,
      {
        ...version, version: 2, status: "复审缺测", expected: "5",
        sample: { ...version.sample, input: "1\n7", output: "5" },
      },
    ],
  })),
};

async function workbench() {
  const router = await import("../webapp/static/router.js");
  const { state } = await import("../webapp/static/state.js");
  state.data = null;
  state.student = "";
  const { evaluation } = await import("../webapp/static/pages/evaluation.js")
    .catch((error) => {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      return {};
    });
  assert.equal(typeof evaluation, "function", "评测页已接入工作的渲染器");
  const start = () => router.start({
    home: () => {},
    experiments: evaluation,
  });
  return { start, navigate: router.navigate };
}

test("direct evaluation links use admin navigation and bypass student bootstrap", async (t) => {
  const { nodes, requests, location } = browser(t, (url) => {
    if (url === "/api/evaluation") return { available: false };
    assert.equal(url, "/api/bootstrap");
    return {};
  });
  const { start, navigate } = await workbench();
  await start();
  assert.deepEqual(requests, ["/api/evaluation"]);
  assert.equal(nodes.breadcrumb.textContent, "管理后台 / 实验评测");
  assert.equal(nodes.navigation.children.find((node) =>
    node.dataset.page === "experiments").attributes["aria-current"], "page");
  assert.equal(nodes.student.hidden, true);
  assert.equal(nodes["student-label"].hidden, true);
  assert.equal(nodes["profile-select"].parentElement.hidden, true);
  assert.match(nodes.content.textContent, /实验归档未安装/);

  await navigate("home");
  assert.deepEqual(requests, ["/api/evaluation", "/api/bootstrap"]);
  assert.equal(location.hash, "#home");
  assert.equal(nodes.student.hidden, false);
  assert.equal(nodes["student-label"].hidden, false);
  assert.equal(nodes["profile-select"].parentElement.hidden, false);
  assert.ok(!nodes.navigation.children.some((node) =>
    node.dataset.page === "experiments"));
});

test("evaluation shows paired numerators and denominator, evidence and skill comparisons", async (t) => {
  const { nodes } = browser(t, () => fixture);
  const { start } = await workbench();
  await start();
  const result = nodes.content;
  assert.match(result.textContent, /2\s*\/\s*5/);
  assert.match(result.textContent, /4\s*\/\s*5/);
  assert.match(result.textContent, /\+40(?:\.00)?\s*个百分点/);
  assert.match(result.textContent, /缺测\s*1/);
  assert.match(result.textContent, /样例答案/);
  assert.match(result.textContent, /覆盖条件/);
  assert.match(result.textContent, /净增 2 份，改善涉及 1 条教师请求/);
  assert.match(result.textContent, /学生学习效果缺测/);
  assert.deepEqual(result.descendants("meter").map((meter) =>
    [meter.attributes.value, meter.attributes.max]), [["40", "100"], ["80", "100"]]);

  const cases = result.descendants("details");
  assert.equal(cases.length, 4);
  assert.equal(cases.filter((item) => item.open).length, 1);
  assert.equal(cases[0].open, true);
  assert.match(cases[0].textContent, /<b>多行题面<\/b>/);
  assert.match(cases[0].textContent, /1\n2/);
  assert.match(cases[0].textContent, /1\n7/);
  assert.match(cases[0].textContent, /复审缺测/);
  assert.match(cases[0].textContent, /样例的期望输出有误/);
  assert.match(result.textContent, /B\s*[−-]\s*A/);
  assert.match(result.textContent, /C\s*[−-]\s*A/);
  assert.match(result.textContent, /可比题数/);
  assert.match(result.textContent, /5\s*\/\s*6/);
  assert.match(result.textContent, /4\s*\/\s*6/);
  assert.match(result.textContent, /[−-]16\.67\s*个百分点/);
  assert.match(result.textContent, /教师本人意见缺测/);
  assert.match(result.textContent, /改善 1 · 退步 1 · 持平 0/);
  assert.match(result.textContent, /等价最优解法/);
});

test("a delayed evaluation does not overwrite the page after navigation", async (t) => {
  let resolve;
  const pending = new Promise((ready) => { resolve = ready; });
  const { nodes, requests } = browser(t, (url) =>
    url === "/api/evaluation" ? pending : {},
  );
  const { start, navigate } = await workbench();
  const loading = start();
  assert.match(nodes.content.textContent, /正在读取实验评测/);
  await navigate("home");
  resolve(fixture);
  await loading;
  assert.deepEqual(requests, ["/api/evaluation", "/api/bootstrap"]);
  assert.equal(nodes.breadcrumb.textContent, "我的空间 / 学习空间");
  assert.equal(nodes.content.descendants("details").length, 0);
});
