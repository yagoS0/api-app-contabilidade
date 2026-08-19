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

/**
 * O LOTE POR PLANILHA — a tela de CONFERÊNCIA. **Ela prepara; ela não emite.**
 *
 * ⚠ O TÍTULO E O BOTÃO QUE LEVA AQUI DIZEM "PREPARAR", e isso é deliberado: chamá-los de "Emitir
 * em lote" prometeria um comportamento que esta fase não tem. A frase que descreve um comportamento
 * é parte do comportamento.
 *
 * > Dono (19/08/2026): *"a planilha deve ser baixada por nós o modelo, o cliente preenche; se o
 * > CNPJ preenchido for de um tomador que já teve antes, só preencher; se não teve consultamos na
 * > API; e se a API não retornar nós avisamos isso em uma tela para ajuste daquela nota; ajustando,
 * > ele passa por todas as notas para conferir e pode emitir em lote."*
 *
 * ⚠⚠ **ESTA TELA NÃO EMITE, E NÃO TEM BOTÃO DE EMITIR.** Ela termina em "pronto para emitir" e para
 * ali. A emissão em série é a fase perigosa e tem regras próprias (sequencial, parada no desfecho
 * desconhecido, numeração queimada) que **não estão construídas**. Um botão aqui, mesmo desabilitado,
 * seria a promessa de um comportamento que não existe.
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
  }, [companyId]);

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

          <p className="muted" style={{ fontSize: ".85rem" }}>
            {/* ⚠ A AUSÊNCIA DO BOTÃO DE EMITIR PRECISA SER DITA: sem esta linha, quem terminar a
                conferência procura um botão que não existe. */}
            Esta tela confere a planilha. A emissão em lote ainda não está disponível aqui.
          </p>
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
