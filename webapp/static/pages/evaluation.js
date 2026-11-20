import { api } from "../api.js";
import { state } from "../state.js";
import { el, empty, hero } from "../ui.js";

const formatScore = (value) => (value == null ? "缺测" : value.toFixed(2));
const percent = (value) => (value == null ? "缺测" : formatScore(value) + "%");

function difference(value) {
  if (value == null) return "缺测";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return sign + formatScore(Math.abs(value)) + " 个百分点";
}

function scoreBar(label, tone, passed, paired, mean) {
  const row = el("div", "evaluation-bar " + tone);
  const heading = el("div", "evaluation-bar-heading");
  heading.append(el("h3", "", label), el("span", "", percent(mean)));
  const meter = el("meter", "evaluation-meter");
  meter.setAttribute("min", "0");
  meter.setAttribute("max", "100");
  meter.setAttribute("value", mean ?? 0);
  meter.setAttribute("aria-hidden", "true");
  const ratio = el(
    "div", "evaluation-ratio", paired ? `${passed} / ${paired}` : "缺测",
  );
  row.append(heading, ratio, meter);
  return row;
}

function diagnostic(label, metric) {
  const item = el("div", "evaluation-diagnostic");
  item.append(
    el("h3", "", label),
    el(
      "strong", "evaluation-figures",
      `${percent(metric.before_mean)} → ${percent(metric.after_mean)}`,
    ),
    el("span", "evaluation-muted", difference(metric.change_pp)),
  );
  return item;
}

function overview(data) {
  const { metrics, paired, total, taskCount, armCount } = data;
  const metric = metrics.primary_score;
  const card = el("section", "evaluation-overview");
  const heading = el("div", "evaluation-overview-heading");
  const copy = el("div");
  copy.append(
    el("h2", "", "未见确定缺陷的题稿比例"),
    el(
      "p", "evaluation-muted",
      `${taskCount} 条 Java 出题请求 · ${armCount} 组 · 完整配对 ${paired} / ${total} · 缺测 ${total - paired}`,
    ),
  );
  const change = el("div", "evaluation-difference");
  change.append(
    el("small", "", "终稿相对首稿"),
    el("strong", "", difference(metric.change_pp)),
  );
  heading.append(copy, change);

  const comparison = el("div", "evaluation-comparison");
  comparison.append(
    scoreBar("首稿", "draft", metric.before_passed, paired, metric.before_mean),
    scoreBar("终稿", "final", metric.after_passed, paired, metric.after_mean),
  );
  const diagnostics = el("div", "evaluation-diagnostics");
  diagnostics.append(
    diagnostic("样例答案正确比例", metrics.sample_accuracy_score),
    diagnostic("样例覆盖条件比例", metrics.coverage_score),
  );
  const improvement = data.improvedTaskCount
    ? `主指标净增 ${metric.after_passed - metric.before_passed} 份，改善涉及 ${data.improvedTaskCount} 条教师请求。`
    : "";
  const note = el(
    "p", "evaluation-muted evaluation-note",
    improvement + "两项诊断指标为配对题稿的均值。学生学习效果缺测。",
  );
  card.append(heading, comparison, diagnostics, note);
  return card;
}

function textBlock(label, text, className = "") {
  const block = el("div", className);
  block.append(el("strong", "evaluation-text-label", label), el("pre", "", text || "未记录"));
  return block;
}

function caseVersion(version) {
  const card = el("section", "evaluation-version");
  const heading = el("div", "evaluation-version-heading");
  heading.append(
    el("h3", "", version.version === 1 ? "首稿" : "修订稿"),
    el("span", "evaluation-status", version.status),
  );
  card.append(heading, textBlock("保存的题面", version.statement));
  const sample = el("section", "evaluation-evidence");
  const numbers = el("div", "evaluation-sample");
  numbers.append(
    textBlock("样例输入", version.sample.input),
    textBlock("题稿输出", version.sample.output),
    textBlock("独立复算输出", version.expected),
  );
  sample.append(el("h4", "", "样例与复算"), numbers);
  if (version.sample.explanation)
    sample.append(textBlock("题稿样例说明", version.sample.explanation, "sample-explanation"));
  const review = el("section", "evaluation-evidence");
  review.append(el("h4", "", "盲评依据"));
  if (version.findings.length) {
    const list = el("ul", "evaluation-findings");
    for (const finding of version.findings) list.append(el("li", "", finding));
    review.append(list);
  } else {
    review.append(el("p", "evaluation-muted", "盲评未记录确定缺陷。"));
  }
  const scores = el(
    "p", "evaluation-scores",
    `主指标 ${formatScore(version.scores.primary_score)} · 样例答案 ${formatScore(version.scores.sample_accuracy_score)} · 覆盖条件 ${formatScore(version.scores.coverage_score)}`,
  );
  card.append(sample, review, scores);
  return card;
}

