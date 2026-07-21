import { inngest } from "./client";

// Scaffolding check — confirms the Inngest dev server can reach this app and
// run a step-based function before any real analysis logic is built on top.
export const ping = inngest.createFunction(
  { id: "ping", triggers: [{ event: "test/ping" }] },
  async ({ event, step }) => {
    const result = await step.run("echo", async () => {
      return { receivedAt: Date.now(), message: event.data?.message ?? "no message" };
    });
    return result;
  }
);
