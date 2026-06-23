export type SecurityHeader = {
  key: string;
  value: string;
};

export type BuildSecurityHeadersOptions = {
  nodeEnv?: string;
};

export function buildSecurityHeaders(
  options: BuildSecurityHeadersOptions = {}
): readonly SecurityHeader[] {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const headers: SecurityHeader[] = [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy({ nodeEnv })
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin"
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff"
    },
    {
      key: "X-Frame-Options",
      value: "DENY"
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    },
    {
      key: "Cross-Origin-Opener-Policy",
      value: "same-origin"
    },
    {
      key: "Cross-Origin-Resource-Policy",
      value: "same-origin"
    },
    {
      key: "Origin-Agent-Cluster",
      value: "?1"
    }
  ];

  if (nodeEnv === "production") {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains"
    });
  }

  return headers;
}

export function buildContentSecurityPolicy(
  options: BuildSecurityHeadersOptions = {}
): string {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const scriptSrc = ["'self'", "'unsafe-inline'"];

  if (nodeEnv !== "production") {
    scriptSrc.push("'unsafe-eval'");
  }

  const directives = [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ["object-src", "'none'"],
    ["img-src", "'self'", "data:", "blob:", "https:"],
    ["font-src", "'self'", "data:"],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["script-src", ...scriptSrc],
    ["connect-src", "'self'", "https:", "wss:"]
  ];

  if (nodeEnv === "production") {
    directives.push(["upgrade-insecure-requests"]);
  }

  return directives.map((directive) => directive.join(" ")).join("; ");
}
