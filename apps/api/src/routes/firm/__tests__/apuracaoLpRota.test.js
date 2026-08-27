// A PORTA DA APURAÇÃO DO LUCRO PRESUMIDO — varredura de fonte.
//
// `LucroPresumidoCalculoService` existe desde 14/07/2026 e **nunca teve consumidor de tela**: o
// motor calculava e ninguém pedia. Regra sem porta é metade do defeito, e este projeto já mediu
// caso de coluna que voltava no payload e não tinha campo em formulário nenhum.
//
// ⚠⚠ O QUE ESTE ARQUIVO **NÃO** PROVA. Nenhum teste aqui sobe Express, autentica ninguém nem
// executa o middleware: ele lê o ARQUIVO da rota. Ele prova que a ligação está escrita e que as
// guardas estão no caminho — não que elas barrem uma requisição real. Um teste de HTTP de verdade
// exigiria um harness que este router ainda não tem, e fingir que a varredura o substitui seria
// pior que declarar o limite. Mesmo molde de `escopoGlobalNaRota.test.js`.

import fs from "node:fs";
import path from "node:path";

const ROTA = path.resolve(__dirname, "../apuracaoV2.js");
const fonte = fs.readFileSync(ROTA, "utf-8");
// ⚠ O recorte começa no CABEÇALHO do bloco, não no `router.get`: metade das decisões desta rota
// (só leitura, sem snapshot, sem SERPRO) está nos comentários acima dela, e um recorte que os
// deixasse de fora provaria menos do que parece.
const INICIO = fonte.indexOf("// ─── APURAÇÃO DO LUCRO PRESUMIDO");
const bloco = fonte.slice(INICIO, INICIO + 3400);

describe("⚠ a rota existe e chega ao serviço", () => {
  it("é um GET literal, por competência", () => {
    expect(fonte).toMatch(/router\.get\(\s*"\/apuracao-lp\/:competencia"/);
  });

  it("importa `reconciliarLp` — e não reimplementa o cálculo", () => {
    expect(fonte).toMatch(/import \{ reconciliarLp \} from ".*LucroPresumidoCalculoService\.js"/);
    // Uma segunda conta de presunção na rota divergiria da do motor na primeira correção.
    expect(bloco).not.toMatch(/0\.32|0\.08|0\.0065|60000/);
  });

  it("o gate é ACCOUNTANT, o mesmo das outras rotas de apuração da empresa", () => {
    expect(bloco).toMatch(/requireFirmCompanyAccess\(\{ minRole: "ACCOUNTANT" \}\)/);
  });

  it("competência fora do formato é recusada com código nomeado", () => {
    expect(bloco).toMatch(/invalid_competencia/);
  });
});

describe("⚠⚠ A GUARDA DE REGIME — e ela vem ANTES do cálculo", () => {
  it("usa `podeApurarPresumido`, não um `if` escrito à mão", () => {
    // Duas leituras de regime divergiriam, e a tela mostraria uma aba enquanto a rota calcularia
    // outra coisa.
    expect(fonte).toMatch(/import \{ podeApurarPresumido \} from ".*regimeDoPresumido\.js"/);
    expect(bloco).toMatch(/podeApurarPresumido\(regime\)/);
  });

  it("recusa com 409 e código NOMEADO", () => {
    expect(bloco).toMatch(/409,\s*"regime_nao_apura_presumido"/);
  });

  it("⚠⚠ a guarda vem ANTES da chamada ao serviço", () => {
    // Depois dela, o cálculo já teria rodado — recusar em seguida devolveria 409 sobre um trabalho
    // que já foi feito, e o custo aqui é uma varredura de notas da carteira.
    const iGuarda = bloco.indexOf("if (!porta.pode)");
    const iCalculo = bloco.indexOf("await reconciliarLp(");
    expect(iGuarda).toBeGreaterThan(-1);
    expect(iCalculo).toBeGreaterThan(-1);
    expect(iGuarda).toBeLessThan(iCalculo);
  });

  it("⚠ o aviso de regime desconhecido CHEGA ao payload", () => {
    // Ele é o que impede o cálculo sobre um regime não cadastrado de se ler como apuração conferida.
    expect(bloco).toMatch(/avisoDeRegime: porta\.aviso/);
  });
});

describe("⚠⚠ OS DOIS IDS — `PortalClient` não tem relação `company`", () => {
  it("o regime é lido por consulta SEPARADA à `Company`, pelo `companyId`", () => {
    // `select: { company: { … } }` estouraria em runtime: só existe o escalar `companyId`.
    expect(bloco).toMatch(/select: \{ companyId: true \}/);
    expect(bloco).toMatch(/prisma\.company\.findUnique/);
    expect(bloco).not.toMatch(/company: \{ select:/);
  });
});

describe("⚠⚠ OS TRÊS ESTADOS DOS R$ 120.000 SOBREVIVEM À QUERY STRING", () => {
  it('só "true" e "false" viram booleano — o resto é `null`', () => {
    // `?servicos16=` é "não veio", não "o contador disse que não". `Boolean("")` é `false` e
    // `Boolean("false")` é `true`: as duas leituras ingênuas erram, em direções opostas.
    expect(bloco).toMatch(/cru === "true" \? true : cru === "false" \? false : null/);
  });

  it("⚠ e o custo de a confirmação NÃO persistir fica escrito na rota", () => {
    // Não há coluna para ela em lugar nenhum, e criar uma é migration — decisão do dono. Sem esta
    // nota, a próxima sessão descobre o recustar sozinha.
    expect(bloco).toMatch(/NÃO PERSISTE|não persiste/);
    expect(bloco).toMatch(/migration/i);
  });
});

describe("⚠ NADA NESTA ROTA CHAMA O SERPRO", () => {
  it("ela não é envolvida por `comContextoSerpro` nem chama serviço de captura", () => {
    // A consulta é PAGA e o teto AV02 é por contratante. Esta rota lê o que já está capturado.
    expect(bloco).not.toMatch(/comContextoSerpro|captureSerpro|Pgdas|GERARGUIA31|CONSDECCOMPLETA33/);
  });

  it("⚠ e ela não grava snapshot — `ApuracaoSnapshot.rbt12` é NOT NULL", () => {
    // Inventar um RBT12 para o Presumido seria fabricar dado fiscal.
    expect(bloco).not.toMatch(/apuracaoSnapshot|\.create\(|\.update\(|\.upsert\(/);
    expect(bloco).toMatch(/NÃO GRAVA SNAPSHOT|rbt12/i);
  });
});
