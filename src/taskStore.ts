export type Task = {
  name: string;
  slug: string;
  description?: string | null;
  completed: boolean;
  due_date: string; // keep as string for now (ISO or date)
};

const tasksBySlug = new Map<string, Task>();

function seedIfEmpty() {
  if (tasksBySlug.size > 0) return;

  const seed: Task[] = [
    {
      name: "Clean my room",
      slug: "clean-room",
      description: null,
      completed: false,
      due_date: "2025-01-05",
    },
    {
      name: "Build something awesome with Cloudflare Workers",
      slug: "cloudflare-workers",
      description: "Lorem Ipsum",
      completed: true,
      due_date: "2022-12-24",
    },
  ];

  for (const t of seed) tasksBySlug.set(t.slug, t);
}

export function listTasks(opts: { isCompleted?: boolean }) {
  seedIfEmpty();

  let tasks = Array.from(tasksBySlug.values());

  if (typeof opts.isCompleted !== "undefined") {
    tasks = tasks.filter((t) => t.completed === opts.isCompleted);
  }

  return tasks;
}

export function getTask(slug: string) {
  seedIfEmpty();
  return tasksBySlug.get(slug) ?? null;
}

export function createTask(task: Task) {
  seedIfEmpty();
  tasksBySlug.set(task.slug, task);
  return task;
}

export function deleteTask(slug: string) {
  seedIfEmpty();
  const existing = tasksBySlug.get(slug) ?? null;
  if (!existing) return null;
  tasksBySlug.delete(slug);
  return existing;
}
