import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { TRACO, brl, mesCorrente, pct, texto } from "../../lib/format";
import { roleLabel } from "../../lib/roles";
import { ESTADO, lerPortaoEmissao } from "./lib/portaoEmissao";
import { TIPO, lerErroEmissao, lerResultado } from "./lib/desfechoEmissao";
import { DesfechoEmissao } from "./DesfechoEmissao";
import { PreviaNota } from "./PreviaNota";

/**
 * EMISSÃO DE NFS-e PELO CLIENTE.
 *
 * ⚠⚠ **ESTA É A ÚNICA TELA DESTE PORTAL QUE PRATICA UM ATO FISCAL.** As outras leem: notas, guias,
 * alíquota, fluxo. Esta escreve — no sistema nacional, em produção. O que sai daqui vira nota
 * fiscal de verdade, e a NFS-e **não tem inutilização**: o conserto de uma nota errada é
 * cancelamento, não edição.
 *
 * Contrato (lido, não deduzido):
 *   `POST /client/companies/:companyId/nfse`  → `apps/api/src/routes/client/index.js` (a fachada)
 *   corpo                                     → `apps/api/src/application/validators/nfsePayload.js`
 *   portão                                    → `apps/api/src/application/nfse/emissaoClienteAutorizacao.js`
 *   desfechos                                 → `apps/api/src/routes/nfseEmissaoHttp.js`
 *
 * ⚠ **NENHUM CAMPO FOI INVENTADO.** Todo campo do formulário existe no validador; nenhum campo do
 * validador que o backend ignora (`referencia`, que nada consome) foi oferecido.
 */

const FORM_VAZIO = {
  tomadorDoc: "",
  tomadorNome: "",
  tomadorEmail: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cMun: "",
  descricao: "",
  valorServicos: "",
  competencia: "",
  issRetido: false,
  aliquota: "",
  cLocPrestacao: "",
  pTotTribSN: "",
};

/**
 * Campos que `NfseService` exige da EMPRESA antes de qualquer emissão (`REQUIRED_COMPANY_FIELDS`).
 *
 * ⚠ **`cnpj` FICOU DE FORA DE PROPÓSITO, e isso foi medido, não suposto.** O servidor exige cinco
 * campos; o `legacyCompanySelect` de `GET /client/companies`
 * (`apps/api/src/routes/client/index.js`) devolve só quatro deles — `Company.cnpj` **não está no
 * select**. Conferir um campo que nunca chega faria esta tela acusar "falta o CNPJ" em **todas** as
 * empresas, inclusive nas que emitem sem problema: um aviso que está sempre aceso não é aviso, é
 * ruído, e ensina o cliente a ignorar o painel. (O CNPJ que a tela recebe é o do `PortalClient`,
 * `empresa.cnpj` — outra coluna, de outra tabela; usá-lo aqui responderia a pergunta errada.)
 */
const CAMPOS_EXIGIDOS_DA_EMPRESA = [
  ["inscricaoMunicipal", "inscrição municipal"],
  ["codigoServicoNacional", "código de serviço nacional"],
  ["codigoServicoMunicipal", "código de serviço municipal"],
  ["rpsSerie", "série do RPS"],
];

function apenasDigitos(valor) {
  return String(valor || "").replace(/\D+/g, "");
}

/**
 * Número de um `<input type="number">`.
 *
 * ⚠ O campo é `type="number"` de propósito, e não um texto com máscara: máscara de moeda em
 * pt-BR precisa decidir se `1.234` é mil duzentos e trinta e quatro ou um vírgula dois — e essa
 * decisão, errada, vira o VALOR DA NOTA. Com `type="number"` o separador é o ponto e um `1.234`
 * ambíguo não existe; o que o navegador não conseguir ler chega aqui como `""` e sai como traço na
 * pré-visualização, onde a pessoa vê o erro antes de emitir.
 */
