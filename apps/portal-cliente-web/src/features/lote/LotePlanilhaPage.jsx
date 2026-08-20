import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { AlertaErro, Chip } from "../../components/ui";
import { baixarBlob } from "../../lib/baixarBlob";
import { brl, fmtDoc, texto } from "../../lib/format";
import { carregarMunicipiosIbge } from "../../lib/municipios/municipioIbge";
import { COLUNAS_DO_LOTE, CAMPOS_DE_ENDERECO, NOME_DO_ARQUIVO_MODELO } from "./lib/colunasDoLote";
import {
  ESTADO,
  apresentacaoDoEstado,
  quantasNaoProntas,
  vereditosDoLote,
} from "./lib/estadoDaLinhaDoLote";
import { consultarDocumentos } from "./lib/consultasDoLote";
import { lerRecusaDaPlanilha } from "./lib/recusaDaPlanilha";
import {
  aindaCorrendo,
  avisoDaLinhaIndeterminada,
  confirmacaoDaEmissao,
  conviteParaRetomar,
  resumoDaEmissao,
  somarValorDasProntas,
  textoDoDesfecho,
} from "./lib/emissaoDoLote";

/**
 * O LOTE POR PLANILHA — conferir e, no fim, EMITIR.
 *
 * ⚠⚠ **ESTA TELA PASSOU A EMITIR EM 20/08/2026.** O cabeçalho anterior dizia "ela prepara; ela não
 * emite", e a frase ficou falsa — está corrigida aqui, porque a frase que descreve um comportamento
 * é parte do comportamento.
 *
 * > Dono (19/08/2026): *"a planilha deve ser baixada por nós o modelo, o cliente preenche; se o
 * > CNPJ preenchido for de um tomador que já teve antes, só preencher; se não teve consultamos na
 * > API; e se a API não retornar nós avisamos isso em uma tela para ajuste daquela nota; ajustando,
 * > ele passa por todas as notas para conferir e pode emitir em lote."*
 *
 * ⚠⚠ **O BOTÃO DE EMITIR É O ATO MAIS PERIGOSO DESTE PORTAL.** Cada linha pronta vira uma nota
 * fiscal irreversível no sistema nacional, em série. O que protege quem clica:
 *
 *   • a CONFIRMAÇÃO é esta tela — ela já mostra linha a linha. O bloco final confirma o que ela
 *     mostra (quantas, o total, e que é definitivo). ⚠ **Um bloco, não 50**: confirmação repetida
 *     ensina a clicar sem ler, e confirmação que ninguém lê é pior que nenhuma;
 *   • ⚠ o servidor **reclassifica a planilha inteira** — o que esta tela manda é o ARQUIVO, nunca a
 *     lista de linhas. A tela não escolhe o que se emite;
 *   • ⚠⚠ se o lote parar por **desfecho desconhecido**, a tela GRITA a linha e **não oferece
 *     retentativa dela** — nem com aviso, nem escondida. Retomar segue DEPOIS dela.
 *
 * ⚠ **A CLASSIFICAÇÃO É DO BACKEND** (`application/nfse/lote/classificarLinhaLote.js`). A tela
 * mostra. As duas únicas decisões que moram deste lado estão em `lib/`, e as duas foram DELEGADAS
 * por escrito pelo servidor:
 *   1. **a conferência do código do município** contra a lista oficial do IBGE, que só existe aqui
 *      (`lib/estadoDaLinhaDoLote.js`);
 *   2. **a consulta do CNPJ na Receita**, que sai do navegador (`lib/consultasDoLote.js`).
 *
 * ⚠ **CPF NÃO SE CONSULTA** — decisão do dono, e a guarda é a mesma da emissão avulsa.
 */
