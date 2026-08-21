// ⚠⚠ CHIP SEM COR É UM DEFEITO SILENCIOSO — e este projeto já o nomeou uma vez.
//
// `features/lote/lib/__tests__/emissaoDoLote.test.js` traz a frase inteira: *"o `status` do chip
// tem de estar na lista de `data-status` do CSS — valor fora dela renderiza SEM COR NENHUMA, em
// silêncio. Foi o defeito da primeira escrita deste módulo."* Aquela lista cobre o vocabulário da
// NOTA; quando a GUIA ganhou o seu (`paga`/`vencida`/`aberta`, em 20/08/2026), ela não foi
// estendida e o vocabulário novo entrou sem guarda nenhuma.
//
// ⚠ Este teste lê o CSS DE VERDADE, em vez de repetir a lista à mão. Uma lista copiada tem o mesmo
// problema que ela quer resolver: alguém renomeia a regra no `app.css` e a cópia continua verde.

import fs from "node:fs";
import path from "node:path";
import { CHIP_POR_PAGAMENTO, chipDaGuia } from "../GuiasPage";

const css = fs.readFileSync(path.join(__dirname, "../../../styles/app.css"), "utf8");

/** Os `data-status` que o CSS realmente pinta. */
const PINTADOS = new Set(
  [...css.matchAll(/\.chip\[data-status="([^"]+)"\]/g)].map((m) => m[1]),
);

describe("o chip da guia tem cor no CSS", () => {
  it("o CSS pinta pelo menos os seis valores de nota + os três de guia", () => {
    expect(PINTADOS.size).toBeGreaterThanOrEqual(9);
  });

  it.each(Object.entries(CHIP_POR_PAGAMENTO))(
    "%s → `%s` é um `data-status` que o CSS conhece",
    (_pagamento, { status }) => {
      expect(PINTADOS.has(status)).toBe(true);
    },
  );

  it("⚠ GUIA NÃO USA VOCABULÁRIO DE NOTA — `emitida`/`rejeitada`/`rascunho` não aparecem aqui", () => {
    const usados = Object.values(CHIP_POR_PAGAMENTO).map((c) => c.status);
    for (const deNota of ["emitida", "rejeitada", "rascunho", "substituida", "processando"]) {
      expect(usados).not.toContain(deNota);
    }
  });

  it("⚠ status desconhecido não FABRICA cor — devolve `null` e o chip fica no cinza padrão", () => {
    expect(chipDaGuia("QUALQUER_COISA").status).toBeNull();
    expect(chipDaGuia(null).status).toBeNull();
    expect(chipDaGuia(undefined).status).toBeNull();
  });
});
