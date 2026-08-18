// MOCKS — o formato que a UI espera. Os nomes dos campos sao contrato: `store.js` e as telas leem
// exatamente estes.
//
// ATENCAO: TODO CNPJ AQUI E FABRICADO. Formato e comprimento reais, digitos inventados — mesma
// disciplina das fixtures do projeto (`apps/api/CLAUDE.md`, secao SITFIS): identificador nunca e
// real; valor e data sao estrutura.
"use strict";

const VOCABULARIO_STATUS = Object.freeze([
  "rascunho", "processando", "emitida", "rejeitada", "cancelada", "substituida",
]);

const VOCABULARIO_ORIGEM = Object.freeze(["avulsa", "recorrente", "lote"]);

// Rejeicoes SORTEADAS por `emitirNota` — existem para a tela de lote ter o que mostrar.
// `mensagem` e `acao` sempre aparecem; `codigo` so ao expandir. `campo` e o que leva o botao de
// correcao ao lugar certo: erro sem destino deixa o contador procurando.
const ERROS = Object.freeze([
  { codigo: "E101", mensagem: "Codigo de servico invalido para este municipio.", acao: "Escolha outro codigo de servico.", campo: "servicoId" },
  { codigo: "E204", mensagem: "CNPJ do tomador nao encontrado na base da Receita.", acao: "Confira o CNPJ do cliente.", campo: "clienteId" },
  { codigo: "E310", mensagem: "Aliquota de ISS incompativel com o regime.", acao: "Revise a aliquota do servico.", campo: "servicoId" },
  { codigo: "E500", mensagem: "Prefeitura indisponivel no momento.", acao: "Tente novamente em alguns minutos.", campo: null },
]);

const CLIENTES = [
  { id: "c1", razaoSocial: "Aurora Comércio de Alimentos Ltda", cnpj: "11222333000144", email: "financeiro@aurora.exemplo",
    endereco: { logradouro: "Rua das Laranjeiras, 120", bairro: "Centro", municipio: "Rio de Janeiro", uf: "RJ", cep: "20240000" },
    retencoes: { irrf: 1.5, pis: 0.65, cofins: 3, csll: 1, inss: 0 } },
  { id: "c2", razaoSocial: "Bandeira Engenharia S/A", cnpj: "22333444000155", email: "contas@bandeira.exemplo",
    endereco: { logradouro: "Av. Brasil, 4500", bairro: "Benfica", municipio: "Rio de Janeiro", uf: "RJ", cep: "20930000" },
    retencoes: { irrf: 1.5, pis: 0, cofins: 0, csll: 0, inss: 11 } },
  { id: "c3", razaoSocial: "Cordilheira Serviços Digitais Ltda", cnpj: "33444555000166", email: "pagamentos@cordilheira.exemplo",
    endereco: { logradouro: "Rua Voluntários da Pátria, 88", bairro: "Botafogo", municipio: "Rio de Janeiro", uf: "RJ", cep: "22270000" },
    retencoes: { irrf: 0, pis: 0, cofins: 0, csll: 0, inss: 0 } },
  { id: "c4", razaoSocial: "Delta Log Transportes Ltda", cnpj: "44555666000177", email: "fiscal@deltalog.exemplo",
    endereco: { logradouro: "Rod. Washington Luiz, km 12", bairro: "Parque Duque", municipio: "Duque de Caxias", uf: "RJ", cep: "25065000" },
    retencoes: { irrf: 1.5, pis: 0.65, cofins: 3, csll: 1, inss: 0 } },
  { id: "c5", razaoSocial: "Estrela Norte Participações Ltda", cnpj: "55666777000188", email: "adm@estrelanorte.exemplo",
    endereco: { logradouro: "Praia de Botafogo, 300", bairro: "Botafogo", municipio: "Rio de Janeiro", uf: "RJ", cep: "22250000" },
    retencoes: { irrf: 1.5, pis: 0, cofins: 0, csll: 0, inss: 0 } },
  { id: "c6", razaoSocial: "Farol Clínica Médica Ltda", cnpj: "66777888000199", email: "financeiro@farolclinica.exemplo",
    endereco: { logradouro: "Rua Barata Ribeiro, 501", bairro: "Copacabana", municipio: "Rio de Janeiro", uf: "RJ", cep: "22040000" },
    retencoes: { irrf: 1.5, pis: 0.65, cofins: 3, csll: 1, inss: 0 } },
  { id: "c7", razaoSocial: "Guará Alimentos ME", cnpj: "77888999000110", email: "guara@guaraalimentos.exemplo",
    endereco: { logradouro: "Rua do Catete, 210", bairro: "Catete", municipio: "Rio de Janeiro", uf: "RJ", cep: "22220000" },
    retencoes: { irrf: 0, pis: 0, cofins: 0, csll: 0, inss: 0 } },
  { id: "c8", razaoSocial: "Horizonte Consultoria Empresarial Ltda", cnpj: "88999000000121", email: "nf@horizonteconsult.exemplo",
    endereco: { logradouro: "Av. Rio Branco, 1", bairro: "Centro", municipio: "Rio de Janeiro", uf: "RJ", cep: "20090000" },
    retencoes: { irrf: 1.5, pis: 0.65, cofins: 3, csll: 1, inss: 0 } },
];

