import { state } from "../state.js";
import {
  el,
  tag,
  button,
  hero,
  panel,
  openDetail,
  $,
  notice,
  conceptName,
} from "../ui.js";
import { api, artifact } from "../api.js";
import { opNames, labels } from "../labels.js";
import { render, startTask, navigate, load } from "../router.js";
import { pollJob } from "../job-poller.js";
// Form previews remain available when a backend does not advertise an operation.
const formFields = {
  profile: "records student limit max_calls",
  recommend: "profile usage_history student scope goals requirement max_calls",
  generate:
    "recommendation_run profile usage_history student scope targets requirement max_calls",
  submit: "generation_run submission",
  update: "base_profile records submission_run max_calls",
};
const sources = {
  records: "record_files",
  profile: "twin",
  base_profile: "twin",
  usage_history: "usage_files",
  recommendation_run: "recommendations",
  generation_run: "generations",
  submission_run: "submission_runs",
};
export function taskOperations(advertised = []) {
  return Object.entries(formFields).map(([id, fields]) => {
    const connected = advertised.find((x) => x.id === id);
    return {
      ...(connected || {
        id,
        fields: fields.split(" ").map((name) => ({
          name,
          source: sources[name],
          multiple: ["scope", "goals", "targets", "requirement"].includes(name),
        })),
      }),
      connected: Boolean(connected),
    };
  });
}
export function fieldControl(field) {
  const name = field.name,
    label = labels[name] || name;
  const conceptField = ["scope", "targets", "goals"].includes(name);
  const wrap = el(
    conceptField ? "div" : "label",
    "field " +
      (conceptField ||
      ["requirement", "approve_sha256", "record_id"].includes(name)
        ? "wide"
        : ""),
  );
  wrap.append(el("span", "", label));
  let input;
  let picker, syncPicker;
  const source =
    field.source === "profiles"
      ? state.model?.profiles
      : field.source === "recommendations"
        ? state.model?.recommendations
        : state.data[field.source];
  if (["scope", "targets", "goals"].includes(name)) {
    input = el("select");
    input.multiple = true;
    input.hidden = true;
    input.setAttribute("aria-label", label);
    for (const [id, title] of Object.entries(state.data.catalog.concepts || {}))
      input.append(new Option(conceptName(title), id));
    picker = el("div", "concept-picker");
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", label);
    const controls = el("div", "picker-controls"),
      search = el("input"),
      count = el("span", "muted small"),
      options = el("div", "picker-options");
    search.type = "search";
    search.placeholder = "搜索知识点";
    search.setAttribute("aria-label", label + "搜索");
    const changed = () => {
      syncPicker();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    controls.append(
      search,
      count,
      button(
        "清空",
        () => {
          for (const o of input.options) o.selected = false;
          changed();
        },
        "text-link",
      ),
    );
    if (name === "scope")
      controls.append(
        button(
          "全选",
          () => {
            for (const o of input.options) o.selected = true;
            changed();
          },
          "text-link",
        ),
      );
    for (const option of input.options) {
      const row = el("label", "concept-choice"),
        check = el("input");
      check.type = "checkbox";
      check.value = option.value;
      check.addEventListener("change", () => {
        option.selected = check.checked;
        changed();
      });
      row.title = state.data.catalog.concepts[option.value];
      row.append(check, el("span", "", option.textContent));
      options.append(row);
    }
    syncPicker = () => {
      count.textContent = `已选 ${input.selectedOptions.length}`;
      for (const check of options.querySelectorAll("input"))
        check.checked = [...input.selectedOptions].some(
          (o) => o.value === check.value,
        );
    };
    search.addEventListener("input", () => {
      for (const row of options.children)
        row.hidden = !row.textContent.includes(search.value.trim());
    });
    picker.append(controls, options);
  } else if (source) {
    input = el("select");
    input.multiple = field.multiple;
    if (!field.multiple) input.append(new Option("不指定 / 选择记录", ""));
    for (const item of source.filter(
      (v) =>
        (!state.student ||
          v.student_id === state.student ||
          (name === "records" && v.student_ids?.includes(state.student))) &&
        (name !== "verification_run" || v.verification_kind === "student") &&
        (name !== "submission_run" || v.learning_evidence_eligible === true),
    ))
      input.append(
        new Option(
          item.label + " — " + (item.student_id || item.path),
          item.path,
        ),
      );
  } else if (field.multiple) {
    input = el("textarea");
    input.placeholder = "每行一项";
  } else {
    input = el("input");
    input.type = ["limit", "max_calls"].includes(name) ? "number" : "text";
    if (name === "student") input.value = state.student;
    input.placeholder =
      name === "cases"
        ? "例如 artifacts/student-java-20261030/cases.json"
        : name === "submission"
          ? "仓库内作答 JSON 的相对路径"
          : name === "catalog" || name === "concepts"
            ? "默认 config/java-basics.json"
            : "";
  }
  input.name = name;
  const preset =
    state.taskFields[name] ??
    (["profile", "base_profile"].includes(name) &&
    !state.taskFields.recommendation_run
      ? state.selectedProfile
      : name === "max_calls"
        ? String({ recommend: 2, generate: 8 }[state.operation] || 12)
        : undefined);
  if (name === "max_calls") {
    input.min = "1";
    input.max = String({ recommend: 2, generate: 8 }[state.operation] || 12);
  }
  if (preset !== undefined) {
    if (input.multiple)
      for (const option of input.options)
        option.selected = preset.includes(option.value);
    else input.value = Array.isArray(preset) ? preset.join("\n") : preset;
  }
  if (name === "student") input.readOnly = true;
  input.dataset.multiple = String(field.multiple);
  wrap.append(input);
  if (picker) {
    syncPicker();
    wrap.append(picker);
  }
  if (input.multiple && !picker)
    wrap.append(el("small", "", "可按 Ctrl / Command 多选；留空表示不指定。"));
  return wrap;
}

export function fieldsFrom(form) {
  const fields = {};
  for (const node of form.elements) {
    if (!node.name || node.name === "confirm") continue;
    let value;
    if (node.dataset.multiple === "true") {
      value =
        node.tagName === "SELECT"
          ? [...node.selectedOptions].map((o) => o.value)
          : node.value
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean);
    } else value = node.value.trim();
    if (value.length) fields[node.name] = value;
  }
  if (fields.recommendation_run)
    for (const name of [
      "student",
      "profile",
      "usage_history",
      "scope",
      "targets",
      "requirement",
    ])
      delete fields[name];
  return fields;
}

