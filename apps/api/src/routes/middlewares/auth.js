export function extractApiKey(req) {
  const headerKey = (req.get("x-api-key") || "").trim();
  if (headerKey) return headerKey;
  return "";
}

export function extractBearerToken(req) {
  const authHeader = req.get("authorization") || "";
  const match = authHeader.match(/^Bearer (.+)$/i);
  return match ? match[1].trim() : null;
}

export function serializeUser(user) {
  if (!user) return null;
  const formatDate = (value) =>
    value instanceof Date ? value.toISOString() : value;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: formatDate(user.createdAt),
    updatedAt: formatDate(user.updatedAt),
  };
}

export function createEnsureAuthorized({ AuthService, API_KEYS = [], log }) {
  return async function ensureAuthorized(req, res, options = {}) {
    const { allowApiKeyFallback = true, requireRole } = options;
    const hasJwt = AuthService.isEnabled();
    const hasApiKey = API_KEYS.length > 0;
    if (!hasJwt && !hasApiKey) {
      log.warn({ path: req.path }, "Autorização indisponível: configure JWT_SECRET ou API_KEYS");
      res.status(503).json({ error: "auth_not_configured" });
      return false;
    }

    const bearer = extractBearerToken(req);
    if (bearer) {
      try {
        if (!hasJwt) {
          log.error("Token JWT recebido, mas AuthService não está configurado");
          res.status(503).json({ error: "auth_not_configured" });
          return false;
        }
        const payload = AuthService.verifyToken(bearer);
        const user = await AuthService.resolveUserFromPayload(payload);
        if (!user) {
          res.status(401).json({ error: "invalid_token" });
          return false;
        }
        if (user.status && user.status !== "active") {
          return res.status(403).json({ error: "user_not_active", status: user.status });
        }
        if (requireRole && user.role !== requireRole) {
          return res.status(403).json({ error: "forbidden" });
        }
        req.auth = { type: "jwt", payload, user };
        return true;
      } catch (err) {
        log.warn({ err: err.message, path: req.path }, "Token JWT inválido");
        res.status(401).json({ error: "invalid_token" });
        return false;
      }
    }

    if (allowApiKeyFallback && hasApiKey) {
      const provided = extractApiKey(req);
      if (provided && API_KEYS.includes(provided)) {
        req.auth = { type: "api-key" };
        return true;
      }
    }

    log.warn({ path: req.path, ip: req.ip }, "Credenciais ausentes ou inválidas");
    res.status(401).json({ error: "unauthorized" });
    return false;
  };
}

