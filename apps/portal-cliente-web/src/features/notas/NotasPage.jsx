import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { AlertaErro, CardNumero, Carregando, Chip, Vazio } from "../../components/ui";
import { useCarregamento } from "../../lib/hooks";
import { baixarBlob } from "../../lib/baixarBlob";
import { modeloDeEmissaoDaNota, podeReaproveitar } from "../emitir/lib/reaproveitarNota";
import { lerRecusaDanfse, nomeDoArquivoDanfse, podeGerarDanfse } from "./lib/danfseDaNota";
import { LOTE_MAXIMO, lerRecusaLote, nomeDoArquivoLoteDanfse } from "./lib/loteDanfse";
import {
  ESCOPO_DO_LOTE,
  avisoDoEscopo,
  ofertaDeTodaACompetencia,
  pedidoDoLote,
  rotuloDoBotao,
} from "./lib/selecaoDeNotas";
import { podeCancelar } from "./lib/cancelamentoNota";
import { estadoDaLinhaDaNota } from "./lib/estadoDaLinhaDaNota";
import { chipDaNota } from "./lib/chipDaNota";
import { ESCOPO } from "./lib/impedimento";
import { ConfirmarCancelamento } from "./ConfirmarCancelamento";
import {
  TRACO,
  brl,
  competenciaPadrao,
  competenciasRecentes,
  fmtCompetencia,
  fmtDateBr,
  fmtDoc,
  inteiro,
  somaOuTraco,
  texto,
} from "../../lib/format";

const OPCOES_COMPETENCIA = competenciasRecentes(12);
const LIMITE = 25;

// ⚠ O de-para do chip MUDOU-SE PARA `lib/chipDaNota.js` em 24/08/2026, e não por arrumação: ele
// deixou de ser um mapa e virou uma REGRA — a precedência entre `ciclo.situacao` e `status`, que
// existe porque a nota SUBSTITUÍDA lia "Cancelada" aqui e "Substituída" na tela do contador. Regra
// de tela vive em `features/<x>/lib/`, com teste próprio; a tela faz a ligação.

/**
 * Notas EMITIDAS pela empresa (direcao=emitidas, como no app mobile).
 *
 * ⚠ O `summary` é do FILTRO INTEIRO, não da página — é o backend que soma
 * (`prisma.aggregate`). Por isso ele vive fora da tabela: somar a coluna da
 * página daria outro número, menor, e ninguém saberia qual dos dois é o do mês.
 *
 * ── DE ONDE SE CLICA PARA REAPROVEITAR (dono, 19/08/2026) ────────────────────
 *
 * ⚠ O QUE ESTA TELA TINHA, MEDIDO ANTES DE INVENTAR NAVEGAÇÃO: uma tabela de 7
 * colunas, `<tr>` sem `onClick`, sem modal de detalhe, sem seleção e sem rota
 * por nota (o roteamento do portal é por HASH, com quatro destinos fixos —
 * `lib/hooks.js`). Ou seja: **hoje clicar numa nota não faz nada**, e não havia
 * nem detalhe onde pendurar a ação, como há no portal do escritório (lá ela mora
 * no `NotaDetailModal`).
 *
 * ⚠ POR ISSO A AÇÃO É UM BOTÃO NA LINHA, e não a linha inteira virando clicável:
 * linha clicável sem detalhe para abrir teria UM destino possível — começar uma
 * emissão —, e um clique acidental na lista abrindo a tela que pratica ato
 * fiscal é caro demais para ser adivinhado. Botão nomeado diz o que vai
 * acontecer antes de acontecer, e é alcançável pelo teclado.
 *
 * ⚠ BOTÃO IMPOSSÍVEL NÃO SOME: a nota que não serve de modelo (NF-e, ou nota em
 * que a tomadora é a própria empresa) fica DESABILITADA com o motivo em texto ao
 * lado — a mesma disciplina do portal do escritório. Sumir faria a ausência
 * parecer defeito.
 *
 * ⚠ A REGRA NÃO MORA AQUI: quem decide o que se copia, o que não se copia e o
 * que a tela é obrigada a dizer é `emitir/lib/reaproveitarNota.js`.
 *
 * ── A NOTA EMITIDA APARECE NA HORA (dono, 19/08/2026) ────────────────────────
 *
 * > *"ao emitir uma nota, ela deve aparecer para o cliente, e depois que
 * > consultar o ADN aí fica confirmada na tela; deve ficar mais clarinha e,
 * > quando confirmada ADN, ela fica viva como as outras. **Não coloque
 * > explicação disso na tela.***"
 *
 * A lista lia SÓ `PortalInvoice`, que é a projeção do ADN — entre emitir e a
 * próxima captura a nota simplesmente não existia aqui. Hoje o backend junta as
 * duas fontes NA LEITURA e marca cada linha com **`confirmadaPeloAdn`** (ver
 * `application/notas/notasEmitidasNaoConfirmadas.js`, que traz a chave de
 * deduplicação e a prova de que ela identifica).
 *
 * ⚠⚠ **A DISTINÇÃO É VISUAL E SÓ** — é instrução literal do dono, e ela veio
 * logo depois de ele mandar enxugar as legendas desta tela. Não há parágrafo,
 * legenda nem rodapé explicando os dois estados. O que existe:
 *   • `data-confirmada-adn` no `<tr>` — o estado fica **auditável no DOM**;
 *   • `opacity` no CSS (`styles/app.css`) — a linha "mais clarinha";
 *   • `title`/`aria-label` no chip — que **não são texto na tela** e são o que
 *     existe para quem passa o mouse e para quem usa leitor de tela. Opacidade
 *     sozinha não chega a quem não enxerga a diferença.
 */
