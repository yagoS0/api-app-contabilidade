// ⚠⚠ EXISTEM DUAS TABELAS DE ALÍQUOTAS DO SIMPLES NESTE REPOSITÓRIO, E NADA AS AMARRAVA.
//
// | onde | quem lê | tem repartição por tributo? |
// |---|---|---|
// | `apps/api/.../seeds/AliquotaSimplesNacionalSeeds.js` | o MOTOR (`AliquotaResolver`, o DAS calculado) | **não** |
// | `apps/web/.../planejamento/lib/tabelasFiscais.js` | a TELA (comparativo, gauge, tabela de referência) | **sim** |
//
// São as MESMAS 30 linhas da Resolução CGSN 140/2018 (LC 155/2016), escritas duas vezes. O motor
// calcula com uma; a tela mostra a outra. Enquanto ninguém as prende, a próxima correção fiscal
// entra num lado só — e o sintoma é o pior tipo: **os dois números continuam plausíveis**, e a
// única pessoa que percebe é o contador que somar na mão.
//
// Medido em 26/08/2026, antes de escrever esta trava: **30 de 30 linhas conferem**. Ou seja, ela
// não conserta divergência nenhuma — ela impede a que ainda não aconteceu. É por isso que existe
// agora e não depois: depois, alguém já teria de descobrir QUAL das duas está certa.
//
// ⚠ POR QUE A LEITURA É TEXTUAL, e não um `import` do arquivo do backend.
// Importar código de um app no outro é o defeito que este projeto já pagou (o `ATIVIDADES_PRESUMIDO`
// importado do web para dentro da API quebrava o boot). O precedente desta casa é ler o arquivo do
// outro app como TEXTO, dentro do teste — o mesmo que `categoriaPresumido` faz. O teste é o único
// lugar em que os dois apps podem se olhar.
//
// ⚠ E ESTE TESTE NÃO DECIDE QUAL DAS DUAS ESTÁ CERTA. Ele afirma só que elas dizem a mesma coisa.
// Divergindo, quem decide é a fonte oficial (Resolução CGSN 140/2018), nunca o teste — "consertar"
// copiando um lado no outro sem abrir a Resolução é como uma alíquota errada se torna permanente.

import fs from "node:fs";
import path from "node:path";
import { ANEXO_I, ANEXO_II, ANEXO_III, ANEXO_IV, ANEXO_V } from "../tabelasFiscais";

const CAMINHO_DO_SEED = path.resolve(
  __dirname,
  "../../../../../../../apps/api/src/application/notas/apuracao/v2/seeds/AliquotaSimplesNacionalSeeds.js",
);

/** As linhas do seed do backend, lidas do texto: `["I", 1, 0.00, 180000.00, 0.0400, 0.00]`. */
function lerSeedDoBackend() {
  const fonte = fs.readFileSync(CAMINHO_DO_SEED, "utf-8");
  const re = /\[\s*"(I{1,3}V?|V)"\s*,\s*(\d)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/g;
  const linhas = [];
  let m;
  while ((m = re.exec(fonte)) !== null) {
    linhas.push({
      anexo: m[1], faixa: Number(m[2]),
      rbt12Min: Number(m[3]), rbt12Max: Number(m[4]),
      aliquotaNominal: Number(m[5]), parcelaDeduzir: Number(m[6]),
    });
  }
  return linhas;
}

const DO_FRONT = { I: ANEXO_I, II: ANEXO_II, III: ANEXO_III, IV: ANEXO_IV, V: ANEXO_V };

describe("⚠⚠ AS DUAS TABELAS DE ANEXO DIZEM A MESMA COISA", () => {
  const seed = lerSeedDoBackend();

  it("⚠ o arquivo do backend foi encontrado e LIDO — regex que não casa nada passaria vazia", () => {
    // Sem esta asserção, um seed renomeado ou reformatado faria o teste inteiro virar um laço sobre
    // lista vazia: 30 comparações viram zero comparações, e a suíte fica VERDE sem conferir nada.
    // É a mesma armadilha do "a contagem não é prova" registrada nos geradores da LC 116 e da NBS.
    expect(fs.existsSync(CAMINHO_DO_SEED)).toBe(true);
    expect(seed).toHaveLength(30);
  });

  it("⚠ e os cinco anexos aparecem, com seis faixas cada — não 30 linhas de um anexo só", () => {
    for (const anexo of ["I", "II", "III", "IV", "V"]) {
      const faixas = seed.filter((l) => l.anexo === anexo).map((l) => l.faixa);
      expect(faixas).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it.each(["I", "II", "III", "IV", "V"])(
    "ANEXO %s — alíquota nominal e parcela a deduzir batem nas 6 faixas",
    (anexo) => {
      const doBack = seed.filter((l) => l.anexo === anexo);
      const doFront = DO_FRONT[anexo].faixas;
      expect(doFront).toHaveLength(6);
      for (const linha of doBack) {
        const f = doFront[linha.faixa - 1];
        expect({ faixa: linha.faixa, aliquota: f.aliquota, pd: f.pd })
          .toEqual({ faixa: linha.faixa, aliquota: linha.aliquotaNominal, pd: linha.parcelaDeduzir });
      }
    },
  );

  it("⚠ os LIMITES de cada faixa também batem — a faixa errada muda o DAS tanto quanto a alíquota", () => {
    // O front guarda as faixas UMA vez (`FAIXAS_RBT12`, iguais para todos os anexos, espalhadas em
    // cada linha por `linhas()`); o backend as repete em cada linha do seed. Se um dos dois mover um
    // limite, a mesma empresa cai em faixas diferentes nas duas telas, com as duas alíquotas
    // "certas" — e nada acusa.
    //
    // ⚠ Lido de dentro do ANEXO, não de um export novo: `FAIXAS_RBT12` é privado de propósito (as
    // faixas não existem soltas, elas são parte de cada anexo), e exportá-la só para o teste ver
    // seria o teste mudando o desenho do módulo que ele mede.
    for (const linha of seed) {
      const faixa = DO_FRONT[linha.anexo].faixas[linha.faixa - 1];
      expect({ anexo: linha.anexo, de: faixa.de, ate: faixa.ate })
        .toEqual({ anexo: linha.anexo, de: linha.rbt12Min, ate: linha.rbt12Max });
    }
  });

  it("⚠⚠ a REPARTIÇÃO por tributo é só do front — e isso NÃO é a divergência, é o desenho", () => {
    // O motor não reparte: ele calcula o DAS, e quem reparte é a RFB. Um teste que exigisse
    // `partilha` no seed mandaria alguém escrever no backend uma tabela que nada lá consome.
    for (const anexo of ["I", "II", "III", "IV", "V"]) {
      for (const f of DO_FRONT[anexo].faixas) {
        const soma = Object.values(f.partilha).reduce((a, b) => a + b, 0);
        expect(soma).toBeCloseTo(1, 4); // a partilha reparte 100% do DAS, sempre
      }
    }
    expect(fs.readFileSync(CAMINHO_DO_SEED, "utf-8")).not.toMatch(/partilha|irpj|csll/i);
  });
});
