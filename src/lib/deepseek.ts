import OpenAI from "openai";

/**
 * DeepSeek client. DeepSeek's API is OpenAI-compatible — we just point
 * the OpenAI SDK at their base URL.
 *
 * Models: `deepseek-chat`, `deepseek-reasoner`.
 */
export const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  baseURL: "https://api.deepseek.com",
});

export const DEEPSEEK_MODEL = "deepseek-chat";
