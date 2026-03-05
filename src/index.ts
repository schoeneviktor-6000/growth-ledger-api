import { fromHono } from "chanfana";
import { Hono } from "hono";
import { TaskCreate } from "./endpoints/taskCreate";
import { TaskDelete } from "./endpoints/taskDelete";
import { TaskFetch } from "./endpoints/taskFetch";
import { TaskList } from "./endpoints/taskList";
import { agentRegister } from "./endpoints/agentRegister";
import { agentApply } from "./endpoints/agentApply";
import { referralCreate } from "./endpoints/referralCreate";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// Register OpenAPI endpoints
openapi.get("/api/tasks", TaskList);
openapi.post("/api/tasks", TaskCreate);
openapi.get("/api/tasks/:taskSlug", TaskFetch);
openapi.delete("/api/tasks/:taskSlug", TaskDelete);
app.post("/api/agents/register", (c) => agentRegister(c));
app.post("/api/agents/apply", (c) => agentApply(c));
app.post("/api/referrals/create", (c) => referralCreate(c));

// You may also register routes for non OpenAPI directly on Hono
// app.get('/test', (c) => c.text('Hono!'))

// Export the Hono app
export default app;
