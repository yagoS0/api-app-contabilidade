// O CLIENTE DECLARA A RECORRÊNCIA — *"essa é a taxa anual que pago de Conselho"*.
//
// ⚠⚠ ELA NASCE PENDENTE e NÃO entra no fluxo sozinha. Quem confirma é o contador — a mesma forma
// que a nota e o extrato já seguem.
//
// ⚠ Este arquivo é VARREDURA DE FONTE, e não teste de comportamento: `routes/client/index.js` é um
// router de ~1.400 linhas com dezenas de dependências, e montá-lo aqui provaria pouco e quebraria
// muito. O que se prende é o que a montagem tem de dizer — e é exatamente a classe de defeito que
// este projeto já pagou cinco vezes (`legacyCompanySelect`, `resolveLegacyCompanyId`).

import fs from "node:fs";
import path from "node:path";

const FONTE = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
/**
 * O bloco da porta, do COMENTÁRIO ao fim do handler.
 *
 * ⚠ Ele começa no comentário de propósito: parte do que se prende aqui é o que está ESCRITO (a
 * ausência da extração por LLM), e uma fatia que começasse no `router.post` deixaria isso de fora.
 */
const BLOCO = (() => {
  const marca = FONTE.indexOf("⚠⚠ O CLIENTE DECLARA A RECORRÊNCIA");
  expect(marca).toBeGreaterThan(-1);
  // ⚠ Recua até a ABERTURA do JSDoc. Fatiar a partir do texto INTERNO deixa a fatia sem o `/**`, e
  // aí o removedor de comentários não acha o que remover — o comentário inteiro passa por código.
  const i = FONTE.lastIndexOf("/**", marca);
  const j = FONTE.indexOf("// Fase 7 (stub inicial)", marca);
  return FONTE.slice(i, j > i ? j : i + 6000);
})();

/**
 * ⚠⚠ O MESMO BLOCO, SEM OS COMENTÁRIOS — e as duas fatias existem porque são DUAS perguntas.
 *
 * *"A porta lê texto livre?"* se responde no CÓDIGO; *"a ausência está dita?"* se responde no
 * COMENTÁRIO. Varrer o bloco inteiro atrás de `llm` acusaria a própria explicação de que não há LLM
 * — é o defeito que este projeto já corrigiu duas vezes ("varredura que acusa a explicação que a
 * justifica não prova nada"), e ele acabou de reaparecer aqui.
 *
 * ⚠ BLOCO antes de LINHA: um `//` dentro de `/* *​/` apaga o fechamento e o regex não-guloso engole
 * o código real até o `*​/` seguinte.
 */
const CODIGO = BLOCO.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("⚠⚠ A PORTA EXISTE E ESTÁ MONTADA", () => {
  it("a rota é `POST /companies/:companyId/recorrencia/declarar`", () => {
    expect(FONTE).toMatch(/router\.post\(\s*"\/companies\/:companyId\/recorrencia\/declarar"/);
  });

  it("⚠⚠ ela chama o SERVIÇO — a regra não é reimplementada aqui", () => {
    expect(BLOCO).toMatch(/await declararSerie\(/);
    expect(FONTE).toMatch(/from "\.\.\/\.\.\/application\/fluxo\/SerieRecorrenteService\.js"/);
  });

  it("⚠ o serializador vem do SERVIÇO, não da rota do escritório", () => {
    // Importar `paraTela` de `../firm/recorrencia.js` puxaria um router inteiro do OUTRO lado para
    // dentro do do cliente — acoplando os dois por acidente.
    expect(FONTE).not.toMatch(/from "\.\.\/firm\/recorrencia\.js"/);
    expect(FONTE).toMatch(/paraTela,\s*\n\}\s*from "\.\.\/\.\.\/application\/fluxo\/SerieRecorrenteService\.js"/);
  });
});

describe("⚠⚠ O QUE A PORTA NÃO ACEITA", () => {
  it("⚠⚠ NENHUMA CONTA — o cliente não tem plano de contas, e isto é sobre CAIXA", () => {
    expect(BLOCO).not.toMatch(/contaAplicada|contaSugerida|contaDestino|codigoCompleto/);
  });

  it("⚠⚠ NENHUM ESTADO vindo do corpo — ela nasce PENDENTE, e o cliente não decide isso", () => {
    expect(BLOCO).not.toMatch(/corpo\.estado|body\.estado/);
  });

  it("⚠ e não aceita `origem`: uma declaração é DECLARADA, por construção", () => {
    expect(BLOCO).not.toMatch(/corpo\.origem|body\.origem/);
  });

  it("⚠⚠ o `portalClientId` vem do PATH, nunca do corpo", () => {
    // É o furo de multi-tenancy que a F1 do WhatsApp pagou duas vezes: corpo sobrescrevendo o path.
    expect(BLOCO).toMatch(/portalClientId:\s*String\(req\.params\.companyId\)/);
    expect(BLOCO).not.toMatch(/portalClientId:\s*corpo|\.\.\.corpo/);
  });
});

describe("⚠ O PISO DE PAPEL", () => {
  it("⚠ `requireClientCompanyAccess()` SEM `minRole` — declarar não é ato fiscal nem financeiro", () => {
    // Nada acontece até o contador confirmar. Mesmo piso das outras rotas financeiras do cliente.
    expect(BLOCO).toMatch(/requireClientCompanyAccess\(\)/);
    expect(BLOCO).not.toMatch(/requireClientCompanyAccess\(\{\s*minRole/);
  });
});

describe("⚠⚠ O QUE A RESPOSTA PRECISA DIZER", () => {
  it("⚠⚠ `jaDecidida` VIAJA — a declaração não sobrescreve o que o contador já decidiu", () => {
    // Sem este campo, o cliente declara, recebe 200, e acha que mudou algo que não mudou.
    expect(BLOCO).toMatch(/jaDecidida:\s*r\.jaDecidida/);
  });

  it("⚠ a recusa é NOMEADA, e a tabela ausente vira 503 — não 400 nem 500", () => {
    expect(BLOCO).toMatch(/SerieRecusada/);
    expect(BLOCO).toMatch(/RECUSA_DA_SERIE\.INDISPONIVEL\s*\?\s*503\s*:\s*400/);
  });
});

describe("⚠⚠ A EXTRAÇÃO DE TEXTO LIVRE NÃO EXISTE, E ISSO ESTÁ DITO", () => {
  it("a rota não finge ler texto livre", () => {
    // O plano previa a LLM extraindo `{valor, periodicidade, descrição}` de *"1.000 que eu pago de
    // jantar todo mês"*. Não há nenhuma integração de LLM neste repositório — aceitar um texto e
    // fingir que foi lido seria pior que não aceitar.
    // ⚠ Sobre o CÓDIGO, não sobre o bloco inteiro — ver a nota de `CODIGO`.
    expect(CODIGO).not.toMatch(/textoLivre|extrair|llm|anthropic|openai/i);
    // ⚠ contraprova: a varredura reconhece o padrão quando ele existe de verdade.
    expect("const t = extrairComLlm(corpo.texto);").toMatch(/extrair|llm/i);
  });

  it("⚠ e a ausência está ESCRITA no comentário da porta, não só ausente do código", () => {
    expect(BLOCO).toMatch(/EXTRAÇÃO DE TEXTO LIVRE NÃO EXISTE/i);
  });
});
