import { state } from "./state.js";
import { names } from "./labels.js";
import { api } from "./api.js";
import { loadStudent, studentIds } from "./learning-data.js";
import { $, el, button, notice, icon } from "./ui.js";
let renderers,
  loadVersion = 0;
const learner = [
  "home",
  "plan",
  "reading",
  "chat",
  "practice",
  "graph",
  "profiles",
  "review",
  "notes",
];
const admin = [
  "admin",
  "twin",
  "recommendations",
  "questions",
  "submissions",
  "generation",
  "tasks",
];
function drawNav() {
  $("#navigation").replaceChildren();
  for (const id of state.mode === "admin" ? admin : learner) {
    const b = button("", () => navigate(id), state.page === id ? "active" : "");
    b.dataset.page = id;
    b.append(icon(id), el("span", "", names[id]));
    if (state.page === id) b.setAttribute("aria-current", "page");
    $("#navigation").append(b);
  }
  $("#nav-label").textContent =
    state.mode === "admin" ? "管理与运行" : "学习与探索";
  for (const mode of ["learner", "admin"]) {
    $("#" + mode + "-mode").classList.toggle("active", state.mode === mode);
    $("#" + mode + "-mode").setAttribute(
      "aria-pressed",
      String(state.mode === mode),
    );
  }
}
export async function load() {
  const ticket = ++loadVersion;
  ++state.epoch;
  $("#refresh").disabled = true;
  if ($("#detail").open) $("#detail").close();
  try {
    const data = await api("/api/bootstrap");
    if (ticket !== loadVersion) return;
    state.data = data;
    state.artifacts.clear();
    const ids = studentIds(data);
    if (!ids.includes(state.student)) state.student = ids[0] || "";
    $("#student").replaceChildren(
      ...ids.map((x) => new Option(x.replace("java_", ""), x)),
    );
    if (!ids.length) $("#student").append(new Option("暂无学生", ""));
    $("#student").value = state.student;
    await render();
  } catch (error) {
    if (ticket === loadVersion) {
      state.data = null;
      state.model = null;
      $("#content").replaceChildren(
        el("p", "empty", "本地数据读取失败，请检查服务后刷新。"),
      );
      notice(error);
    }
  } finally {
    if (ticket === loadVersion) $("#refresh").disabled = false;
  }
}
export async function render() {
  const epoch = ++state.epoch;
  $("#notice").hidden = true;
  drawNav();
  $("#breadcrumb").textContent =
    (state.mode === "admin" ? "管理后台" : "我的空间") +
    " / " +
    names[state.page];
  document.title = "知序 · " + names[state.page];
  const content = $("#content");
  content.replaceChildren(el("p", "loading", "正在读取当前学生的记录…"));
  if (!state.data) return;
  try {
    const model = await loadStudent(
      state.data,
      state.student,
      state.profileSelections.get(state.student) || "",
    );
    if (epoch !== state.epoch) return;
    state.model = model;
    state.selectedProfile = model.profileItem?.path || "";
    const select = $("#profile-select");
    select.parentElement.hidden = ![
      "home",
      "profiles",
      "review",
      "graph",
      "twin",
      "generation",
      "admin",
    ].includes(state.page);
    select.replaceChildren(
      ...model.profiles.map(
        (x) =>
          new Option(
            `${x.label} · ${x.data.evidence?.length || 0} 份证据`,
            x.path,
          ),
      ),
    );
    if (!model.profiles.length) select.append(new Option("暂无可用画像", ""));
    select.value = state.selectedProfile;
    select.disabled = !model.profiles.length;
    if (model.issues.length)
      notice(
        new Error(
          "部分记录无法读取，其他可用结果正常展示：" +
            model.issues
              .map((x) => (typeof x === "string" ? x : x.message))
              .join("；"),
        ),
      );
    content.replaceChildren();
    await renderers[state.page](content, epoch);
  } catch (error) {
    if (epoch === state.epoch) {
      content.replaceChildren(
        el("p", "empty", "读取结果时遇到问题，请刷新重试。"),
      );
      notice(error);
    }
  }
}
export function navigate(page) {
  if (!renderers[page]) page = "home";
  if ($("#detail").open) $("#detail").close();
  state.page = page;
  state.mode = [...admin, "quality", "experiments", "settings"].includes(page)
    ? "admin"
    : "learner";
  if (location.hash !== "#" + page) history.replaceState(null, "", "#" + page);
  document.body.classList.remove("nav-open");
  $("#menu-toggle").setAttribute("aria-expanded", "false");
  return render();
}
export function startTask(operation, fields = {}) {
  state.operation = operation;
  state.taskFields = fields;
  return navigate("generation");
}
export function start(pages) {
  renderers = pages;
  $("#student").addEventListener("change", () => {
    state.student = $("#student").value;
    state.taskFields = {};
    state.selectedGeneration = "";
    if ($("#detail").open) $("#detail").close();
    render();
  });
  $("#profile-select").addEventListener("change", () => {
    state.profileSelections.set(state.student, $("#profile-select").value);
    render();
  });
  $("#refresh").addEventListener("click", load);
  $("#close-detail").addEventListener("click", () => $("#detail").close());
  $("#learner-mode").addEventListener("click", () => navigate("home"));
  $("#admin-mode").addEventListener("click", () => navigate("admin"));
  $("#menu-toggle").addEventListener("click", () => {
    const open = document.body.classList.toggle("nav-open");
    $("#menu-toggle").setAttribute("aria-expanded", String(open));
  });
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));
  const hash = location.hash.slice(1);
  state.page = pages[hash] ? hash : "home";
  state.mode = admin.includes(state.page) ? "admin" : "learner";
  drawNav();
  load();
}
