// EMISSÃO DE NFS-e — o assistente.
//
// ⚠ NÃO EXISTE CAMINHO QUE PULE O PREVIEW.
// Emitir uma nota é ato fiscal IRREVERSÍVEL: uma vez autorizada, o desfazer é um cancelamento com
// justificativa, sujeito a prazo da prefeitura — quando a prefeitura aceita. Por isso o passo 4 não
// é uma tela de "revisar se quiser": é a única porta para o botão Emitir, e o botão só aparece lá.
//
// ⚠ O CONFIRM REPETE A DECLARAÇÃO INTEIRA, não dois campos.
// O espelho do passo 4 e o texto do `window.confirm` saem da MESMA `linhasDoEspelho`
// (`notas/lib/declaracaoNfse.js`). Antes eram duas listas: o espelho tinha sete linhas e o confirm
// tinha duas (valor e tomador) — e é o confirm que se lê no instante do clique.
//
// ⚠ OS CAMPOS SÃO OS DO BACKEND, não uma invenção da tela.
// Tudo aqui espelha `application/validators/nfsePayload.js`:
//   tomador  { cnpjCpf, nome, email?, endereco? { cMun, CEP, xLgr, nro, xCpl?, xBairro } }
//   servico  { descricao, valorServicos, aliquota?, issRetido? }
//   competencia?, referencia?, totTrib { pTotTribSN }
// O endereço do tomador é OPCIONAL para o validador, mas ele só é aceito COMPLETO: faltando um
// pedaço, o backend descarta o endereço inteiro (`hasEnderecoTomador`). Então a tela trata o bloco
// como tudo-ou-nada e diz isso — meio endereço preenchido viraria nota sem endereço, em silêncio.
//
// ⚠ `totTrib.pTotTribSN` NÃO É OPCIONAL, e a tela não o coletava.
// Sendo a nota declarada como Simples, o servidor exige o percentual: sem ele lança
// `MISSING_P_TOT_TRIB_SN`. Esse código não é mapeado na rota, cai no catch genérico e vira
// `status:"rejected"` no banco — ou seja, a emissão morreria e o motivo apareceria como REJEIÇÃO
// FISCAL da prefeitura, que não foi o que aconteceu.
//
// ⚠ AS TRÊS RECUSAS DO SERVIDOR APARECEM AQUI, ANTES DO CLIQUE.
// A tela não tem regra fiscal própria: ela espelha `application/nfse/dpsCodigos.js` para que o
// contador veja o desfecho antes de gastar uma emissão.
//   • regime não mapeado  → `NFSE_REGIME_INDEFINIDO`
//   • não optante         → `MISSING_TOT_TRIB_NAO_SIMPLES` (grupo de XML ainda não confirmado)
//   • ISS retido sem alíquota → `NFSE_ISS_RETIDO_SEM_ALIQUOTA`
//   • sem município emissor   → `NFSE_MUNICIPIO_NAO_CONFIGURADO`
//
// ⚠ O MUNICÍPIO EMISSOR É IMPEDIMENTO DA EMPRESA, e por isso aparece no PRIMEIRO passo.
// Ele não se resolve aqui (é cadastro), e um assistente que deixa preencher tomador, serviço e
// valores para só então recusar cobra do contador um trabalho que já estava perdido. A ausência
// também é dita no próprio cadastro — ver `SeletorMunicipioIbge`: a recusa não pode ser a primeira
// vez que alguém descobre que a empresa não emite.

import { useMemo, useState } from "react";
import { PANEL } from "./notasStyles";
import { Button } from "../../../components/ui/Button";
import {
  regimeDeclaradoNaNota,
  lerPTotTribSN,
  problemaAliquotaComRetencao,
  linhasDoEspelho,
  textoDeConfirmacao,
  textoIssRetido,
  formatarDoc,
  fmtBRL,
  RESOLUCAO,
  MOTIVO_P_TOT_TRIB_SN,
  FONTE_P_TOT_TRIB_SN,
} from "../lib/declaracaoNfse";
import { impedimentoDeEmissao } from "../../../lib/municipios/municipioIbge";
import { faltasParaEmitir } from "../../../lib/nfse/cadastroEmissaoNfse";
import { ServicoNacionalDaNota } from "./ServicoNacionalDaNota";

