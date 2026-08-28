// O DANFSe EM LOTE NA TELA DO CLIENTE — o nome do arquivo e o que a recusa quer dizer.
//
// > Pedido do dono (19/08/2026): *"a possibilidade de baixar notas em lote (…) quero o download no
// > portal do cliente, e fazer o download dos DANFSe e não do XML."*
//
// ⚠ NADA DE PDF NEM DE ZIP É FEITO AQUI. O lote é montado pelo backend
// (`GET /client/companies/:id/invoices/danfse/bulk`), que gera cada DANFSe com o MESMO serviço da
// porta individual. Este módulo responde duas perguntas de tela: **como se chama o arquivo que a
// pessoa vai salvar?** e **o que o servidor recusou?**
//
// ⚠ ELE É IRMÃO DE `danfseDaNota.js`, e a divisão é a mesma: a decisão mora aqui, o componente só
// desenha. As recusas espelhadas vêm de `routes/portalInvoices.js` (`GET /danfse/bulk`).

/**
 * ⚠⚠ ESPELHO DE `LOTE_MAXIMO` (`apps/api/src/application/nfse/danfse/loteDanfseDoPortal.js`).
 *
 * Está em cópia porque não há código compartilhado entre a API e este app — ver a tabela
 * "mudou lá, muda aqui" no `CLAUDE.md` deste portal. **Mudou lá, muda aqui**: um teto diferente do
 * servidor treinaria a tela a recusar onde a produção aceita, ou pior, o contrário.
 *
 * ⚠ Ele MORA AQUI e não no mock, e a razão é que a TELA passou a precisar dele: a oferta de baixar
 * toda a competência (`lib/selecaoDeNotas.js`) só pode ser desabilitada com o motivo se souber o
 * teto. Duas cópias no mesmo app é como o mock e a tela começam a discordar.
 */
export const LOTE_MAXIMO = 200;

/** Os códigos que a rota do lote responde. Espelho — não invente um que o servidor não manda. */
export const RECUSA_LOTE = {
  MUITO_GRANDE: "lote_muito_grande",
  VAZIO: "lote_vazio",
};

/**
 * O nome do zip que a pessoa salva.
 *
 * ⚠ ELE É COMPOSTO AQUI, e não lido do `Content-Disposition`, porque esse cabeçalho **não é
 * legível por JavaScript entre origens** (não está na lista segura do CORS, e o portal roda em
 * outra porta que a API). Ler um cabeçalho que volta `null` produziria um download chamado
 * `undefined.zip` — o nome composto é o que de fato chega ao disco da pessoa.
 *
 * ⚠ O carimbo de tempo é o do NAVEGADOR, então ele difere em segundos do que o servidor escreveu
 * no cabeçalho. Isso é sem consequência (o arquivo é o mesmo) e está dito para ninguém "consertar"
 * uma divergência que é de relógio.
 */
export function nomeDoArquivoLoteDanfse({ cnpj, competencia } = {}) {
  const doc = String(cnpj || "").replace(/\D+/g, "") || "empresa";
  const comp = String(competencia || "todas").replace(/[^\w.-]+/g, "-") || "todas";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `danfse-${doc}-${comp}-${stamp}.zip`;
}

/**
 * A recusa do servidor, traduzida sem inventar procedimento.
 *
 * ⚠ A MENSAGEM DO SERVIDOR VENCE — ela já vem escrita por extenso, com os números do caso
 * (`encontradas`, `maximo`). O texto daqui só entra quando não veio nada. Mesma regra de
 * `danfseDaNota.js#lerRecusaDanfse` e de `emitir/lib/desfechoEmissao.js`: código que esta tela não
 * conhece **não** ganha um "tente de novo" fabricado.
 */
export function lerRecusaLote(err) {
  const codigo = String(err?.code || "").trim().toLowerCase();
  const doServidor = String(err?.message || "").trim();
  const corpo = err?.corpo || null;

  if (codigo === RECUSA_LOTE.MUITO_GRANDE) {
    const encontradas = Number(corpo?.encontradas) || null;
    const maximo = Number(corpo?.maximo) || null;
    return {
      codigo,
      titulo: "São notas demais para um download só.",
      texto:
        doServidor
        || (encontradas && maximo
          ? `Este filtro encontrou ${encontradas} notas, e o máximo por download é ${maximo}.`
          : "Este filtro encontrou mais notas do que cabe em um download."),
      // ⚠⚠ ISTO NÃO É "tente de novo": é o motivo do teto. Cada DANFSe é um PDF **gerado na hora**
      // (não um arquivo guardado), e o navegador desistiria no meio de um lote grande — sem dizer
      // quantas notas vieram. O teto existe para a recusa acontecer ANTES, com o número na frente.
      // ⚠ A SEGUNDA SAÍDA É NOMEADA porque a primeira pode não existir: no portal do cliente o
      // único filtro é a competência, e quem já escolheu um mês não tem o que estreitar. Recusa
      // sem caminho é beco sem saída — o botão por linha existe e continua funcionando.
      porQue:
        "Cada DANFSe é gerado na hora, não é um arquivo guardado — por isso há um limite. Escolha "
        + 'uma competência e baixe mês a mês, ou use o "Baixar DANFSe" de cada linha.',
      encontradas,
      maximo,
    };
  }

  if (codigo === RECUSA_LOTE.VAZIO) {
    return {
      codigo,
      titulo: "Não há nota para baixar.",
      texto: doServidor || "Nenhuma nota foi encontrada para o filtro atual.",
      porQue: null,
      encontradas: 0,
      maximo: null,
    };
  }

  return {
    codigo: codigo || null,
    titulo: "O download em lote não foi feito.",
    texto: doServidor || "O sistema não devolveu o arquivo e não disse por quê.",
    porQue: null,
    encontradas: null,
    maximo: null,
  };
}
