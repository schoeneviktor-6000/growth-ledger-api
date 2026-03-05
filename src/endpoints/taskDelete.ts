import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { type AppContext, Task } from "../types";
import { deleteTask } from "../taskStore";

export class TaskDelete extends OpenAPIRoute {
	schema = {
		tags: ["Tasks"],
		summary: "Delete a Task",
		request: {
			params: z.object({
				taskSlug: Str({ description: "Task slug" }),
			}),
		},
		responses: {
			"200": {
				description: "Returns if the task was deleted successfully",
				content: {
					"application/json": {
						schema: z.object({
							series: z.object({
								success: Bool(),
								result: z.object({
									task: Task,
								}),
							}),
						}),
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		// Get validated data
		const data = await this.getValidatedData<typeof this.schema>();

		// Retrieve the validated slug
// Retrieve the validated slug
const { taskSlug } = data.params;

const task = deleteTask(taskSlug);

if (!task) {
  return Response.json(
    { success: false, error: "Object not found" },
    { status: 404 }
  );
}

return {
  success: true,
  result: { task },
};

		// Implement your own object deletion here

		// Return the deleted task for confirmation
		return {
			result: {
				task: {
					name: "Build something awesome with Cloudflare Workers",
					slug: taskSlug,
					description: "Lorem Ipsum",
					completed: true,
					due_date: "2022-12-24",
				},
			},
			success: true,
		};
	}
}
