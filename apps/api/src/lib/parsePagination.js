// Q8.A.8: helper de paginação. Rejeita limits absurdos (anti-DoS).
// Uso:
//   const pg = parsePagination(req.query);
//   if (!pg.ok) return res.status(400).json(pg.body);
//   prisma.x.findMany({ skip: pg.skip, take: pg.limit, ... });

export const LIMIT_MAX = 100;
export const LIMIT_DEFAULT = 25;

export function parsePagination(query, { limitMax = LIMIT_MAX, limitDefault = LIMIT_DEFAULT } = {}) {
  const rawPage = Number(query?.page ?? 1);
  const rawLimit = Number(query?.limit ?? limitDefault);

  if (!Number.isFinite(rawPage) || rawPage < 1) {
    return {
      ok: false,
      status: 400,
      body: { ok: false, error: "invalid_page", message: "page deve ser inteiro >= 1" },
    };
  }
  if (!Number.isFinite(rawLimit) || rawLimit < 1) {
    return {
      ok: false,
      status: 400,
      body: { ok: false, error: "invalid_limit", message: `limit deve ser inteiro >= 1` },
    };
  }
  if (rawLimit > limitMax) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        error: "limit_too_large",
        message: `limit máximo permitido é ${limitMax}`,
        limitMax,
      },
    };
  }

  const page = Math.floor(rawPage);
  const limit = Math.floor(rawLimit);
  const skip = (page - 1) * limit;
  return { ok: true, page, limit, skip };
}
