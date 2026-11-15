import { state } from "../state.js";
import { el, tag, hero, panel, empty, openDetail, button } from "../ui.js";
import { dimensions } from "../labels.js";
import { artifact } from "../api.js";
import { questionVersions } from "../learning-data.js";
import { startTask, render } from "../router.js";

function questionBody(q) {
  const nodes = [];
  for (const [label, key] of [
    ["题目要求", "statement"],
    ["输入格式", "input_format"],
    ["输出格式", "output_format"],
    ["约束与边界", "constraints"],
  ])
    if (q[key])
      nodes.push(el("h3", "", label), el("p", "question-body", q[key]));
  (q.samples || []).forEach((s, i) => {
    const sample = el("div", "sample-grid"),
      a = panel("输入"),
      b = panel("输出");
    a.append(el("pre", "", s.input));
    b.append(el("pre", "", s.output));
    sample.append(a, b);
    nodes.push(
      el("h3", "", `样例 ${i + 1}`),
      sample,
      el("p", "small muted", s.explanation),
    );
  });
  return nodes;
}
export async function showQuestion(item) {
  const epoch = state.epoch,
    g = item.data || (await artifact(item.path));
  if (epoch !== state.epoch) return;
  const versions = questionVersions(g),
    wrap = el("div");
  if (!versions.length) {
    openDetail("生成任务记录", [
      tag(g.status),
      empty(
        g.status === "needs_split"
          ? "目标需要拆分，尚未形成题目。"
          : "此任务没有可用题目版本。",
      ),
      el("p", "small muted", g.error?.message || ""),
    ]);
    return;
  }
  const select = el("select");
  select.setAttribute("aria-label", "题目版本");
  versions.forEach((v, i) =>
    select.append(
      new Option(
        `版本 ${v.version}${i === versions.length - 1 ? " · 最后保存版本" : ""}`,
        String(i),
      ),
    ),
  );
  select.value = String(versions.length - 1);
  const body = el("div");
  const history = el("details");
  history.append(el("summary", "", "历史版本"), select);
  wrap.append(body, history);
  function draw() {
    const v = versions[Number(select.value)],
      q = v.question;
    body.replaceChildren(
      tag(g.status),
      el("h2", "question-title", q.title),
      ...questionBody(q),
    );
    const checks = el("div", "review-grid");
    for (const c of v.review?.checks || []) {
      const box = panel(dimensions[c.dimension] || c.dimension);
      box.append(
        tag(c.status),
        el("p", "", c.reason),
        el("p", "small muted", c.location),
      );
      checks.append(box);
    }
    const review = el("details");
    review.append(el("summary", "", "生成检查"), checks);
    if (!v.review) review.append(empty("此版本尚无审核结果。"));
    body.append(review);
    const reference = el("details");
    reference.append(
      el("summary", "", "参考代码与解析"),
      el("pre", "code-block", q.reference_code),
      el("p", "question-body", q.explanation),
    );
    body.append(reference);
    const identity = el("details");
    identity.append(
      el("summary", "", "题目记录信息"),
      el(
        "p",
        "mono small muted",
        `题号 ${g.question_id}\n版本哈希 ${v.question_sha256}`,
      ),
    );
    body.append(identity);
    if (g.execution_status === "completed" && g.status === "needs_review") {
      const receive = button(
        "录入作答",
        () => startTask("submit", { generation_run: item.path }),
        "primary",
      );
      receive.disabled = Number(select.value) !== versions.length - 1;
      if (receive.disabled) receive.title = "请切换到最后保存版本后录入作答";
      body.append(receive);
    }
  }
  select.addEventListener("change", draw);
  draw();
  openDetail("题目详情", [wrap]);
}
export function questions(content) {
  content.append(hero("题目管理"));
  const toolbar = el("div", "management-toolbar"),
    search = el("input"),
    filter = el("select");
  search.type = "search";
  search.placeholder = "搜索题目或记录";
  search.setAttribute("aria-label", "搜索题目");
  filter.setAttribute("aria-label", "题目状态筛选");
  filter.append(new Option("全部状态", "all"));
  for (const status of new Set(
    state.model.generations.map((x) => x.data.status),
  ))
    filter.append(new Option(tag(status).textContent, status));
  const inputs = el("div", "management-filters");
  inputs.append(search, filter);
  toolbar.append(
    inputs,
    button("指定目标出题", () => startTask("generate"), "primary"),
  );
  content.append(toolbar);
  const list = panel(),
    count = el("p", "muted small");
  list.classList.add("management-list");
  content.append(count, list);
  function draw() {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    let total = 0;
    for (const item of state.model.generations) {
      const g = item.data,
        q = questionVersions(g).at(-1)?.question;
      if (filter.value !== "all" && g.status !== filter.value) continue;
      if (!(item.label + " " + (q?.title || "")).toLowerCase().includes(query))
        continue;
      total++;
      const row = el("article", "management-row"),
        main = el("div", "management-copy");
      main.append(
        el("h3", "", q?.title || "未形成题目"),
        el(
          "p",
          "clamp-two muted small",
          q?.statement || g.error?.message || "生成结果未包含可用题目",
        ),
        el("small", "record-name", item.label),
      );
      const targets = el("div", "mini-targets");
      for (const c of q?.coverage || [])
        targets.append(
          el(
            "span",
            "",
            String(
              state.data.catalog.concepts[c.concept_id] || c.concept_id,
            ).split("：")[0],
          ),
        );
      main.append(targets);
      const controls = el("div", "management-controls");
      controls.append(
        tag(g.status),
        button("查看题目", () => showQuestion(item), "secondary"),
      );
      if (
        g.execution_status === "completed" &&
        g.status === "needs_review" &&
        q
      )
        controls.append(
          button(
            "录入作答",
            () => startTask("submit", { generation_run: item.path }),
            "text-link",
          ),
        );
      row.append(main, controls);
      list.append(row);
    }
    count.textContent = `${total} 条生成记录`;
    if (!total) list.append(empty("没有匹配的题目记录"));
  }
  search.addEventListener("input", draw);
  filter.addEventListener("change", draw);
  draw();
}
export function submissions(content) {
  content.append(hero("作答记录"));
  const toolbar = el("div", "management-toolbar"),
    search = el("input");
  search.type = "search";
  search.placeholder = "搜索题号或提交编号";
  search.setAttribute("aria-label", "搜索作答");
  toolbar.append(
    search,
    button("录入作答", () => startTask("submit"), "primary"),
  );
  content.append(toolbar);
  const list = panel();
  list.classList.add("management-list");
  content.append(list);
  function draw() {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    let count = 0;
    for (const item of state.model.submissions) {
      const receipt = item.data,
        e = receipt.evidence || {},
        answer = receipt.packet?.answer || {};
      if (
        !(e.problem_id + " " + answer.submission_id + " " + item.label)
          .toLowerCase()
          .includes(query)
      )
        continue;
      count++;
      const row = el("article", "management-row"),
        main = el("div", "management-copy"),
        controls = el("div", "management-controls");
      main.append(
        el("h3", "", e.problem_id || answer.question_id),
        el(
          "p",
          "muted small",
          `提交编号：${answer.submission_id || e.record_id || "未记录"}`,
        ),
        el("small", "record-name", item.label),
      );
      controls.append(
        el("span", "tag good", "已接收"),
        button(
          "查看作答",
          () =>
            openDetail("已接收作答", [
              el("h3", "", e.problem_id || answer.question_id),
              el("p", "question-body", e.question || ""),
              el("pre", "code-block", answer.program || e.program || ""),
              el("p", "muted small", "来源声明：student"),
            ]),
          "secondary",
        ),
        button(
          "用于更新画像",
          () =>
            startTask("update", {
              base_profile: state.selectedProfile,
              submission_run: item.path,
            }),
          "text-link",
        ),
      );
      row.append(main, controls);
      list.append(row);
    }
    if (!count) {
      const blank = el("div", "admin-empty");
      blank.append(
        el("span", "empty-mark", "↳"),
        el("h2", "", query ? "没有匹配的作答" : "暂无已接收作答"),
        el(
          "p",
          "muted",
          query
            ? "试试其他题号或提交编号"
            : "录入学生作答后，可在这里查看并选择更新画像。",
        ),
      );
      if (!query)
        blank.append(
          button("选择题目并录入", () => startTask("submit"), "primary"),
        );
      list.append(blank);
    }
  }
  search.addEventListener("input", draw);
  draw();
}

