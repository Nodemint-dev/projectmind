// Environment-driven configuration. Every tunable lives here so the rest of
// the codebase never reads process.env directly.
const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
};

export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS || 3600),
  environment: process.env.NODE_ENV || "development",
};

export const isProduction = () => config.environment === "production";