function examples(cases) {
  const section = el("section", "evaluation-section");
  section.append(el("h2", "", "题稿案例"));
  for (const [index, example] of cases.entries()) {
    const details = el("details", "evaluation-case");
    details.open = index === 0;
    const summary = el("summary");
    const title = el("span", "evaluation-case-title");
    title.append(
      el("strong", "", example.title),
      el("span", "evaluation-muted", example.subtitle),
    );
    summary.append(el("span", "evaluation-case-id", `${example.task} · ${example.arm} 组`), title);
    const body = el("div", "evaluation-case-body");
    const request = el("section", "evaluation-request");
    request.append(el("h3", "", "教师要求"), el("pre", "", example.requirement));
    const versions = el("div", "evaluation-versions");
    versions.append(...example.versions.map(caseVersion));
    body.append(request, versions);
    if (example.task === "H06") {
      body.append(el(
        "p", "evaluation-muted evaluation-note",
        "教师明确要求可任选排序实现。冻结盲评判据还允许等价最优解法。若只按排序实现的自由来理解，题面也可以要求使用贪心。",
      ));
    }
    details.append(summary, body);
    section.append(details);
  }
  return section;
}

function skillRound(label, arm, { included, primary }) {
  const round = el("div", "evaluation-skill-round");
  const heading = el("div", "evaluation-skill-round-heading");
  heading.append(
    el("h4", "", label),
    el("span", "evaluation-muted", `可比题数 ${included}`),
  );
  const comparison = el("dl", "evaluation-skill-values");
  const entries = [
    ["A 正式提示", included ? `${primary.before_passed} / ${included}` : "缺测"],
    [`${arm} 技能`, included ? `${primary.after_passed} / ${included}` : "缺测"],
    ["净差", difference(primary.change_pp)],
  ];
  for (const [key, value] of entries) {
    const item = el("div");
    item.append(el("dt", "", key), el("dd", "evaluation-figures", value));
    comparison.append(item);
  }
  round.append(heading, comparison);
  return round;
}

function skillComparison(skills) {
  const section = el("section", "evaluation-section");
  section.append(el("h2", "", "同题技能对照"));
  const comparisons = el("div", "evaluation-skills");
  const labels = { B: "一次改写技能", C: "历史 WikiSkill" };
  for (const skill of skills) {
    const arm = skill.key.split("-")[0];
    const card = el("div", "evaluation-skill");
    const caption = el("div", "evaluation-skill-caption");
    caption.append(
      el("span", "evaluation-case-id", skill.key),
      el("h3", "", labels[arm] || arm),
    );
    const { improved, regressed, tied } = skill.draftCounts;
    const draft = skillRound("首稿", arm, skill);
    draft.append(el(
      "p", "evaluation-muted evaluation-draft-outcomes",
      `改善 ${improved} · 退步 ${regressed} · 持平 ${tied}`,
    ));
    card.append(caption, draft, skillRound("终稿", arm, skill.final));
    comparisons.append(card);
  }
  section.append(
    el("p", "evaluation-muted", "每项比较只纳入两组都可评的同一教师请求。数字表示未见确定缺陷的题稿数。"),
    comparisons,
    el("p", "evaluation-muted evaluation-note", "若教师允许 H06 限定学生使用贪心解法，B 组终稿与 A 组的差异就会消失。教师本人意见缺测。"),
  );
  return section;
}

export async function evaluation(content, epoch) {
  const data = await api("/api/evaluation");
  if (epoch !== state.epoch) return;
  const heading = hero("实验评测", "阶段 D · Java 题稿静态盲评与样例复算");
  if (!data.available) {
    content.replaceChildren(heading, empty("实验归档未安装，当前没有可展示的评测结果。"));
    return;
  }
  const page = el("div", "evaluation-page");
  page.append(heading, overview(data), examples(data.cases), skillComparison(data.skills));
  content.replaceChildren(page);
}
