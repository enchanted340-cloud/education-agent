import { state } from "../state.js";
import {
  el,
  hero,
  panel,
  button,
  empty,
  conceptName,
  conceptGroups,
  conceptGroup,
} from "../ui.js";
import { showConcept } from "./profiles.js";
import { names } from "../labels.js";

export function relationsFor(catalog, id) {
  return [
    ...(catalog.prerequisites || []).map((r) => ({ ...r, type: "条件先修" })),
    ...(catalog.associations || []).map((r) => ({ ...r, type: "关联" })),
  ].filter((r) => r.from === id || r.to === id || r.concept_ids?.includes(id));
}
function svgEl(name, attrs = {}, text) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}
export function graph(content) {
  content.append(hero("知识图谱"));
  const catalog = state.data.catalog,
    concepts = Object.entries(catalog.concepts || {});
  if (!concepts.length) {
    content.append(empty("暂无知识目录"));
    return;
  }
  const workspace = el("div", "atlas-workspace"),
    main = el("section", "atlas-main"),
    side = el("aside", "atlas-side");
  const toolbar = el("div", "atlas-toolbar"),
    search = el("input"),
    matches = el("div", "atlas-matches");
  search.type = "search";
  search.placeholder = "查找知识点";
  search.setAttribute("aria-label", "查找知识点");
  const reset = button("查看全图", () => select(null), "secondary");
  toolbar.append(search, reset);
  const legend = el("div", "atlas-legend");
  legend.append(
    el("span", "edge-key prerequisite", "条件先修"),
    el("span", "edge-key association", "知识关联"),
  );
  const viewport = el("div", "atlas-viewport");
  viewport.setAttribute("aria-label", "知识关系画布");
  viewport.tabIndex = 0;
  const svg = svgEl("svg", {
    viewBox: "0 0 1080 930",
    class: "knowledge-svg",
    role: "group",
    "aria-label": "知识点关系图",
  });
  const defs = svgEl("defs"),
    marker = svgEl("marker", {
      id: "knowledge-arrow",
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 6,
      markerHeight: 6,
      orient: "auto-start-reverse",
    });
  marker.append(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#7183ac" }));
  defs.append(marker);
  svg.append(defs);
  const backgrounds = svgEl("g"),
    edges = svgEl("g", { class: "atlas-edges" }),
    nodes = svgEl("g");
  svg.append(backgrounds, edges, nodes);
  const positions = new Map(),
    buttons = new Map();
  conceptGroups.forEach((group, index) => {
    const gx = 24 + (index % 2) * 536,
      gy = 24 + Math.floor(index / 2) * 452,
      items = concepts.filter(([id]) => conceptGroup(id) === index);
    const block = svgEl("g", { class: `atlas-cluster tone-${group.tone}` });
    block.append(
      svgEl("rect", { x: gx, y: gy, width: 512, height: 426, rx: 26 }),
      svgEl(
        "text",
        { x: gx + 26, y: gy + 35, class: "cluster-title" },
        group.name,
      ),
      svgEl(
        "text",
        { x: gx + 26, y: gy + 58, class: "cluster-count" },
        `${items.length} 个知识点`,
      ),
    );
    backgrounds.append(block);
    items.forEach(([id, name], i) => {
      const x = gx + 130 + (i % 2) * 250,
        y = gy + 104 + Math.floor(i / 2) * 66;
      positions.set(id, { x, y });
      const b = svgEl("g", {
        class: `atlas-node tone-${group.tone}`,
        role: "button",
        tabindex: 0,
        "aria-label": conceptName(name),
        "aria-pressed": "false",
        "data-id": id,
        transform: `translate(${x},${y})`,
      });
      b.append(
        svgEl("rect", { x: -112, y: -25, width: 224, height: 50, rx: 14 }),
        svgEl("circle", { cx: -94, cy: 0, r: 4 }),
        svgEl(
          "text",
          { x: 5, y: 5, "text-anchor": "middle" },
          conceptName(name),
        ),
      );
      b.addEventListener("click", () => select(id));
      b.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select(id);
        }
      });
      nodes.append(b);
      buttons.set(id, b);
    });
  });
  viewport.append(svg);
  main.append(toolbar, matches, legend, viewport);
  workspace.append(main, side);
  content.append(workspace);
  function relationDetail(r) {
    const box = panel(r.type),
      ids = r.concept_ids || [r.from, r.to];
    box.append(
      el(
        "h3",
        "",
        ids
          .map((id) => conceptName(catalog.concepts[id] || id))
          .join(r.type === "条件先修" ? " → " : " · "),
      ),
      el("h3", "small muted", "适用场景"),
      el("p", "", r.applies_when || r.use_case || "未记录"),
      el("h3", "small muted", "关系依据"),
      el("p", "", r.reason || "未记录"),
    );
    const old = side.querySelector(".selected-relation");
    if (old) old.remove();
    box.classList.add("selected-relation");
    side.append(box);
    box.scrollIntoView({ block: "nearest" });
  }
  function select(id) {
    edges.replaceChildren();
    side.replaceChildren();
    const relations = id ? relationsFor(catalog, id) : [],
      neighbors = new Set([id]);
    for (const r of relations)
      for (const c of r.concept_ids || [r.from, r.to]) neighbors.add(c);
    for (const [key, b] of buttons) {
      b.classList.toggle("faded", Boolean(id && !neighbors.has(key)));
      b.classList.toggle("selected", key === id);
      b.setAttribute("aria-pressed", String(key === id));
    }
    if (!id) {
      const intro = panel("知识导航");
      intro.append(
        el("div", "atlas-emblem", "⌘"),
        el("strong", "atlas-total", `${concepts.length}`),
        el("p", "muted center", "个知识点"),
        el("p", "center", "选择节点，展开直接关系"),
      );
      for (const [i, g] of conceptGroups.entries()) {
        const row = el("div", `group-key tone-${g.tone}`);
        row.append(
          el("span", "group-dot"),
          el("span", "", g.name),
          el(
            "strong",
            "",
            concepts.filter(([id]) => conceptGroup(id) === i).length,
          ),
        );
        intro.append(row);
      }
      side.append(intro);
      return;
    }
    const info = panel(conceptName(catalog.concepts[id])),
      g = conceptGroups[conceptGroup(id)];
    info.append(
      el("span", `category-label tone-${g.tone}`, g.name),
      el("p", "muted", catalog.concepts[id]),
      el("p", "small muted", `${relations.length} 条直接关系`),
    );
    side.append(info);
    for (const r of relations) {
      const pairs =
        r.type === "条件先修"
          ? [[r.from, r.to]]
          : (r.concept_ids || []).filter((c) => c !== id).map((c) => [id, c]);
      for (const [from, to] of pairs) {
        const a = positions.get(from),
          b = positions.get(to);
        if (!a || !b) continue;
        const dx = b.x - a.x,
          dy = b.y - a.y,
          vertical = Math.abs(dy) > Math.abs(dx),
          sx = a.x + (vertical ? 0 : Math.sign(dx) * 114),
          sy = a.y + (vertical ? Math.sign(dy) * 27 : 0),
          tx = b.x - (vertical ? 0 : Math.sign(dx) * 114),
          ty = b.y - (vertical ? Math.sign(dy) * 27 : 0);
        const d = vertical
          ? `M${sx},${sy} C${sx},${(sy + ty) / 2} ${tx},${(sy + ty) / 2} ${tx},${ty}`
          : `M${sx},${sy} C${(sx + tx) / 2},${sy} ${(sx + tx) / 2},${ty} ${tx},${ty}`;
        const line = svgEl("path", {
          d,
          class: `atlas-edge ${r.type === "条件先修" ? "conditional" : ""}`,
          role: "button",
          tabindex: 0,
          "aria-label": `${r.type}：${conceptName(catalog.concepts[from])}到${conceptName(catalog.concepts[to])}`,
        });
        if (r.type === "条件先修")
          line.setAttribute("marker-end", "url(#knowledge-arrow)");
        line.addEventListener("click", () => relationDetail(r));
        line.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            relationDetail(r);
          }
        });
        edges.append(line);
      }
    }
    const related = panel("直接关系");
    for (const r of relations)
      related.append(
        button(
          (r.type === "条件先修" ? "⇢ " : "— ") +
            (r.concept_ids || [r.from, r.to])
              .filter((c) => c !== id)
              .map((c) => conceptName(catalog.concepts[c] || c))
              .join(" · "),
          () => relationDetail(r),
          "relation-button",
        ),
      );
    if (!relations.length) related.append(empty("暂无关联记录"));
    side.append(related);
    const row = state.model.conceptRows.find((x) => x.id === id),
      personal = panel("当前学生的证据");
    personal.append(
      el("strong", "evidence-number", row?.evidence.length || 0),
      el("span", "muted", " 份作答"),
    );
    if (row?.observations.length)
      personal.append(
        button("查看分析与作答 →", () => showConcept(row), "text-link"),
      );
    else personal.append(el("p", "muted small", "暂无相关作答"));
    side.append(personal);
  }
  search.addEventListener("input", () => {
    matches.replaceChildren();
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    const found = concepts
      .filter(([id, n]) => (id + " " + n).toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(conceptName(b[1]).toLowerCase().includes(q)) -
          Number(conceptName(a[1]).toLowerCase().includes(q)),
      );
    for (const [id, n] of found)
      matches.append(
        button(
          conceptName(n),
          () => {
            select(id);
            buttons.get(id).focus();
            matches.replaceChildren();
          },
          "search-hit",
        ),
      );
    if (!found.length) matches.append(empty("没有匹配的知识点"));
  });
  select(null);
}