export function practice(content) {
  const candidates = state.model.generations.filter(
    (x) => questionVersions(x.data).length,
  );
  content.append(hero("练习题目"));
  if (!candidates.length) {
    content.append(
      empty("暂无可预览的候选题。管理员可直接指定目标或根据推荐出题。"),
    );
    return;
  }
  const chosen =
    candidates.find((x) => x.path === state.selectedGeneration) ||
    candidates[0];
  state.selectedGeneration = chosen.path;
  const selector = el("select");
  selector.setAttribute("aria-label", "选择候选题");
  for (const x of candidates)
    selector.append(
      new Option(
        questionVersions(x.data).at(-1).question.title + " · " + x.label,
        x.path,
      ),
    );
  selector.value = chosen.path;
  selector.addEventListener("change", () => {
    state.selectedGeneration = selector.value;
    render();
  });
  content.append(selector);
  const v = questionVersions(chosen.data).at(-1),
    q = v.question,
    grid = el("div", "practice-grid"),
    body = panel(),
    side = el("aside", "stack");
  body.append(
    tag(chosen.data.status),
    el("h2", "question-title", q.title),
    ...questionBody(q),
  );
  const target = panel("本题练习目标");
  for (const c of q.coverage || []) {
    target.append(
      el(
        "h3",
        "",
        String(
          state.data.catalog.concepts?.[c.concept_id] || c.concept_id,
        ).split("：")[0],
      ),
      el("p", "small muted", c.location),
    );
  }
  side.append(target);
  const received = state.model.submissions.filter(
    (x) =>
      x.data.evidence?.problem_id === chosen.data.question_id &&
      (x.data.packet?.answer?.question_sha256 ||
        x.data.evidence?.submission?.question_sha256) === v.question_sha256,
  );
  const result = panel("收到的作答");
  result.append(
    el(
      "p",
      "muted",
      received.length
        ? `当前版本 · ${received.length} 份作答`
        : "当前版本暂无作答记录",
    ),
  );
  side.append(result);
  grid.append(body, side);
  content.append(grid);
}
