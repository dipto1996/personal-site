import "./env-loader.js";
import http from "node:http";

import { handleRequest } from "./app.js";

const PORT = Number(process.env.PORT || 4173);

const server = http.createServer((request, response) => {
  handleRequest(request, response);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try PORT=4180 npm run dev`);
    process.exit(1);
  }

  throw error;
});

server.listen(PORT, () => {
  console.log(`personal-site server listening on http://localhost:${PORT}`);
  console.log(`Makhanamart home: http://localhost:${PORT}/makhana/`);
  console.log(`Makhanamart trade: http://localhost:${PORT}/makhana/trade`);
});