export async function tasks(content) {
  if (state.page === "tasks") return taskHistory(content);
  const epoch = state.epoch;
  content.append(hero("创建任务"));
  const context = el("div", "task-context");
  context.append(
    el(
      "span",
      "",
      `当前学生：${state.student.replace("java_", "") || "未选择"}`,
    ),
    button("查看全部任务 →", () => navigate("tasks"), "text-link"),
  );
  content.append(context);
  const choices = el("div", "choices operation-switch");
  const operations = taskOperations(state.data.operations);
  for (const op of operations)
    choices.append(
      button(
        opNames[op.id] || op.id,
        () => {
          state.operation = op.id;
          state.taskFields = {};
          state.preview = null;
          return render();
        },
        state.operation === op.id ? "active" : "",
      ),
    );
  content.append(choices);
  const op = operations.find((o) => o.id === state.operation) || operations[0];
  state.operation = op.id;
  const grid = el("div", "task-grid"),
    p = panel(opNames[op.id]),
    jobsPanel = panel("执行反馈");
  p.append(
    el(
      "span",
      op.connected ? "tag good" : "tag unknown",
      op.connected ? "后端已接入" : "暂未接入服务",
    ),
  );
  const form = el("form");
  form.addEventListener("submit", (e) => e.preventDefault());
  const fields = el("div", "form-grid");
  for (const f of op.fields.filter(
    (f) => !["catalog", "concepts", "verification_run"].includes(f.name),
  ))
    fields.append(fieldControl(f));
  if (op.id === "generate") {
    const sync = () => {
      const handoff = Boolean(
        form.elements.recommendation_run?.value ||
          fields.querySelector('[name="recommendation_run"]').value,
      );
      for (const name of [
        "student",
        "profile",
        "usage_history",
        "scope",
        "targets",
        "requirement",
      ]) {
        const input = fields.querySelector(`[name="${name}"]`);
        input.disabled = handoff;
        input.closest(".field").hidden = handoff;
      }
    };
    fields
      .querySelector('[name="recommendation_run"]')
      .addEventListener("change", sync);
    sync();
  }
  form.append(fields);
  const steps = el("ol", "task-steps");
  for (const label of [
    "填写输入",
    "预览核对",
    op.id === "submit" ? "确认接收" : "确认执行",
  ])
    steps.append(el("li", "", label));
  p.append(steps);
  if (op.id === "generate")
    form.append(
      el("p", "note", "出题方式：选择推荐记录，或填写下方目标与教学要求"),
    );
  if (op.id === "submit") {
    const tools = el("div", "actions");
    const draft = button("填写作答", () => draftAnswer(form));
    draft.disabled = !op.connected;
    tools.append(draft);
    form.append(
      tools,
      el(
        "p",
        "small muted",
        "提交来源默认为 test_fixture。只有实际学生提交才能声明 origin=student；来源声明不是身份认证。",
      ),
    );
  }
  if (op.id.startsWith("verify_"))
    form.append(
      el(
        "p",
        "note",
        "预览会列出源码、用例、工具与批准哈希。逐份审阅后填写批准哈希；本地执行不是文件或网络沙箱。",
      ),
    );
  const confirm = el("label", "confirmation");
  const check = el("input");
  check.type = "checkbox";
  check.name = "confirm";
  confirm.append(
    check,
    document.createTextNode(
      op.id.startsWith("verify_")
        ? "我已逐份审阅源码、独立用例和工具，批准本次确切哈希执行。"
        : op.id === "submit"
          ? "我已核对学生、题目版本和作答来源，确认保存。"
          : "我确认本次输入及请求上限，授权此任务调用配置的付费模型。",
    ),
  );
  form.append(confirm);
  const actions = el("div", "actions");
  const preview = button("1. 预览输入", () => start("preview"), "secondary"),
    execute = button(
      op.id === "submit"
        ? "2. 保存作答"
        : op.id.startsWith("verify_")
          ? "2. 批准并执行"
          : "2. 启动任务",
      () => start(op.id === "submit" ? "save" : "execute"),
      "primary",
    );
  execute.disabled = true;
  preview.disabled = !op.connected;
  check.disabled = !op.connected;
  actions.append(preview, execute);
  form.append(actions);
  p.append(form);
  jobsPanel.append(el("p", "small muted", "执行状态"), el("div", "", ""));
  const list = el("div");
  const jobSelector = el("select");
  jobSelector.setAttribute("aria-label", "本次服务任务");
  jobSelector.hidden = true;
  const jobRecords = new Map();
  let selectedJob = "";
  jobsPanel.append(
    el("p", "small muted", "本次服务启动以来"),
    jobSelector,
    list,
  );
  jobSelector.addEventListener("change", () => {
    selectedJob = jobSelector.value;
    showJob(jobRecords.get(selectedJob));
  });
  grid.append(p, jobsPanel);
  content.append(grid);
  const signature = () => {
    const fields = fieldsFrom(form);
    delete fields.approve_sha256;
    return JSON.stringify(fields);
  };
  let previewSignature = null;
  form.addEventListener("input", () => {
    execute.disabled = !(check.checked && previewSignature === signature());
  });
  form.addEventListener("change", () => {
    execute.disabled = !(check.checked && previewSignature === signature());
  });
  async function start(mode) {
    if (!op.connected) throw Error("暂未接入服务");
    if (
      mode !== "preview" &&
      (!check.checked || previewSignature !== signature())
    )
      throw Error("请先完成相同输入的预览，并明确确认本次操作。");
    preview.disabled = true;
    execute.disabled = true;
    try {
      const fields = fieldsFrom(form);
      const before = signature();
      const result = await api("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          operation: op.id,
          mode,
          fields,
          confirm: mode !== "preview",
        }),
      });
      if (epoch !== state.epoch) return;
      state.job = result.job;
      selectedJob = result.job.id;
      showJob(result.job);
      await poll(
        result.job.id,
        (job) => {
          showJob(job);
          if (job.mode === "preview" && job.status === "succeeded") {
            previewSignature = before;
            execute.disabled = !(check.checked && before === signature());
          }
        },
        epoch,
      );
    } finally {
      preview.disabled = false;
    }
  }
  function showJob(job) {
    jobRecords.set(job.id, job);
    if (!selectedJob) selectedJob = job.id;
    jobSelector.hidden = false;
    jobSelector.replaceChildren(
      ...[...jobRecords.values()].map(
        (x) =>
          new Option(
            `${opNames[x.operation] || x.operation} · ${x.mode === "preview" ? "预览" : x.mode === "save" ? "接收" : "执行"} · ${x.id.slice(0, 8)} · ${tag(x.status).textContent}`,
            x.id,
          ),
      ),
    );
    jobSelector.value = selectedJob;
    if (job.id !== selectedJob) return;
    list.replaceChildren();
    const row = el("div", "row");
    row.append(
      el("strong", "", opNames[job.operation] || job.operation),
      tag(job.status),
    );
    list.append(
      row,
      el("p", "mono small muted", job.output || ""),
      el("pre", "job-log", job.log || "等待本地命令返回…"),
    );
    if (job.error) list.append(el("p", "note", job.error));
    if (job.status === "succeeded" && job.mode !== "preview") {
      const actions = el("div", "actions");
      actions.append(
        button(
          "查看保存结果",
          async () => {
            await load();
            if (job.operation === "submit") {
              const receipt = await artifact(job.output + "/submission.json");
              openDetail("作答接收结果", [
                el(
                  "p",
                  "",
                  `学生：${receipt.evidence?.student_id || receipt.packet?.answer?.student_id || "未记录"}`,
                ),
                el(
                  "p",
                  "",
                  `题目：${receipt.evidence?.problem_id || receipt.packet?.answer?.question_id || "未记录"}`,
                ),
                el(
                  "p",
                  "",
                  `来源：${receipt.packet?.answer?.origin || "未记录"}`,
                ),
                el(
                  "p",
                  "",
                  receipt.learning_evidence_eligible === true
                    ? "可作为画像更新证据"
                    : "不用于真实画像更新",
                ),
              ]);
              return;
            }
            return navigate(
              job.operation === "generate"
                ? "questions"
                : job.operation === "recommend"
                  ? "recommendations"
                  : "twin",
            );
          },
          "secondary",
        ),
      );
      if (job.operation === "submit")
        actions.append(
          button(
            "准备更新画像",
            async () => {
              await load();
              const receipt = await artifact(job.output + "/submission.json");
              if (
                receipt.learning_evidence_eligible !== true ||
                receipt.packet?.answer?.origin !== "student"
              )
                throw Error("该作答不用于真实画像更新。");
              if (receipt.evidence?.student_id !== state.student)
                throw Error("请先切换到该作答所属学生。");
              return startTask("update", {
                base_profile: state.selectedProfile,
                submission_run: job.output + "/submission.json",
              });
            },
            "primary",
          ),
        );
      list.append(actions);
    }
  }
  const jobs = await api("/api/jobs");
  if (epoch !== state.epoch) return;
  if (jobs.jobs.length) {
    for (const job of jobs.jobs) jobRecords.set(job.id, job);
    selectedJob = jobs.jobs[0].id;
    showJob(jobs.jobs[0]);
    for (const job of jobs.jobs.filter((x) =>
      ["queued", "running"].includes(x.status),
    ))
      poll(job.id, showJob, epoch).catch(notice);
  } else
    list.append(el("p", "empty", "暂无任务。预览或执行后可在这里查看状态。"));
}

