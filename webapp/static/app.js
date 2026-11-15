import { start } from "./router.js";
import { home, plan, admin } from "./pages/home.js";
import { profiles, review } from "./pages/profiles.js";
import { questions, practice, submissions } from "./pages/questions.js";
import { tasks } from "./pages/tasks.js";
import { graph, notes, placeholder } from "./pages/library.js";
start({
  home,
  plan,
  recommendations: plan,
  submissions,
  admin,
  profiles,
  review,
  questions,
  practice,
  tasks,
  generation: tasks,
  graph,
  notes,
  reading: placeholder,
  chat: placeholder,
  twin: profiles,
  quality: placeholder,
  experiments: placeholder,
  settings: placeholder,
});
