import { artifact } from "./api.js";

const groups = [
  "profiles",
  "recommendations",
  "generations",
  "submission_runs",
];
const list = (value) => (Array.isArray(value) ? value : []);
const comparePath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const badStatus = (value) =>
  /(?:failed|rejected|invalid|cancelled|canceled)/i.test(value || "");

export function studentIds(data) {
  return [
    ...new Set(
      groups
        .flatMap((key) => list(data?.[key]))
        .filter(
          (item) =>
            keyIdentity(item.student_id) &&
            item.learning_evidence_eligible !== false,
        )
        .map((item) => item.student_id),
    ),
  ].sort();
}

function keyIdentity(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function identityMatches(value, studentId, submission = false) {
  const identities = submission
    ? [
        value.student_id,
        value.packet?.student_id,
        value.packet?.answer?.student_id,
        value.packet?.assignment?.student_id,
        value.evidence?.student_id,
        value.answer?.student_id,
      ]
    : [value.student_id];
  const recorded = identities.filter(keyIdentity);
  return recorded.length > 0 && recorded.every((id) => id === studentId);
}

function fixture(value) {
  return (
    value?.origin === "test_fixture" ||
    value?.split === "test" ||
    value?.split === "test_fixture"
  );
}

function usableProfile(profile, studentId) {
  const accepted =
    profile.finalization?.kind === "user_accepted_available_data";
  return (
    (["completed", "available", "succeeded"].includes(profile.status) ||
      accepted) &&
    !badStatus(profile.status) &&
    list(profile.evidence).length > 0 &&
    [...list(profile.evidence), ...list(profile.observations)].every(
      (row) =>
        (!row.student_id || row.student_id === studentId) && !fixture(row),
    )
  );
}

function conceptRows(profile, catalog) {
  if (!profile) return [];
  const observations = list(profile.observations),
    summaries = profile.summaries || {};
  const concepts = catalog?.concepts || {};
  const catalogIds = Array.isArray(concepts)
    ? concepts.map((c) => c.id || c.concept_id)
    : Object.keys(concepts);
  const ids = [
    ...new Set([
      ...catalogIds,
      ...observations.map((o) => o.concept_id),
      ...Object.keys(summaries),
      ...list(profile.finalization?.excluded_concept_ids),
    ]),
  ]
    .filter(keyIdentity)
    .sort();
  return ids.map((id) => {
    const obs = observations.filter((o) => o.concept_id === id);
    const summary = summaries[id] || null;
    const evidenceIds = new Set([
      ...obs.map((o) => o.evidence_id),
      ...list(summary?.evidence_ids),
    ]);
    const catalogName = Array.isArray(concepts)
      ? concepts.find((c) => (c.id || c.concept_id) === id)?.name
      : concepts[id];
    return {
      id,
      name: catalogName || profile.concepts?.[id] || id,
      summary,
      observations: obs,
      evidence: list(profile.evidence).filter((e) =>
        evidenceIds.has(e.record_id),
      ),
      missingSummary: !summary,
    };
  });
}

/** Read only selected-student artifacts. Each rejected or unreadable file is a local issue. */
export async function loadStudent(
  data,
  studentId,
  preferredProfile = "",
  readArtifact = artifact,
) {
  const result = {
    studentId,
    profiles: [],
    profileItem: null,
    profile: null,
    recommendations: [],
    generations: [],
    submissions: [],
    conceptRows: [],
    issues: [],
  };
  if (!keyIdentity(studentId)) return result;
  const destinations = {
    profiles: "profiles",
    recommendations: "recommendations",
    generations: "generations",
    submission_runs: "submissions",
  };
  for (const group of groups) {
    const loaded = await Promise.all(
      list(data?.[group])
        .filter((item) => item.student_id === studentId)
        .map(async (item) => {
          try {
            const value = await readArtifact(item.path);
            if (
              !value ||
              !identityMatches(value, studentId, group === "submission_runs")
            )
              throw Error("记录的学生身份不一致或缺失。");
            if (
              group === "profiles" &&
              [...list(value.evidence), ...list(value.observations)].some(
                (row) => row.student_id && row.student_id !== studentId,
              )
            )
              throw Error("画像中的证据或观察属于其他学生。");
            if (group === "profiles" && !usableProfile(value, studentId))
              return null;
            if (
              group === "submission_runs" &&
              (value.learning_evidence_eligible !== true ||
                value.packet?.answer?.origin !== "student" ||
                fixture(value.packet?.answer) ||
                fixture(value.evidence) ||
                fixture(value.answer))
            )
              return null;
            return { ...item, data: value };
          } catch (error) {
            result.issues.push({
              path: item.path,
              group,
              message: error.message || String(error),
            });
            return null;
          }
        }),
    );
    result[destinations[group]] = loaded.filter(Boolean).sort(comparePath);
  }
  result.profileItem =
    result.profiles.find((p) => p.path === preferredProfile) ||
    [...result.profiles].sort(
      (a, b) =>
        b.data.evidence.length - a.data.evidence.length || comparePath(a, b),
    )[0] ||
    null;
  result.profile = result.profileItem?.data || null;
  result.conceptRows = conceptRows(result.profile, data?.catalog);
  return result;
}

export function questionVersions(generation) {
  return list(generation?.versions).filter(
    (v) =>
      v.question?.outcome === "question" &&
      typeof v.question_sha256 === "string" &&
      v.question_sha256.length > 0,
  );
}

export function isPublished(generation) {
  return (
    generation?.ready_for_student === true &&
    generation.status === "published" &&
    !badStatus(generation.execution_status) &&
    questionVersions(generation).length > 0
  );
}
