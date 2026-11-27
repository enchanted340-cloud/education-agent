import { state } from "../state.js";
import { startTask, navigate } from "../router.js";
import {
  el,
  button,
  hero,
  panel,
  empty,
  tag,
  openDetail,
  conceptName,
  conceptGroups,
  conceptGroup,
} from "../ui.js";

export function showEvidence(record, observations = []) {
  const nodes = [
    el("p", "muted small", `${record.problem_id} · ${record.record_id}`),
    el("h3", "", "原始题目"),
    el("p", "question-body", record.question),
    el("h3", "", "原始作答"),
    el("pre", "code-block", record.program),
  ];
  if (record.source)
    nodes.push(
      el(
        "p",
        "muted small",
        `来源：${record.source.file || "未记录"} · 原始索引 ${record.source.index ?? "未记录"} · ${record.split || "未记录划分"}`,
      ),
    );
  if (record.execution_verification) {
    const details = el("details");
    details.append(
      el("summary", "", "运行结果"),
      el("pre", "", JSON.stringify(record.execution_verification, null, 2)),
    );
    nodes.push(details);
  } else nodes.push(el("p", "note", "运行结果：无记录"));
  nodes.push(el("h3", "", "模型分析"));
  for (const o of observations) {
    const p = panel(
      conceptName(state.data.catalog.concepts?.[o.concept_id] || o.concept_id),
    );
    p.append(
      tag(o.status),
      el("p", "", o.description),
      el("p", "small muted", "模型推断 · " + (o.model_id || "模型未记录")),
    );
    nodes.push(p);
  }
  openDetail("原始作答与分析", nodes);
}
export function showConcept(row) {
  const nodes = [
    el(
      "div",
      "drawer-context",
      `${state.student.replace("java_", "")} · ${row.evidence.length} 份作答 · ${row.observations.length} 条分析`,
    ),
    el("h3", "small muted", "综合评价 · 模型分析"),
    el("p", "", row.summary?.evaluation || "此知识点暂无汇总。"),
    el("h3", "", "相关作答分析"),
  ];
  for (const o of row.observations) {
    const p = panel();
    p.append(
      tag(o.status),
      el("p", "", o.description),
      el("p", "small muted", "模型推断 · " + (o.model_id || "未记录")),
    );
    const e = row.evidence.find((x) => x.record_id === o.evidence_id);
    p.append(
      e
        ? button(
            "查看原始作答 · " + e.problem_id,
            () => showEvidence(e, [o]),
            "text-link",
          )
        : empty("该条判断的证据引用未找到。"),
    );
    nodes.push(p);
  }
  if (!row.observations.length) nodes.push(empty("暂无作答分析"));
  openDetail(conceptName(row.name), nodes, "profile-drawer");
}
export function profiles(content) {
  const m = state.model;
  content.append(hero(state.page === "twin" ? "学生画像" : "学习画像"));
  const actions = el("div", "actions");
  actions.append(
    button(
      "更新画像",
      () => startTask("update", { base_profile: state.selectedProfile }),
      "primary",
    ),
    button("建立画像", () => startTask("profile"), "secondary"),
    button("查看任务", () => navigate("tasks"), "quiet"),
  );
  content.append(actions);
  if (!m.profile) {
    content.append(empty("当前学生暂无可用画像"));
    return;
  }
  const observed = m.conceptRows.filter((r) => r.observations.length),
    issues = m.conceptRows.filter((r) =>
      r.observations.some((o) => o.status === "Bad"),
    );
  const overview = el("section", "profile-overview"),
    identity = el("div", "profile-identity"),
    avatar = el(
      "span",
      "profile-avatar",
      state.student.replace("java_u", "").slice(-2),
    );
  const who = el("div");
  who.append(
    el("div", "eyebrow", "LEARNING PROFILE"),
    el("h2", "", state.student.replace("java_", "")),
    el("p", "muted small", m.profileItem?.label || "当前画像"),
  );
  identity.append(avatar, who);
  overview.append(identity);
  for (const [value, label] of [
    [m.profile.evidence.length, "历史作答"],
    [`${observed.length} / ${m.conceptRows.length}`, "有观察的知识点"],
    [m.profile.observations?.length || 0, "模型分析记录"],
  ]) {
    const stat = el("div", "profile-stat");
    stat.append(el("strong", "", value), el("span", "", label));
    overview.append(stat);
  }
  content.append(overview);
  const toolbar = el("div", "matrix-toolbar"),
    filters = el("div", "matrix-filters"),
    search = el("input");
  search.type = "search";
  search.placeholder = "搜索知识点";
  search.setAttribute("aria-label", "搜索知识点");
  let filter = "all";
  const choices = [
    ["all", "全部", m.conceptRows.length],
    ["problems", "有问题表现", issues.length],
    [
      "unknown",
      "证据不足",
      m.conceptRows.filter((r) =>
        r.observations.some((o) => o.status === "Unknown"),
      ).length,
    ],
    ["unobserved", "暂无观察", m.conceptRows.length - observed.length],
  ];
  for (const [id, label, n] of choices) {
    const b = button(
      `${label} ${n}`,
      () => {
        filter = id;
        draw();
      },
      "matrix-filter",
    );
    b.dataset.filter = id;
    filters.append(b);
  }
  toolbar.append(filters, search);
  content.append(toolbar);
  const groups = el("div", "profile-groups");
  content.append(groups);
  function draw() {
    groups.replaceChildren();
    for (const b of filters.children)
      b.setAttribute("aria-pressed", String(b.dataset.filter === filter));
    const query = search.value.trim().toLowerCase(),
      rows = m.conceptRows.filter(
        (r) =>
          (r.name + " " + r.id).toLowerCase().includes(query) &&
          (filter === "all" ||
            (filter === "problems" &&
              r.observations.some((o) => o.status === "Bad")) ||
            (filter === "unknown" &&
              r.observations.some((o) => o.status === "Unknown")) ||
            (filter === "unobserved" && !r.observations.length)),
      );
    conceptGroups.forEach((group, index) => {
      const members = rows.filter((r) => conceptGroup(r.id) === index);
      if (!members.length) return;
      const section = el("section", `matrix-group tone-${group.tone}`),
        head = el("div", "matrix-group-heading");
      head.append(
        el("span", "group-symbol", group.symbol),
        el("h2", "", group.name),
        el("span", "muted small", `${members.length} 个知识点`),
      );
      const grid = el("div", "profile-matrix");
      for (const row of members) {
        const card = button("", () => showConcept(row), "profile-card");
        card.setAttribute("aria-label", `查看${conceptName(row.name)}的画像`);
        const top = el("div", "between");
        top.append(
          el("span", "card-category", group.symbol),
          el("span", "card-open", "↗"),
        );
        card.append(top, el("h3", "", conceptName(row.name)));
        const badges = el("div", "observation-badges");
        for (const [status, label, cls] of [
          ["Bad", "有问题表现", "issue"],
          ["Good", "正面表现", "positive"],
          ["Unknown", "证据不足", "uncertain"],
        ]) {
          const count = row.observations.filter(
            (o) => o.status === status,
          ).length;
          if (count)
            badges.append(
              el("span", `observation-badge ${cls}`, `${label} ${count}`),
            );
        }
        if (!row.observations.length)
          badges.append(el("span", "observation-badge neutral", "暂无观察"));
        card.append(badges);
        const foot = el("div", "card-evidence");
        foot.append(
          el("span", "", `${row.evidence.length} 份作答`),
          el(
            "span",
            "",
            row.missingSummary && row.observations.length
              ? "汇总缺测"
              : `${row.observations.length} 条分析`,
          ),
        );
        card.append(foot);
        grid.append(card);
      }
      section.append(head, grid);
      groups.append(section);
    });
    if (!rows.length) groups.append(empty("没有匹配的知识点"));
  }
  search.addEventListener("input", draw);
  draw();
}

