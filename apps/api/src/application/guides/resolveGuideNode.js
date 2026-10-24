import { envioDeEmailFalhou } from "./guideContract.js";

/**
 * Resolve o nó no ciclo de vida. Precedência: guia real > ausência confirmada > falta.
 *
 *                       ┌─→ gerada ─→ enviada        (terminais bons)
 *   missing ────────────┤     └─→ FALHOU             (tentou e não foi; NÃO é terminal)
 *                       └─→ vazio                    (terminal: ausência confirmada)
 *
 * ⚠ A PRECEDÊNCIA É ESCRITA AQUI, de propósito. Antes ela emergia de um `if` lá embaixo
 * (`semFaturamento` zerava `required` e curto-circuitava tudo), e um marcador VAZIO de SIMPLES na
 * mesma competência ficava órfão: ignorado pelo compliance, invisível na matriz, mas visível na
 * tabela de guias. Dois estados coexistiam no banco e um vencia o outro em silêncio.
 *
 * ⚠ **EXPORTADA, e o teste importa ESTA função.** `__tests__/guideComplianceCiclo.test.js` mantinha
 * uma RÉPLICA da regra ("se as duas divergirem, este teste deixa de proteger"). A réplica derivava
 * "enviada" de `emailStatus === "SENT"` — leitura que o próprio arquivo abandonou quando o envio
 * ganhou canal (`foiEnviadaComLegado`). Ou seja: ela já tinha divergido, e o teste passava.
 * Exportar custa uma linha e acaba com a classe inteira de problema.
 */
export function resolveNode(node, presente, vazio, { semFaturamento = false, faturamento = 0 } = {}) {
  if (!node.required) return { ...node, ok: true, state: "na" };

  if (presente) {
    // Guia existe: falta enviá-la, já foi, ou TENTOU E FALHOU. É esta distinção que a listagem não
    // conseguia fazer.
    //
    // ⚠ "Enviada" é terminal em QUALQUER canal (ver `EnvioGuiaService.foiEnviada`). Se foi por
    // e-mail e o WhatsApp falhou, ela chegou — cobrar o segundo canal transformaria uma escolha de
    // conveniência em pendência. Por isso `enviada` vence `falhou`: um erro de e-mail ANTERIOR a um
    // envio bem-sucedido é história, não pendência.
    //
    // ⚠ `falhou` NÃO é terminal e NÃO muda `ok`. O nó continua "a obrigação está materializada"
    // (a guia existe) — mexer em `ok` mudaria o filtro de pendências e o agregado do fechamento,
    // que respondem outra pergunta. O que muda é o que a tela MOSTRA: âmbar "gerada, falta enviar"
    // sobre uma guia cujo envio falhou é o sistema dizendo que está tudo no rumo.
    // ⚠ "Falhou" tem DUAS fontes desde 02/09/2026: o e-mail (`emailStatus: ERROR`, o de sempre) e o
    // envio por WhatsApp (`envios_guia.status = "falhou"`). Sem a segunda, a guia cujo WhatsApp a
    // Meta recusou ficava âmbar "gerada, falta enviar" — o mesmo estado de quem nunca foi tentado, o
    // defeito que este `falhou` existe para impedir, agora pelo outro canal.
    const state = presente.enviada
      ? "enviada"
      : ((envioDeEmailFalhou(presente) || presente.envioStatus === "falhou") ? "falhou" : "gerada");
    return {
      ...node, ok: true, state,
      guideId: presente.guideId,
      paymentStatus: presente.paymentStatus || null,
      canalEnvio: presente.canalEnvio,
      canaisEnviados: presente.canaisEnviados || [],
      envioStatus: presente.envioStatus,
      envioEm: presente.envioEm,
      envioErro: presente.envioErro,
      envioErroCodigo: presente.envioErroCodigo ?? null,
      // ⚠ TRÊS respostas (`true`/`false`/`null`): `null` é "a Meta não diz". A tela não o trata
      // como `false` — ela oferece o botão com a frase de que a decisão é do contador.
      envioPodeTentarDeNovo: presente.envioPodeTentarDeNovo ?? null,
      emailStatus: presente.emailStatus,
      emailSentAt: presente.emailSentAt,
      // O MOTIVO viaja junto do estado. "Falhou" sem o porquê manda o contador procurar em outro
      // lugar — e o lugar existe (aba Guias, página de pendências), mas ninguém sabe que existe.
      emailLastError: presente.emailLastError || null,
      emailAttempts: Number(presente.emailAttempts || 0),
    };
  }

  // Ausência CONFIRMADA — pelo marcador da guia ou pela afirmação de mês sem faturamento.
  if (vazio || semFaturamento) {
    // Receita contradiz um MÊS sem faturamento, mas não a ausência de uma guia específica.
    if (!vazio && faturamento > 0) {
      return {
        ...node, ok: false, state: "conflito", faturamento,
        origem: "sem_faturamento",
        guideId: vazio?.guideId || null,
        vazioEm: vazio?.vazioEm || null,
        vazioPor: vazio?.vazioPor || null,
      };
    }
    return {
      ...node, ok: true, state: "vazio",
      origem: vazio ? "guia_vazia" : "sem_faturamento",
      guideId: vazio?.guideId || null,
      vazioEm: vazio?.vazioEm || null,
      vazioPor: vazio?.vazioPor || null,
      vazioMotivo: vazio?.vazioMotivo || null,
    };
  }

  return { ...node, ok: false, state: "missing" };
}
