// AS VALIDAÇÕES DA DEFIS — as que o manual declara, e só essas.
//
// ⚠ ERRO ≠ ALERTA, e a diferença é quem decide:
//   • ERRO   é o que o PORTAL recusaria (soma de participação ≠ 100%, total de entradas menor que
//            as parcelas que ele mesmo engloba, linha de lista com valor zero). Transcrever isso
//            só adianta a rejeição para o momento em que o contador está no portal, sem o espelho
//            do lado.
//   • ALERTA é divergência com o que NÓS temos (exportação × PGDAS-D). O manual manda conferir,
//            não corrigir: quem declarou ao PGDAS-D foi a empresa, e o número do espelho pode
//            estar certo com o nosso errado. Corrigir sozinho seria decidir ato fiscal por
//            suposição (regra 5).
//
// Fonte das regras: mesmo manual citado em `defisSpec.js`.

const num = (v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const TOLERANCIA = 0.01;

/**
 * Campo 7.3 — a soma da participação dos sócios tem de fechar 100%.
 * Sem sócio nenhum não acusa: espelho recém-aberto não é espelho errado.
 */
export function validarParticipacaoSocios(socios) {
  const lista = socios || [];
  if (!lista.length) return null;
  const soma = lista.reduce((s, x) => s + num(x.percentual), 0);
  if (Math.abs(soma - 100) <= TOLERANCIA) return null;
  return {
    campo: "7.3",
    tipo: "erro",
    // O número aparece na mensagem: "não fecha 100%" manda somar de cabeça.
    mensagem: `A soma da participação dos sócios está em ${soma.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% — precisa fechar 100%.`,
  };
}

/**
 * Campo 9 — "Total de entradas (incluídos os itens 5, 6 e 8)".
 * O próprio rótulo diz que ele ENGLOBA os outros três, então menor que a soma é impossível.
 * ⚠ MAIOR é normal e não acusa: o 9 inclui uso e consumo, ativo imobilizado, remessas e fretes.
 */
export function validarTotalEntradas(est) {
  if (!est) return null;
  const parcelas = num(est.aquisicoes) + num(est.entradasTransferencia) + num(est.devolucoesVendas);
  const total = num(est.totalEntradas);
  // Nada preenchido ainda não é erro — é formulário em branco.
  if (total === 0 && parcelas === 0) return null;
  if (total + TOLERANCIA >= parcelas) return null;
  return {
    campo: "9",
    tipo: "erro",
    mensagem: `O total de entradas (${fmt(total)}) é menor que a soma dos itens 5, 6 e 8 (${fmt(parcelas)}), que ele engloba.`,
  };
}

/** Campo 5 — o total precisa bater com 5.1 + 5.2 quando os dois foram preenchidos. */
export function validarAquisicoes(est) {
  if (!est) return null;
  const partes = num(est.aquisicoesInterno) + num(est.aquisicoesImportacao);
  const total = num(est.aquisicoes);
  if (partes === 0 || total === 0) return null;
  if (Math.abs(total - partes) <= TOLERANCIA) return null;
  return {
    campo: "5",
    tipo: "erro",
    mensagem: `O total de aquisições (${fmt(total)}) não bate com 5.1 + 5.2 (${fmt(partes)}).`,
  };
}

/**
 * Campos 12 a 15 — linha de lista com valor zero.
 * O manual é explícito: valor tem de ser > 0, senão a UF deve ser desmarcada. Uma linha zerada é
 * rejeição garantida no portal.
 */
export function validarListasComValor(est) {
  const out = [];
  const listas = [
    ["12", "entradasInterestaduais", "entradas interestaduais"],
    ["13", "saidasInterestaduais", "saídas interestaduais"],
    ["14", "issRetido", "ISS retido"],
    ["15", "servicosComunicacao", "serviços de comunicação"],
  ];
  for (const [n, chave, nome] of listas) {
    const zeradas = (est?.[chave] || []).filter((l) => num(l.valor) <= 0).length;
    if (zeradas > 0) {
      out.push({
        campo: n,
        tipo: "erro",
        mensagem: `${zeradas} linha${zeradas > 1 ? "s" : ""} de ${nome} com valor zero — o portal exige valor maior que zero ou a linha removida.`,
      });
    }
  }
  return out;
}

/**
 * Campos 5 e 6 (ME/EPP) × o que o PGDAS-D do ano registrou.
 *
 * ⚠ ALERTA, NUNCA CORREÇÃO. Sem receita de exportação conhecida do nosso lado, não acusa nada:
 * ausência de dado não é prova de divergência — e é o caso comum, porque a maioria não exporta.
 */
export function alertarExportacaoVsPgdas(meEpp, exportacaoDoPgdas) {
  if (exportacaoDoPgdas == null) return null;
  const declarado = num(meEpp?.receitaExportacaoDireta)
    + (meEpp?.exportadoras || []).reduce((s, e) => s + num(e.valor), 0);
  if (Math.abs(declarado - Number(exportacaoDoPgdas)) <= TOLERANCIA) return null;
  return {
    campo: "5/6",
    tipo: "alerta",
    mensagem: `A exportação informada aqui (${fmt(declarado)}) difere do que o PGDAS-D do ano registrou (${fmt(exportacaoDoPgdas)}). Confira antes de transmitir — o espelho não corrige sozinho.`,
  };
}

/** Tudo, de uma vez. Erros bloqueiam a marcação de "transmitida"; alertas só avisam. */
export function conferirEspelho(espelho, { exportacaoDoPgdas = null } = {}) {
  const itens = [];
  if (espelho?.inativa) {
    // Inatividade pula direto para transmissão (seção 0, passo 3 do manual): não há o que conferir.
    return { erros: [], alertas: [] };
  }
  const p = validarParticipacaoSocios(espelho?.meEpp?.socios);
  if (p) itens.push(p);
  const a = alertarExportacaoVsPgdas(espelho?.meEpp, exportacaoDoPgdas);
  if (a) itens.push(a);

  for (const est of espelho?.estabelecimentos || []) {
    const rotulo = est.cnpj || est.nome || "estabelecimento";
    for (const r of [validarAquisicoes(est), validarTotalEntradas(est), ...validarListasComValor(est)]) {
      if (r) itens.push({ ...r, mensagem: `${rotulo}: ${r.mensagem}` });
    }
  }
  return {
    erros: itens.filter((i) => i.tipo === "erro"),
    alertas: itens.filter((i) => i.tipo === "alerta"),
  };
}

function fmt(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
