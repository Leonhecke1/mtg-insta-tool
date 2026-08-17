import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: parseInt(optional("PORT", "3000"), 10),

  basicAuthUser: optional("BASIC_AUTH_USER"),
  basicAuthPass: optional("BASIC_AUTH_PASS"),

  anthropicApiKey: optional("ANTHROPIC_API_KEY"),
  anthropicModel: optional("ANTHROPIC_MODEL", "claude-sonnet-5"),

  dataDir: path.resolve(optional("DATA_DIR", "./data")),
  outDir: path.resolve(optional("OUT_DIR", "./out")),
};

export function requireAnthropicConfigured(): void {
  if (!config.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY missing (.env) - LLM text generation not possible"
    );
  }
}