const SERVICOS = [
  { id: "s1", descricao: "Consultoria em gestão empresarial", codigoMunicipal: "1702", aliquotaIss: 5, valorPadrao: 4500 },
  { id: "s2", descricao: "Assessoria contábil mensal", codigoMunicipal: "1719", aliquotaIss: 5, valorPadrao: 1800 },
  { id: "s3", descricao: "Desenvolvimento de software sob encomenda", codigoMunicipal: "0104", aliquotaIss: 2, valorPadrao: 12000 },
  { id: "s4", descricao: "Suporte técnico e manutenção de sistemas", codigoMunicipal: "0107", aliquotaIss: 2, valorPadrao: 2400 },
  { id: "s5", descricao: "Treinamento corporativo", codigoMunicipal: "0801", aliquotaIss: 5, valorPadrao: 3200 },
];

const RECORRENCIAS = [
  { id: "r1", clienteId: "c2", servicoId: "s2", descricao: "Assessoria contábil referente a {mes/ano}", valor: 1800, diaDoMes: 5,
    inicio: "2026-01", fim: null, ativa: true, emitirAutomatico: false, enviarEmail: true, reajusteAnualPct: 0, historico: [] },
  { id: "r2", clienteId: "c3", servicoId: "s4", descricao: "Suporte técnico — {mes/ano}", valor: 2400, diaDoMes: 5,
    inicio: "2026-02", fim: null, ativa: true, emitirAutomatico: true, enviarEmail: true, reajusteAnualPct: 0, historico: [] },
  { id: "r3", clienteId: "c6", servicoId: "s2", descricao: "Assessoria contábil referente a {mes/ano}", valor: 2100, diaDoMes: 10,
    inicio: "2025-11", fim: null, ativa: true, emitirAutomatico: false, enviarEmail: false, reajusteAnualPct: 5, historico: [] },
  { id: "r4", clienteId: "c8", servicoId: "s1", descricao: "Consultoria mensal — {mes/ano}", valor: 4500, diaDoMes: 10,
    inicio: "2026-03", fim: null, ativa: true, emitirAutomatico: false, enviarEmail: true, reajusteAnualPct: 0, historico: [] },
  { id: "r5", clienteId: "c5", servicoId: "s1", descricao: "Consultoria — {mes/ano}", valor: 6800, diaDoMes: 20,
    inicio: "2026-01", fim: null, ativa: false, emitirAutomatico: false, enviarEmail: true, reajusteAnualPct: 0, historico: [] },
  { id: "r6", clienteId: "c1", servicoId: "s5", descricao: "Treinamento mensal — {mes/ano}", valor: 3200, diaDoMes: 20,
    inicio: "2026-04", fim: null, ativa: true, emitirAutomatico: false, enviarEmail: true, reajusteAnualPct: 0, historico: [] },
];