/**
 * O botão do DANFSe de UMA nota.
 *
 * ⚠ BOTÃO IMPOSSÍVEL NÃO SOME — fica desabilitado com o motivo em texto ao lado, a mesma
 * disciplina de "Usar como modelo". A regra de quando ele pode não mora aqui: mora em
 * `lib/danfseDaNota.js`, que espelha o que o backend recusa.
 *
 * ⚠⚠ A RECUSA APARECE INTEIRA. A rota responde **503 `danfse_sem_qrcode`** quando o QR Code não
 * pôde ser gerado, e essa é a única resposta que a tela precisa EXPLICAR: um DANFSe sem QR Code
 * não é um DANFSe (NT 008 §2.2 e §2.4.3). Mostrar "falha ao baixar" — ou nada — aqui seria a
 * mentira que o 503 existe para impedir.
 */
function BotaoDanfse({ nota, companyId }) {
  const [estado, setEstado] = useState({ fase: "ocioso", recusa: null });
  const permissao = podeGerarDanfse(nota);
  const gerando = estado.fase === "gerando";

  async function baixar() {
    setEstado({ fase: "gerando", recusa: null });
    try {
      const blob = await api.fetchDanfseBlob(companyId, nota.invoiceId);
      baixarBlob(blob, nomeDoArquivoDanfse(nota));
      setEstado({ fase: "pronto", recusa: null });
    } catch (err) {
      setEstado({ fase: "recusado", recusa: lerRecusaDanfse(err) });
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn-link"
        disabled={!permissao.pode || gerando}
        title={permissao.pode ? "Gera e baixa o PDF da NFS-e" : permissao.texto || undefined}
        onClick={permissao.pode && !gerando ? baixar : undefined}
      >
        {gerando ? "Gerando…" : "Baixar DANFSe"}
      </button>
      {/* ⚠ Ver `lib/impedimento.js`. Impedimento da NOTA (é NF-e, ainda não confirmada) NÃO vira
          texto aqui: a linha inteira já o carrega — a coluna "Tipo", o chip e o `title`/`aria`
          dele —, e a coluna vizinha chegaria à mesma conclusão e escreveria a mesma frase. Até
          19/08/2026 "Ainda não confirmada." aparecia DUAS vezes na mesma linha.
          O que sobra aqui é o que só o DANFSe sabe: a nota não tem o XML guardado. */}
      {permissao.pode || permissao.escopo === ESCOPO.NOTA ? null : (
        <span className="meta">{permissao.resumo}</span>
      )}
      {estado.recusa ? (
        <span
          className="meta-erro" style={{ maxWidth: 260 }}
        >
          ⚠ {estado.recusa.titulo} {estado.recusa.texto}
          {estado.recusa.porQue ? ` ${estado.recusa.porQue}` : ""}
        </span>
      ) : null}
    </>
  );
}

/**
 * ⚠⚠ A BARRA DA SELEÇÃO — ela substituiu o botão "Baixar DANFSe em lote (.zip)" em 27/08/2026.
 *
 * > Dono: *"tire o botão de baixar em lote, deixe o usuário selecionar as notas que ele quer e abra
 * > a opção baixar"*.
 *
 * ⚠ O QUE O BOTÃO ANTIGO FAZIA, E POR QUE ELE INCOMODAVA: ele baixava **o filtro inteiro**, não uma
 * escolha. Quem queria três notas de vinte tinha de estreitar a competência até sobrarem três — e no
 * portal do cliente o único filtro é a competência, então na prática não dava.
 *
 * ⚠⚠ **ELA SÓ EXISTE COM ALGO MARCADO.** Barra permanente com "0 selecionadas" é ruído fixo; é a
 * mesma disciplina da barra de seleção do portal do escritório.
 *
 * ⚠ E ela DIZ O NÚMERO — *"Baixar 3 DANFSe"*, nunca "Baixar selecionadas". O número é o que a pessoa
 * confere contra o que ela marcou, e é o que aparece dentro do zip.
 */
function BarraDeSelecao({ companyId, cnpj, competencia, selecionadas, escopo, totalDaCompetencia, aoLimpar }) {
  const [estado, setEstado] = useState({ fase: "ocioso", recusa: null });
  const baixando = estado.fase === "baixando";
  const quantas = selecionadas.length;
  // ⚠⚠ NA COMPETÊNCIA O NÚMERO É DE NOTAS, NÃO DE DANFSe — e a frase que diz isso é obrigatória.
  // Ver o cabeçalho de `lib/selecaoDeNotas.js`: ali entram notas que não geram PDF nenhum.
  const aviso = avisoDoEscopo(escopo);

  async function baixar() {
    setEstado({ fase: "baixando", recusa: null });
    try {
      // ⚠ Quem monta o pedido é a REGRA, não este componente: na competência a ausência dos ids é o
      // que faz o servidor cair no filtro inteiro, e escrever isso aqui seria a segunda leitura da
      // mesma decisão.
      const blob = await api.baixarDanfseEmLote(companyId, pedidoDoLote({ escopo, ids: selecionadas, competencia }));
      baixarBlob(blob, nomeDoArquivoLoteDanfse({ cnpj, competencia }));
      setEstado({ fase: "pronto", recusa: null });
    } catch (err) {
      setEstado({ fase: "recusado", recusa: lerRecusaLote(err) });
    }
  }

  return (
    <div className="barra-selecao" role="region" aria-label="Ações sobre as notas selecionadas">
      <span className="barra-selecao-conta">
        {escopo === ESCOPO_DO_LOTE.COMPETENCIA ? (
          <>
            <strong>{totalDaCompetencia}</strong> nota{totalDaCompetencia === 1 ? "" : "s"} desta competência
          </>
        ) : (
          <>
            <strong>{quantas}</strong> nota{quantas === 1 ? "" : "s"} selecionada{quantas === 1 ? "" : "s"}
          </>
        )}
      </span>
      <button type="button" className="btn btn-primary" disabled={baixando} onClick={baixar}>
        {baixando ? "Gerando os PDFs…" : rotuloDoBotao({ escopo, quantas, total: totalDaCompetencia })}
      </button>
      <button type="button" className="btn" onClick={aoLimpar} disabled={baixando}>
        Limpar seleção
      </button>
      {aviso ? <span className="meta">{aviso}</span> : null}
      {estado.fase === "pronto" ? (
        <span className="meta">
          Arquivo baixado. Dentro dele, <strong>RELATORIO.txt</strong> lista o que não gerou DANFSe e
          o motivo.
        </span>
      ) : null}
      {estado.recusa ? (
        <span className="meta-erro">
          ⚠ {estado.recusa.titulo} {estado.recusa.texto}
          {estado.recusa.porQue ? ` ${estado.recusa.porQue}` : ""}
        </span>
      ) : null}
    </div>
  );
}

export function NotasPage({ empresa, competencia: competenciaDaCasca, aoTrocarCompetencia, aoReaproveitar, aoEmitir, aoPrepararLote }) {
  const companyId = empresa.companyId;
  // ⚠ Abre no mês CORRENTE — decisão do dono, 18/08/2026 (ver `competenciaPadrao` em
  // `lib/format.js`). Antes abria em "Todas". ⚠ Isto ESTREITA o que a tela mostra ao abrir: quem
  // emitiu no mês passado não vê a nota de cara. Por isso o estado vazio abaixo NOMEIA a
  // competência e aponta para "Todas" — some da tela, mas não some sem dizer para onde foi.
  //
  // ⚠⚠ O VALOR VEM DA CASCA (`AppShell`) — era um `useState` daqui, gêmeo do da `HomePage`, e as
  // duas abas discordavam em silêncio. O controle continua sendo ESTE, dentro do card de filtros,
  // com o "Todas" que só existe aqui; o que passou a ser único é o valor.
  const competencia = competenciaDaCasca ?? competenciaPadrao();
  const setCompetencia = aoTrocarCompetencia || (() => {});
  const [pagina, setPagina] = useState(1);
  // ⚠ A nota que está em confirmação de CANCELAMENTO. Fica aqui, e não dentro da linha, porque o
  // diálogo é modal: uma confirmação por vez, e ela sobrevive à rolagem da tabela.
  const [notaParaCancelar, setNotaParaCancelar] = useState(null);
  // ⚠⚠ AS NOTAS QUE MANDAMOS CANCELAR NESTA SESSÃO. Elas NÃO vêm do servidor: a lista lê
  // `PortalInvoice`, a projeção do ADN, e nós deliberadamente não a escrevemos (ver
  // `notasEmitidasNaoConfirmadas.js`). Até a captura trazer o evento, o único lugar do mundo que
  // sabe do cancelamento é esta tela — e quem mandou cancelar precisa ver que funcionou.
  const [cancelamentosEnviados, setCancelamentosEnviados] = useState(() => new Set());

  // ⚠⚠ A SELEÇÃO É PODADA AO QUE ESTÁ NA TELA — trocar de competência ou de página não pode deixar
  // marcada uma nota que a pessoa não vê mais. É a mesma regra que o portal do escritório aplica à
  // carteira, e pelo mesmo motivo: seleção invisível vira ato sobre o que ninguém conferiu.
  const [selecionadas, setSelecionadas] = useState(() => new Set());
  // ⚠⚠ O SEGUNDO ESCOPO — "todas as notas desta competência". Ele existe porque a seleção por
  // PÁGINA, sozinha, desfaz uma capacidade: o botão antigo baixava até 200 notas, e a página mostra
  // 25. O pedido do dono era sobre ESCOLHER, não sobre baixar menos.
  // ⚠ Ele NÃO é um terceiro estado da seleção: quando ligado, os ids marcados deixam de importar e
  // quem decide é o servidor, pelo mesmo `where` da listagem.
  const [todaACompetencia, setTodaACompetencia] = useState(false);


  // Trocar de empresa ou de competência recomeça na página 1: manter a página 4
  // de uma lista que agora tem 2 páginas mostra uma tela vazia que parece um bug.
  useEffect(() => {
    setPagina(1);
  }, [companyId, competencia]);

  // ⚠⚠ TROCAR DE EMPRESA OU DE COMPETÊNCIA DESLIGA O ESCOPO LARGO. Ele afirma "todas as notas DESTE
  // mês"; mantido através da troca, o próximo clique baixaria o mês que ninguém escolheu — e sem uma
  // lista de ids não há poda que salve, porque não existe id nenhum para podar. É a mesma disciplina
  // da poda da seleção, aplicada ao único estado que a poda não alcança.
  useEffect(() => {
    setTodaACompetencia(false);
  }, [companyId, competencia]);

  // ⚠ TROCAR DE EMPRESA ESQUECE OS CANCELAMENTOS ENVIADOS. Os ids são de outra carteira; mantê-los
  // riscaria uma linha desta empresa por causa de um clique dado na outra. (A competência NÃO
  // limpa: a nota cancelada continua sendo a mesma nota se a pessoa voltar ao mês dela.)
  useEffect(() => {
    setCancelamentosEnviados(new Set());
  }, [companyId]);

  const query = useCarregamento(
    () => api.getInvoices(companyId, { competencia: competencia || undefined, page: pagina, limit: LIMITE }),
    [companyId, competencia, pagina]
  );

  const resposta = query.dados;
  const notas = resposta?.data || [];

  /**
   * ⚠⚠ SÓ SE MARCA O QUE GERA DANFSe — a caixa nasce DESABILITADA no resto, com o motivo no `title`
   * que a linha já mostra. É o oposto de deixar marcar e depois entregar um zip sem aquela nota: a
   * pessoa conferiria o número da barra contra o conteúdo do arquivo e não bateria.
   * ⚠ `podeGerarDanfse` é a MESMA função que o botão da linha usa — duas leituras divergiriam.
   */
  const selecionaveis = useMemo(
    () => (notas || []).filter((n) => podeGerarDanfse(n).pode).map((n) => n.invoiceId),
    [notas],
  );

  // ⚠⚠ A PODA. Sem ela, marcar três notas de agosto e trocar para setembro deixaria as três marcadas
  // e invisíveis — e o "Baixar 3" agiria sobre o que ninguém está vendo.
  useEffect(() => {
    setSelecionadas((atual) => {
      const podados = [...atual].filter((id) => selecionaveis.includes(id));
      return podados.length === atual.size ? atual : new Set(podados);
    });
  }, [selecionaveis]);

  const alternar = (id) => setSelecionadas((atual) => {
    const proximo = new Set(atual);
    if (proximo.has(id)) proximo.delete(id); else proximo.add(id);
    return proximo;
  });
  const todasMarcadas = selecionaveis.length > 0 && selecionaveis.every((id) => selecionadas.has(id));
  const total = resposta?.total ?? 0;
  // ⚠ O `total` é o do FILTRO (o `count` do servidor), nunca `notas.length` — é essa diferença que a
  // oferta existe para alcançar.
  const oferta = ofertaDeTodaACompetencia({ total, notasNaPagina: notas.length, teto: LOTE_MAXIMO });
  const limite = resposta?.limit ?? LIMITE;
  const totalPaginas = Math.max(1, Math.ceil(total / limite));
  const paginaAtual = resposta?.page ?? pagina;

  return (
    <>
      <div className="page-header">
        <h1>Notas emitidas</h1>
        {/* ⚠⚠ ESTE BOTÃO SUBSTITUIU A ABA "EMITIR" (dono, 19/08/2026) — a aba foi removida
            INTEIRA: menu, rota e estado (`shell/AppShell.jsx`, `lib/hooks.js`).

            ⚠ ELE APARECE SEMPRE, inclusive para quem NÃO pode emitir, e isso é a razão de a aba
            aparecer sempre, herdada: escondê-lo deixaria o cliente sem saber que a emissão existe
            e que ela depende de um clique do contador. Quem não pode cai na tela do outro lado,
            que diz QUAL guarda está fechada e o que fazer — e que tem o seu próprio "Voltar".
            Um botão desabilitado aqui não serviria: o motivo não cabe num `title`, e o portão é
            resposta do servidor, não da lista. */}
        <button type="button" className="btn btn-primary" onClick={aoEmitir}>
          Emitir nota
        </button>
        {/* ⚠⚠ O RÓTULO ERA "Preparar lote por planilha", E O COMENTÁRIO AQUI EXPLICAVA QUE ELE
            NÃO PODIA PROMETER EMITIR — *"a emissão em lote não existe ainda"*. Ela passou a
            existir em 20/08/2026, e a frase ficou falsa; **"Emissão em Lote" é o rótulo pedido
            pelo dono em 21/08/2026**, e hoje ele é verdadeiro: a tela do outro lado confere linha
            a linha E emite.
            ⚠ Só o TEXTO mudou. `aoPrepararLote`, a chave de navegação e o `data-*` continuam como
            estavam: neste app o despacho é por cadeia de `if` com chave em string, e renomear a
            chave quebra em silêncio.
            ⚠ Ele aparece SEMPRE, como o "Emitir nota" ao lado: baixar o modelo e conferir uma
            planilha são LEITURA (a rota entra sem papel mínimo), então não há portão a espelhar —
            quem recusa a EMISSÃO é o servidor, na rota que emite. */}
        <button type="button" className="btn" onClick={aoPrepararLote}>
          Emissão em Lote
        </button>
      </div>

      <div className="card">
        <div className="filters">
          <label htmlFor="competencia-notas">
            Competência
            <select
              id="competencia-notas"
              disabled={!aoTrocarCompetencia}
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
            >
              <option value="">Todas</option>
              {OPCOES_COMPETENCIA.map((c) => (
                <option key={c} value={c}>
                  {fmtCompetencia(c)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid-2">
        <CardNumero
          rotulo={competencia ? `Notas em ${fmtCompetencia(competencia)}` : "Notas no período"}
          valor={resposta ? inteiro(resposta.summary?.totalInvoices) : TRACO}
          apoio="Total encontrado com o filtro atual"
        />
        <CardNumero
          rotulo="Valor total"
          valor={resposta ? somaOuTraco(resposta.summary?.totalAmount) : TRACO}
          apoio={
            resposta
              ? `Nesta página: ${somaOuTraco(resposta.summary?.pageAmount)}`
              : "Total encontrado com o filtro atual"
          }
          destaque
        />
      </div>

      <AlertaErro
        erro={query.erro}
        padrao="Não foi possível carregar as notas."
        aoTentarNovamente={query.recarregar}
      />

      {query.carregando ? (
        <Carregando>Carregando notas…</Carregando>
      ) : query.erro ? null : notas.length === 0 ? (
        <Vazio>
          {competencia
            ? `Nenhuma nota emitida em ${fmtCompetencia(competencia)}. Troque a competência acima — ou escolha "Todas" para ver o histórico inteiro.`
            : "Nenhuma nota emitida encontrada."}
        </Vazio>
      ) : (
        <>
          <div className="table-wrap">
            {/* ⚠⚠ A BARRA SÓ EXISTE COM ALGO MARCADO, e fica ACIMA da tabela — quem marcou está
                olhando as linhas, e a ação tem de aparecer onde o olho está. */}
            {selecionadas.size > 0 || todaACompetencia ? (
              <BarraDeSelecao
                companyId={companyId}
                cnpj={empresa.cnpj}
                competencia={competencia}
                selecionadas={[...selecionadas]}
                escopo={todaACompetencia ? ESCOPO_DO_LOTE.COMPETENCIA : ESCOPO_DO_LOTE.PAGINA}
                totalDaCompetencia={total}
                aoLimpar={() => {
                  setSelecionadas(new Set());
                  setTodaACompetencia(false);
                }}
              />
            ) : null}
            {/* ⚠⚠ A OFERTA DO ESCOPO LARGO — ela só aparece quando há MAIS notas do que a página
                mostra. Com tudo numa página, o cabeçalho já faz o mesmo, e uma segunda porta para o
                mesmo ato ensina a não ler a barra.
                ⚠ Acima do teto ela aparece DESABILITADA com o motivo: botão que some esconde que a
                ação existe, e o servidor recusaria de qualquer jeito. */}
            {oferta && !todaACompetencia ? (
              <p className="meta oferta-competencia">
                <button
                  type="button"
                  className="btn btn-link"
                  disabled={oferta.acimaDoTeto}
                  title={oferta.motivo || undefined}
                  onClick={() => {
                    setTodaACompetencia(true);
                    // ⚠ A marcação da página some junto: manter as caixas marcadas ao lado de "todas
                    // as 120" faria a tela mostrar dois números para o mesmo lote.
                    setSelecionadas(new Set());
                  }}
                >
                  {oferta.rotulo}
                </button>
                {oferta.motivo ? <span className="meta"> {oferta.motivo}</span> : null}
              </p>
            ) : null}
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Número</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Emissão</th>
                  <th scope="col">Competência</th>
                  <th scope="col">Tomador</th>
                  <th scope="col">Situação</th>
                  <th scope="col" className="num">
                    Valor
                  </th>
                  {/* ⚠ A caixa de "todas" fica na COLUNA da seleção, e o rótulo acessível diz o
                      número — "Selecionar" sozinho não conta quantas. */}
                  <th scope="col" className="col-selecao">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar as ${selecionaveis.length} notas com DANFSe desta página`}
                      checked={todasMarcadas}
                      disabled={selecionaveis.length === 0}
                      onChange={() => setSelecionadas(todasMarcadas ? new Set() : new Set(selecionaveis))}
                    />
                  </th>
                  <th scope="col">DANFSe</th>
                  <th scope="col">Cancelar</th>
                  <th scope="col">Emitir outra</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((nota) => {
                  // ⚠ A NOTA INTEIRA, não `nota.status`: o chip agora lê o `ciclo` também.
                  const chip = chipDaNota(nota);
                  const permissao = podeReaproveitar(nota, { cnpjDaEmpresa: empresa.cnpj });
                  // ⚠ O ESTADO DA LINHA MORA NUM LUGAR SÓ — `lib/estadoDaLinhaDaNota.js`. Ele
                  // distingue "emitida, aguardando o ADN" de "cancelamento enviado", que são dois
                  // fatos diferentes e têm desenhos diferentes.
                  const cancelamentoEnviado = cancelamentosEnviados.has(nota.invoiceId);
                  const estadoLinha = estadoDaLinhaDaNota(nota, { cancelamentoEnviado });
                  const cancelamento = podeCancelar(nota, {
                    cancelamentoEnviado,
                    // ⚠ O CNPJ da empresa é o que permite reconhecer a nota RECEBIDA quando
                    // `papel` não veio — a mesma fonte dupla de `podeReaproveitar`.
                    cnpjDaEmpresa: empresa.cnpj,
                  });
                  return (
                    <tr key={nota.invoiceId} data-estado-nota={estadoLinha.estado}>
                      <td className="col-selecao">
                        {/* ⚠ Desabilitada quando a nota não gera DANFSe: marcar o que não vem no zip
                            faria o número da barra discordar do conteúdo do arquivo. O motivo já está
                            no `title` do botão da linha — não se repete aqui. */}
                        <input
                          type="checkbox"
                          aria-label={`Selecionar a nota ${texto(nota.numero)}`}
                          checked={selecionadas.has(nota.invoiceId)}
                          disabled={!podeGerarDanfse(nota).pode}
                          onChange={() => alternar(nota.invoiceId)}
                        />
                      </td>
                      <td>{texto(nota.numero)}</td>
                      <td>{texto(nota.type)}</td>
                      <td>{fmtDateBr(nota.issueDate)}</td>
                      <td>{fmtCompetencia(nota.competencia)}</td>
                      <td>
                        <span className="truncar" title={texto(nota.tomador?.nome)}>
                          {texto(nota.tomador?.nome)}
                        </span>
                        <span className="meta">
                          {nota.tomador?.cnpjCpf ? fmtDoc(nota.tomador.cnpjCpf) : TRACO}
                        </span>
                      </td>
                      <td>
                        {/* ⚠ O CHIP NÃO MUDA DE COR NEM DE RÓTULO. A nota FOI emitida; o que falta
                            é a confirmação do sistema nacional. Um rótulo diferente ("Pendente",
                            "Aguardando") a pintaria de azul de processando ou de cinza de
                            cancelada, que é justamente a confusão a evitar.

                            ⚠ `title`/`aria-label` NÃO são "explicação na tela" — são o que existe
                            para quem passa o mouse e para quem usa leitor de tela. A opacidade
                            sozinha não chega a quem não enxerga a diferença. */}
                        <Chip
                          status={chip.status}
                          title={estadoLinha.title || undefined}
                          aria-label={estadoLinha.aria ? `${chip.rotulo} — ${estadoLinha.aria}` : undefined}
                        >
                          {chip.rotulo}
                        </Chip>
                      </td>
                      <td className="num">{brl(nota.total)}</td>
                      <td>
                        <BotaoDanfse nota={nota} companyId={companyId} />
                      </td>
                      <td>
                        {/* ⚠⚠ ESTE BOTÃO NÃO CANCELA NADA — ele abre a confirmação, que repete os
                            dados da nota. Cancelar uma NFS-e é IRREVERSÍVEL, e um clique acidental
                            na linha errada de uma tabela é exatamente o acidente a evitar.
                            ⚠ BOTÃO IMPOSSÍVEL NÃO SOME: fica desabilitado com o motivo ao lado. */}
                        <button
                          type="button"
                          className="btn-link"
                          disabled={!cancelamento.pode}
                          title={cancelamento.texto || undefined}
                          onClick={() => setNotaParaCancelar(nota)}
                        >
                          Cancelar
                        </button>
                        {/* ⚠ Ver `lib/impedimento.js`: impedimento da NOTA não vira texto aqui —
                            a linha já o carrega (coluna Tipo, chip, `title`/`aria`), e cada botão
                            escrevendo o seu fazia a mesma frase aparecer duas vezes por linha. */}
                        {cancelamento.pode || cancelamento.escopo === ESCOPO.NOTA ? null : (
                          <span className="meta">
                            {cancelamento.resumo}
                          </span>
                        )}
                      </td>
                      <td>
                        {/* ⚠ O BOTÃO NÃO EMITE NADA — ele abre a tela de emissão pré-preenchida,
                            que continua tendo o portão, o aviso de cadastro incompleto e o botão
                            Emitir como sempre teve. */}
                        <button
                          type="button"
                          className="btn-link"
                          disabled={!permissao.pode}
                          title={permissao.texto || undefined}
                          onClick={() =>
                            aoReaproveitar?.(
                              modeloDeEmissaoDaNota(nota, {
                                companyId,
                                cnpjDaEmpresa: empresa.cnpj,
                              })
                            )
                          }
                        >
                          Usar como modelo
                        </button>
                        {permissao.pode ? null : (
                          <span className="meta">
                            {permissao.resumo}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="paginacao">
            <button
              type="button"
              className="btn"
              disabled={paginaAtual <= 1}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <span className="info">
              Página {inteiro(paginaAtual)} de {inteiro(totalPaginas)} · {inteiro(total)} nota(s)
            </span>
            <button
              type="button"
              className="btn"
              disabled={paginaAtual >= totalPaginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </>
      )}

      {notaParaCancelar ? (
        <ConfirmarCancelamento
          nota={notaParaCancelar}
          aoFechar={() => setNotaParaCancelar(null)}
          aoConfirmar={async ({ cMotivo, justificativa }) => {
            // ⚠ A recusa NÃO é engolida: o diálogo a captura e a mostra. Aqui só o desfecho feliz
            // fecha e recarrega — a lista precisa refletir a nota cancelada.
            const alvo = notaParaCancelar.invoiceId;
            await api.cancelarNota(companyId, alvo, { cMotivo, justificativa });
            // ⚠ MARCA ANTES DE RECARREGAR. O servidor vai devolver a nota como "EMITIDA" de novo
            // (a lista lê a projeção do ADN), então sem esta marca a linha voltaria ao normal e o
            // clique pareceria não ter funcionado.
            setCancelamentosEnviados((anterior) => new Set(anterior).add(alvo));
            setNotaParaCancelar(null);
            query.recarregar();
          }}
        />
      ) : null}
    </>
  );
}