export function LotePlanilhaPage({ empresa, aoVoltar }) {
  const companyId = empresa.companyId;

  const [arquivo, setArquivo] = useState(null);
  const [leitura, setLeitura] = useState(null);
  const [recusa, setRecusa] = useState(null);
  const [erro, setErro] = useState(null);
  const [fase, setFase] = useState("ocioso"); // ocioso | lendo | consultando
  const [progresso, setProgresso] = useState(null);
  const [somenteAsMinhas, setSomenteAsMinhas] = useState(false);
  const [emAjuste, setEmAjuste] = useState(null);

  // ⚠ O mapa de consultas é POR DOCUMENTO e o de ajustes é POR LINHA DO EXCEL. Os dois vivem aqui,
  // na sessão da tela: nada disso é gravado em lugar nenhum.
  const [consultas, setConsultas] = useState({});
  const [ajustes, setAjustes] = useState({});

  // ⚠⚠ O ESTADO DA EMISSÃO. `confirmando` é o passo que separa o clique do ato fiscal.
  const [confirmando, setConfirmando] = useState(false);
  const [lote, setLote] = useState(null);
  const [emitindo, setEmitindo] = useState(false);
  const [erroEmissao, setErroEmissao] = useState(null);
  const [reconhecido, setReconhecido] = useState(false);

  const [municipios, setMunicipios] = useState(null);
  const [municipiosFalharam, setMunicipiosFalharam] = useState(false);
  const pararRef = useRef(false);

  // A lista oficial do IBGE (~197 KB, `import()` dinâmico). É ela que permite conferir o código do
  // município — a metade da prova que o servidor não tem como fazer.
  useEffect(() => {
    let descartado = false;
    carregarMunicipiosIbge()
      .then((lista) => {
        if (!descartado) setMunicipios(lista);
      })
      .catch(() => {
        if (!descartado) setMunicipiosFalharam(true);
      });
    return () => {
      descartado = true;
    };
  }, []);

  // ⚠⚠ TROCAR DE EMPRESA DESCARTA TUDO. A planilha, os ajustes e as consultas foram feitos para
  // OUTRA empresa; conferi-los aqui prepararia notas no CNPJ errado — o pior desfecho possível num
  // portal multi-empresa. É a mesma disciplina do modelo de emissão na casca.
  useEffect(() => {
    setArquivo(null);
    setLeitura(null);
    setRecusa(null);
    setErro(null);
    setConsultas({});
    setAjustes({});
    setEmAjuste(null);
    setProgresso(null);
    // ⚠ O LOTE TAMBÉM. Um relatório de emissão da empresa anterior, visível sob o nome da nova,
    // faria alguém acreditar que emitiu notas para o CNPJ errado — ou que não emitiu as que emitiu.
    setLote(null);
    setConfirmando(false);
    setErroEmissao(null);
    setReconhecido(false);
  }, [companyId]);

  // ⚠⚠ O POLLING. O lote corre no servidor (uma nota pode levar até 15 s), e o desfecho de cada
  // linha já está gravado quando acontece — então fechar a aba não perde nada. Enquanto ela está
  // aberta, a tela pergunta a cada 2 s.
  useEffect(() => {
    if (!lote?.id || !aindaCorrendo(lote)) return undefined;
    let vivo = true;
    const id = setInterval(async () => {
      try {
        const r = await api.consultarLoteEmissao(companyId, lote.id);
        if (vivo && r?.lote) setLote(r.lote);
      } catch {
        // ⚠ Falha de polling NÃO é falha do lote — ele segue no servidor. Silenciar aqui é o certo:
        // um erro na tela faria a pessoa achar que a emissão parou, e ela não parou.
      }
    }, 2000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [companyId, lote]);

  const veredito = vereditosDoLote(leitura, { municipios });
  const resumo = veredito.resumo;
  const naoProntas = quantasNaoProntas(resumo);

  async function baixarModelo() {
    setErro(null);
    try {
      const blob = await api.baixarModeloDoLote(companyId);
      // ⚠ Autenticado ⇒ Blob, NUNCA `<a href>`: um link comum não leva o Bearer e receberia 401.
      baixarBlob(blob, NOME_DO_ARQUIVO_MODELO);
    } catch (err) {
      setErro(err);
    }
  }

  const enviar = useCallback(
    async (arquivoAlvo, { consultas: mapaConsultas, ajustes: mapaAjustes }) => {
      if (!arquivoAlvo) return null;
      setFase("lendo");
      setErro(null);
      setRecusa(null);
      try {
        const resposta = await api.lerPlanilhaDoLote(companyId, arquivoAlvo, {
          consultas: mapaConsultas,
          ajustes: mapaAjustes,
        });
        setLeitura(resposta);
        return resposta;
      } catch (err) {
        const lida = lerRecusaDaPlanilha(err);
        setRecusa(lida);
        // ⚠ RECUSA DE AJUSTE NÃO APAGA A PLANILHA JÁ LIDA. O que o servidor recusou foi a correção,
        // não o arquivo — descartar a leitura faria a pessoa perder a conferência inteira por causa
        // de um campo.
        if (!lida.deAjuste) setLeitura(null);
        return null;
      } finally {
        setFase("ocioso");
      }
    },
    [companyId]
  );

  function escolherArquivo(evento) {
    const escolhido = evento.target.files?.[0] || null;
    setArquivo(escolhido);
    setLeitura(null);
    setRecusa(null);
    setEmAjuste(null);
    // ⚠ OS AJUSTES SÃO DESCARTADOS, as consultas NÃO. O ajuste é chaveado pelo NÚMERO DA LINHA, e
    // um arquivo novo pode ter outra ordem — aplicá-lo levaria a correção para a nota errada. A
    // consulta é chaveada pelo DOCUMENTO, que não muda de significado entre arquivos.
    setAjustes({});
    if (escolhido) enviar(escolhido, { consultas, ajustes: {} });
  }

  /**
   * O SEGUNDO PASSE: consulta os CNPJs em série e reclassifica com o que foi resolvido.
   *
   * ⚠⚠ **PARCIAL É NORMAL.** Uma consulta que falha vira pendência DAQUELA linha e o lote segue;
   * "Parar" devolve o que já veio. Exigir o conjunto completo travaria a tela esperando tudo.
   */
  async function consultarPendentes() {
    const alvos = leitura?.aConsultar || [];
    if (!alvos.length) return;
    pararRef.current = false;
    setFase("consultando");
    setProgresso({ feitas: 0, total: alvos.length });

    const { resultados } = await consultarDocumentos(alvos, {
      consultar: (cnpj) => api.consultarCnpj(cnpj),
      municipios,
      jaConhecidos: consultas,
      aoProgredir: ({ feitas, total }) => setProgresso({ feitas, total }),
      deveParar: () => pararRef.current,
    });

    setConsultas(resultados);
    setProgresso(null);
    await enviar(arquivo, { consultas: resultados, ajustes });
  }

  /** Guarda o que a pessoa digitou nesta linha e manda reclassificar. */
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ A EMISSÃO — daqui sai nota fiscal de verdade, em série
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  async function emitirDeVerdade() {
    setConfirmando(false);
    setErroEmissao(null);
    setEmitindo(true);
    try {
      // ⚠ VAI O ARQUIVO, não a lista de linhas. Quem decide o que é `pronta` é o servidor, que
      // reclassifica tudo de novo — a tela não escolhe o que se emite.
      const r = await api.emitirLoteDeNotas(companyId, arquivo, { consultas, ajustes });
      setReconhecido(Boolean(r?.reconhecido));
      setLote(r?.lote || null);
    } catch (err) {
      setErroEmissao(err);
    } finally {
      setEmitindo(false);
    }
  }

  /**
   * ⚠⚠ RETOMAR — e o servidor começa DEPOIS da linha indeterminada, nunca nela.
   *
   * Esta tela não decide isso e não pode contorná-lo: ela só pede a retomada. A ressalva aparece
   * ANTES do clique (ver `conviteParaRetomar`), porque "retomar" se lê como "resolver tudo".
   */
  async function retomar() {
    setErroEmissao(null);
    setEmitindo(true);
    try {
      const r = await api.retomarLoteEmissao(companyId, lote.id);
      setLote(r?.lote || null);
    } catch (err) {
      setErroEmissao(err);
    } finally {
      setEmitindo(false);
    }
  }

  async function salvarAjuste(numero, celulas) {
    const acumulado = { ...ajustes, [numero]: { ...(ajustes[numero] || {}), ...celulas } };
    setAjustes(acumulado);
    setEmAjuste(null);
    await enviar(arquivo, { consultas, ajustes: acumulado });
  }

  const linhasNaTela = somenteAsMinhas
    ? veredito.linhas.filter((l) => l.estado !== ESTADO.PRONTA)
    : veredito.linhas;

  return (
    <>
      <div className="page-header">
        <h1>Preparar lote por planilha</h1>
        <div className="page-actions">
          <button type="button" className="btn" onClick={aoVoltar}>
            Voltar
          </button>
        </div>
      </div>

      <div className="card">
        <h2>1. Baixe o modelo e preencha</h2>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={baixarModelo}>
            Baixar modelo (.xlsx)
          </button>
          <span className="muted" style={{ fontSize: ".82rem" }}>
            Uma linha por nota. A linha de exemplo do modelo não vira nota.
          </span>
        </div>
      </div>

      <div className="card">
        <h2>2. Envie a planilha preenchida</h2>
        <label htmlFor="arquivo-lote">
          Planilha (.xlsx)
          <input
            id="arquivo-lote"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={escolherArquivo}
            disabled={fase !== "ocioso"}
          />
        </label>
        {fase === "lendo" ? (
          <p className="muted" role="status">
            Conferindo a planilha…
          </p>
        ) : null}
        {municipiosFalharam ? (
          <p className="muted" style={{ fontSize: ".82rem", color: "var(--warning)" }}>
            ⚠ A lista de municípios não carregou — o código do município do tomador não pôde ser
            conferido nesta tela. Recarregue a página antes de emitir.
          </p>
        ) : null}
      </div>

      <AlertaErro erro={erro} padrao="Não foi possível falar com o servidor." />

      {recusa ? (
        <div className="alerta alerta-erro" role="alert">
          <p>
            <strong>{recusa.titulo}</strong>
          </p>
          <p>{recusa.texto}</p>
        </div>
      ) : null}

      {leitura ? (
        <>
          <div className="card">
            <h2>3. Confira, linha a linha</h2>
            <ResumoDoLote resumo={resumo} naoProntas={naoProntas} />

            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginTop: "12px" }}>
              {leitura.aConsultar?.length ? (
                fase === "consultando" ? (
                  <>
                    <span role="status">
                      Consultando a Receita: {progresso?.feitas ?? 0} de {progresso?.total ?? 0}
                    </span>
                    <button type="button" className="btn" onClick={() => { pararRef.current = true; }}>
                      Parar e conferir o que já veio
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={consultarPendentes}>
                    Consultar {leitura.aConsultar.length} CNPJ
                    {leitura.aConsultar.length > 1 ? "s" : ""} na Receita
                  </button>
                )
              ) : null}

              <label htmlFor="filtro-lote" style={{ marginBottom: 0, marginLeft: "auto" }}>
                Mostrar
                <select
                  id="filtro-lote"
                  value={somenteAsMinhas ? "pendentes" : "todas"}
                  onChange={(e) => setSomenteAsMinhas(e.target.value === "pendentes")}
                >
                  <option value="todas">Todas as {resumo.total} linhas</option>
                  <option value="pendentes">Só as que precisam de mim ({naoProntas})</option>
                </select>
              </label>
            </div>

            {leitura.linhasAjustadas?.length ? (
              // ⚠ AUSÊNCIA QUE MUDA DECISÃO: o ajuste vive nesta tela. A planilha no disco continua
              // com o valor antigo, e subir o mesmo arquivo amanhã perde as correções.
              <p className="muted" style={{ fontSize: ".82rem", marginTop: "8px" }}>
                {leitura.linhasAjustadas.length} linha
                {leitura.linhasAjustadas.length > 1 ? "s ajustadas" : " ajustada"} aqui. O ajuste vale
                nesta tela — a sua planilha continua com o valor antigo.
              </p>
            ) : null}

            {leitura.memoriaIndisponivel ? (
              <p className="muted" style={{ fontSize: ".82rem", color: "var(--warning)" }}>
                ⚠ Não conseguimos ver para quais tomadores esta empresa já emitiu, então nenhum
                endereço foi preenchido por aí.
              </p>
            ) : null}

            {leitura.colunasIgnoradas?.length ? (
              <p className="muted" style={{ fontSize: ".82rem" }}>
                Colunas não usadas: {leitura.colunasIgnoradas.join(", ")}.
              </p>
            ) : null}
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Tomador</th>
                  <th className="num">Valor</th>
                  <th>Competência</th>
                  <th>Estado</th>
                  <th>O que falta</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {linhasNaTela.map((linha) => (
                  <LinhaDoLote
                    key={linha.numero}
                    linha={linha}
                    emAjuste={emAjuste === linha.numero}
                    aoAbrirAjuste={() => setEmAjuste(linha.numero)}
                    aoFecharAjuste={() => setEmAjuste(null)}
                    aoSalvar={(celulas) => salvarAjuste(linha.numero, celulas)}
                    ocupado={fase !== "ocioso"}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* ⚠⚠ O ATO. Só aparece quando há linha pronta — botão que não pode fazer nada não
              precisa existir —, e nunca enquanto a consulta em série ainda está correndo. */}
          {erroEmissao ? <AlertaErro erro={erroEmissao} /> : null}

          {lote ? (
            <RelatorioDoLote lote={lote} reconhecido={reconhecido} ocupado={emitindo} aoRetomar={retomar} />
          ) : resumo.prontas > 0 && fase === "ocioso" ? (
            <BlocoDeEmissao
              prontas={resumo.prontas}
              naoProntas={naoProntas}
              valorTotal={somarValorDasProntas(veredito.linhas)}
              confirmando={confirmando}
              ocupado={emitindo}
              aoPedirConfirmacao={() => setConfirmando(true)}
              aoCancelar={() => setConfirmando(false)}
              aoConfirmar={emitirDeVerdade}
            />
          ) : (
            <p className="muted" style={{ fontSize: ".85rem" }}>
              {/* ⚠ A ausência continua sendo DITA — mas agora ela é sobre não haver linha pronta,
                  não sobre o botão não existir. */}
              Nenhuma linha está pronta para emitir. Corrija o que está marcado acima.
            </p>
          )}
        </>
      ) : null}
    </>
  );
}

/**
 * ⚠⚠ QUANTAS ESTÃO PRONTAS E QUANTAS NÃO — sempre à vista. É o número que decide se dá para seguir.
 */
function ResumoDoLote({ resumo, naoProntas }) {
  return (
    <div className="grid-3" data-resumo-lote>
      <div className="card" style={{ padding: "12px" }}>
        <div className="rotulo">Prontas</div>
        <div className="numero destaque" data-lote="prontas">
          {resumo.prontas}
        </div>
        <div className="apoio">de {resumo.total} linhas</div>
      </div>
      <div className="card" style={{ padding: "12px" }}>
        <div className="rotulo">Ainda não</div>
        <div className="numero" data-lote="nao-prontas">
          {naoProntas}
        </div>
        <div className="apoio">
          {resumo.conferir} a conferir · {resumo.consultar} a consultar · {resumo.pendentes} pendentes
          {resumo.desconhecidas ? ` · ${resumo.desconhecidas} em estado desconhecido` : ""}
        </div>
      </div>
    </div>
  );
}

/** Uma linha da planilha, com o que falta nela e o formulário de ajuste. */
function LinhaDoLote({ linha, emAjuste, aoAbrirAjuste, aoFecharAjuste, aoSalvar, ocupado }) {
  const apresentacao = apresentacaoDoEstado(linha.estado);
  const valores = linha.valores || {};
  const avisos = [...(linha.pendencias || []), ...(linha.conferencias || [])];

  return (
    <>
      <tr data-estado-lote={linha.estado} data-linha={linha.numero}>
        <td className="num">{linha.numero}</td>
        <td>
          <span className="truncar">{texto(valores.nome)}</span>
          <span className="muted" style={{ fontSize: ".78rem" }}>
            {fmtDoc(linha.documento || valores.documento)}
          </span>
        </td>
        <td className="num">{brl(linha.dados?.servico?.valorServicos) === "—" ? texto(valores.valor) : brl(linha.dados.servico.valorServicos)}</td>
        <td>{texto(valores.competencia)}</td>
        <td>
          <Chip status={apresentacao.chip}>{apresentacao.rotulo}</Chip>
          {linha.ajustada ? (
            <span className="muted" style={{ fontSize: ".72rem", display: "block" }}>
              ajustada aqui
            </span>
          ) : null}
        </td>
        <td>
          {!linha.conhecido ? (
            <span style={{ fontSize: ".8rem", color: "var(--danger)" }}>
              Esta tela não conhece o estado “{String(linha.estado)}” — a linha não pode ser
              emitida. Avise o seu contador.
            </span>
          ) : null}
          {avisos.map((aviso) => (
            <span
              key={aviso.codigo}
              data-codigo={aviso.codigo}
              className="muted"
              style={{ fontSize: ".78rem", display: "block", maxWidth: 420 }}
            >
              {aviso.texto}
            </span>
          ))}
          {linha.municipio ? (
            <span className="muted" style={{ fontSize: ".78rem", display: "block" }}>
              Município: {linha.municipio}
            </span>
          ) : null}
        </td>
        <td>
          <button
            type="button"
            className="btn-link"
            onClick={emAjuste ? aoFecharAjuste : aoAbrirAjuste}
            disabled={ocupado}
          >
            {emAjuste ? "Fechar" : "Ajustar"}
          </button>
        </td>
      </tr>
      {emAjuste ? (
        <tr>
          <td colSpan={7}>
            <FormularioDeAjuste valores={valores} numero={linha.numero} aoSalvar={aoSalvar} aoCancelar={aoFecharAjuste} />
          </td>
        </tr>
      ) : null}
    </>
  );
}


/**
 * ⚠⚠ O BOTÃO QUE EMITE, E A CONFIRMAÇÃO DE UM BLOCO SÓ.
 *
 * A confirmação é a TELA — ela já mostrou linha a linha. Este bloco confirma o que ela mostra:
 * quantas, o total e que é definitivo. ⚠ Repetir a pergunta por nota ensinaria a clicar sem ler.
 *
 * ⚠ O botão de confirmar NASCE fora da tela e só aparece depois do primeiro clique: um ato
 * irreversível não pode estar a um clique acidental de distância.
 */
function BlocoDeEmissao({
  prontas,
  naoProntas,
  valorTotal,
  confirmando,
  ocupado,
  aoPedirConfirmacao,
  aoCancelar,
  aoConfirmar,
}) {
  const texto = confirmacaoDaEmissao({ prontas, valorTotal });

  if (!confirmando) {
    return (
      <div style={{ marginTop: "12px" }} data-emissao="convite">
        <button type="button" className="btn btn-primary" onClick={aoPedirConfirmacao} disabled={ocupado}>
          Emitir {prontas} {prontas === 1 ? "nota" : "notas"}
        </button>
        {naoProntas > 0 ? (
          <p className="muted" style={{ fontSize: ".82rem", marginTop: "6px" }}>
            {/* ⚠ Quem tem 3 de 50 prontas precisa saber que as outras 47 NÃO vão sair — senão o
                clique parece emitir a planilha inteira. */}
            As outras {naoProntas} linhas não serão emitidas.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: "12px", padding: "14px" }} data-emissao="confirmacao">
      <h3 style={{ marginTop: 0 }}>{texto.titulo}</h3>
      <p style={{ margin: "4px 0" }}>
        Valor total: <strong>{brl(valorTotal)}</strong>
        {naoProntas > 0 ? <> · {naoProntas} linhas ficam de fora</> : null}
      </p>
      <p className="muted" style={{ fontSize: ".85rem" }}>{texto.aviso}</p>
      <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
        <button type="button" className="btn btn-primary" onClick={aoConfirmar} disabled={ocupado}>
          {ocupado ? "Emitindo…" : "Confirmar e emitir"}
        </button>
        <button type="button" className="btn" onClick={aoCancelar} disabled={ocupado}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * O RELATÓRIO — o que aconteceu com cada linha.
 *
 * ⚠⚠ A LINHA INDETERMINADA VEM PRIMEIRO E EM DESTAQUE. Ela é o pior estado deste sistema: pode
 * existir uma nota fiscal no mundo e ninguém sabe qual. Enterrá-la no meio de uma tabela de 50
 * linhas seria esconder exatamente o que precisa de ação humana.
 */
function RelatorioDoLote({ lote, reconhecido, ocupado, aoRetomar }) {
  const resumo = resumoDaEmissao(lote);
  const aviso = avisoDaLinhaIndeterminada(lote);
  const convite = conviteParaRetomar(lote);

  return (
    <div style={{ marginTop: "12px" }} data-emissao="relatorio" data-status-lote={lote.status}>
      {reconhecido ? (
        <p className="muted" style={{ fontSize: ".85rem" }} data-emissao="reconhecido">
          {/* ⚠ Esta planilha JÁ tinha sido emitida. Dizer isso é o que impede a pessoa de tentar de
              novo achando que falhou — e emitir tudo em duplicidade. */}
          Esta planilha já havia sido emitida. Abaixo está o que aconteceu naquela vez — nenhuma nota
          nova foi emitida agora.
        </p>
      ) : null}

      {aviso ? (
        <div className="card" style={{ padding: "14px", borderColor: "var(--warning-surface-border)" }} data-emissao="indeterminada">
          <h3 style={{ marginTop: 0 }}>A linha {aviso.numeroLinha} precisa da sua conferência</h3>
          <p style={{ margin: "4px 0" }}>
            {aviso.tomadorNome ? <>Tomador: <strong>{aviso.tomadorNome}</strong>. </> : null}
            {aviso.rpsNumero ? (
              <>
                Número reservado: <strong>{aviso.rpsSerie}/{aviso.rpsNumero}</strong>.
              </>
            ) : null}
          </p>
          {/* ⚠⚠ O texto vem do SERVIDOR (`paradoMotivo`/`correcao`) — reescrevê-lo aqui criaria uma
              segunda explicação do mesmo fato, e as duas divergiriam na primeira correção. */}
          {aviso.motivo ? <p style={{ margin: "4px 0" }}>{aviso.motivo}</p> : null}
          {aviso.correcao ? <p className="muted" style={{ fontSize: ".85rem" }}>{aviso.correcao}</p> : null}
        </div>
      ) : null}

      <div className="grid-3" style={{ marginTop: "10px" }} data-resumo-emissao>
        <div className="card" style={{ padding: "12px" }}>
          <div className="rotulo">Emitidas</div>
          <div className="numero destaque" data-emissao-conta="emitidas">{resumo.emitidas}</div>
          <div className="apoio">de {resumo.total} linhas</div>
        </div>
        <div className="card" style={{ padding: "12px" }}>
          <div className="rotulo">Recusadas</div>
          <div className="numero" data-emissao-conta="recusadas">{resumo.recusadas}</div>
          <div className="apoio">não viraram nota</div>
        </div>
        <div className="card" style={{ padding: "12px" }}>
          <div className="rotulo">Não tentadas</div>
          <div className="numero" data-emissao-conta="nao-tentadas">{resumo.naoTentadas}</div>
          <div className="apoio">ninguém encostou nelas</div>
        </div>
      </div>

      {convite ? (
        <div style={{ marginTop: "10px" }} data-emissao="retomar">
          {/* ⚠⚠ A RESSALVA VEM ANTES DO BOTÃO. "Retomar" se lê como "resolver tudo", e a pergunta
              que fica é justamente sobre a linha duvidosa. Deixá-la implícita faria a pessoa clicar
              esperando que aquela nota fosse resolvida — e ela não será, nem deve ser. */}
          <p style={{ margin: "4px 0" }}>{convite.ressalva}</p>
          <button type="button" className="btn" onClick={aoRetomar} disabled={ocupado}>
            {ocupado ? "Retomando…" : `Emitir as ${convite.quantas} linhas seguintes`}
          </button>
        </div>
      ) : null}

      <div className="table-wrap" style={{ marginTop: "10px" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Linha</th>
              <th>Tomador</th>
              <th className="num">Valor</th>
              <th>Nº da nota</th>
              <th>Desfecho</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>
            {(lote.linhas || []).map((l) => {
              const d = textoDoDesfecho(l.desfecho);
              return (
                <tr key={l.numeroLinha} data-desfecho={l.desfecho}>
                  <td>{l.numeroLinha}</td>
                  <td>{l.tomadorNome}</td>
                  <td className="num">{brl(Number(l.valorServicos))}</td>
                  {/* ⚠ O número RESERVADO aparece mesmo quando a linha não virou nota: não existe
                      inutilização na NFS-e, então número queimado é informação fiscal. */}
                  <td>{l.rpsNumero ? `${l.rpsSerie}/${l.rpsNumero}` : "—"}</td>
                  <td><Chip status={d.chip}>{d.rotulo}</Chip></td>
                  <td>{l.mensagem || l.correcao || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * O formulário de ajuste de UMA linha.
 *
 * ⚠ **SÓ O QUE MUDOU É ENVIADO.** O ajuste é o que a PESSOA digitou por cima; mandar de volta os
 * campos intocados marcaria como ajustada uma célula que ninguém tocou.
 *
 * ⚠ O bloco de endereço fica junto e nomeado porque a emissão o exige INTEIRO — preencher quatro
 * dos cinco não adianta, e espalhar esses campos entre os outros esconderia isso.
 */
function FormularioDeAjuste({ valores, numero, aoSalvar, aoCancelar }) {
  const [rascunho, setRascunho] = useState(() =>
    Object.fromEntries(COLUNAS_DO_LOTE.map((c) => [c.chave, String(valores?.[c.chave] ?? "")]))
  );

  function enviar(evento) {
    evento.preventDefault();
    const mudou = {};
    for (const coluna of COLUNAS_DO_LOTE) {
      const antes = String(valores?.[coluna.chave] ?? "");
      const agora = String(rascunho[coluna.chave] ?? "");
      if (antes !== agora) mudou[coluna.chave] = agora;
    }
    if (Object.keys(mudou).length) aoSalvar(mudou);
    else aoCancelar();
  }

  const campo = (coluna) => (
    <label key={coluna.chave} htmlFor={`ajuste-${numero}-${coluna.chave}`}>
      {coluna.rotulo}
      <input
        id={`ajuste-${numero}-${coluna.chave}`}
        type="text"
        value={rascunho[coluna.chave]}
        onChange={(e) => setRascunho((r) => ({ ...r, [coluna.chave]: e.target.value }))}
      />
    </label>
  );

  const daNota = COLUNAS_DO_LOTE.filter((c) => !CAMPOS_DE_ENDERECO.includes(c.chave));
  const doEndereco = COLUNAS_DO_LOTE.filter((c) => CAMPOS_DE_ENDERECO.includes(c.chave));

  return (
    <form onSubmit={enviar} data-ajuste-linha={numero}>
      <div className="filters">{daNota.map(campo)}</div>
      <h3>Endereço do tomador</h3>
      <p className="muted" style={{ fontSize: ".78rem", marginTop: 0 }}>
        A nota exige o endereço completo — só o complemento é opcional. Apague o bloco inteiro para
        buscarmos o endereço de novo.
      </p>
      <div className="filters">{doEndereco.map(campo)}</div>
      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
        <button type="submit" className="btn btn-primary">
          Aplicar e reclassificar
        </button>
        <button type="button" className="btn" onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
