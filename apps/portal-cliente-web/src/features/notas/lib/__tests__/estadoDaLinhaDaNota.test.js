// ⚠⚠ DOIS FATOS DIFERENTES NÃO PODEM TER O MESMO DESENHO.
//
//   `aguardando_adn`       — emitida por nós, o ADN ainda não devolveu. Nota VÁLIDA.
//   `cancelamento_enviado` — a pessoa acabou de mandar CANCELAR. Feedback de uma ação dela.
//
// Os dois são "esperando o ADN", mas um espera a confirmação de que a nota EXISTE e o outro, de que
// ela DEIXOU de valer. Confundi-los é o defeito que este projeto persegue.

import { ESTADO_DA_LINHA, estadoDaLinhaDaNota } from "../estadoDaLinhaDaNota";

const confirmada = { invoiceId: "i1", confirmadaPeloAdn: true };
const aguardando = { invoiceId: "i2", confirmadaPeloAdn: false };

describe("os três estados", () => {
  it("nota confirmada: sem estado especial, e sem `title`/`aria`", () => {
    const r = estadoDaLinhaDaNota(confirmada);
    expect(r.estado).toBe(ESTADO_DA_LINHA.CONFIRMADA);
    expect(r.title).toBeNull();
    expect(r.aria).toBeNull();
  });

  it("emitida e não confirmada: `aguardando_adn`, com `title`/`aria`", () => {
    const r = estadoDaLinhaDaNota(aguardando);
    expect(r.estado).toBe(ESTADO_DA_LINHA.AGUARDANDO_ADN);
    expect(r.title).toMatch(/aguardando confirmação/i);
    expect(r.aria).toMatch(/aguardando confirmação/i);
  });

  it("cancelamento enviado: estado PRÓPRIO, com `title`/`aria` próprios", () => {
    const r = estadoDaLinhaDaNota(confirmada, { cancelamentoEnviado: true });
    expect(r.estado).toBe(ESTADO_DA_LINHA.CANCELAMENTO_ENVIADO);
    expect(r.title).toMatch(/Cancelamento enviado/i);
  });

  it("⚠⚠ os dois estados de espera NÃO são o mesmo valor", () => {
    expect(ESTADO_DA_LINHA.AGUARDANDO_ADN).not.toBe(ESTADO_DA_LINHA.CANCELAMENTO_ENVIADO);
    expect(estadoDaLinhaDaNota(aguardando).title)
      .not.toBe(estadoDaLinhaDaNota(confirmada, { cancelamentoEnviado: true }).title);
  });

  it("⚠ o CANCELAMENTO ENVIADO vence — é o ato mais recente, e é o que impede o segundo clique", () => {
    const r = estadoDaLinhaDaNota(aguardando, { cancelamentoEnviado: true });
    expect(r.estado).toBe(ESTADO_DA_LINHA.CANCELAMENTO_ENVIADO);
  });

  it("⚠ `undefined` (contrato antigo, app mobile) é lido como CONFIRMADA", () => {
    expect(estadoDaLinhaDaNota({ invoiceId: "i3" }).estado).toBe(ESTADO_DA_LINHA.CONFIRMADA);
    expect(estadoDaLinhaDaNota(null).estado).toBe(ESTADO_DA_LINHA.CONFIRMADA);
  });

  it("⚠ nenhum estado devolve texto para renderizar — só `title`/`aria`", () => {
    // A instrução do dono ("não coloque explicação disso na tela") vale para os dois. O módulo não
    // tem por onde vazar texto: ele devolve só o estado e os dois atributos.
    for (const r of [
      estadoDaLinhaDaNota(confirmada),
      estadoDaLinhaDaNota(aguardando),
      estadoDaLinhaDaNota(confirmada, { cancelamentoEnviado: true }),
    ]) {
      expect(Object.keys(r).sort()).toEqual(["aria", "estado", "title"]);
    }
  });
});
