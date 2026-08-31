function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

export function requireAccountType(expectedType) {
  const expected = normalize(expectedType);
  return function requireAccountTypeMiddleware(req, res, next) {
    const user = req?.auth?.user;
    if (!user) return res.status(401).json({ error: "unauthorized" });

    const role = String(user.role || "").toLowerCase();
    if (role === "admin") return next();

    /**
     * ⚠⚠ A MARCA POR USUÁRIO ABRE O PORTAL DO CLIENTE PARA QUEM É DO ESCRITÓRIO (30/08/2026).
     *
     * > Dono: *"o meu acesso admin deve ser o único a conseguir isso."*
     *
     * ⚠ Ela **não** é `role: "admin"`, de propósito: aquele é bypass total nos três middlewares
     * desta casa, e daría privilégio sobre o sistema inteiro para abrir uma porta.
     * ⚠⚠ E ela abre SÓ ESTA porta: o caminho contrário (uma conta CLIENT no portal do escritório)
     * continua fechado, porque a marca só vale quando o esperado é `CLIENT`. Um cliente com este
     * campo ligado por engano não ganharia nada.
     * ⚠ `=== true`, nunca truthy: ausência do campo não é permissão.
     */
    if (expected === "CLIENT" && user.podeAbrirPortalDoCliente === true) return next();

    const accountType = normalize(user.accountType);
    if (accountType !== expected) {
      return res.status(403).json({
        error: "forbidden_account_type",
        expected,
        received: accountType || null,
      });
    }
    return next();
  };
}