export async function poll(id, callback, epoch = state.epoch) {
  return pollJob(
    id,
    async (id) => (await api("/api/jobs/" + encodeURIComponent(id))).job,
    (job) => {
      state.job = job;
      callback(job);
    },
    () => epoch === state.epoch,
    () => new Promise((r) => setTimeout(r, 1200)),
  );
}

export async function draftAnswer(form) {
  const epoch = state.epoch;
  const path = form.elements.generation_run.value;
  if (!path) throw Error("请先选择生成题任务。");
  const g = await artifact(path);
  if (epoch !== state.epoch) return;
  const v = g.versions?.at(-1);
  if (!v?.question_sha256) throw Error("该任务没有可绑定的题目版本。");
  const wrap = el("div");
  wrap.append(
    el(
      "p",
      "note",
      "粘贴学生实际代码并填写唯一提交 ID。演示代码必须保留 test_fixture，不会进入真实画像。",
    ),
  );
  const id = el("input");
  id.placeholder = "唯一 submission_id";
  const origin = el("select");
  origin.append(
    new Option("测试示范 test_fixture", "test_fixture"),
    new Option("真实学生来源声明 student", "student"),
  );
  const program = el("textarea");
  program.className = "answer-code";
  program.placeholder = "粘贴 Java 代码原文";
  const status = el("p", "small");
  const fields = el("div", "form-grid");
  for (const [label, node] of [
    ["提交 ID", id],
    ["来源声明", origin],
    ["原始代码", program],
  ]) {
    const l = el("label", "field wide");
    l.append(el("span", "", label), node);
    fields.append(l);
  }
  wrap.append(
    fields,
    status,
    button(
      "保存输入草稿并带入表单",
      async () => {
        if (!id.value.trim() || !program.value.trim())
          throw Error("请填写提交 ID 和代码。");
        const answer = {
          schema: "student-answer-v1",
          submission_id: id.value.trim(),
          student_id: g.student_id,
          question_id: g.question_id,
          question_sha256: v.question_sha256,
          origin: origin.value,
          program: program.value,
          submitted_at: null,
        };
        try {
          const r = await api("/api/submission-draft", {
            method: "POST",
            body: JSON.stringify({ answer }),
          });
          form.elements.submission.value = r.path;
          form.dispatchEvent(new Event("input"));
          $("#detail").close();
        } catch (e) {
          status.textContent = e.message;
        }
      },
      "primary",
    ),
  );
  openDetail("准备作答输入", [wrap]);
}

