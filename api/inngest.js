import { serve } from "inngest/node";

import { jobSearchFunctions, jobSearchInngest } from "../server/job-search/inngest.js";

const inngestHandler = serve({ client: jobSearchInngest, functions: jobSearchFunctions });

export default function handleInngest(request, response) {
  const missing = ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"].filter((key) => !process.env[key]);
  if (missing.length) {
    response.statusCode = 503;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ status: "blocked", missing }));
    return;
  }
  return inngestHandler(request, response);
}
