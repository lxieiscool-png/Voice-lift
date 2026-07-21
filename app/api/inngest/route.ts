import { serve } from "inngest/next";
import { inngest } from "@/app/lib/inngest/client";
import { ping } from "@/app/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [ping],
});
