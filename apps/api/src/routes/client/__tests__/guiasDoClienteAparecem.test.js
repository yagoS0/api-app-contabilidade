// ⚠⚠ A ABA DE GUIAS MOSTRA SÓ AS GUIAS LIBERADAS — e as AÇÕES continuam travadas (02/09/2026)
//
// > Dono, 02/09/2026: *"as únicas guias que devem aparecer no portal do cliente são as liberadas
// > pelo contador"*.
//
// ⚠⚠⚠ **ESTE ARQUIVO AFIRMAVA O CONTRÁRIO ATÉ HOJE, E O CONTRÁRIO TAMBÉM ERA DECISÃO DELE.** Em
// 30/08/2026: *"arruma a aba de guias, INSS e parcelamento não aparecem"*, com o critério *"a aba
// de guias é aba de guias, o fluxo é o fluxo"*. Medido então em produção
// (`scripts/diag-guias-do-cliente.mjs`): a ERISANGELA via **7 de 17** guias, e a carteira inteira
// tinha **24 liberadas contra 232 não liberadas** — não eram algumas guias escondidas, era a maior
// parte da dívida.
//
// ⚠⚠ **A REVERSÃO FOI FEITA COM ESSE CUSTO NA FRENTE DELE**, com os números do banco (3 liberadas
// de 16; duas empresas ficariam com a aba VAZIA), e ele reafirmou. As duas versões estão aqui de
// propósito: quem só ler uma delas vai achar que a outra é defeito.
//
// ⚠⚠ **O QUE NÃO VOLTOU JUNTO** é o que impede o defeito de 30/08 de renascer inteiro: o FLUXO
// continua contando toda guia — *"no caso do fluxo a previsão permanece"* —, e o que a liberação
// decide lá é a PROCEDÊNCIA (previsão × compromisso, *"só confirmada após a liberação"*). O imposto
// do mês continua na tela do cliente; o que ele não vê é o DOCUMENTO que ninguém lhe entregou.
//
// ⚠⚠ ESTE TESTE É DE FONTE, e tinha de ser: a suíte inteira ficou VERDE com a mudança, porque
// ninguém nunca afirmou o `apenasLiberadas` da rota do cliente. Um teste de comportamento com dublê
// não pegaria o dia em que alguém "restaurasse" o filtro, e a aba voltaria a esconder a dívida
// sem um vermelho sequer.

// ⚠ `require`, não `import`: esta suíte roda em CommonJS, e `import.meta` quebra em tempo de
// PARSE — o arquivo inteiro morre antes do primeiro teste. É o molde das outras varreduras daqui.
const fs = require("node:fs");
const path = require("node:path");

const FONTE = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

// ⚠ Tira comentários de BLOCO antes dos de LINHA — a ordem inversa deixa o fecho órfão e come
// código. ⚠ E esta nota é de LINHA de propósito: escrever o fecho de bloco dentro de um bloco
// encerra o comentário ali mesmo, e o arquivo morre no PARSE — foi o que aconteceu ao escrevê-la.
function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
const CODIGO = semComentarios(FONTE);

/** O corpo de uma rota, do `router.<verbo>("<caminho>"` até o fecho do arquivo (basta para varrer). */
function trechoDaRota(caminho, verbo = "get") {
  const i = CODIGO.indexOf(`router.${verbo}(`);
  const alvo = CODIGO.indexOf(caminho);
  expect(alvo).toBeGreaterThan(-1);
  return CODIGO.slice(alvo, alvo + 2500);
}

describe("⚠⚠ a LISTA de guias do cliente mostra SÓ as liberadas", () => {
  it("⚠⚠ `apenasLiberadas` é TRUE na rota da lista", () => {
    const trecho = trechoDaRota('"/companies/:companyId/guides"');
    expect(trecho).toMatch(/apenasLiberadas:\s*true/);
    expect(trecho).not.toMatch(/apenasLiberadas:\s*false/);
  });

  it("⚠⚠⚠ e o FLUXO continua SEM recorte — a previsão permanece", () => {
    // ⚠⚠ É a metade que impede a reversão de virar o defeito de 30/08 outra vez. Se alguém puser
    // `liberadaCliente` no `where` do fluxo, o imposto não liberado some da tela do cliente e o
    // número volta a não bater com o portal do contador — que foi exatamente a reclamação.
    const fluxo = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "application", "fluxo", "FluxoDeCaixaService.js"),
      "utf8",
    );
    const corpo = semComentarios(fluxo);
    const i = corpo.indexOf("client.guide.findMany");
    expect(i).toBeGreaterThan(-1);
    const where = corpo.slice(i, corpo.indexOf("select:", i));
    expect(where).not.toMatch(/liberadaCliente/);
  });

  it("⚠⚠ e o estado da liberação DESCE na resposta — senão a tela oferece o que o servidor recusa", () => {
    // Sem este campo o "Baixar PDF" apareceria habilitado numa guia cujo download responde 404.
    const service = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "application", "guides", "GuideService.js"), "utf8"
    );
    expect(semComentarios(service)).toMatch(/liberadaCliente:\s*Boolean\(item\.liberadaCliente\)/);
  });
});

describe("⚠⚠ as TRÊS ações continuam exigindo `liberadaCliente: true`", () => {
  // ⚠ Este é o outro lado da mudança, e é o que impede que ela vire "o cliente pode tudo".
  // ⚠⚠ O recálculo gasta dinheiro do escritório — o comentário dele diz "este gate NÃO se afrouxa".
  it.each([
    ['"/companies/:companyId/guides/:guideId/download"', "get"],
    ['"/companies/:companyId/guides/:guideId/recalculate"', "post"],
    ['"/companies/:companyId/guides/:guideId/confirmar-pagamento"', "post"],
  ])("%s continua com o gate", (caminho) => {
    const trecho = trechoDaRota(caminho);
    expect(trecho).toMatch(/liberadaCliente:\s*true/);
  });
});