export function notes(content) {
  content.append(hero("我的笔记"));
  if (!state.student) {
    content.append(empty("请选择学生后再记录笔记。"));
    return;
  }
  const key = "zhixu-local-notes:" + state.student,
    p = panel("学习笔记"),
    input = el("textarea", "notes-editor");
  input.setAttribute("aria-label", "学习笔记");
  input.placeholder = "记录解题思路、尚不理解的地方，或下一次想复查的内容…";
  const status = el("p", "small muted", "本机保存");
  try {
    input.value = localStorage.getItem(key) || "";
  } catch {
    status.textContent = "当前浏览器存储不可用。";
  }
  p.append(
    input,
    button(
      "保存笔记",
      () => {
        try {
          localStorage.setItem(key, input.value);
          status.textContent = "已保存到当前浏览器。";
        } catch {
          status.textContent = "保存失败，浏览器存储不可用，请先复制笔记内容。";
        }
      },
      "primary",
    ),
    status,
  );
  content.append(p);
}
export function placeholder(content) {
  const copy = {
    reading: [
      "课程资料",
      "暂未接入课程资料库。",
      "已有题目与作答可在练习和复习页面查看。",
    ],
    chat: [
      "智能助教",
      "问答服务尚未接入。",
      "当前页面不生成预设回答，也不会调用模型。",
    ],
    quality: [
      "教学质量",
      "暂无真实新题学习效果数据。",
      "已有工程验证和模型审核不能代替教学效果。",
    ],
    experiments: [
      "研究验证",
      "研究实验尚未接入此工作空间。",
      "独立实验材料保留在本地；旧固定案例和 skills 展示已移除。",
    ],
    settings: [
      "系统配置",
      "当前使用本地已有配置。",
      "模型任务沿用后端预算与确认机制。此页面不展示或修改密钥。",
    ],
  }[state.page] || [names[state.page], "暂未接入", ""];
  content.append(hero(copy[0]), empty(copy[1]));
}
