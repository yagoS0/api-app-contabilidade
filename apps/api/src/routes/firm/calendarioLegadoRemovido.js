// Old browser tabs must not recreate or restore the removed calendar.
export function calendarioLegadoRemovido(req, res) {
  if (!req.auth?.user?.id) return res.status(401).json({ ok: false });
  return res.status(410).json({
    ok: false,
    error: 'CALENDARIO_LEGADO_REMOVIDO',
    message: 'O calendário antigo foi removido. Atualize a página para usar o Calendario.',
  });
}
