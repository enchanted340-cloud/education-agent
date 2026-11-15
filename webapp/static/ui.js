import { statusNames } from "./labels.js";
export const $ = (s) => document.querySelector(s);

export function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

export function tag(status) {
  return el(
    "span",
    "tag " +
      ([
        "pass",
        "succeeded",
        "completed",
        "recommended",
        "tests_passed",
        "Good",
      ].includes(status)
        ? "good"
        : ["fail", "failed", "Bad", "tests_failed", "rejected"].includes(status)
          ? "bad"
          : "unknown"),
    statusNames[status] || status || "未记录",
  );
}

export function button(text, fn, cls = "quiet") {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", () => Promise.resolve().then(fn).catch(notice));
  return b;
}

export function notice(error) {
  const n = $("#notice");
  n.textContent = error.message || String(error);
  n.hidden = false;
}

export function hero(title, desc = "", kicker = "") {
  const h = el("section", "page-heading");
  const copy = el("div");
  if (kicker) copy.append(el("div", "eyebrow", kicker));
  copy.append(el("h1", "", title));
  if (desc) copy.append(el("p", "", desc));
  h.append(copy);
  return h;
}

export function panel(title) {
  const p = el("section", "panel");
  if (title) p.append(el("h2", "", title));
  return p;
}

export function empty(text) {
  return el("p", "empty", text);
}

export function openDetail(title, nodes, className = "") {
  $("#detail").className = className;
  $("#detail-title").textContent = title;
  $("#detail-body").replaceChildren(...nodes);
  if (!$("#detail").open) $("#detail").showModal();
}

export function rows(items, action) {
  const box = el("div");
  if (!items.length)
    return empty("当前选择下没有记录。可在任务工作台创建新任务。");
  for (const item of items) {
    const row = el("div", "row");
    const copy = el("div");
    copy.append(
      button(item.label, () => action(item), "text-link"),
      el("small", "", item.student_id || item.path),
    );
    row.append(copy, tag(item.status));
    box.append(row);
  }
  return box;
}

export function conceptName(value) {
  return String(value || "").split("：")[0];
}
export const conceptGroups = [
  { name: "语言基础", tone: "blue", symbol: "{ }" },
  { name: "数据处理", tone: "violet", symbol: "[ ]" },
  { name: "计算与建模", tone: "teal", symbol: "∑" },
  { name: "策略与结构", tone: "amber", symbol: "◇" },
];
// Presentation groups only: no prerequisite or mastery semantics.
export function conceptGroup(id) {
  if (/^java\.(array|string|sort|collections)/.test(id)) return 1;
  if (id.startsWith("java.")) return 0;
  if (
    /^algorithm\.(counting|aggregation|extrema|digit_processing|rounding|number_theory|combinatorics|interval)$/.test(
      id,
    )
  )
    return 2;
  return 3;
}
export function icon(name) {
  name =
    { recommendations: "plan", submissions: "review", twin: "profiles" }[
      name
    ] || name;
  const paths = {
    home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
    plan: "M5 4v16M5 7h9l4 4-4 4H5",
    reading: "M12 5v16M3 4h5l4 2 4-2h5v15h-5l-4 2-4-2H3Z",
    chat: "M4 4h16v13H9l-5 4Z",
    practice: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18",
    graph: "M12 3v6M5 15v-4h14v4M3 15h4v6H3Zm14 0h4v6h-4ZM10 3h4v4h-4Z",
    profiles: "m2 13 4-1 3-8 4 16 3-8h6",
    review: "M4 8V3m0 5h5M4 8a9 9 0 1 1-1 8",
    notes: "M6 3h12v19l-6-4-6 4Z",
    tasks: "M6 3h12v18H6ZM9 7h6m-6 5h6m-6 5h4",
    questions: "M4 3h16v18H4Zm4 5h8m-8 5h8m-8 4h5",
    admin: "M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z",
    generation: "M12 2v20M2 12h20M5 5l14 14M19 5 5 19",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, v] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.6",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(k, v);
  const p = document.createElementNS(svg.namespaceURI, "path");
  p.setAttribute("d", paths[name] || paths.tasks);
  svg.append(p);
  return svg;
}