export function review(content) {
  const p = state.model.profile;
  content.append(hero("历史作答"));
  if (!p) {
    content.append(empty("当前学生暂无历史作答。"));
    return;
  }
  const toolbar = el("div", "toolbar"),
    search = el("input"),
    filter = el("select");
  search.type = "search";
  search.placeholder = "搜索题号或题目内容";
  search.setAttribute("aria-label", "搜索历史作答");
  filter.setAttribute("aria-label", "作答筛选");
  filter.append(
    new Option("全部历史作答", "all"),
    new Option("含问题表现的作答", "bad"),
  );
  toolbar.append(search, filter);
  content.append(toolbar);
  const list = panel();
  content.append(list);
  function draw() {
    list.replaceChildren();
    let count = 0;
    for (const record of p.evidence) {
      const obs = (p.observations || []).filter(
        (o) => o.evidence_id === record.record_id,
      );
      if (filter.value === "bad" && !obs.some((o) => o.status === "Bad"))
        continue;
      if (
        !(record.problem_id + " " + record.question)
          .toLowerCase()
          .includes(search.value.trim().toLowerCase())
      )
        continue;
      count++;
      const row = el("article", "evidence-row"),
        copy = el("div");
      copy.append(
        el("h3", "", record.problem_id),
        el("p", "clamp-two muted", record.question),
        el(
          "span",
          "small muted",
          `${obs.length} 条模型判断 · ${record.execution_verification ? "附运行观测" : "未附运行观测"}`,
        ),
      );
      row.append(
        copy,
        button("查看作答 →", () => showEvidence(record, obs), "secondary"),
      );
      list.append(row);
    }
    if (!count) list.append(empty("没有匹配的历史记录。"));
  }
  search.addEventListener("input", draw);
  filter.addEventListener("change", draw);
  draw();
}
