// O PERFIL DE EMISSÃO, DO LADO DA TELA — leitura, e nada além disso.
//
// ⚠⚠ ESTE ARQUIVO É ESPELHO DE `apps/api/src/application/nfse/perfilEmissao/campos.js`, e o espelho
// é AMARRADO POR TESTE: `__tests__/perfilEmissao.test.js` importa a lista do backend e exige os
// mesmos ids, na mesma ordem, com os mesmos valores de enumeração. Sem o amarre, "espelho" é
// intenção, e a divergência aparece como *"a tela ofereceu e o servidor recusou"* — que é o defeito
// que `codigoServicoDaNota` já pagou uma vez.
//
// ⚠ A METADATA VEM DO SERVIDOR quando ela chega (`resposta.campos`); o que está aqui é o FALLBACK
// e o vocabulário. Um contrato antigo que não traga `campos` não pode deixar a tela em branco.
//
// ⚠⚠ O QUE ESTA TELA RESPONDE, e é o valor da fase: **o que a próxima DPS desta empresa vai levar,
// e de ONDE cada valor sai**. Hoje `regApTribSN` e `tribISSQN` são CONSTANTES dentro do gerador —
// constante em código é invisível até a nota sair, e o contador nunca teve como ver isso antes.

/** As quatro procedências. ⚠ `INDEFINIDO` NÃO é "vazio": é "ninguém respondeu". */
export const FONTE = Object.freeze({
  PERFIL: "PERFIL",
  COMPANY: "COMPANY",
  CRAVADO: "CRAVADO",
  INDEFINIDO: "INDEFINIDO",
});

/**
 * A frase de cada procedência — ela é o produto, não o rótulo.
 *
 * ⚠ `CRAVADO` é a que justifica o painel: o contador precisa saber que aquele valor **não veio de
 * decisão nenhuma**, e que por isso não adianta procurá-lo no cadastro.
 */
export const TEXTO_DA_FONTE = Object.freeze({
  [FONTE.PERFIL]: "do perfil de emissão",
  [FONTE.COMPANY]: "do cadastro da empresa",
  [FONTE.CRAVADO]: "fixo no sistema — não vem de cadastro nenhum",
  [FONTE.INDEFINIDO]: "não configurado",
});

