import "./env-loader.js";
import { ensureDemoUser } from "./auth.js";
import { syncAllSources } from "./source-adapters.js";

await ensureDemoUser();
const sources = await syncAllSources();
console.log(JSON.stringify(sources, null, 2));
