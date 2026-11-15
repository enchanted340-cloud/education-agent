import { state } from "../state.js";
import { el, button, hero, panel, empty, tag, conceptName } from "../ui.js";
import { navigate, startTask } from "../router.js";
import { questionVersions, isPublished } from "../learning-data.js";
import { showEvidence } from "./profiles.js";
import { showQuestion } from "./questions.js";

export const shortConcept = (id) =>
  conceptName(state.data.catalog.concepts?.[id] || id);
export function orderedRecommendations(items) {
  const time = (item) => Date.parse(item.data.created_at) || 0;
  return [...items].sort(
    (a, b) => time(b) - time(a) || a.path.localeCompare(b.path),
  );
}
export function linkedGenerations(item, generations) {
  const r = item.data;
  return r.recommendation_id && r.student_id
    ? generations.filter(
        (x) =>
          x.data.student_id === r.student_id &&
          x.data.recommendation_id === r.recommendation_id,
      )
    : [];
}
function recordTime(item) {
  const d = new Date(item.data.created_at);
  return !item.data.created_at || Number.isNaN(d.getTime())
    ? "时间未记录"
    : d.toLocaleString("zh-CN", { hour12: false });
}
function metrics(items) {
  const grid = el("div", "stats-grid");
  for (const [label, value, unit] of items) {
    const c = el("section", "stat panel");
    c.append(
      el("span", "muted", label),
      el("strong", "", value),
      el("small", "muted", unit),
    );
    grid.append(c);
  }
  return grid;
}
export function home(content) {
  const m = state.model;
  content.append(hero("学习概览"));
  if (!m.studentId) {
    content.append(empty("暂无学生数据。请先导入已有数据，再刷新学习空间。"));
    return;
  }
  const rec = orderedRecommendations(m.recommendations).find(
    (x) => x.data.status === "recommended",
  );
  const candidates = m.generations.filter(
    (x) => questionVersions(x.data).length,
  );
  const candidate =
    (rec && linkedGenerations(rec, candidates)[0]) || candidates[0];
  const outer = el("div", "home-grid"),
    left = el("div", "stack"),
    right = el("aside", "stack");
  const banner = el("section", "learning-hero");
  const copy = el("div", "hero-copy");
  copy.append(
    el("div", "eyebrow", "练习题目"),
    el("h2", "", candidate ? "待复核的练习" : "学习画像"),
  );
  copy.append(
    el(
      "p",
      "",
      candidate
        ? questionVersions(candidate.data).at(-1).question.title
        : "选择当前画像，查看知识点表现与原始作答。",
    ),
  );
  const actions = el("div", "actions");
  actions.append(
    button(
      candidate ? "查看候选题目 →" : "查看学习画像 →",
      () => {
        if (candidate) state.selectedGeneration = candidate.path;
        return navigate(candidate ? "practice" : "profiles");
      },
      "primary",
    ),
    button("浏览推荐记录", () => navigate("plan"), "text-link"),
  );
  copy.append(actions);
  const art = el("div", "hero-art");
  art.setAttribute("aria-hidden", "true");
  art.append(
    el("div", "orbit orbit-one"),
    el("div", "orbit orbit-two"),
    el("span", "art-core", "知"),
    el("span", "art-node node-one", "⌘"),
    el("span", "art-node node-two", "</>"),
    el("span", "art-node node-three", "✧"),
  );
  banner.append(copy, art);
  left.append(banner);
  left.append(
    metrics([
      ["当前画像证据", m.profile?.evidence?.length || 0, "份历史作答"],
      ["已有候选题目", candidates.length, "条题目记录"],
      ["已接收新题作答", m.submissions.length, "份作答记录"],
    ]),
  );
  const course = panel("我的学习记录"),
    body = el("div", "course-card"),
    cover = el("div", "course-cover");
  cover.append(
    el("small", "", "JAVA"),
    el("strong", "", "</>"),
    el("small", "", "PROGRAMMING"),
  );
  const info = el("div");
  info.append(
    el("span", "tag unknown", "Java_5 原型"),
    el("h3", "", "Java 程序设计"),
    el("p", "muted", "保留每次作答及其分析，让画像结论可以回到具体证据。"),
    button("浏览历史作答 →", () => navigate("review"), "text-link"),
  );
  body.append(cover, info);
  course.append(body);
  left.append(course);
  if (rec) {
    const why = panel("近期推荐");
    why.append(
      el(
        "div",
        "target-tags",
        rec.data.decision.concept_ids.map(shortConcept).join(" / "),
      ),
      el("p", "clamp-three", rec.data.decision.reason),
      button(
        "查看这条推荐 →",
        () => {
          state.recommendationSelections.set(state.student, rec.path);
          return navigate("plan");
        },
        "text-link",
      ),
    );
    left.append(why);
  }
  const target = panel("题目状态");
  target.append(
    el("div", "status-symbol", "◎"),
    el(
      "h3",
      "center",
      candidates.some((x) => isPublished(x.data))
        ? "有可用练习"
        : candidates.length
          ? "待复核"
          : "暂无题目",
    ),
    el("p", "muted center", `${candidates.length} 条候选题目记录`),
    button("查看题目与状态", () => navigate("practice"), "secondary full"),
  );
  right.append(target);
  const path = panel("快捷入口");
  [
    ["01", "查看知识点表现", "从当前画像了解已有观察", "profiles"],
    ["02", "理解推荐目标", "查看理由与引用作答", "plan"],
    ["03", "预览练习内容", "题面、样例与题目状态", "practice"],
    ["04", "回看已有作答", "问题、判断和原始代码", "review"],
  ].forEach(([n, title, desc, page]) => {
    const b = button("", () => navigate(page), "path-item");
    const c = el("span");
    c.append(el("strong", "", title), el("small", "", desc));
    b.append(el("span", "step", n), c, el("span", "", "›"));
    path.append(b);
  });
  right.append(path);
  const source = panel("当前参考画像");
  source.append(
    el("p", "small", m.profileItem?.label || "暂无画像"),
    el(
      "p",
      "muted small",
      `${m.profile?.evidence?.length || 0} 份作答 · ${m.profile?.observations?.length || 0} 条分析`,
    ),
  );
  right.append(source);
  outer.append(left, right);
  content.append(outer);
}
export function plan(content) {
  content.append(hero("推荐记录"));
  const actions = el("div", "actions");
  actions.append(
    button("新建推荐", () => startTask("recommend"), "primary"),
    button("查看任务", () => navigate("tasks"), "secondary"),
  );
  content.append(actions);
  const rows = orderedRecommendations(state.model.recommendations);
  if (!rows.length) {
    content.append(empty("当前学生尚无保存的推荐。可由管理员发起目标推荐。"));
    return;
  }
  const layout = el("div", "record-workspace"),
    rail = panel("历史推荐"),
    detail = el("section", "record-detail stack");
  detail.setAttribute("aria-label", "推荐详情");
  const search = el("input"),
    filter = el("select"),
    list = el("div", "record-list");
  search.type = "search";
  search.placeholder = "搜索知识点或记录";
  search.setAttribute("aria-label", "搜索推荐记录");
  filter.setAttribute("aria-label", "推荐结果筛选");
  for (const [value, title] of [
    ["all", "全部结果"],
    ["recommended", "已推荐"],
    ["other", "未形成推荐"],
  ])
    filter.append(new Option(title, value));
  const count = el("p", "small muted");
  rail.append(search, filter, count, list);
  layout.append(rail, detail);
  content.append(layout);
  let selected =
    state.recommendationSelections.get(state.student) || rows[0].path;
  function drawDetail(item) {
    const r = item.data,
      d = r.decision || {},
      request = r.generation_request || {},
      related = linkedGenerations(item, state.model.generations);
    detail.replaceChildren();
    detail.append(
      button(
        "← 返回推荐记录",
        () => {
          layout.classList.remove("detail-open");
          list.querySelector('[aria-pressed="true"]')?.focus();
        },
        "secondary record-back",
      ),
    );
    const heading = panel(),
      line = el("div", "between");
    line.append(el("h2", "", recordTime(item)), tag(r.status));
    heading.append(
      line,
      el("p", "record-name", item.label),
      el("h3", "", "推荐目标"),
    );
    const targets = el("div", "target-chips");
    for (const id of d.concept_ids || [])
      targets.append(el("span", "target-chip", shortConcept(id)));
    heading.append(targets);
    if (!targets.childElementCount) heading.append(empty("未形成练习目标"));
    detail.append(heading);
    if (r.status === "recommended") {
      const actions = el("div", "recommendation-actions");
      actions.append(
        button(
          "按此推荐出题",
          () => startTask("generate", { recommendation_run: item.path }),
          "primary",
        ),
      );
      heading.append(actions);
    }
    const reason = panel("推荐理由");
    reason.append(
      el("p", "", d.reason || r.error?.message || "未记录推荐理由"),
    );
    if (d.uncertainties?.length) {
      const fold = el("details");
      fold.append(
        el("summary", "", "需要进一步确认"),
        el(
          "p",
          "",
          Array.isArray(d.uncertainties)
            ? d.uncertainties.join("；")
            : d.uncertainties,
        ),
      );
      reason.append(fold);
    }
    detail.append(reason);
    const evidence = panel(`依据作答 · ${(d.evidence_ids || []).length} 份`);
    for (const id of d.evidence_ids || []) {
      const e = request.evidence?.find((x) => x.record_id === id),
        row = el("div", "row"),
        copy = el("div");
      copy.append(el("strong", "", e?.problem_id || id));
      if (e) copy.append(el("p", "clamp-two muted", e.question));
      row.append(copy);
      if (e)
        row.append(
          button(
            "查看作答",
            () =>
              showEvidence(
                e,
                Object.values(request.concept_context || {})
                  .flatMap((x) => x.observations || [])
                  .filter((o) => o.evidence_id === id),
              ),
            "secondary",
          ),
        );
      else row.append(el("span", "muted small", "正文未保存"));
      evidence.append(row);
    }
    if (!(d.evidence_ids || []).length)
      evidence.append(empty("未引用具体作答"));
    detail.append(evidence);
    const questions = panel(`关联练习 · ${related.length} 条生成记录`);
    for (const item of related) {
      const row = el("div", "row");
      row.append(
        button(
          questionVersions(item.data).at(-1)?.question.title || "未形成题目",
          () => showQuestion(item),
          "text-link",
        ),
        tag(item.data.status),
      );
      questions.append(row);
    }
    if (!related.length) questions.append(empty("暂无关联练习"));
    detail.append(questions);
    const source = el("details", "panel");
    source.append(el("summary", "", "推荐来源"));
    const ps = r.profile_source || request.profile_source;
    source.append(
      el("p", "small", `知识目录：${r.catalog_version || "未记录"}`),
      el("p", "small", `画像模型：${ps?.model_id || "未记录"}`),
      el("p", "small", `画像状态：${ps?.status || "未记录"}`),
      el(
        "p",
        "mono small muted",
        `推荐编号：${r.recommendation_id || "未记录"}`,
      ),
      el("p", "mono small muted", item.path),
    );
    detail.append(source);
  }
  function draw() {
    const query = search.value.trim().toLowerCase(),
      visible = rows.filter(
        (x) =>
          (
            x.label +
            " " +
            (x.data.decision?.concept_ids || []).map(shortConcept).join(" ")
          )
            .toLowerCase()
            .includes(query) &&
          (filter.value === "all" ||
            (filter.value === "recommended") ===
              (x.data.status === "recommended")),
      );
    list.replaceChildren();
    count.textContent = `${visible.length} / ${rows.length} 条记录`;
    if (!visible.length) {
      list.append(empty("没有匹配记录"));
      detail.replaceChildren(empty("请选择其他筛选条件"));
      return;
    }
    if (!visible.some((x) => x.path === selected)) selected = visible[0].path;
    state.recommendationSelections.set(state.student, selected);
    for (const item of visible) {
      const b = button(
        "",
        () => {
          selected = item.path;
          draw();
          layout.classList.add("detail-open");
          detail.scrollIntoView({ block: "start" });
        },
        "record-option",
      );
      b.setAttribute("aria-pressed", String(item.path === selected));
      b.append(
        el("span", "small", recordTime(item)),
        el(
          "strong",
          "",
          (item.data.decision?.concept_ids || [])
            .map(shortConcept)
            .join(" · ") || "未形成推荐",
        ),
        el("span", "record-name small", item.label),
      );
      const meta = el("span", "between");
      meta.append(
        tag(item.data.status),
        el(
          "span",
          "small",
          `${linkedGenerations(item, state.model.generations).length} 条生成记录`,
        ),
      );
      b.append(meta);
      list.append(b);
    }
    drawDetail(visible.find((x) => x.path === selected));
  }
  search.addEventListener("input", draw);
  filter.addEventListener("change", draw);
  draw();
}
export function admin(content) {
  const m = state.model;
  content.append(hero("管理概览"));
  const welcome = el("section", "admin-banner"),
    copy = el("div");
  copy.append(
    el("span", "eyebrow", "STUDENT WORKSPACE"),
    el(
      "h2",
      "",
      state.student
        ? `学生 ${state.student.replace("java_", "")}`
        : "请选择学生",
    ),
    el(
      "p",
      "muted",
      m.profileItem
        ? `${m.profile?.evidence.length || 0} 份历史作答 · 当前参考画像 ${m.profileItem.label}`
        : "暂无可用画像",
    ),
  );
  welcome.append(
    copy,
    button("查看学生画像 →", () => navigate("twin"), "secondary"),
  );
  content.append(welcome);
  const numbers = el("div", "admin-metrics");
  for (const [value, title, page] of [
    [m.profiles.length, "画像记录", "twin"],
    [m.recommendations.length, "推荐记录", "recommendations"],
    [m.generations.length, "生成记录", "questions"],
    [m.submissions.length, "已接收作答", "submissions"],
  ]) {
    const b = button("", () => navigate(page), "admin-metric");
    b.append(
      el("span", "muted", title),
      el("strong", "", value),
      el("span", "metric-arrow", "↗"),
    );
    numbers.append(b);
  }
  content.append(numbers);
  const actions = el("div", "admin-workflow");
  for (const [n, title, description, primary, run, secondary, page] of [
    [
      "01",
      "准备练习",
      "从当前画像确定目标，或直接指定知识点。",
      "新建推荐",
      () => startTask("recommend"),
      "查看推荐",
      "recommendations",
    ],
    [
      "02",
      "管理题目",
      "查看题面、生成状态和对应作答。",
      "指定目标出题",
      () => startTask("generate"),
      "查看题目",
      "questions",
    ],
    [
      "03",
      "接收与更新",
      "录入实际作答，选择证据更新画像。",
      "录入作答",
      () => startTask("submit"),
      "查看作答",
      "submissions",
    ],
  ]) {
    const card = panel();
    card.classList.add("workflow-card");
    card.append(
      el("span", "workflow-index", n),
      el("h2", "", title),
      el("p", "muted", description),
    );
    const controls = el("div", "actions");
    controls.append(
      button(primary, run, "primary"),
      button(secondary, () => navigate(page), "text-link"),
    );
    card.append(controls);
    actions.append(card);
  }
  content.append(actions);
  const bottom = el("div", "admin-bottom"),
    results = panel("题目记录"),
    tools = panel("工作入口");
  const items = [...m.generations].sort(
    (a, b) =>
      (Date.parse(b.data.created_at) || 0) -
      (Date.parse(a.data.created_at) || 0),
  );
  for (const item of items.slice(0, 5)) {
    const q = questionVersions(item.data).at(-1)?.question,
      row = el("div", "row"),
      text = el("div");
    text.append(
      button(q?.title || "未形成题目", () => showQuestion(item), "text-link"),
      el("small", "", item.label),
    );
    row.append(text, tag(item.data.status));
    results.append(row);
  }
  if (!items.length) results.append(empty("暂无生成记录"));
  results.append(
    button("全部题目 →", () => navigate("questions"), "text-link"),
  );
  for (const [title, desc, action] of [
    [
      "更新学生画像",
      "选择基线画像和新增作答",
      () => startTask("update", { base_profile: state.selectedProfile }),
    ],
    ["查看任务状态", "执行记录、日志与保存结果", () => navigate("tasks")],
  ]) {
    const b = button("", action, "workspace-link");
    const text = el("div");
    text.append(el("strong", "", title), el("small", "muted", desc));
    b.append(text, el("span", "", "→"));
    tools.append(b);
  }
  bottom.append(results, tools);
  content.append(bottom);
}
