const texto = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Cada mensagem continua identificável mesmo quando encaminhada ou fora da sequência. */
export function identificarGuiaWhatsapp({ empresa, tipoGuia, sequencia = null }) {
  const nome = texto(empresa);
  if (!nome) throw Object.assign(new Error('Confira o nome da empresa antes de enviar a guia.'), { code: 'GUIA_EMPRESA_SEM_NOME' });
  if (sequencia && (!Number.isInteger(sequencia.indice) || !Number.isInteger(sequencia.total)
    || sequencia.indice < 1 || sequencia.indice > sequencia.total)) throw new Error('Sequência de guias inválida.');
  return [nome, sequencia ? `Guia ${sequencia.indice} de ${sequencia.total}` : null, texto(tipoGuia)].filter(Boolean).join(' — ');
}

/** Ordem estável por empresa e documento; não depende da ordem de seleção no navegador. */
export function ordenarGuiasWhatsapp(guias) {
  return [...guias].sort((a, b) => String(a.portalClientId).localeCompare(String(b.portalClientId))
    || String(a.tipo).localeCompare(String(b.tipo))
    || String(a.competencia).localeCompare(String(b.competencia))
    || (Number(a.numeroParcela) || 0) - (Number(b.numeroParcela) || 0)
    || String(a.id ?? a.guideId).localeCompare(String(b.id ?? b.guideId)));
}

export function sequenciasGuiasWhatsapp(guias) {
  const grupos = new Map();
  for (const g of ordenarGuiasWhatsapp(guias)) {
    const grupo = grupos.get(g.portalClientId) || [];
    grupo.push(g); grupos.set(g.portalClientId, grupo);
  }
  return new Map([...grupos.values()].flatMap(grupo => grupo.map((g, i) => [g.id ?? g.guideId, { indice: i + 1, total: grupo.length }])));
}