/** Espelho de `campos.js`. ⚠ A ORDEM importa: é a ordem em que a tela desenha. */
export const CAMPOS_PERFIL_EMISSAO = Object.freeze([
  Object.freeze({
    id: "codigoServicoNacional",
    rotulo: "Código de Tributação Nacional",
    tag: "cTribNac",
    caminhoNoXml: "infDPS/serv/cServ/cTribNac",
    formaDescrita: "6 dígitos",
    obrigatorio: true,
    cravadoHoje: false,
  }),
  Object.freeze({
    id: "codigoServicoMunicipal",
    rotulo: "Código Complementar Municipal",
    tag: "cTribMun",
    caminhoNoXml: "infDPS/serv/cServ/cTribMun",
    formaDescrita: "exatamente 3 dígitos",
    obrigatorio: false,
    cravadoHoje: false,
  }),
  Object.freeze({
    id: "cLocPrestacao",
    rotulo: "Município da prestação",
    tag: "cLocPrestacao",
    caminhoNoXml: "infDPS/serv/locPrest/cLocPrestacao",
    formaDescrita: "código do IBGE, 7 dígitos",
    obrigatorio: false,
    cravadoHoje: false,
  }),
  Object.freeze({
    id: "regEspTrib",
    rotulo: "Regime Especial de Tributação",
    tag: "regEspTrib",
    caminhoNoXml: "infDPS/prest/regTrib/regEspTrib",
    valores: Object.freeze(["0", "1", "2", "3", "4", "5", "6", "9"]),
    formaDescrita: "0 Nenhum · 1 Ato Cooperado · 2 Estimativa · 3 ME Municipal · 4 Notário · 5 Prof. Autônomo · 6 · 9",
    obrigatorio: false,
    cravadoHoje: false,
  }),
  Object.freeze({
    id: "regApTribSN",
    rotulo: "Regime de Apuração no Simples Nacional",
    tag: "regApTribSN",
    caminhoNoXml: "infDPS/prest/regTrib/regApTribSN",
    valores: Object.freeze(["1", "2", "3"]),
    formaDescrita: "1 federais e municipal pelo SN · 2 federais pelo SN, ISSQN por fora · 3 ambos por fora",
    obrigatorio: false,
    cravadoHoje: true,
  }),
  Object.freeze({
    id: "tribISSQN",
    rotulo: "Tributação do ISSQN",
    tag: "tribISSQN",
    caminhoNoXml: "infDPS/valores/trib/tribMun/tribISSQN",
    valores: Object.freeze(["1", "2", "3", "4"]),
    formaDescrita: "1 Operação tributável · 2 Imunidade · 3 Exportação · 4 Não incidência",
    obrigatorio: false,
    cravadoHoje: true,
  }),

  // ── NBS e IBS/CBS (02/09/2026) ───────────────────────────────────────────────
  // ⚠ Nenhum deles é `cravadoHoje`: o gerador simplesmente NÃO ESCREVIA a tag. Por isso a
  // procedência deles, sem perfil, é `INDEFINIDO` e não `CRAVADO` — dizer "cravado" afirmaria que
  // o gerador escolhe um valor, quando ele não escreve nada.
  Object.freeze({
    id: "codigoNbs",
    rotulo: "Item da NBS",
    tag: "cNBS",
    caminhoNoXml: "infDPS/serv/cServ/cNBS",
    formaDescrita: "código NBS pontuado e TERMINAL (ex.: 1.1502.10.00)",
    obrigatorio: false,
    cravadoHoje: false,
  }),
  Object.freeze({
    id: "ibscbsCIndOp",
    rotulo: "Código indicador da operação (IBS/CBS)",
    tag: "cIndOp",
    caminhoNoXml: "infDPS/IBSCBS/cIndOp",
    formaDescrita: "6 dígitos, do ANEXO VIII",
    obrigatorio: false,
    cravadoHoje: false,
  }),
  Object.freeze({
    id: "ibscbsCst",
    rotulo: "Situação tributária do IBS/CBS (CST)",
    tag: "CST",
    caminhoNoXml: "infDPS/IBSCBS/valores/trib/gIBSCBS/CST",
    formaDescrita: "3 dígitos",
    obrigatorio: false,
    cravadoHoje: false,
  }),
  Object.freeze({
    id: "ibscbsCClassTrib",
    rotulo: "Classificação tributária do IBS/CBS",
    tag: "cClassTrib",
    caminhoNoXml: "infDPS/IBSCBS/valores/trib/gIBSCBS/cClassTrib",
    formaDescrita: "6 dígitos, do ANEXO VIII",
    obrigatorio: false,
    cravadoHoje: false,
  }),
]);

/** As descrições dos valores — para a tela não mostrar um "3" cru sobre tributação. */
export const DESCRICAO_DO_VALOR = Object.freeze({
  regEspTrib: Object.freeze({
    0: "Nenhum", 1: "Ato Cooperado", 2: "Estimativa", 3: "Microempresa Municipal",
    4: "Notário ou Registrador", 5: "Profissional Autônomo", 6: "—", 9: "—",
  }),
  regApTribSN: Object.freeze({
    1: "Tributos federais e municipal pelo Simples Nacional",
    2: "Federais pelo Simples Nacional; ISSQN pela NFS-e",
    3: "Federais e municipal pela NFS-e",
  }),
  tribISSQN: Object.freeze({
    1: "Operação tributável", 2: "Imunidade", 3: "Exportação de serviço", 4: "Não incidência",
  }),
});

/** O texto que a tela mostra no valor. ⚠ Ausência vira travessão, nunca "0" nem string vazia. */
export function textoDoValor(id, valor) {
  if (valor === null || valor === undefined || String(valor).trim() === "") return "—";
  const bruto = String(valor);
  const desc = DESCRICAO_DO_VALOR[id]?.[bruto];
  return desc ? `${bruto} — ${desc}` : bruto;
}

