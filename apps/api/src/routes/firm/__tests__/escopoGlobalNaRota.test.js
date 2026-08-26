// A PORTA DO ESCOPO GLOBAL — varredura de fonte.
//
// `AprendizadoService` ganhou o escopo GLOBAL (13 testes de comportamento em
// `apuracao/v2/__tests__/aprendizadoGlobal.test.js`). Regra nova sem porta é metade do defeito:
// este projeto já mediu caso de coluna que existia no model, voltava no payload e **não tinha campo
// em formulário nenhum** — e o de um seletor que a tela oferecia e o servidor recusava.
//
// ⚠⚠ O QUE ESTE ARQUIVO **NÃO** PROVA. Nenhum teste aqui sobe Express, autentica ninguém nem
// executa o middleware: ele lê o ARQUIVO da rota. Ele prova que a ligação está escrita e que a
// guarda de papel está no caminho — não que ela barre uma requisição real. Um teste de HTTP de
// verdade exigiria um harness que este router ainda não tem, e fingir que a varredura o substitui
// seria pior que declarar o limite.

import fs from "node:fs";
import path from "node:path";

const ROTA = path.resolve(__dirname, "../apuracaoV2.js");
const fonte = fs.readFileSync(ROTA, "utf-8");

describe("⚠ o `escopo` CHEGA ao serviço", () => {
  it("é lido do corpo da requisição", () => {
    // Sem isto o parâmetro novo do serviço fica inalcançável por HTTP, e a capacidade nasce morta.
    expect(fonte).toMatch(/const\s*\{[^}]*\bescopo\b[^}]*\}\s*=\s*req\.body/);
  });

  it("é repassado a `resolverPendenciaItemSemRegra`", () => {
    const chamada = fonte.slice(
      fonte.indexOf("resolverPendenciaItemSemRegra({"),
      fonte.indexOf("resolverPendenciaItemSemRegra({") + 400,
    );
    expect(chamada).toMatch(/escopo/);
  });

  it("⚠ e SÓ quando veio — corpo antigo continua caindo no default EMPRESA", () => {
    // `{ ...(escopo ? { escopo } : {}) }`: mandar `escopo: undefined` explicitamente também cairia
    // no default do serviço, mas o spread condicional deixa a intenção legível e não depende disso.
    expect(fonte).toMatch(/\.\.\.\(escopo\s*\?\s*\{\s*escopo\s*\}\s*:\s*\{\s*\}\)/);
  });
});

describe("⚠⚠ GLOBAL EXIGE FIRM_ADMIN — o alcance da decisão não pode exceder o da permissão", () => {
  it("a guarda existe, e compara com FIRM_ADMIN", () => {
    // O gate da rota responde "esta pessoa tem acesso a ESTA empresa?". Uma regra GLOBAL fecha
    // pendências e muda classificação de empresas que quem clicou pode nem enxergar.
    expect(fonte).toMatch(/escopo\s*===\s*"GLOBAL"/);
    expect(fonte).toMatch(/req\.access\?\.role[\s\S]{0,40}FIRM_ADMIN/);
  });

  it("recusa com 403 e código NOMEADO", () => {
    // Recusa genérica mandaria o contador procurar defeito onde há decisão de permissão.
    expect(fonte).toMatch(/403,\s*"escopo_global_exige_admin"/);
  });

  it("⚠ e a mensagem diz a CONSEQUÊNCIA, não só o requisito", () => {
    // "Exige FIRM_ADMIN" explica o que falta; não explica por que existe a exigência.
    const i = fonte.indexOf("escopo_global_exige_admin");
    const msg = fonte.slice(i, i + 400);
    expect(msg).toMatch(/todas as empresas/i);
    expect(msg).toMatch(/que você não acessa/i);
  });

  it("⚠⚠ a guarda vem ANTES da chamada ao serviço", () => {
    // Depois dela, a regra global já teria sido gravada e as pendências irmãs já estariam
    // fechadas — recusar em seguida devolveria 403 sobre um efeito que já aconteceu.
    const iGuarda = fonte.indexOf("escopo_global_exige_admin");
    const iChamada = fonte.indexOf("resolverPendenciaItemSemRegra({");
    expect(iGuarda).toBeGreaterThan(-1);
    expect(iChamada).toBeGreaterThan(-1);
    expect(iGuarda).toBeLessThan(iChamada);
  });
});

describe("⚠ O LIMITE DE SCHEMA FICA ESCRITO NA ROTA", () => {
  it("o comentário registra que `RegraClassificacao` não tem coluna de escritório", () => {
    // É o que impede a próxima sessão de assumir que o papel separa carteiras — ele não separa:
    // uma regra GLOBAL é global de verdade, e dividi-la por escritório exige migration.
    const i = fonte.indexOf("escopo_global_exige_admin");
    const bloco = fonte.slice(Math.max(0, i - 1400), i);
    expect(bloco).toMatch(/não tem coluna de escritório|migration/i);
  });
});
