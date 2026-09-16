// Leituras de fotos imutáveis: não chamar o motor atual para comparar resultados antigos.
export const valorPresente = v => typeof v === "number" && Number.isFinite(v);
export const moedaCenario = v => valorPresente(v) ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Não informado";
export const percentualCenario = v => valorPresente(v) ? `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "Não informado";
export const nomeCenario = c => c?.entradas?.formularioCenario?.ajustes?.nomeCenario?.trim() || `Cenário ${c?.competencia || "sem competência"}`;
export function dataCenario(c) {
  const d = new Date(c?.geradoEm);
  return c?.geradoEm && Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR") : "Data não informada";
}
export function ordenarCenarios(cenarios) {
  return (Array.isArray(cenarios) ? cenarios : []).filter(c => c?.id).slice()
    .sort((a, b) => (Date.parse(b.geradoEm) || 0) - (Date.parse(a.geradoEm) || 0));
}
export function totalDoRegime(r) {
  return r && !r.indisponivel && r.elegivel !== false && valorPresente(r.total) ? r.total : null;
}
export function coberturaSalva(r) {
  if (!r || r.indisponivel || r.elegivel === false) return "Indisponível";
  if (r.cobertura?.estado === "estimado") return "Estimado";
  if (r.cobertura?.estado === "parcial") return "Parcial";
  return "Cobertura não registrada";
}
export function resumirCenario(cenario, hoje = new Date()) {
  if (!cenario) return { estado: "sem_cenario", rotulo: "Sem cenário salvo", economia: null };
  const r = cenario.resultado || {};
  const revisao = r.conclusao?.revisarEm || "";
  const dataHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const regimes = Array.isArray(r.regimes) ? r.regimes : [];
  const atual = regimes.find(x => x.regime === r.regimeAtual);
  const menor = regimes.filter(x => totalDoRegime(x) != null).sort((a, b) => a.total - b.total)[0];
  const completa = r.comparacaoCompleta === true && regimes.filter(x => totalDoRegime(x) != null).length >= 2
    && regimes.every(x => x.elegivel === false || (totalDoRegime(x) != null && x.cobertura?.estado === "estimado"));
  let estado = "sem_base", rotulo = "Regime atual não registrado";
  if (!completa) { estado = "parcial"; rotulo = "Revisar cobertura"; }
  else if (String(r.anoBase) !== String(hoje.getFullYear())) { estado = "revisar"; rotulo = "Revisar ano-base"; }
  else if (/^\d{4}-\d{2}-\d{2}$/.test(revisao) && revisao <= dataHoje) { estado = "revisar"; rotulo = "Revisão prevista vencida ou para hoje"; }
  else if (totalDoRegime(atual) != null && menor) {
    estado = atual.total > menor.total ? "oportunidade" : "sem_reducao";
    rotulo = estado === "oportunidade" ? "Potencial no cenário salvo" : "Sem redução no cenário salvo";
  }
  return { estado, rotulo, revisao, atual: r.regimeAtual || null, menor: menor?.regime || null,
    economia: estado === "oportunidade" || estado === "sem_reducao" ? atual.total - menor.total : null };
}

// Apenas endpoints já autorizados por empresa. Três leituras simultâneas no máximo;
// ao sair da tela/trocar a carteira, não inicia mais leituras nem entrega resultados antigos.
export async function carregarCarteira({ empresas, api, cancelado = () => false, progresso = () => {} }) {
  const fila = [...new Map(empresas.map(e => [e.companyId || e.id, e])).entries()].filter(([id]) => id);
  let proximo = 0;
  const resultados = [];
  await Promise.all(Array.from({ length: Math.min(3, fila.length) }, async () => {
    while (!cancelado() && proximo < fila.length) {
      const [id, empresa] = fila[proximo++];
      let item;
      try {
        const resposta = await api.listarSimulacoesPlanejamento(id);
        if (resposta?.ok === false || !Array.isArray(resposta?.simulacoes)) throw new Error("leitura");
        // A rota já isola a empresa; também descarta uma foto de outra empresa em resposta inconsistente.
        if (resposta.simulacoes.some(c => c?.portalClientId && c.portalClientId !== id)) throw new Error("escopo");
        item = { id, empresa, cenario: ordenarCenarios(resposta.simulacoes)[0] || null };
      } catch { item = { id, empresa, erro: true }; }
      if (cancelado()) return;
      resultados.push(item);
      progresso([...resultados], fila.length);
    }
  }));
  return resultados;
}
