// Session state shared by the existing pages.
export const state = {
  data: null,
  page: "home",
  mode: "learner",
  student: "",
  operation: "recommend",
  job: null,
  preview: null,
  artifacts: new Map(),
  epoch: 0,
  model: null,
  selectedProfile: "",
  profileSelections: new Map(),
  selectedGeneration: "",
  recommendationSelections: new Map(),
  taskFields: {},
};

export function filtered(items) {
  return (items || []).filter(
    (x) => state.student && x.student_id === state.student,
  );
}
