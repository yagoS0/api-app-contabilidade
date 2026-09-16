import { numeroMensal, distribuirReceitaAnual } from "./planejamentoMensal";

// Metadados por campo distinguem sugestões automáticas de zero/apagamento manual.
// A foto salva permanece intacta; somente o formulário reaberto recebe dados novos.
export function preencherMensal(value = {}, dados = [], ano = 2026, receitaAnual = null) {
  if (!dados.length) return value;
  const mapa = new Map(dados.map(d => [d.competencia, d]));
  const planoInicial = numeroMensal(receitaAnual) > 0 ? distribuirReceitaAnual(receitaAnual) : [];
  const preencher = (anterior, d, historico, i) => {
    const m = { ...anterior, automaticos: { ...anterior?.automaticos } };
    const atualizar = (chave, valor, extras = {}) => {
      if (numeroMensal(valor) == null || m.editados?.[chave]) return;
      if (m[chave] != null && m[chave] !== "" && !m.automaticos[chave]) return;
      Object.assign(m, { [chave]: valor, ...extras }); m.automaticos[chave] = true;
    };
    if (!historico) atualizar("plano", planoInicial[i], { origemPlano: "receita anual distribuída em 12 meses" });
    if (!d) return m;
    m.mesParcial = Boolean(d.mesParcial);
    atualizar(historico ? "receita" : "realizado", d.receita, { origem: d.origem, mesParcial: Boolean(d.mesParcial), avisoReceita: d.avisoReceita || null,
      ...(!historico ? { tributoApurado: d.tributoApurado ?? null, origemTributo: d.origemTributo || null } : {}) });
    if (d.folha != null) atualizar("folha", d.folha, { origemFolha: d.origemFolha || "folha informada na apuração", folhaPendenteConferencia: false });
    else atualizar("folha", d.folhaContabil, { origemFolha: d.origemFolhaContabil, folhaPendenteConferencia: true });
    return m;
  };
  return { ...value, meses: Array.from({ length: 12 }, (_, i) => preencher(value.meses?.[i], mapa.get(`${ano}-${String(i + 1).padStart(2, "0")}`), false, i)),
    historico: Array.from({ length: 12 }, (_, i) => preencher(value.historico?.[i], mapa.get(`${ano - 1}-${String(i + 1).padStart(2, "0")}`), true, i)) };
}
export function editarCampoMensal(m = {}, chave, valor) {
  return { ...m, [chave]: valor, editados: { ...m.editados, [chave]: true }, automaticos: { ...m.automaticos, [chave]: false },
    ...(chave === "realizado" || chave === "receita" ? { origem: "realizado informado", tributoApurado: null, origemTributo: null, avisoReceita: null } : {}),
    ...(chave === "folha" ? { origemFolha: "folha conferida no cenário", folhaPendenteConferencia: false } : {}) };
}
