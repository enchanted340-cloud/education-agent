const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const modules = Promise.all([
  import("../webapp/static/api.js"),
  import("../webapp/static/state.js"),
  import("../webapp/static/pages/tasks.js"),
]);
const originalFetch = global.fetch;

test("unadvertised operations retain form previews but are not marked connected", async () => {
  const { taskOperations } = await import("../webapp/static/pages/tasks.js");
  const ops = taskOperations([
    { id: "recommend", fields: [{ name: "student" }] },
  ]);
  assert.equal(ops.find((x) => x.id === "recommend").connected, true);
  assert.equal(ops.find((x) => x.id === "generate").connected, false);
  assert.ok(
    ops
      .find((x) => x.id === "generate")
      .fields.some((x) => x.name === "targets"),
  );
  assert.equal(
    ops.some((x) => x.id.startsWith("verify_")),
    false,
  );
});

test("concurrent artifact reads coalesce; refresh and rejected reads do not poison the cache", async () => {
  const [{ artifact }, { state }] = await modules;
  state.artifacts.clear();
  let resolve,
    calls = 0;
  global.fetch = () => {
    calls++;
    return new Promise((r) => (resolve = r));
  };
  const a = artifact("runs/a/profile.json"),
    b = artifact("runs/a/profile.json");
  assert.equal(calls, 1);
  state.artifacts.clear();
  resolve({
    ok: true,
    json: async () => ({ artifact: { student_id: "old" } }),
  });
  await Promise.all([a, b]);
  assert.equal(state.artifacts.size, 0);
  global.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ error: "missing" }),
  });
  await assert.rejects(artifact("runs/a/profile.json"), /missing/);
  assert.equal(state.artifacts.size, 0);
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ artifact: { student_id: "new" } }),
  });
  assert.equal((await artifact("runs/a/profile.json")).student_id, "new");
});

test("graph preserves conditional direction and whole association membership", async () => {
  const { relationsFor } = await import("../webapp/static/pages/library.js");
  const conditional = {
    id: "p",
    from: "a",
    to: "b",
    applies_when: "condition",
  };
  const association = {
    id: "r",
    concept_ids: ["a", "b", "c"],
    use_case: "scenario",
  };
  const catalog = {
    prerequisites: [conditional],
    associations: [association, { id: "other", concept_ids: ["x", "y"] }],
  };
  const rows = relationsFor(catalog, "b");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].from, "a");
  assert.equal(rows[0].to, "b");
  assert.deepEqual(rows[1].concept_ids, ["a", "b", "c"]);
  assert.equal(rows[1].use_case, "scenario");
  assert.deepEqual(relationsFor(catalog, "none"), []);
});

test("history sorts by recorded time, with missing times last; question links require student and recommendation IDs", async () => {
  const { orderedRecommendations, linkedGenerations } = await import(
    "../webapp/static/pages/home.js"
  );
  const old = {
    path: "z",
    data: {
      created_at: "2026-10-01T00:00:00Z",
      student_id: "s1",
      recommendation_id: "r1",
    },
  };
  const recent = { path: "a", data: { created_at: "2026-11-01T00:00:00Z" } };
  const unknown = { path: "0", data: {} };
  assert.deepEqual(orderedRecommendations([unknown, old, recent]), [
    recent,
    old,
    unknown,
  ]);
  const own = { data: { student_id: "s1", recommendation_id: "r1" } };
  assert.deepEqual(
    linkedGenerations(old, [
      own,
      { data: { student_id: "s2", recommendation_id: "r1" } },
      { data: { student_id: "s1", recommendation_id: "r2" } },
    ]),
    [own],
  );
  assert.deepEqual(linkedGenerations(unknown, [{ data: {} }]), []);
});
afterEach(() => {
  global.fetch = originalFetch;
});

test("result reads are cached and never send a task request", async () => {
  const [{ artifact }, { state }] = await modules;
  state.artifacts.clear();
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ artifact: { student_id: "s1" } }) };
  };
  assert.deepEqual(await artifact("runs/中文/profile.json"), {
    student_id: "s1",
  });
  await artifact("runs/中文/profile.json");
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "/api/artifact?path=" + encodeURIComponent("runs/中文/profile.json"),
  );
  assert.equal(requests[0].options.method, undefined);
  assert.equal(requests[0].options.headers["X-Workbench-Token"], undefined);
});

test("explicit writes use the current token and surface server rejection", async () => {
  const [{ api }, { state }] = await modules;
  state.data = { csrf_token: "test-token" };
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: false,
      status: 409,
      json: async () => ({ error: "Another task is running" }),
    };
  };
  await assert.rejects(
    api("/api/jobs", { method: "POST", body: "{}" }),
    /Another task is running/,
  );
  assert.equal(request.options.headers["X-Workbench-Token"], "test-token");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.equal(request.options.body, "{}");
});

test("invalid JSON response produces a readable error", async () => {
  const [{ api }] = await modules;
  global.fetch = async () => ({
    ok: true,
    json: async () => {
      throw Error("bad JSON");
    },
  });
  await assert.rejects(api("/api/bootstrap"), /服务器未返回有效数据/);
});

test("form fields retain lists and omit confirmation and empty inputs", async () => {
  const [, , { fieldsFrom }] = await modules;
  const fields = fieldsFrom({
    elements: [
      { name: "student", value: " s1 ", dataset: {} },
      {
        name: "requirement",
        value: " 第一条\n\n--execute\n",
        dataset: { multiple: "true" },
        tagName: "TEXTAREA",
      },
      {
        name: "scope",
        dataset: { multiple: "true" },
        tagName: "SELECT",
        selectedOptions: [{ value: "java.array" }],
      },
      { name: "confirm", value: "on", dataset: {} },
      { name: "cases", value: " ", dataset: {} },
    ],
  });
  assert.deepEqual(fields, {
    student: "s1",
    requirement: ["第一条", "--execute"],
    scope: ["java.array"],
  });
});

test("recommendation generation sends its saved handoff without teacher inputs", async () => {
  const [, , { fieldsFrom }] = await modules;
  const fields = fieldsFrom({
    elements: [
      {
        name: "recommendation_run",
        value: "runs/recommendation.json",
        dataset: {},
      },
      { name: "student", value: "s1", dataset: {} },
      { name: "profile", value: "runs/profile.json", dataset: {} },
      { name: "max_calls", value: "8", dataset: {} },
    ],
  });
  assert.deepEqual(fields, {
    recommendation_run: "runs/recommendation.json",
    max_calls: "8",
  });
});