export async function taskHistory(content) {
  const epoch = state.epoch;
  content.append(hero("任务中心"));
  const toolbar = el("div", "management-toolbar"),
    filter = el("select"),
    controls = el("div", "actions");
  filter.setAttribute("aria-label", "任务状态筛选");
  for (const [id, label] of [
    ["all", "全部任务"],
    ["active", "运行中"],
    ["failed", "失败"],
    ["succeeded", "已完成"],
  ])
    filter.append(new Option(label, id));
  controls.append(
    button("刷新任务", refresh, "secondary"),
    button("创建任务", () => startTask("recommend"), "primary"),
  );
  toolbar.append(filter, controls);
  content.append(toolbar, el("p", "muted small", "本次服务启动以来的任务"));
  const layout = el("div", "task-history-layout"),
    list = el("section", "task-history-list"),
    detail = panel("任务详情");
  layout.append(list, detail);
  content.append(layout);
  const records = new Map();
  let selected = "",
    refreshId = 0;
  const polling = new Set();
  function draw() {
    list.replaceChildren();
    const items = [...records.values()].filter(
      (j) =>
        filter.value === "all" ||
        (filter.value === "active" &&
          ["queued", "running"].includes(j.status)) ||
        j.status === filter.value,
    );
    if (!items.length) {
      list.append(
        el(
          "p",
          "empty",
          records.size
            ? "没有匹配的任务"
            : "暂无任务。创建任务后可在这里查看执行情况。",
        ),
      );
      detail.replaceChildren(
        el("h2", "", "任务详情"),
        el("p", "muted", "选择一条任务查看"),
      );
      return;
    }
    if (!items.some((j) => j.id === selected)) selected = items[0].id;
    for (const j of items) {
      const b = button(
        "",
        () => {
          selected = j.id;
          draw();
        },
        "task-history-option",
      );
      b.setAttribute("aria-pressed", String(selected === j.id));
      const head = el("div", "between");
      head.append(
        el("strong", "", opNames[j.operation] || j.operation),
        tag(j.status),
      );
      b.append(
        head,
        el(
          "span",
          "small muted",
          `${j.mode === "preview" ? "输入预览" : j.mode === "save" ? "作答接收" : "执行任务"} · ${j.id.slice(0, 8)}`,
        ),
      );
      list.append(b);
    }
    const job = records.get(selected);
    detail.replaceChildren(
      el("h2", "", opNames[job.operation] || job.operation),
    );
    const status = el("div", "actions");
    status.append(
      tag(job.status),
      el(
        "span",
        "muted small",
        job.mode === "preview"
          ? "输入预览"
          : job.mode === "save"
            ? "作答接收"
            : "执行任务",
      ),
    );
    detail.append(status);
    if (job.error) detail.append(el("p", "note", job.error));
    else
      detail.append(
        el(
          "p",
          "muted",
          job.status === "succeeded"
            ? "任务已完成"
            : job.status === "running"
              ? "正在执行，请稍候"
              : job.status === "queued"
                ? "任务等待执行"
                : "任务已结束",
        ),
      );
    const logs = el("details", "task-log-details");
    logs.open = job.status === "failed";
    logs.append(
      el("summary", "", "执行日志"),
      el("pre", "job-log", job.log || "暂无日志"),
    );
    detail.append(logs);
    if (job.status === "succeeded" && job.mode !== "preview")
      detail.append(
        button("查看保存结果", () => openTaskResult(job), "primary"),
      );
    const info = el("details");
    info.append(
      el("summary", "", "任务信息"),
      el("p", "mono small muted", job.id),
      el("p", "mono small muted", job.output || ""),
    );
    detail.append(info);
  }
  async function refresh() {
    const ticket = ++refreshId,
      result = await api("/api/jobs");
    if (epoch !== state.epoch || ticket !== refreshId) return;
    records.clear();
    for (const job of result.jobs) records.set(job.id, job);
    draw();
    for (const job of result.jobs) {
      if (!["queued", "running"].includes(job.status) || polling.has(job.id))
        continue;
      polling.add(job.id);
      poll(
        job.id,
        (updated) => {
          records.set(updated.id, updated);
          draw();
        },
        epoch,
      )
        .catch(notice)
        .finally(() => polling.delete(job.id));
    }
  }
  filter.addEventListener("change", draw);
  await refresh();
}
async function openTaskResult(job) {
  const file = {
    generate: "generation.json",
    recommend: "recommendation.json",
    profile: "profile.json",
    update: "profile.json",
    submit: "submission.json",
  }[job.operation];
  if (!file) throw Error("该任务没有可展示的结果入口");
  await load();
  const path = job.output + "/" + file,
    result = await artifact(path),
    student =
      result.student_id ||
      result.evidence?.student_id ||
      result.packet?.answer?.student_id;
  if (student) {
    state.student = student;
    $("#student").value = student;
  }
  if (["profile", "update"].includes(job.operation))
    state.profileSelections.set(student, path);
  if (job.operation === "recommend")
    state.recommendationSelections.set(student, path);
  if (job.operation === "generate") state.selectedGeneration = path;
  return navigate(
    {
      generate: "questions",
      recommend: "recommendations",
      profile: "twin",
      update: "twin",
      submit: "submissions",
    }[job.operation],
  );
}
