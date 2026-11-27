const test = require("node:test");
const assert = require("node:assert/strict");
const adapter = import("../webapp/static/learning-data.js");
const item = (path, student_id = "s1") => ({ path, student_id, label: path });
const profile = (n = 1) => ({
  student_id: "s1",
  status: "completed",
  evidence: Array.from({ length: n }, (_, i) => ({
    record_id: `e${i}`,
    student_id: "s1",
  })),
  observations: [{ concept_id: "loop", evidence_id: "e0", student_id: "s1" }],
  summaries: {},
});

test("strict student isolation, missing summaries and independent file failures", async () => {
  const { loadStudent, studentIds } = await adapter;
  const data = {
    catalog: {
      concepts: { loop: "Loop", input: "Input", unobserved: "Not observed" },
    },
    profiles: [item("p"), item("other", "s2"), item("wrong"), item("broken")],
    recommendations: [item("r")],
    generations: [item("g", "s2")],
  };
  const files = {
    p: profile(),
    other: {
      ...profile(),
      student_id: "s2",
      evidence: [{ student_id: "s2", record_id: "e0" }],
      observations: [],
    },
    wrong: { ...profile(), student_id: "s2" },
    r: { student_id: "s1" },
  };
  files.p.summaries.input = {
    evaluation: "Summary only",
    evidence_ids: ["e0"],
  };
  const calls = [];
  const read = async (p) => {
    calls.push(p);
    if (!files[p]) throw Error("unreadable");
    return files[p];
  };
  assert.deepEqual(studentIds(data), ["s1", "s2"]);
  const result = await loadStudent(data, "s1", "", read);
  assert.deepEqual(
    result.profiles.map((x) => x.path),
    ["p"],
  );
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.issues.length, 2);
  const loop = result.conceptRows.find((c) => c.id === "loop");
  assert.equal(loop.missingSummary, true);
  assert.equal(loop.name, "Loop");
  assert.equal(loop.evidence[0].record_id, "e0");
  assert.equal(result.conceptRows.length, 3);
  assert.deepEqual(
    result.conceptRows.find((c) => c.id === "unobserved"),
    {
      id: "unobserved",
      name: "Not observed",
      summary: null,
      observations: [],
      evidence: [],
      missingSummary: true,
    },
  );
  assert.equal(
    result.conceptRows.find((c) => c.id === "input").summary.evaluation,
    "Summary only",
  );
  assert.ok(!calls.includes("other") && !calls.includes("g"));
  calls.length = 0;
  assert.equal((await loadStudent(data, "", "", read)).profile, null);
  assert.deepEqual(calls, []);
  const second = await loadStudent(data, "s2", "", read);
  assert.equal(second.profile.student_id, "s2");
  assert.deepEqual(
    second.profiles.map((x) => x.path),
    ["other"],
  );
});

test("profile selection uses evidence then stable path; explicit available choice wins", async () => {
  const { loadStudent } = await adapter;
  const data = {
    profiles: ["z", "b", "a", "failed", "empty"].map((p) => item(p)),
  };
  const files = {
    z: profile(1),
    b: profile(2),
    a: profile(2),
    failed: { ...profile(8), status: "failed" },
    empty: profile(0),
  };
  files.z.finalization = { kind: "user_accepted_available_data" };
  const result = await loadStudent(data, "s1", "", async (p) => files[p]);
  assert.equal(result.profileItem.path, "a");
  assert.deepEqual(result.issues, []);
  assert.equal(
    (await loadStudent(data, "s1", "z", async (p) => files[p])).profileItem
      .path,
    "z",
  );
});

test("nested receipt identities must agree; fixtures and foreign profile evidence excluded", async () => {
  const { loadStudent } = await adapter;
  const receipt = {
    packet: {
      answer: { student_id: "s1", origin: "student" },
      assignment: { student_id: "s1" },
    },
    evidence: { student_id: "s1" },
    learning_evidence_eligible: true,
  };
  const files = {
    ok: receipt,
    bad: { ...receipt, evidence: { student_id: "s2" } },
    fixture: {
      ...receipt,
      packet: { answer: { student_id: "s1", origin: "test_fixture" } },
    },
    p: { ...profile(), evidence: [{ student_id: "s2" }] },
  };
  const result = await loadStudent(
    {
      submission_runs: ["ok", "bad", "fixture"].map((p) => item(p)),
      profiles: [item("p")],
    },
    "s1",
    "",
    async (p) => files[p],
  );
  assert.deepEqual(
    result.submissions.map((x) => x.path),
    ["ok"],
  );
  assert.equal(result.profile, null);
  assert.deepEqual(result.issues.map((i) => i.path).sort(), ["bad", "p"]);
});

test("versions preserve actual hashed question revisions; publication requires explicit readiness", async () => {
  const { questionVersions, isPublished } = await adapter;
  const versions = [
    { version: 1, question_sha256: "a", question: { outcome: "question" } },
    { version: 2, question_sha256: "b", question: { outcome: "question" } },
    {
      version: 3,
      question_sha256: "c",
      question: { outcome: "split_targets" },
    },
    { version: 4, question: { outcome: "question" } },
  ];
  assert.deepEqual(questionVersions({ versions }), versions.slice(0, 2));
  assert.equal(isPublished({ status: "completed", versions }), false);
  assert.equal(
    isPublished({ ready_for_student: true, status: "failed", versions }),
    false,
  );
  assert.equal(
    isPublished({ ready_for_student: true, status: "rejected", versions }),
    false,
  );
  assert.equal(
    isPublished({ ready_for_student: true, status: "completed", versions }),
    false,
  );
  assert.equal(
    isPublished({ ready_for_student: true, status: "needs_review", versions }),
    false,
  );
  assert.equal(
    isPublished({ ready_for_student: true, status: "published", versions }),
    true,
  );
});