const PASSOS = ["Tomador", "Serviço", "Valores e tributos", "Conferir"];

const soDigitos = (v) => String(v || "").replace(/\D/g, "");

const campo = {
  background: "var(--bg-page)", border: `1px solid ${PANEL.border}`, borderRadius: 6,
  color: PANEL.text, padding: "8px 10px", fontSize: "0.9rem", width: "100%", boxSizing: "border-box",
};
const rotulo = { display: "grid", gap: 4, fontSize: "0.78rem", color: PANEL.muted };

// Cor do bloco "o que vai ser declarado". Regime resolvido NÃO é verde: verde é concluído, e ler o
// regime não conclui nada. Quando ele bloqueia a emissão, é vermelho — bloqueio é bloqueio.
const TOM_REGIME = {
  ok: { cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)" },
  bloqueado: { cor: "var(--state-danger)", fundo: "var(--state-danger-surface)" },
};

export function EmitirNfseWizard({
  companyId,
  regime: regimeCadastrado,
  codigoMunicipioIbge,
  // ⚠ O CADASTRO DA EMPRESA, como `buildMissingFields` o lê: `{ cnpj, inscricaoMunicipal,
  // codigoServicoNacional, codigoServicoMunicipal, rpsSerie }`, direto do `legacyCompany`. Sem esta
  // leitura, a recusa `company_missing_fields` do servidor morria no backend: a rota devolvia a
  // lista `missing` e NINGUÉM na interface a lia — o contador preenchia a nota inteira para receber
  // um erro genérico, sem saber qual campo faltava nem onde preenchê-lo.
  cadastroEmissao = null,
  onEmitir,
  onClose,
  onEmitida,
}) {
  const [passo, setPasso] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState(null);

  const [tomador, setTomador] = useState({ cnpjCpf: "", nome: "", email: "" });
  const [endereco, setEndereco] = useState({ cMun: "", CEP: "", xLgr: "", nro: "", xCpl: "", xBairro: "" });
  const [servico, setServico] = useState({ descricao: "", valorServicos: "", aliquota: "", issRetido: false });
  const [pTotTribSN, setPTotTribSN] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [referencia, setReferencia] = useState("");

  const docLimpo = soDigitos(tomador.cnpjCpf);
  const docValido = docLimpo.length === 11 || docLimpo.length === 14;
  const emailValido = !tomador.email || tomador.email.includes("@");
  const valor = Number(String(servico.valorServicos).replace(",", "."));

  // O regime que o SERVIDOR vai declarar, confrontado com o do cadastro. Não é escolha da tela:
  // é o espelho do `opSimpNac` que o backend crava, exposto para o contador ver antes de emitir.
  const regime = useMemo(() => regimeDeclaradoNaNota(regimeCadastrado), [regimeCadastrado]);
  // O município emissor (`cLocEmi`) é da EMPRESA, não da nota: ou está no cadastro, ou nada sai.
  const municipio = useMemo(() => impedimentoDeEmissao(codigoMunicipioIbge), [codigoMunicipioIbge]);
  // O resto da configuração da EMPRESA — o mesmo conjunto que `buildMissingFields` confere, na
  // mesma ordem. Vazio = nada falta. ⚠ Sem `cadastroEmissao` a lista sai vazia de propósito: quem
  // não passou a prop não sabe nada sobre o cadastro, e afirmar "falta tudo" seria pior que calar.
  const faltas = useMemo(() => (cadastroEmissao ? faltasParaEmitir(cadastroEmissao) : []), [cadastroEmissao]);
  const leituraPTot = useMemo(
    () => lerPTotTribSN(pTotTribSN, { exigido: regime.exigePTotTribSN }),
    [pTotTribSN, regime.exigePTotTribSN],
  );

  // ⚠ Endereço é TUDO OU NADA — é assim que o backend o trata. Um campo preenchido e outro não
  // faria o servidor descartar o bloco inteiro sem avisar ninguém.
  const camposEndereco = [endereco.cMun, endereco.CEP, endereco.xLgr, endereco.nro, endereco.xBairro];
  const enderecoCompleto = camposEndereco.every(Boolean);
  const enderecoParcial = camposEndereco.some(Boolean) && !enderecoCompleto;

  const problemasPorPasso = useMemo(() => [
    [
      // ⚠ Primeiro da lista, e no primeiro passo: é o impedimento que não depende de nada que se
      // digite aqui. Deixá-lo para o passo 3 (como o do regime) faria o contador preencher a nota
      // inteira antes de descobrir que a empresa não emite.
      municipio.bloqueia && municipio.motivoCurto,
      // Os campos de `buildMissingFields`, na mesma posição e pelo mesmo motivo do município: são
      // impedimentos da EMPRESA, que não se resolvem nesta tela e não dependem de nada digitado
      // aqui. Deixá-los para o fim cobraria do contador uma nota inteira já perdida.
      ...faltas.map((f) => f.motivoCurto),
      !docValido && "informe um CNPJ (14 dígitos) ou CPF (11 dígitos) válido",
      !String(tomador.nome).trim() && "informe o nome ou a razão social do tomador",
      !emailValido && "o e-mail informado não parece um e-mail",
      enderecoParcial && "o endereço precisa estar completo (município, CEP, logradouro, número e bairro) ou totalmente vazio — o servidor descarta endereço incompleto",
    ].filter(Boolean),
    [!String(servico.descricao).trim() && "descreva o serviço prestado"].filter(Boolean),
    [
      (!Number.isFinite(valor) || valor <= 0) && "o valor do serviço precisa ser maior que zero",
      problemaAliquotaComRetencao({ issRetido: servico.issRetido, aliquota: servico.aliquota }),
      leituraPTot.problema,
      // ⚠ O bloqueio do regime é do SERVIDOR, e é o único problema desta lista que o contador não
      // resolve nesta tela. Ele entra aqui mesmo assim: um passo que deixa avançar até o botão
      // Emitir para depois recusar é pior que dizer não na hora, com o motivo. Aqui vai a versão
      // CURTA — a explicação inteira está no bloco do regime, logo acima na mesma tela.
      regime.bloqueiaEmissao && regime.motivoCurto,
    ].filter(Boolean),
    [],
  ], [municipio, faltas, docValido, tomador.nome, emailValido, enderecoParcial, servico.descricao, valor,
    servico.issRetido, servico.aliquota, leituraPTot.problema, regime]);

  const problemasAtuais = problemasPorPasso[passo] || [];
  const podeAvancar = problemasAtuais.length === 0;
  // Chegar em "Conferir" exige que os TRÊS passos anteriores estejam bons — senão o preview
  // mostraria uma nota que o servidor recusaria, e o erro voltaria depois do clique em Emitir.
  const faltamAnteriores = problemasPorPasso.slice(0, 3).flat();
  const prontoParaEmitir = faltamAnteriores.length === 0;

  // A nota como ela vai ser declarada — uma descrição só, lida pelo espelho e pelo confirm.
  const dadosDaDeclaracao = useMemo(() => ({
    tomador: { nome: String(tomador.nome).trim(), doc: docLimpo, email: String(tomador.email).trim() },
    endereco: enderecoCompleto ? endereco : null,
    servico: {
      descricao: String(servico.descricao).trim(),
      valor,
      aliquota: servico.aliquota === "" ? null : Number(String(servico.aliquota).replace(",", ".")),
      issRetido: Boolean(servico.issRetido),
    },
    competencia,
    referencia: String(referencia).trim(),
    pTotTribSN: leituraPTot.valor,
    regime,
  }), [tomador, docLimpo, endereco, enderecoCompleto, servico, valor, competencia, referencia, leituraPTot.valor, regime]);

  function montarPayload() {
    return {
      companyId,
      tomador: {
        cnpjCpf: docLimpo,
        nome: String(tomador.nome).trim(),
        email: String(tomador.email).trim() || undefined,
        endereco: enderecoCompleto ? { ...endereco } : undefined,
      },
      servico: {
        descricao: String(servico.descricao).trim(),
        valorServicos: valor,
        aliquota: servico.aliquota === "" ? undefined : Number(String(servico.aliquota).replace(",", ".")),
        // ⚠ SEMPRE booleano explícito, nunca `undefined`: "não marcou" e "marcou não" precisam
        // chegar iguais ao servidor. É este campo que decide quem recolhe o ISS.
        issRetido: Boolean(servico.issRetido),
      },
      competencia: competencia || undefined,
      referencia: String(referencia).trim() || undefined,
      // O bloco que faltava. Sem ele o servidor lança `MISSING_P_TOT_TRIB_SN` e a nota é gravada
      // como `rejected` — parecendo rejeição da prefeitura.
      totTrib: leituraPTot.valor == null ? undefined : { pTotTribSN: leituraPTot.valor },
    };
  }

  async function emitir() {
    setErro("");
    if (!window.confirm(textoDeConfirmacao(dadosDaDeclaracao))) return;
    setEnviando(true);
    try {
      const r = await onEmitir(montarPayload());
      setResultado(r);
      onEmitida?.(r);
    } catch (e) {
      // A mensagem do provedor chega traduzida pelo `normalizeError`; o código seco não ajudaria.
      setErro(e?.message || "Não foi possível emitir a nota.");
    } finally {
      setEnviando(false);
    }
  }

  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
  const caixa = { background: "var(--bg-surface)", border: `1px solid ${PANEL.border}`, borderRadius: 12, padding: 20, width: 620, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", color: PANEL.text, boxSizing: "border-box" };

  // ── Depois de emitida: o resultado, não o formulário ──────────────────────
  if (resultado) {
    const st = String(resultado?.status || resultado?.nfse?.status || "").toLowerCase();
    const autorizada = st.includes("issued") || st.includes("autoriz");
    // ⚠ A MENSAGEM DO SERVIDOR NÃO PODE SER DESCARTADA.
    // `pending` chega por dois motivos completamente diferentes, e a tela dizia a mesma frase para
    // os dois: (a) a nota saiu e a prefeitura ainda não respondeu; (b) NADA saiu — o backend
    // devolve `pending` com "certificado/endpoint NFSe não configurado" quando `integrationReady()`
    // é falso (medido: nenhuma variável `NFSE_*` existe em produção, então hoje é SEMPRE o caso b).
    // Traduzir (b) como "aguardando o retorno da prefeitura" manda o contador esperar por uma
    // resposta que ninguém vai dar. Quando o servidor diz por quê, é o servidor que fala.
    const recado = String(resultado?.message || "").trim();
    return (
      <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div style={caixa}>
          <h3 style={{ margin: "0 0 10px" }}>{autorizada ? "✓ Nota autorizada" : "Nota registrada"}</h3>
          {autorizada ? (
            <p style={{ fontSize: "0.85rem", color: PANEL.muted, margin: "0 0 12px" }}>
              A prefeitura autorizou a nota.
            </p>
          ) : recado ? (
            <div style={{
              margin: "0 0 12px", padding: 10, borderRadius: 6, fontSize: "0.82rem",
              background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)",
              color: "var(--state-warn)",
            }}>
              <strong style={{ display: "block", marginBottom: 4 }}>A nota ainda NÃO foi emitida.</strong>
              {recado}
            </div>
          ) : (
            /* "pending" NÃO é sucesso nem erro, e dizer "emitida" aqui seria afirmar o que ainda
               não aconteceu — o servidor recebeu o pedido e ainda não respondeu. */
            <p style={{ fontSize: "0.85rem", color: PANEL.muted, margin: "0 0 12px" }}>
              O pedido de emissão foi registrado e ainda não houve resposta.
            </p>
          )}

          {/* ⚠ A FRASE ANTIGA MENTIA: "o status aparece na lista assim que houver resposta".
              A lista da aba é alimentada pela CAPTURA do ADN (`PortalInvoice`); a nota emitida por
              aqui é gravada em `ServiceInvoice`, outra tabela. Recarregar a lista depois de emitir
              não pode fazê-la aparecer — e o contador, não vendo nada mudar, emite de novo.
              A arquitetura está certa (o ADN é a autoridade); o que estava errado era a frase. */}
          <div style={{
            margin: "0 0 12px", padding: 10, borderRadius: 6, fontSize: "0.8rem",
            background: "var(--state-neutral-surface)", border: `1px solid ${PANEL.border}`,
            color: PANEL.muted,
          }}>
            <strong style={{ display: "block", marginBottom: 4, color: PANEL.text }}>
              Esta nota ainda não aparece na lista — e isso é esperado.
            </strong>
            A lista desta aba mostra o que a captura traz do Padrão Nacional (ADN), não o que sai
            daqui. A nota entra na lista quando o ADN a devolver. Enquanto isso, guarde o número e a
            chave abaixo; para verificar antes, use <strong>“🔄 Buscar NFS-e”</strong> na aba de
            notas — e não emita de novo, para não duplicar.
          </div>

          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: "0.82rem", margin: 0 }}>
            <dt style={{ color: PANEL.muted }}>Tomador</dt><dd style={{ margin: 0 }}>{String(tomador.nome).trim()}</dd>
            <dt style={{ color: PANEL.muted }}>Documento</dt><dd style={{ margin: 0 }}>{formatarDoc(docLimpo)}</dd>
            <dt style={{ color: PANEL.muted }}>Valor</dt><dd style={{ margin: 0 }}>{fmtBRL(valor)}</dd>
            {resultado?.nfse?.numeroNfse && <><dt style={{ color: PANEL.muted }}>Número</dt><dd style={{ margin: 0 }}>{resultado.nfse.numeroNfse}</dd></>}
            {resultado?.nfse?.chaveAcesso && <><dt style={{ color: PANEL.muted }}>Chave</dt><dd style={{ margin: 0, wordBreak: "break-all", fontFamily: "monospace", fontSize: "0.74rem" }}>{resultado.nfse.chaveAcesso}</dd></>}
          </dl>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <Button type="button" onClick={onClose}>Fechar</Button>
          </div>
        </div>
      </div>
    );
  }

  const tomRegime = regime.bloqueiaEmissao ? TOM_REGIME.bloqueado : TOM_REGIME.ok;

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={caixa}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Emitir nota de serviço</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {/* ⚠ IMPEDIMENTO DA EMPRESA — fica ACIMA da trilha, visível em todos os passos, porque não
            é um campo que falta: é a empresa que ainda não emite. A lista de problemas do passo
            repete a versão curta; aqui vai o motivo inteiro e onde se resolve. */}
        {(municipio.bloqueia || faltas.length > 0) && (
          <div style={{
            marginBottom: 14, padding: 10, borderRadius: 6, fontSize: "0.82rem",
            background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)",
            color: "var(--state-danger)",
          }}>
            <strong style={{ display: "block", marginBottom: 4 }}>
              Esta empresa ainda não pode emitir nota de serviço.
            </strong>
            {municipio.bloqueia && <div>{municipio.motivo}</div>}
            {/* ⚠ CADA CAMPO COM SEU NOME E O SEU LUGAR. A recusa do servidor devolve
                `{ missing: ["codigoServicoNacional", …] }` — nome de coluna, que não diz a ninguém o
                que preencher nem onde. Uma lista de "falta configuração" também não diria. */}
            {faltas.length > 0 && (
              <ul style={{ margin: municipio.bloqueia ? "8px 0 0" : 0, paddingLeft: 18 }}>
                {faltas.map((f) => (
                  <li key={f.campo} style={{ marginBottom: 4 }}>
                    <strong>{f.rotulo}</strong> — {f.motivo}{" "}
                    <span style={{ opacity: 0.9 }}>Preencha em {f.onde}.</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Trilha dos passos: onde estou e quanto falta. */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {PASSOS.map((p, i) => (
            <span
              key={p}
              style={{
                fontSize: "0.72rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                border: `1px solid ${i === passo ? PANEL.accent : PANEL.border}`,
                // ⚠ Nada de `${PANEL.accent}22`: `accent` é `var(--accent-cyan)`, e concatenar
                // hex numa var() produz uma cor inválida que o browser descarta em silêncio.
                background: i === passo ? "rgba(139, 233, 253, 0.14)" : "transparent",
                color: i === passo ? PANEL.text : (i < passo ? "var(--state-ok)" : PANEL.muted),
              }}
            >
              {i < passo ? "✓ " : `${i + 1}. `}{p}
            </span>
          ))}
        </div>

        {passo === 0 && (
          <div style={{ display: "grid", gap: 10 }}>
            <label style={rotulo}>CNPJ ou CPF do tomador
              <input value={tomador.cnpjCpf} onChange={(e) => setTomador({ ...tomador, cnpjCpf: e.target.value })} placeholder="Só números" style={campo} />
            </label>
            <label style={rotulo}>Nome ou razão social
              <input value={tomador.nome} onChange={(e) => setTomador({ ...tomador, nome: e.target.value })} style={campo} />
            </label>
            <label style={rotulo}>E-mail (opcional)
              <input value={tomador.email} onChange={(e) => setTomador({ ...tomador, email: e.target.value })} style={campo} />
            </label>
            <details>
              <summary style={{ cursor: "pointer", fontSize: "0.78rem", color: PANEL.muted }}>
                Endereço do tomador (opcional — mas só vale completo)
              </summary>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <label style={rotulo}>Código do município (IBGE)<input value={endereco.cMun} onChange={(e) => setEndereco({ ...endereco, cMun: e.target.value })} style={campo} /></label>
                <label style={rotulo}>CEP<input value={endereco.CEP} onChange={(e) => setEndereco({ ...endereco, CEP: e.target.value })} style={campo} /></label>
                <label style={{ ...rotulo, gridColumn: "1 / -1" }}>Logradouro<input value={endereco.xLgr} onChange={(e) => setEndereco({ ...endereco, xLgr: e.target.value })} style={campo} /></label>
                <label style={rotulo}>Número<input value={endereco.nro} onChange={(e) => setEndereco({ ...endereco, nro: e.target.value })} style={campo} /></label>
                <label style={rotulo}>Complemento<input value={endereco.xCpl} onChange={(e) => setEndereco({ ...endereco, xCpl: e.target.value })} style={campo} /></label>
                <label style={{ ...rotulo, gridColumn: "1 / -1" }}>Bairro<input value={endereco.xBairro} onChange={(e) => setEndereco({ ...endereco, xBairro: e.target.value })} style={campo} /></label>
              </div>
            </details>
          </div>
        )}

        {passo === 1 && (
          <div style={{ display: "grid", gap: 10 }}>
            {/* ⚠ O CÓDIGO DE SERVIÇO É O QUE SE DECLARA AO FISCO, e ele vinha invisível: a nota
                saía com o `cTribNac` do cadastro e o contador não via qual, nem com que descrição.
                Fica ANTES da descrição livre de propósito — a descrição do serviço se escreve
                olhando para o serviço que está sendo declarado, não o contrário. */}
            <ServicoNacionalDaNota cadastroEmissao={cadastroEmissao} />
            <label style={rotulo}>Descrição do serviço
              <textarea value={servico.descricao} onChange={(e) => setServico({ ...servico, descricao: e.target.value })} rows={4} style={{ ...campo, resize: "vertical" }} />
            </label>
            <label style={rotulo}>Competência (opcional)
              <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} style={{ ...campo, colorScheme: "dark" }} />
            </label>
            <label style={rotulo}>Referência interna (opcional)
              <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ex.: contrato, pedido" style={campo} />
            </label>
          </div>
        )}

        {passo === 2 && (
          <div style={{ display: "grid", gap: 10 }}>
            <label style={rotulo}>Valor dos serviços (R$)
              <input value={servico.valorServicos} onChange={(e) => setServico({ ...servico, valorServicos: e.target.value })} placeholder="0,00" inputMode="decimal" style={campo} />
            </label>
            <label style={rotulo}>Alíquota de ISS (%) — opcional
              <input value={servico.aliquota} onChange={(e) => setServico({ ...servico, aliquota: e.target.value })} placeholder="Deixe vazio para usar a da prefeitura" inputMode="decimal" style={campo} />
            </label>

            {/* ⚠ Retenção fica VISÍVEL como escolha, não escondida num default: ela muda quem
                recolhe o ISS, e passar batido é erro que só aparece na conciliação. O rótulo diz a
                CONSEQUÊNCIA, não o nome do campo. */}
            <div style={{ border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", cursor: "pointer" }}>
                <input type="checkbox" checked={servico.issRetido} onChange={(e) => setServico({ ...servico, issRetido: e.target.checked })} />
                ISS retido pelo tomador
              </label>
              <div style={{ fontSize: "0.75rem", color: PANEL.muted, marginTop: 6 }}>
                {textoIssRetido(Boolean(servico.issRetido))}
              </div>
            </div>

            {/* ⚠ O REGIME QUE VAI SER DECLARADO fica à vista, e antes do campo que ele torna
                obrigatório. Ele é o que decide `opSimpNac` no XML — quem emite precisa ver isso
                antes, não descobrir depois na nota (ou numa recusa). */}
            <div style={{
              border: `1px solid ${tomRegime.cor}`, background: tomRegime.fundo,
              borderRadius: 8, padding: 10, fontSize: "0.78rem", color: PANEL.text,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span style={{ color: PANEL.muted }}>Regime declarado nesta nota</span>
                <strong>
                  {regime.resolucao === RESOLUCAO.RESOLVIDO
                    ? `${regime.rotuloDeclarado} (opSimpNac ${regime.opSimpNac})`
                    : regime.rotuloDeclarado}
                </strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                <span style={{ color: PANEL.muted }}>Regime no cadastro da empresa</span>
                <strong>{regime.rotuloCadastrado || "não cadastrado"}</strong>
              </div>
              {regime.aviso && (
                <div style={{ marginTop: 8, color: tomRegime.cor }}>⚠ {regime.aviso}</div>
              )}
            </div>

            {/* O campo que faltava. Só existe quando a nota é declarada como Simples — para quem
                não é, o percentual do Simples não é o dado certo, e pedi-lo confundiria. */}
            {regime.exigePTotTribSN && (
              <>
                <label style={rotulo}>
                  Total de tributos do Simples Nacional (%) — obrigatório
                  <input
                    value={pTotTribSN}
                    onChange={(e) => setPTotTribSN(e.target.value)}
                    placeholder="Ex.: 6,00"
                    inputMode="decimal"
                    style={{
                      ...campo,
                      border: `1px solid ${leituraPTot.problema ? "var(--state-danger)" : PANEL.border}`,
                    }}
                  />
                </label>
                <div style={{ fontSize: "0.75rem", color: PANEL.muted, marginTop: -4 }}>
                  {MOTIVO_P_TOT_TRIB_SN}
                  <div style={{ marginTop: 6 }}>{FONTE_P_TOT_TRIB_SN}</div>
                </div>
              </>
            )}
          </div>
        )}

        {passo === 3 && (
          <div>
            <p style={{ fontSize: "0.8rem", color: PANEL.muted, margin: "0 0 10px" }}>
              Confira o espelho antes de emitir. Depois de autorizada, desfazer exige cancelamento com
              justificativa, dentro do prazo da prefeitura.
            </p>
            <div style={{ border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 12, background: "var(--bg-page)", display: "grid", gap: 6, fontSize: "0.84rem" }}>
              {/* MESMA lista que o `confirm` vai repetir — uma descrição só da nota. */}
              {linhasDoEspelho(dadosDaDeclaracao).map((l) => (
                <LinhaEspelho key={l.rotulo} r={l.rotulo} v={l.valor} forte={l.forte} separadorAntes={l.separadorAntes} />
              ))}
            </div>
            {!prontoParaEmitir && (
              <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: "0.8rem", color: "var(--state-danger)" }}>
                {faltamAnteriores.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
          </div>
        )}

        {/* Opção desabilitada NUNCA fica sem explicação. */}
        {problemasAtuais.length > 0 && (
          <ul style={{ margin: "12px 0 0", paddingLeft: 18, color: "var(--state-danger)", fontSize: "0.78rem" }}>
            {problemasAtuais.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        {erro && (
          <div style={{ marginTop: 12, padding: 8, borderRadius: 6, background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)", color: "var(--state-danger)", fontSize: "0.8rem" }}>
            {erro}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 16 }}>
          {/* Voltar de PASSO, não de tela — por isso é `Button variant="secondary"` e não o
              `BackButton`, que é a saída da página. Os outros assistentes (OFX, Excel, regras de
              obrigação) já escreviam exatamente isto. */}
          <Button
            type="button"
            variant="secondary"
            onClick={() => (passo === 0 ? onClose() : setPasso(passo - 1))}
            disabled={enviando}
          >
            {passo === 0 ? "Cancelar" : "Voltar"}
          </Button>

          {/* ⚠ O botão Emitir SÓ existe no passo de conferência. Não é uma decisão de estilo: é a
              garantia de que ninguém emite sem ver o espelho. */}
          {passo < 3 ? (
            <Button
              type="button"
              onClick={() => setPasso(passo + 1)}
              disabled={!podeAvancar}
              title={podeAvancar ? undefined : problemasAtuais.join(" · ")}
            >
              Continuar →
            </Button>
          ) : (
            /* ⚠ Era verde #69FF47. Emitir nota é o oposto de "concluído" — é o ato fiscal
               acontecendo. Ação primária usa o accent. */
            <Button
              type="button"
              onClick={emitir}
              disabled={enviando || !prontoParaEmitir}
              title={
                enviando ? "Emissão em andamento — aguarde a resposta do servidor."
                  : prontoParaEmitir ? undefined
                    : `Faltam dados nos passos anteriores: ${faltamAnteriores.join(" · ")}`
              }
            >
              {enviando ? "Emitindo…" : "Emitir nota"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LinhaEspelho({ r, v, forte, separadorAntes }) {
  return (
    <>
      {separadorAntes && <div style={{ borderTop: `1px solid ${PANEL.border}`, margin: "4px 0" }} />}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
        <span style={{ color: PANEL.muted, flex: "0 0 auto" }}>{r}</span>
        <span style={{ textAlign: "right", fontWeight: forte ? 800 : 500 }}>{v}</span>
      </div>
    </>
  );
}