function numeroDoCampo(valor) {
  const s = String(valor ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Monta o corpo de `POST /client/companies/:id/nfse`.
 *
 * ⚠ **`companyId` NÃO VAI NO CORPO.** Ele vem do path, e a fachada o sobrescreve por cima do corpo
 * (`{...body, companyId: path}`) exatamente para que um id no corpo não desvie a emissão para
 * outra empresa depois de a permissão ter sido conferida nesta.
 *
 * ⚠⚠ **`servico.codigoServicoNacional` NÃO É ENVIADO, E ISSO É UMA DECISÃO.** O campo existe no
 * validador desde 18/08/2026 e o cadastro é a autoridade sobre ele: um código que não esteja em
 * `Company.codigosServicoNacional` é RECUSADO (`NFSE_CODIGO_SERVICO_FORA_DA_LISTA`). Essa lista
 * está **vazia nas 33 empresas** medidas — um seletor aqui não teria o que oferecer, e ofereceria
 * ou nada, ou opções que o servidor recusaria uma a uma. Sem o campo, vale o singular
 * `Company.codigoServicoNacional`, que é o comportamento de sempre — e a tela DIZ qual é ele, em
 * vez de deixar a pergunta sem resposta. Quando houver códigos cadastrados, é aqui que o seletor
 * entra.
 */
function montarPayload(form) {
  const payload = {
    tomador: {
      cnpjCpf: apenasDigitos(form.tomadorDoc),
      nome: form.tomadorNome.trim(),
      endereco: {
        cMun: apenasDigitos(form.cMun),
        CEP: apenasDigitos(form.cep),
        xLgr: form.logradouro.trim(),
        nro: form.numero.trim(),
        xCpl: form.complemento.trim() || undefined,
        xBairro: form.bairro.trim(),
      },
    },
    servico: {
      descricao: form.descricao.trim(),
      valorServicos: numeroDoCampo(form.valorServicos),
      issRetido: form.issRetido === true,
    },
  };

  const email = form.tomadorEmail.trim();
  if (email) payload.tomador.email = email;

  const aliquota = numeroDoCampo(form.aliquota);
  if (aliquota !== null) payload.servico.aliquota = aliquota;

  const local = apenasDigitos(form.cLocPrestacao);
  if (local) payload.servico.cLocPrestacao = local;

  const pTotTribSN = numeroDoCampo(form.pTotTribSN);
  if (pTotTribSN !== null) payload.totTrib = { pTotTribSN };

  // 'YYYY-MM' do `<input type="month">` → o primeiro dia do mês. ⚠ Sem competência o servidor usa
  // a data de HOJE (`formatDateOnly(null)`), e é isso que a dica ao lado do campo diz.
  if (form.competencia) payload.competencia = `${form.competencia}-01`;

  return payload;
}

export function EmitirNotaPage({ empresa, aoNavegar, aoRecarregarEmpresas }) {
  const companyId = empresa.companyId;
  const [form, setForm] = useState(FORM_VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [desfecho, setDesfecho] = useState(null);
  // A linha da tentativa anterior, quando o servidor disse que o número dela é reaproveitável.
  // ⚠ Reenviar SEM ela queimaria um número novo a cada correção — e número pulado é buraco
  // permanente. Nunca é preenchida depois de uma falha de TRANSPORTE.
  const [retryInvoiceId, setRetryInvoiceId] = useState(null);

  // ⚠ TROCAR DE EMPRESA ZERA TUDO. Uma nota meio preenchida que sobrevivesse à troca seria emitida
  // no CNPJ errado — o pior desfecho possível num portal multi-empresa, e irreversível aqui.
  useEffect(() => {
    setForm(FORM_VAZIO);
    setDesfecho(null);
    setRetryInvoiceId(null);
  }, [companyId]);

  const portao = lerPortaoEmissao(empresa);
  const legacy = empresa.legacyCompany || null;
  const codigoServicoNacional = legacy?.codigoServicoNacional || null;
  const cadastroIncompleto = legacy
    ? CAMPOS_EXIGIDOS_DA_EMPRESA.filter(([campo]) => !legacy[campo]).map(([, nome]) => nome)
    : [];

  const valorServicos = numeroDoCampo(form.valorServicos);
  const aliquota = numeroDoCampo(form.aliquota);
  const issRetidoValor =
    form.issRetido && valorServicos !== null && aliquota !== null
      ? Number(((valorServicos * aliquota) / 100).toFixed(2))
      : null;
  const liquido =
    valorServicos === null
      ? null
      : form.issRetido
        ? issRetidoValor === null
          ? null
          : Number((valorServicos - issRetidoValor).toFixed(2))
        : valorServicos;

  const valoresDaPrevia = useMemo(
    () => ({
      tomadorNome: form.tomadorNome.trim(),
      tomadorDoc: apenasDigitos(form.tomadorDoc),
      tomadorEmail: form.tomadorEmail.trim(),
      endereco: {
        cMun: apenasDigitos(form.cMun),
        CEP: apenasDigitos(form.cep),
        xLgr: form.logradouro.trim(),
        nro: form.numero.trim(),
        xCpl: form.complemento.trim(),
        xBairro: form.bairro.trim(),
      },
      descricao: form.descricao.trim(),
      valorServicos,
      competencia: form.competencia,
      issRetido: form.issRetido,
      aliquota,
      issRetidoValor,
      liquido,
      codigoServicoNacional,
    }),
    [form, valorServicos, aliquota, issRetidoValor, liquido, codigoServicoNacional]
  );

  function campo(nome) {
    return (evento) => {
      const alvo = evento.target;
      const valor = alvo.type === "checkbox" ? alvo.checked : alvo.value;
      setForm((anterior) => ({ ...anterior, [nome]: valor }));
    };
  }

  async function emitir(evento) {
    evento.preventDefault();
    if (enviando) return;
    setEnviando(true);
    try {
      const resposta = await api.emitirNfse(companyId, montarPayload(form), { retryInvoiceId });
      const lido = lerResultado(resposta);
      setDesfecho(lido);
      if (lido.tipo === TIPO.SUCESSO) {
        setRetryInvoiceId(null);
        setForm(FORM_VAZIO);
      }
    } catch (err) {
      const lido = lerErroEmissao(err);
      setDesfecho(lido);
      setRetryInvoiceId(lido.retryInvoiceId);
      // ⚠⚠ DESFECHO DESCONHECIDO APAGA O FORMULÁRIO. Não é limpeza de tela: é tirar do caminho o
      // "enviar de novo" de um clique só sobre uma nota que talvez já exista. Quem quiser
      // reemitir depois de consultar terá de digitar tudo outra vez, de propósito.
      if (lido.tipo === TIPO.TRANSPORTE || lido.tipo === TIPO.DESCONHECIDO) {
        setForm(FORM_VAZIO);
      }
    } finally {
      setEnviando(false);
    }
  }

  // ── O PORTÃO, ANTES DE QUALQUER FORMULÁRIO ────────────────────────────────────────────────
  if (!portao.podeEmitir) {
    return (
      <>
        <div className="page-header">
          <h1>Emitir nota</h1>
        </div>
        <PortaoFechado portao={portao} empresa={empresa} aoRecarregar={aoRecarregarEmpresas} />
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Emitir nota</h1>
      </div>

      {desfecho ? (
        <DesfechoEmissao
          desfecho={desfecho}
          aoNavegar={aoNavegar}
          aoCorrigir={() => setDesfecho(null)}
          aoNovaNota={() => {
            setForm(FORM_VAZIO);
            setRetryInvoiceId(null);
            setDesfecho(null);
          }}
        />
      ) : (
        <>
          {cadastroIncompleto.length ? (
            // ⚠ AVISO, NÃO BLOQUEIO — e a diferença é de fonte do dado. O portão é bloqueio porque
            // `emissaoNfseLiberada` existe justamente para a tela decidir. Isto aqui é a MESMA
            // regra do servidor lida de segunda mão (uma projeção da empresa legada), e bloquear
            // por uma leitura de segunda mão pararia uma emissão legítima. Se ela vier a ser
            // recusada, a recusa é da camada NOSSA: nada sai da máquina e nenhum número se perde.
            <div className="alerta alerta-aviso" role="status">
              <p>
                <strong>O cadastro fiscal desta empresa parece incompleto.</strong> Falta:{" "}
                {cadastroIncompleto.join(", ")}.
              </p>
              <p>
                Você pode preencher a nota, mas ela provavelmente será recusada antes de sair daqui.
                Fale com o seu contador.
              </p>
            </div>
          ) : null}

          {retryInvoiceId ? (
            <div className="alerta alerta-info" role="status">
              <p>
                Esta é uma correção da tentativa anterior — ela vai reaproveitar o mesmo número, em
                vez de consumir um novo.
              </p>
            </div>
          ) : null}

          <div className="page-split">
            <form className="pane pane-form" onSubmit={emitir}>
              <fieldset>
                <legend>Para quem</legend>
                <label htmlFor="emitir-doc">
                  CNPJ ou CPF do tomador
                  <input
                    id="emitir-doc"
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    value={form.tomadorDoc}
                    onChange={campo("tomadorDoc")}
                  />
                </label>
                <label htmlFor="emitir-nome">
                  Nome ou razão social
                  <input
                    id="emitir-nome"
                    required
                    value={form.tomadorNome}
                    onChange={campo("tomadorNome")}
                  />
                </label>
                <label htmlFor="emitir-email">
                  E-mail (opcional)
                  <input
                    id="emitir-email"
                    type="email"
                    value={form.tomadorEmail}
                    onChange={campo("tomadorEmail")}
                  />
                </label>
              </fieldset>

              <fieldset>
                {/* ⚠ O ENDEREÇO DO TOMADOR É OBRIGATÓRIO, e não é "opcional preenchido por
                    educação": `buildDpsXml` recusa a nota inteira sem cMun, CEP, xLgr, nro e
                    xBairro (`MISSING_TOMADOR_ADDRESS`), para evitar a rejeição RNG6110. Só o
                    complemento é dispensável. */}
                <legend>Endereço do tomador</legend>
                <div className="filters">
                  <label htmlFor="emitir-cep">
                    CEP
                    <input id="emitir-cep" inputMode="numeric" required value={form.cep} onChange={campo("cep")} />
                  </label>
                  <label htmlFor="emitir-cmun">
                    Código IBGE do município
                    <input
                      id="emitir-cmun"
                      inputMode="numeric"
                      required
                      value={form.cMun}
                      onChange={campo("cMun")}
                    />
                  </label>
                </div>
                <span className="hint">
                  O código IBGE tem 7 dígitos. ⚠ Ele não é deduzido do CEP nem do nome da cidade —
                  cidades homônimas têm códigos diferentes, e o município errado joga o ISS para o
                  lugar errado.
                </span>
                <label htmlFor="emitir-logradouro">
                  Logradouro
                  <input
                    id="emitir-logradouro"
                    required
                    value={form.logradouro}
                    onChange={campo("logradouro")}
                  />
                </label>
                <div className="filters">
                  <label htmlFor="emitir-numero">
                    Número
                    <input id="emitir-numero" required value={form.numero} onChange={campo("numero")} />
                  </label>
                  <label htmlFor="emitir-complemento">
                    Complemento (opcional)
                    <input
                      id="emitir-complemento"
                      value={form.complemento}
                      onChange={campo("complemento")}
                    />
                  </label>
                </div>
                <label htmlFor="emitir-bairro">
                  Bairro
                  <input id="emitir-bairro" required value={form.bairro} onChange={campo("bairro")} />
                </label>
              </fieldset>

              <fieldset>
                <legend>O que foi prestado</legend>
                <label htmlFor="emitir-descricao">
                  Descrição do serviço
                  <textarea
                    id="emitir-descricao"
                    rows={3}
                    required
                    value={form.descricao}
                    onChange={campo("descricao")}
                  />
                </label>
                <div className="filters">
                  <label htmlFor="emitir-valor">
                    Valor dos serviços (R$)
                    <input
                      id="emitir-valor"
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={form.valorServicos}
                      onChange={campo("valorServicos")}
                    />
                  </label>
                  <label htmlFor="emitir-competencia">
                    Competência (opcional)
                    <input
                      id="emitir-competencia"
                      type="month"
                      max={mesCorrente()}
                      value={form.competencia}
                      onChange={campo("competencia")}
                    />
                  </label>
                </div>
                <span className="hint">
                  O valor usa ponto para os centavos (ex.: 1500.00) — confira o valor formatado na
                  pré-visualização ao lado. Sem competência, a nota sai com a data de hoje.
                </span>
                <p className="hint" style={{ marginTop: "8px" }}>
                  {/* ⚠ A tela DIZ qual código vai, em vez de oferecer uma escolha que o cadastro
                      recusaria. Ver `montarPayload`. */}
                  Código de serviço desta nota:{" "}
                  <strong>{codigoServicoNacional ? texto(codigoServicoNacional) : TRACO}</strong>{" "}
                  {codigoServicoNacional
                    ? "— é o único cadastrado para esta empresa, e não há escolha a fazer aqui. Para emitir com outro código, fale com o seu contador."
                    : "— esta tela não recebeu o código de serviço cadastrado da empresa. Quem confere é o servidor, na emissão."}
                </p>
              </fieldset>

              <fieldset>
                <legend>Impostos</legend>
                <label htmlFor="emitir-iss-retido" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    id="emitir-iss-retido"
                    type="checkbox"
                    style={{ width: "auto", minHeight: 0 }}
                    checked={form.issRetido}
                    onChange={campo("issRetido")}
                  />
                  O ISS desta nota é retido pelo tomador
                </label>
                <div className="filters">
                  <label htmlFor="emitir-aliquota">
                    Alíquota do ISS (%)
                    <input
                      id="emitir-aliquota"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      required={form.issRetido}
                      value={form.aliquota}
                      onChange={campo("aliquota")}
                    />
                  </label>
                  <label htmlFor="emitir-ptottribsn">
                    Alíquota efetiva do Simples (%)
                    <input
                      id="emitir-ptottribsn"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={form.pTotTribSN}
                      onChange={campo("pTotTribSN")}
                    />
                  </label>
                </div>
                <span className="hint">
                  {/* ⚠ Nenhum dos dois é preenchido por nós. A alíquota efetiva é a do extrato do
                      PGDAS-D da competência — derivá-la de faturamento e guias daria um número
                      parecido e declarado ao fisco como se fosse o certo. */}
                  Com ISS retido, a alíquota é obrigatória. A alíquota efetiva do Simples Nacional é
                  exigida das empresas optantes e sai do extrato do PGDAS-D — se não souber, peça ao
                  seu contador.
                </span>
                <label htmlFor="emitir-loc-prestacao">
                  Município da prestação — código IBGE (opcional)
                  <input
                    id="emitir-loc-prestacao"
                    inputMode="numeric"
                    value={form.cLocPrestacao}
                    onChange={campo("cLocPrestacao")}
                  />
                </label>
                <span className="hint">
                  Em branco vale a regra geral: o ISS é devido no município da sua empresa
                  (LC 116/2003, art. 3º). Só preencha se souber que este serviço é uma das exceções.
                </span>
              </fieldset>

              <div className="total">
                <span>{form.issRetido ? "A receber do tomador" : "Valor da nota"}</span>
                <strong>{liquido === null ? TRACO : brl(liquido)}</strong>
              </div>
              {form.issRetido ? (
                <p className="hint">
                  Valor da nota {valorServicos === null ? TRACO : brl(valorServicos)} · ISS retido{" "}
                  {issRetidoValor === null ? TRACO : brl(issRetidoValor)}
                  {aliquota === null ? "" : ` (${pct(aliquota)}, calculado nesta tela)`}
                </p>
              ) : null}

              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={enviando}>
                  {enviando ? "Emitindo…" : "Emitir nota"}
                </button>
              </div>
              <p className="hint" style={{ textAlign: "right" }}>
                ⚠ A emissão é definitiva: uma NFS-e não pode ser apagada, só cancelada.
              </p>
            </form>

            <aside className="pane pane-preview" aria-label="Pré-visualização da nota">
              <PreviaNota empresa={empresa} valores={valoresDaPrevia} />
            </aside>
          </div>
        </>
      )}
    </>
  );
}

/**
 * O PORTÃO FECHADO — três razões diferentes, três frases diferentes.
 *
 * ⚠⚠ **AUSENTE NÃO É `false`.** `DESCONHECIDO` é "esta tela não recebeu o estado", e mandar quem
 * está nele pedir liberação ao contador produziria um telefonema sobre algo que talvez já esteja
 * feito — e do outro lado ninguém acharia o que consertar. Ver `lib/portaoEmissao.js`.
 */
function PortaoFechado({ portao, empresa, aoRecarregar }) {
  if (portao.estado === ESTADO.PAPEL_INSUFICIENTE) {
    return (
      <div className="alerta alerta-aviso" role="status">
        <p>
          <strong>Seu perfil nesta empresa não emite notas.</strong>
        </p>
        <p>
          Você está como <strong>{roleLabel(portao.papel) || TRACO}</strong> em{" "}
          {texto(empresa.razao)}. Emitir nota fiscal exige o perfil{" "}
          <strong>{roleLabel(portao.papelMinimo)}</strong> ou superior.
        </p>
        <p>
          Peça ao responsável pela empresa que ajuste o seu perfil, ou peça a quem já tem esse
          perfil que faça a emissão.
        </p>
      </div>
    );
  }

  if (portao.estado === ESTADO.NAO_LIBERADA) {
    return (
      <div className="alerta alerta-info" role="status">
        <p>
          <strong>A emissão de notas ainda não foi liberada para esta empresa.</strong>
        </p>
        <p>
          Quem libera é o seu escritório de contabilidade, no cadastro de {texto(empresa.razao)}.
          Fale com o seu contador — é um ajuste do lado dele, e depois esta tela passa a mostrar o
          formulário.
        </p>
        <p className="muted">Enquanto isso, o seu contador continua emitindo as notas normalmente.</p>
      </div>
    );
  }

  // ESTADO.DESCONHECIDO
  return (
    <div className="alerta alerta-aviso" role="status">
      <p>
        <strong>Não conseguimos verificar se a emissão está liberada para esta empresa.</strong>
      </p>
      <p>
        Esta tela não recebeu essa informação — o que não quer dizer que a emissão esteja bloqueada,
        nem que esteja liberada. Tente recarregar; se continuar assim, avise o seu contador de que o
        portal não está recebendo o estado da liberação.
      </p>
      {aoRecarregar ? (
        <p>
          <button type="button" className="btn-link" onClick={aoRecarregar}>
            Recarregar
          </button>
        </p>
      ) : null}
    </div>
  );
}
