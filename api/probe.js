import { handleApi } from "../pindl.js";

export default async function handler(req, res) {
  return handleApi(req, res, "probe");
}
