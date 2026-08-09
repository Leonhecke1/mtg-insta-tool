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

  s3: {
    endpoint: optional("S3_ENDPOINT"),
    region: optional("S3_REGION", "auto"),
    bucket: optional("S3_BUCKET"),
    accessKeyId: optional("S3_ACCESS_KEY_ID"),
    secretAccessKey: optional("S3_SECRET_ACCESS_KEY"),
    publicBaseUrl: optional("S3_PUBLIC_BASE_URL"),
  },

  instagram: {
    igUserId: optional("IG_USER_ID"),
    accessToken: optional("IG_ACCESS_TOKEN"),
  },

  dataDir: path.resolve(optional("DATA_DIR", "./data")),
  outDir: path.resolve(optional("OUT_DIR", "./out")),
};

export function requireAnthropicConfigured(): void {
  if (!config.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY fehlt (.env) - LLM-Textgenerierung nicht moeglich"
    );
  }
}

export function requireS3Configured(): void {
  const { endpoint, bucket, accessKeyId, secretAccessKey, publicBaseUrl } =
    config.s3;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
    throw new Error(
      "S3/R2-Konfiguration unvollstaendig (.env: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL)"
    );
  }
}

export function requireInstagramConfigured(): void {
  const { igUserId, accessToken } = config.instagram;
  if (!igUserId || !accessToken) {
    throw new Error(
      "Instagram-Konfiguration unvollstaendig (.env: IG_USER_ID, IG_ACCESS_TOKEN)"
    );
  }
}
