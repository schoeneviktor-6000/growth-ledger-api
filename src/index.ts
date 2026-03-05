import { fromHono } from "chanfana";
import { Hono } from "hono";

import { TaskCreate } from "./endpoints/taskCreate";
import { TaskDelete } from "./endpoints/taskDelete";
import { TaskFetch } from "./endpoints/taskFetch";
import { TaskList } from "./endpoints/taskList";
import { agentRegister } from "./endpoints/agentRegister";
import { agentApply } from "./endpoints/agentApply";
import { referralCreate } from "./endpoints/referralCreate";
<<<<<<< Updated upstream
=======
import { founderConnectStripe } from "./endpoints/founderConnectStripe";
import type { Env } from "./env";
>>>>>>> Stashed changes

// Start a Hono app with typed bindings
const app = new Hono<{ Bindings: Env }>();

// Setup OpenAPI registry for the task endpoints
const openapi = fromHono(app, {
  docs_url: "/",
});

// Register existing OpenAPI task endpoints
openapi.get("/api/tasks", TaskList);
openapi.post("/api/tasks", TaskCreate);
openapi.get("/api/tasks/:taskSlug", TaskFetch);
openapi.delete("/api/tasks/:taskSlug", TaskDelete);
<<<<<<< Updated upstream
app.post("/api/agents/register", (c) => agentRegister(c));
app.post("/api/agents/apply", (c) => agentApply(c));
app.post("/api/referrals/create", (c) => referralCreate(c));
=======
app.post("/api/agents/register", agentRegister);
app.post("/api/agents/apply", agentApply);
app.post("/api/referrals/create", referralCreate);
// Register Stripe Connect endpoint (normal Hono route, not OpenAPI)
app.post("/api/founder/connect-stripe", founderConnectStripe);
>>>>>>> Stashed changes

// Export the app
export default app;