/**
 * Traduz a resposta da rota nas LINHAS que o painel desenha.
 *
 * ⚠⚠ TRÊS ESTADOS, e o terceiro não é "sem perfil": `NAO_RECEBIDA` é fato sobre a RESPOSTA (contrato
 * antigo, rota fora do ar), e é diferente de "esta empresa não tem perfil". Distinguir é o que
 * impede a tela de afirmar coisa sobre o cadastro quando o problema é a chamada — mesma disciplina
 * de `cargaTributaria.js` no portal do cliente.
 */
export const ESTADO = Object.freeze({
  NAO_RECEBIDA: "nao_recebida",
  SEM_PERFIL: "sem_perfil",
  COM_PERFIL: "com_perfil",
});

export function lerPainelDaProximaDps(resposta) {
  if (!resposta || typeof resposta !== "object" || !resposta.proximaDps) {
    return { estado: ESTADO.NAO_RECEBIDA, linhas: [], avisos: [], integracaoLigada: false, mudariam: 0 };
  }

  const { proximaDps } = resposta;
  const metadata = Array.isArray(resposta.campos) && resposta.campos.length
    ? resposta.campos
    : CAMPOS_PERFIL_EMISSAO;

  const linhas = metadata.map((def) => {
    const c = proximaDps.campos?.[def.id] || {};
    const fonte = c.fonte || FONTE.INDEFINIDO;
    return {
      id: def.id,
      rotulo: c.rotulo || def.rotulo,
      tag: c.tag || def.tag,
      caminhoNoXml: c.caminhoNoXml || def.caminhoNoXml,
      // ⚠ `cravadoHoje` vem do servidor quando vem; o fallback é a lista espelho.
      cravadoHoje: c.cravadoHoje ?? def.cravadoHoje === true,
      valor: c.valor ?? null,
      texto: textoDoValor(def.id, c.valor),
      fonte,
      textoDaFonte: TEXTO_DA_FONTE[fonte] || TEXTO_DA_FONTE[FONTE.INDEFINIDO],
      mudariaComPerfil: c.mudariaComPerfil === true,
      textoHoje: textoDoValor(def.id, c.valorHoje),
    };
  });

  return {
    estado: proximaDps.temPerfil ? ESTADO.COM_PERFIL : ESTADO.SEM_PERFIL,
    linhas,
    avisos: Array.isArray(proximaDps.avisos) ? proximaDps.avisos : [],
    // ⚠ `=== true`, nunca truthy: um contrato que não traga a flag NÃO pode ser lido como ligada.
    // `Boolean("false")` é `true`, e é a armadilha que `portaoEmissao.js` já documenta.
    integracaoLigada: resposta.integracaoLigada === true,
    perfisAtivos: Number(proximaDps.perfisAtivos) || 0,
    mudariam: linhas.filter((l) => l.mudariaComPerfil).length,
  };
}

/**
 * A frase do rodapé do painel — ela existe para a tela NÃO prometer efeito que não existe.
 *
 * ⚠⚠ COM A INTEGRAÇÃO DESLIGADA O PAINEL É INFORMATIVO. Dizer "esta nota vai sair assim" enquanto
 * o gerador ainda lê o cadastro seria uma frase falsa sobre documento fiscal — e a frase que
 * descreve um comportamento é parte do comportamento.
 */
export function fraseDoEfeito({ integracaoLigada, mudariam }) {
  if (!integracaoLigada) {
    return mudariam > 0
      ? `O perfil ainda NÃO manda no XML: ${mudariam} campo(s) sairiam diferentes quando ele for ligado.`
      : "O perfil ainda não manda no XML. Com a configuração atual, nada sairia diferente.";
  }
  return mudariam > 0
    ? `O perfil manda no XML: ${mudariam} campo(s) saem do perfil, não do cadastro.`
    : "O perfil manda no XML, e com a configuração atual ele produz o mesmo que o cadastro.";
}