/**
 * ISS + retenções do CLIENTE.
 * ⚠ O ISS incide sobre o serviço e NÃO é retenção: ele não sai do líquido aqui. O que sai são as
 * retenções do tomador. Somá-lo ao retido faria o líquido do protótipo mentir por construção.
 * ⚠ PROTÓTIPO: esta conta não é regra fiscal validada — é o bastante para a tela reagir.
 */
function calcularImpostos({ valor, aliquotaIss, retencoes }) {
  const base = Number(valor) || 0;
  const r = retencoes || {};
  const p = (x) => (Number(x) || 0) / 100;
  const iss = +(base * p(aliquotaIss)).toFixed(2);
  const irrf = +(base * p(r.irrf)).toFixed(2);
  const pis = +(base * p(r.pis)).toFixed(2);
  const cofins = +(base * p(r.cofins)).toFixed(2);
  const csll = +(base * p(r.csll)).toFixed(2);
  const inss = +(base * p(r.inss)).toFixed(2);
  const retido = +(irrf + pis + cofins + csll + inss).toFixed(2);
  return { iss, irrf, pis, cofins, csll, inss, retido, liquido: +(base - retido).toFixed(2) };
}

function montarAuditoria({ status, dataIso, origem }) {
  const quem = origem === "avulsa" ? "Yago (contador)" : "Rotina do sistema";
  const linhas = [{ quando: dataIso, quem, acao: "Nota criada" }];
  if (status === "emitida" || status === "cancelada" || status === "substituida") {
    linhas.push({ quando: dataIso, quem: "Prefeitura", acao: "Autorizada" });
  }
  if (status === "rejeitada") linhas.push({ quando: dataIso, quem: "Prefeitura", acao: "Rejeitada — E101" });
  if (status === "processando") linhas.push({ quando: dataIso, quem: "Sistema", acao: "Enviada, aguardando retorno" });
  if (status === "cancelada") linhas.push({ quando: `${dataIso.slice(0, 8)}28`, quem: "Yago (contador)", acao: "Cancelada" });
  return linhas;
}

/**
 * As 30 notas, espalhadas por 2026-04 → 2026-08.
 * ⚠ DETERMINÍSTICO de propósito: `Math.random()` aqui faria o protótipo contar uma história
 * diferente a cada F5, e conferir a tela contra o que se viu antes deixaria de ser possível.
 */
