import { handleRequest } from "../server/app.js";

export default async function handler(request, response) {
  return handleRequest(request, response);
}
