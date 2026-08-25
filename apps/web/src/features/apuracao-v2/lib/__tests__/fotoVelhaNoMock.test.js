// ⚠⚠ O RAMO DA FOTO VELHA PRECISA EXISTIR OFFLINE — senão ele só existe em produção.
//
// Este projeto foi mordido QUATRO vezes por ramo que o mock não alcançava (o `type` da janela de
// NF-e, a lista plural de códigos de serviço, o `prefill` do cadastro, os valores redondos do
// planejamento). O aviso "este relatório é uma foto e o que ele diz já mudou" quase virou o quinto:
// o mock só produzia `RECEITA_NAO_CLASSIFICADA`, que é justamente o bloqueio que a leitura NÃO
// reconfere (`aindaVale: null`) — com só ele, o caminho novo seria invisível no modo demonstração.
//
// ⚠ E o caso é o REAL: a LENTE tinha a foto de 25/08/2026 12:26:57 e o `CadastroFiscal` criado às
// 12:55:24, 28 minutos depois.

import { createMockApi } from "../../../../api/mock/mockApi";
import { diagnosticoDaFoto } from "../relatorioFaturamento";

const api = createMockApi();
const COMP = "2026-07";

/** ⚠ A lista do mock é `listCompanies`, e o formato varia — normaliza aqui, uma vez. */
async function listar() {
  const r = await api.listCompanies("2026-07");
  return Array.isArray(r) ? r : (r?.companies || r?.items || []);
}

async function empresaComBloqueioDeCadastro() {
  const companies = await listar();
  for (const c of companies) {
    const id = c.companyId || c.id;
    await api.gerarRelatorioFaturamento(id, COMP);
    const { relatorio } = await api.getRelatorioFaturamento(id, COMP);
    const tipos = (relatorio?.dados?.preApurado?.blockers || []).map((b) => b.tipo);
    if (tipos.includes("CADASTRO_FALTANDO")) return relatorio;
  }
  return null;
}

describe("⚠⚠ o mock alcança o ramo da foto velha", () => {
  it("existe UMA empresa cujo relatório carrega CADASTRO_FALTANDO", async () => {
    expect(await empresaComBloqueioDeCadastro()).not.toBeNull();
  });

  it("e o `diagnostico` dela produz o aviso na tela", async () => {
    const rel = await empresaComBloqueioDeCadastro();
    const d = diagnosticoDaFoto(rel);
    expect(d).not.toBeNull();
    expect(d.detalhe).toMatch(/Cadastro Fiscal foi preenchido depois/i);
  });

  it("o bloqueio de cadastro sai marcado como CAÍDO, que é o cenário que se quer ver na tela", async () => {
    const rel = await empresaComBloqueioDeCadastro();
    const estados = rel.diagnostico.bloqueios.map((b) => [b.tipo, b.aindaVale]);
    expect(estados).toEqual(expect.arrayContaining([["CADASTRO_FALTANDO", false]]));
    expect(diagnosticoDaFoto(rel).caidos).toEqual(["CADASTRO_FALTANDO"]);
  });

  // ⚠⚠ LIMITE DECLARADO, e ele é maior que este arquivo: MEDIDO ao escrever isto, as SEIS empresas
  // do mock têm faturamento ZERO na competência padrão. Ou seja, o estado que é 100% da produção
  // hoje — "há receita e ela não está classificada" — não é caminhável no modo demonstração, e por
  // isso `CADASTRO_FALTANDO` teve de ser desatado de `semReceita` para este ramo existir.
  // A CONVIVÊNCIA dos dois estados (um caído + um não conferido) fica coberta pelos testes de
  // unidade dos dois lados (`fotoDoRelatorioNaoDiagnostica` na API, `fotoVelhaNaoDiagnostica` aqui).
  // Dar faturamento ao mock é conserto à parte — fica NOMEADO, não escondido.
  it("⚠ hoje o mock não tem faturamento na competência padrão — e isso está aqui para ser visto", async () => {
    const companies = await listar();
    const totais = [];
    for (const c of companies) {
      const id = c.companyId || c.id;
      await api.gerarRelatorioFaturamento(id, COMP);
      const { relatorio } = await api.getRelatorioFaturamento(id, COMP);
      totais.push(relatorio?.dados?.totalMes?.valorContabil ?? null);
    }
    // Quando alguém der faturamento ao mock, este teste cai — e é o sinal de que a convivência
    // passou a ser caminhável na tela. Ele existe para ser derrubado.
    expect(totais.every((t) => t === 0)).toBe(true);
  });

  it("⚠ relatório NUNCA gerado não ganha diagnóstico — ler não gera", async () => {
    const companies = await listar();
    const id = companies[0].companyId || companies[0].id;
    const { relatorio } = await api.getRelatorioFaturamento(id, "2019-01");
    expect(relatorio).toBeNull();
  });
});