function montarNotas() {
  const receita = [
    ["c1", "s5", 3200, "2026-04", 20, "emitida", "recorrente", "r6"],
    ["c2", "s2", 1800, "2026-04", 5, "emitida", "recorrente", "r1"],
    ["c3", "s4", 2400, "2026-04", 5, "emitida", "recorrente", "r2"],
    ["c6", "s2", 2100, "2026-04", 10, "emitida", "recorrente", "r3"],
    ["c8", "s1", 4500, "2026-04", 10, "emitida", "recorrente", "r4"],
    ["c4", "s3", 12000, "2026-04", 14, "emitida", "avulsa", null],

    ["c1", "s5", 3200, "2026-05", 20, "emitida", "recorrente", "r6"],
    ["c2", "s2", 1800, "2026-05", 5, "emitida", "recorrente", "r1"],
    ["c3", "s4", 2400, "2026-05", 5, "emitida", "recorrente", "r2"],
    ["c6", "s2", 2100, "2026-05", 10, "cancelada", "recorrente", "r3"],
    ["c8", "s1", 4500, "2026-05", 10, "emitida", "recorrente", "r4"],
    ["c7", "s2", 900, "2026-05", 22, "emitida", "avulsa", null],

    ["c1", "s5", 3200, "2026-06", 20, "emitida", "recorrente", "r6"],
    ["c2", "s2", 1800, "2026-06", 5, "emitida", "recorrente", "r1"],
    ["c3", "s4", 2400, "2026-06", 5, "emitida", "recorrente", "r2"],
    ["c6", "s2", 2100, "2026-06", 10, "emitida", "recorrente", "r3"],
    ["c8", "s1", 4500, "2026-06", 10, "emitida", "recorrente", "r4"],
    ["c5", "s1", 6800, "2026-06", 18, "emitida", "lote", "l1"],
    ["c4", "s4", 2400, "2026-06", 18, "emitida", "lote", "l1"],

    ["c1", "s5", 3200, "2026-07", 20, "emitida", "recorrente", "r6"],
    ["c2", "s2", 1800, "2026-07", 5, "emitida", "recorrente", "r1"],
    ["c3", "s4", 2400, "2026-07", 5, "emitida", "recorrente", "r2"],
    ["c6", "s2", 2100, "2026-07", 10, "emitida", "recorrente", "r3"],
    ["c8", "s1", 4500, "2026-07", 10, "rejeitada", "recorrente", "r4"],
    ["c7", "s2", 950, "2026-07", 25, "emitida", "avulsa", null],
    ["c4", "s3", 15000, "2026-07", 28, "emitida", "avulsa", null],

    ["c2", "s2", 1800, "2026-08", 5, "emitida", "recorrente", "r1"],
    ["c3", "s4", 2400, "2026-08", 5, "processando", "recorrente", "r2"],
    ["c8", "s1", 4500, "2026-08", 12, "rascunho", "avulsa", null],
    ["c1", "s5", 3200, "2026-08", 14, "emitida", "lote", "l2"],
  ];

  return receita.map((linha, i) => {
    const [clienteId, servicoId, valor, ref, dia, status, origem, origemId] = linha;
    const servico = SERVICOS.find((s) => s.id === servicoId);
    const cliente = CLIENTES.find((c) => c.id === clienteId);
    const impostos = calcularImpostos({ valor, aliquotaIss: servico.aliquotaIss, retencoes: cliente.retencoes });
    const dataIso = `${ref}-${String(dia).padStart(2, "0")}`;
    const emitiu = status !== "rascunho";
    return {
      id: `n${i + 1}`,
      // ⚠ Rascunho NÃO tem número — o número nasce na emissão. Dar número a rascunho faria um
      // buraco na numeração parecer nota perdida.
      numero: emitiu ? String(1000 + i) : null,
      clienteId, servicoId,
      descricao: `${servico.descricao} — ${Fmt.mesAno(ref)}`,
      valor,
      impostos,
      liquido: impostos.liquido,
      status, origem, origemId,
      referencia: ref,
      emitidaEm: emitiu ? dataIso : null,
      canceladaEm: status === "cancelada" ? `${ref}-28` : null,
      motivoRejeicao: status === "rejeitada" ? ERROS[0] : null,
      auditoria: montarAuditoria({ status, dataIso, origem }),
    };
  });
}

const LOTES = [
  { id: "l1", criadoEm: "2026-06-18", origem: "selecao",
    itens: [{ notaId: "n18", status: "emitida", erro: null }, { notaId: "n19", status: "emitida", erro: null }] },
  { id: "l2", criadoEm: "2026-08-14", origem: "planilha",
    itens: [{ notaId: "n30", status: "emitida", erro: null }] },
];

const state = {
  empresa: {
    razaoSocial: "ATIM Serviços Contábeis Ltda",
    cnpj: "99000111000132",
    im: "0112233-4",
    regime: "Simples Nacional",
    // Configurável em Configurações — é o que liga o aviso persistente da Fase 5.
    certificadoValidade: "2026-09-10",
  },
  clientes: CLIENTES,
  servicos: SERVICOS,
  notas: montarNotas(),
  recorrencias: RECORRENCIAS,
  lotes: LOTES,
  ui: { filtrosNotas: {}, toast: null, selecaoNotas: new Set() },
};
