// EMISSÃO DE NFS-e — o assistente.
//
// ⚠ NÃO EXISTE CAMINHO QUE PULE O PREVIEW.
// Emitir uma nota é ato fiscal IRREVERSÍVEL: uma vez autorizada, o desfazer é um cancelamento com
// justificativa, sujeito a prazo da prefeitura — quando a prefeitura aceita. Por isso o passo
// "Conferir" não é uma tela de "revisar se quiser": é a única porta para o botão Emitir, e o botão
// só aparece lá. O espelho ao vivo do `PainelDaNota` **reforça** essa garantia (a declaração está à
// vista o tempo todo); ele não a substitui.
//
// ⚠ O CONFIRM REPETE A DECLARAÇÃO INTEIRA, não dois campos.
// O espelho, o painel ao vivo e o texto do `window.confirm` saem da MESMA `linhasDoEspelho`
// (`notas/lib/declaracaoNfse.js`). Antes eram duas listas: o espelho tinha sete linhas e o confirm
// tinha duas (valor e tomador) — e é o confirm que se lê no instante do clique.
//
// ⚠ DOIS PASSOS, NÃO QUATRO — e nenhuma garantia caiu junto.
// Tomador, serviço e valores eram três telas que só se podiam ver uma de cada vez; o contador
// clicava "Continuar" três vezes e só via a nota inteira no fim. Hoje são três BLOCOS da mesma
// página, com o espelho ao lado reagindo a cada tecla, e um único "Continuar" até a conferência.
// O que continua valendo, e é o que importa: os impedimentos aparecem ANTES (ver abaixo), o botão
// Emitir só existe na conferência, e o `confirm` repete a declaração inteira.
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
//   • não optante sem a carga tributária aproximada configurada → `MISSING_TOT_TRIB_NAO_SIMPLES`
//   • ISS retido sem alíquota → `NFSE_ISS_RETIDO_SEM_ALIQUOTA`
//   • sem município emissor   → `NFSE_MUNICIPIO_NAO_CONFIGURADO`
//
// ⚠ O NÃO OPTANTE EMITE (18/08/2026). A trava de tela que o impedia (`MOTIVO_NAO_OPTANTE_BLOQUEADO`)
// saiu inteira: o backend já monta o grupo `totTrib/pTotTrib` a partir do cadastro da empresa. O que
// pode faltar agora é DADO — os três percentuais —, e isso aparece como impedimento da EMPRESA, ao
// lado dos de `buildMissingFields`, no passo 1.
//
// ⚠ E QUANDO O SERVIDOR RECUSA MESMO ASSIM, A TELA DIZ O QUE FAZER E LEVA AO CAMPO.
// A rota já respondia `{ camada, codigo, message, correcao, numeroReutilizavel }` e o assistente
// exibia só a mensagem. A leitura está em `notas/lib/rejeicaoDaEmissao.js`; a `correcao` do
// servidor vence qualquer texto nosso. ⚠⚠ E falha de TRANSPORTE **desabilita o Emitir**: ali o
// desfecho é desconhecido e reemitir duplica nota.
//
// ⚠ A CONSULTA DE CNPJ DO TOMADOR É AJUDA, NUNCA PORTÃO.
// Com os 14 dígitos completos a tela consulta a Receita (BrasilAPI) e OFERECE nome e endereço. A
// regra fica em `notas/lib/consultaTomador.js`; a chamada é a que o onboarding já usa
// (`onboarding/lib/brasilApi.js` — reusada, não reescrita). Quatro coisas são inegociáveis aqui:
//   • **CPF não se consulta** (11 dígitos ⇒ nada acontece, nem erro, nem "não encontrado");
//   • **falha não bloqueia** — rede fora, 404 ou API caída deixam o "Continuar" exatamente como
//     estava; a recusa aparece, e o contador digita;
//   • **o digitado vence** uma consulta nova, e a tela diz de onde veio cada valor;
//   • **o endereço é tudo ou nada** — ver o bloco de endereço logo abaixo.
//
// ⚠ AS SUGESTÕES DE TOMADOR NÃO SÃO UM CADASTRO DE CLIENTES.
// Elas saem das notas que a aba já carregou (`notas/lib/tomadoresRecentes.js`) — nenhuma chamada
// nova, nenhum modelo novo. A lista é uma PÁGINA filtrada por competência, e o rótulo diz isso:
// tratar ausência ali como "este tomador não existe" seria falso.
//
// ⚠ O MUNICÍPIO EMISSOR É IMPEDIMENTO DA EMPRESA, e por isso aparece ANTES DE TUDO, acima da
// trilha, em qualquer passo. Ele não se resolve aqui (é cadastro), e um assistente que deixa
// preencher tomador, serviço e valores para só então recusar cobra do contador um trabalho que já
// estava perdido. A ausência também é dita no próprio cadastro — ver `SeletorMunicipioIbge`: a
// recusa não pode ser a primeira vez que alguém descobre que a empresa não emite.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PANEL } from "./notasStyles";
import { Button } from "../../../components/ui/Button";
import {
  regimeDeclaradoNaNota,
  lerPTotTribSN,
  problemaAliquotaComRetencao,
  textoDeConfirmacao,
  textoIssRetido,
  formatarDoc,
  fmtBRL,
  RESOLUCAO,
  MOTIVO_P_TOT_TRIB_SN,
  FONTE_P_TOT_TRIB_SN,
} from "../lib/declaracaoNfse";
import {
  buscarMunicipios,
  carregarMunicipiosIbge,
  impedimentoDeEmissao,
  municipioPorCodigo,
} from "../../../lib/municipios/municipioIbge";
import {
  faltasParaEmitir,
  faltasDaCargaTributaria,
  ONDE_CARGA_TRIBUTARIA,
  PORQUE_OS_TRES,
} from "../../../lib/nfse/cadastroEmissaoNfse";
import { ServicoNacionalDaNota } from "./ServicoNacionalDaNota";
import { PainelDaNota } from "./PainelDaNota";
import { CampoComBusca } from "./CampoComBusca";
import { buscarTomadores, listarTomadoresRecentes } from "../lib/tomadoresRecentes";
import { CAMPOS_COPIADOS, CAMPOS_NAO_COPIADOS } from "../lib/reaproveitarNota";
import { CAMPO, lerRejeicao } from "../lib/rejeicaoDaEmissao";
// ⚠ IMPORTAR daqui é o certo: `consultarCnpj` já existe, já classifica a recusa em
// `{ ok, motivo, mensagem }`, já trata a ausência de `fetch` e já aceita `fetchImpl` (é o que
// mantém o teste fora da rede). Uma segunda consulta divergiria na primeira correção.
import { consultarCnpj } from "../../onboarding/lib/brasilApi";
import {
  ORIGEM,
  NAO_CONSULTA,
  aplicarEndereco,
  aplicarNome,
  avisoSituacao,
  decidirConsulta,
  enderecoDaReceita,
  mensagemEndereco,
  nomeDaReceita,
  rotuloOrigem,
} from "../lib/consultaTomador";

const PASSOS = ["Preencher a nota", "Conferir e emitir"];
const PASSO_CONFERIR = 1;

const soDigitos = (v) => String(v || "").replace(/\D/g, "");

// Os campos do endereço, para o "ir para o campo" saber que precisa abrir a seção primeiro.
const CAMPOS_DO_ENDERECO = new Set([CAMPO.CMUN, CAMPO.CEP, CAMPO.LOGRADOURO, CAMPO.NUMERO, CAMPO.BAIRRO]);

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

// ── O AVISO DE REAPROVEITAMENTO ──────────────────────────────────────────────
//
// ⚠⚠ A TELA TEM DE DIZER QUE ISTO É UMA **NOTA NOVA**, e dizer alto. Um formulário que abre
// preenchido com os dados de uma nota que já existe se parece com "reemitir aquela nota" — e é
// exatamente o que ele NÃO é: a original não é tocada, o número é novo, e não há substituição.
// Sem esta frase, o contador que reaproveita uma nota cancelada acha que a corrigiu.
//
// ⚠ A LISTA DO QUE **NÃO** VEIO É PARTE DA MENSAGEM, não rodapé. Campo em branco num formulário
// pré-preenchido se lê como "não tinha nada lá"; aqui ele quer dizer "não copiamos, e por isto".
// As duas listas vêm de `lib/reaproveitarNota.js` — as mesmas que o código usa.
function AvisoDeReaproveitamento({ modelo }) {
  if (!modelo) return null;
  const origem = modelo.origem || {};
  const avisos = Array.isArray(modelo.avisos) ? modelo.avisos : [];

  return (
    <div style={{
      marginBottom: 14, padding: 12, borderRadius: 8, fontSize: "0.82rem",
      background: "var(--state-neutral-surface)", border: `1px solid ${PANEL.accent}`,
      color: PANEL.text, display: "grid", gap: 8,
    }}>
      <strong style={{ color: PANEL.accent }}>
        Nota NOVA, a partir da nota {origem.numero ? `nº ${origem.numero}` : "selecionada"}
      </strong>

      {/* ⚠ O TEXTO VEM DO PRÓPRIO MÓDULO DA REGRA, como já acontece com os avisos do ciclo da nota.
          Reescrevê-lo aqui faria a tela dizer uma coisa e a regra outra — e é justamente esta frase
          ("é nota nova, a original não é tocada") que impede a leitura de "reemissão". */}
      {avisos.map((a) => (
        a.tom === "atencao" ? (
          // Âmbar é pendência: cada um destes é algo a conferir ANTES de emitir.
          <div key={a.codigo} style={{
            padding: 10, borderRadius: 6,
            background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)",
            color: "var(--state-warn)",
          }}>
            ⚠ {a.texto}
          </div>
        ) : (
          <div key={a.codigo}>{a.texto}</div>
        )
      ))}

      <div style={{ color: PANEL.muted }}>
        <strong style={{ color: PANEL.text }}>Copiado:</strong>{" "}
        {CAMPOS_COPIADOS.map((c) => c.rotulo).join(" · ")}.
      </div>

      <details>
        <summary style={{ cursor: "pointer", color: PANEL.muted }}>
          O que <strong>não</strong> foi copiado, e por quê
        </summary>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
          {CAMPOS_NAO_COPIADOS.map((c) => (
            <li key={c.chave} style={{ color: PANEL.muted }}>
              <strong style={{ color: PANEL.text }}>{c.rotulo}</strong> — {c.motivo}
            </li>
          ))}
        </ul>
        {origem.codigosDaOriginal?.length > 0 && (
          <div style={{ marginTop: 8, color: PANEL.muted }}>
            Código de serviço declarado na nota de origem:{" "}
            <code>{origem.codigosDaOriginal.join(", ")}</code>. A nota nova sai com o código do
            cadastro da empresa — o bloco “O que” mostra qual.
          </div>
        )}
      </details>
    </div>
  );
}

// Cabeçalho de bloco do formulário. As três perguntas em ordem de trabalho — "para quem", "o quê",
// "quanto" —, o mesmo vocabulário do protótipo aprovado.
function Bloco({ titulo, children }) {
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <h4 style={{
        margin: 0, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.04em",
        textTransform: "uppercase", color: PANEL.muted,
      }}>
        {titulo}
      </h4>
      {children}
    </section>
  );
}

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
  // ⚠ As notas que a ABA já carregou, para sugerir tomadores. NÃO é um cadastro, não dispara
  // chamada nenhuma e é uma página filtrada — ver `lib/tomadoresRecentes.js`. Ausente = sem
  // sugestões, e o campo funciona exatamente como antes.
  notasDaEmpresa = null,
  // ⚠ O `fetch` da CONSULTA DE CNPJ, injetável. Em produção fica `null` e vale o do browser; nos
  // testes entra um dublê — nenhum teste deste projeto pode tocar a rede. Não confundir com a
  // emissão, que vai por `onEmitir`.
  fetchCnpj = null,
  // ⚠ REAPROVEITAMENTO DE UMA NOTA JÁ EMITIDA — o estado INICIAL do formulário, e nada além disso.
  //
  // Vem de `notas/lib/reaproveitarNota.js` na forma `{ tomador, servico, competencia, referencia,
  // origem, avisos }`. O assistente continua sendo o único caminho de emissão: o bloqueio de
  // cadastro incompleto, o pré-voo do regime, a consulta de CNPJ, o espelho ao vivo e as travas de
  // desfecho desconhecido valem igual. O que muda é de onde os campos partem.
  //
  // ⚠⚠ NENHUM IDENTIFICADOR CHEGA AQUI. `numero`, `chaveAcesso`, `idNfse`, `idDps`, série e RPS não
  // existem neste objeto (ver a lista `CAMPOS_NAO_COPIADOS` do módulo): o número da nota nova é
  // reservado pelo BACKEND na emissão. Reaproveitar identificador é duplicidade (E0014) ou uma nota
  // que se diz ser outra.
  valoresIniciais = null,
  onEmitir,
  onClose,
  onEmitida,
}) {
  const [passo, setPasso] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [rejeicao, setRejeicao] = useState(null);
  const [resultado, setResultado] = useState(null);

  // ⚠ Inicializadores preguiçosos, não `useEffect`: o assistente é montado do zero a cada abertura,
  // então isto é o estado de partida. Um efeito que "aplicasse" os valores depois sobrescreveria o
  // que o contador tivesse digitado enquanto ele não rodava.
  const [tomador, setTomador] = useState(() => ({
    cnpjCpf: "", nome: "", email: "", ...(valoresIniciais?.tomador || {}),
  }));
  const [endereco, setEndereco] = useState({ cMun: "", CEP: "", xLgr: "", nro: "", xCpl: "", xBairro: "" });
  const [enderecoAberto, setEnderecoAberto] = useState(false);
  // De onde veio o que está no campo. `DIGITADO` é o que faz o contador vencer a consulta.
  // ⚠ Guardadas TAMBÉM em ref: a resposta da consulta chega depois do render que a disparou, e o
  // contador pode ter digitado o nome nesse meio-tempo. Lendo só do closure, a consulta em voo
  // sobrescreveria justamente o que ele acabou de escrever.
  //
  // ⚠ NOME VINDO DE UMA NOTA REAPROVEITADA ENTRA COMO `DIGITADO`, exatamente como
  // `escolherTomadorSugerido` faz com o tomador escolhido na busca: foi uma escolha explícita do
  // contador, e é isso que impede a consulta de CNPJ (que o próprio preenchimento vai disparar) de
  // trocá-lo sozinho. O nome da Receita continua aparecendo, com o botão "usar o da Receita".
  const nomeVeioDeNotaModelo = Boolean(String(valoresIniciais?.tomador?.nome || "").trim());
  const [origemNome, setOrigemNome] = useState(nomeVeioDeNotaModelo ? ORIGEM.DIGITADO : ORIGEM.AUSENTE);
  const [origemEndereco, setOrigemEndereco] = useState(ORIGEM.AUSENTE);
  const origemNomeRef = useRef(nomeVeioDeNotaModelo ? ORIGEM.DIGITADO : ORIGEM.AUSENTE);
  const origemEnderecoRef = useRef(ORIGEM.AUSENTE);
  function marcarOrigemNome(o) { origemNomeRef.current = o; setOrigemNome(o); }
  function marcarOrigemEndereco(o) { origemEnderecoRef.current = o; setOrigemEndereco(o); }
  // Espelho do último render committed, pelo mesmo motivo das origens acima: a decisão de aplicar
  // (ou não) o que a Receita devolveu tem de olhar o campo COMO ELE ESTÁ quando a resposta chega.
  const tomadorRef = useRef(tomador);
  const enderecoRef = useRef(endereco);
  tomadorRef.current = tomador;
  enderecoRef.current = endereco;
  // `null` = a tela não tem nada a dizer sobre consulta (é o estado do CPF, e o do campo vazio).
  const [consulta, setConsulta] = useState(null);
  const [ultimoConsultado, setUltimoConsultado] = useState(null);
  const consultando = useRef(false);
  const [servico, setServico] = useState(() => ({
    descricao: "", valorServicos: "", aliquota: "", issRetido: false, ...(valoresIniciais?.servico || {}),
  }));
  const [pTotTribSN, setPTotTribSN] = useState("");
  // ⚠ A COMPETÊNCIA DA NOTA MODELO **NÃO** ENTRA — a nota nova é de agora, não do mês da antiga.
  // `valoresIniciais.competencia` chega vazio de propósito (ver `reaproveitarNota.js`); a leitura
  // está aqui, e não um valor cravado, para que este campo continue igual nos dois caminhos.
  const [competencia, setCompetencia] = useState(valoresIniciais?.competencia || "");
  const [referencia, setReferencia] = useState(valoresIniciais?.referencia || "");

  // A lista oficial do IBGE, para o campo do município do tomador. ⚠ Carregada por `import()`
  // dinâmico e SÓ quando a seção do endereço é aberta (ou quando a consulta precisa conferir um
  // código): são 5.571 linhas que a maioria das emissões nunca usa.
  const [municipios, setMunicipios] = useState(null);
  useEffect(() => {
    if (!enderecoAberto || municipios) return;
    let vivo = true;
    // Falha de carga não vira erro na tela: o campo continua aceitando o código digitado, que é o
    // comportamento que existia antes de haver busca nenhuma.
    carregarMunicipiosIbge().then((d) => { if (vivo) setMunicipios(d); }).catch(() => {});
    return () => { vivo = false; };
  }, [enderecoAberto, municipios]);

  const docLimpo = soDigitos(tomador.cnpjCpf);
  const docValido = docLimpo.length === 11 || docLimpo.length === 14;
  const emailValido = !tomador.email || tomador.email.includes("@");
  const valor = Number(String(servico.valorServicos).replace(",", "."));

  // ── A consulta do tomador na Receita ──────────────────────────────────────
  // ⚠ Nada aqui entra em `problemasDaNota`. A consulta ajuda; ela não decide se a nota pode sair.
  async function consultarTomador(digitos) {
    if (consultando.current) return;
    consultando.current = true;
    // Marcado ANTES da chamada: é o que impede o mesmo CNPJ de ser consultado de novo enquanto a
    // primeira resposta ainda está no ar.
    setUltimoConsultado(digitos);
    setConsulta({ estado: "consultando" });
    try {
      const r = await consultarCnpj(digitos, { fetchImpl: fetchCnpj });
      if (!r.ok) {
        // A recusa APARECE (o projeto tem o precedente do erro engolido virando "o botão não faz
        // nada") e o caminho segue aberto — nenhum campo é tocado, nenhum passo é bloqueado.
        setConsulta({ estado: "recusada", mensagem: r.mensagem });
        return;
      }

      // A lista oficial do IBGE só é carregada quando há resposta para conferir — `import()`
      // dinâmico, fora do bundle inicial. Falha de carga não é erro de consulta: vira "sem código
      // verificável", e o endereço deixa de ser oferecido.
      const listaIbge = await carregarMunicipiosIbge().catch(() => null);
      if (listaIbge) setMunicipios(listaIbge);
      const leituraEndereco = enderecoDaReceita(r.bruto, { municipios: listaIbge });
      const nome = nomeDaReceita(r.bruto);

      const nomeAplicado = aplicarNome({
        nomeAtual: tomadorRef.current.nome,
        origemAtual: origemNomeRef.current,
        nome,
      });
      if (nomeAplicado.aplicou) {
        setTomador((atual) => ({ ...atual, nome: nomeAplicado.nome }));
        marcarOrigemNome(ORIGEM.DA_RECEITA);
      }

      const enderecoAplicado = aplicarEndereco({
        enderecoAtual: enderecoRef.current,
        origemAtual: origemEnderecoRef.current,
        endereco: leituraEndereco.endereco,
      });
      if (enderecoAplicado.aplicou) {
        setEndereco(enderecoAplicado.endereco);
        marcarOrigemEndereco(ORIGEM.DA_RECEITA);
        // Endereço que chegou preenchido precisa ser CONFERIDO, e não se confere o que está
        // fechado. (A seção já abria sozinha antes, pelo `open` do `<details>`.)
        setEnderecoAberto(true);
      }

      setConsulta({
        estado: "ok",
        nome,
        // O que o contador tinha digitado continua valendo; a tela mostra os DOIS e deixa ele
        // trocar. Sumir com um dos lados é o que faz "por que o nome mudou?" não ter resposta.
        nomeRecusado: nome && !nomeAplicado.aplicou ? nome : null,
        avisoSituacao: avisoSituacao(r.situacao),
        endereco: leituraEndereco.endereco,
        enderecoAplicado: enderecoAplicado.aplicou,
        mensagemEndereco: mensagemEndereco(leituraEndereco),
      });
    } finally {
      consultando.current = false;
    }
  }

  // ⚠ CPF (11 dígitos) NÃO CONSULTA e NÃO MOSTRA NADA — nem erro, nem "não encontrado". Documento
  // fora de forma também limpa o painel; repetido mantém o que já está na tela.
  useEffect(() => {
    const decisao = decidirConsulta(tomador.cnpjCpf, { ultimoConsultado });
    if (decisao.consultar) {
      consultarTomador(decisao.digitos);
      return;
    }
    if (decisao.motivo !== NAO_CONSULTA.REPETIDA) setConsulta(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tomador.cnpjCpf, ultimoConsultado]);

  // ⚠ Toda digitação no endereço marca `DIGITADO` — e é isso que impede uma consulta posterior de
  // apagar o que o contador escreveu.
  function alterarEndereco(campoNome, valorNovo) {
    marcarOrigemEndereco(ORIGEM.DIGITADO);
    setEndereco((atual) => ({ ...atual, [campoNome]: valorNovo }));
  }

  function usarNomeDaReceita(nome) {
    setTomador((atual) => ({ ...atual, nome }));
    marcarOrigemNome(ORIGEM.DA_RECEITA);
    setConsulta((atual) => (atual ? { ...atual, nomeRecusado: null } : atual));
  }

  // ── Sugestão de tomador ───────────────────────────────────────────────────
  // ⚠ Escolher preenche NOME e DOCUMENTO e para aí; os dois seguem editáveis. O nome vai marcado
  // como `DIGITADO` porque foi uma escolha explícita do contador — e é isso que impede a consulta
  // do CNPJ (que o próprio preenchimento vai disparar) de trocá-lo por conta própria.
  const tomadoresRecentes = useMemo(
    () => listarTomadoresRecentes(notasDaEmpresa),
    [notasDaEmpresa],
  );
  const buscarSugestoesDeTomador = useCallback(
    (termo) => buscarTomadores(tomadoresRecentes, termo),
    [tomadoresRecentes],
  );
  function escolherTomadorSugerido(item) {
    marcarOrigemNome(ORIGEM.DIGITADO);
    setTomador((atual) => ({ ...atual, nome: item.nome, cnpjCpf: item.doc }));
  }

  const buscarMunicipioDoTomador = useCallback(
    (termo) => (municipios ? buscarMunicipios(municipios, termo, { limite: 8 }) : { itens: [], total: 0 }),
    [municipios],
  );
  const municipioEscolhido = useMemo(
    () => (municipios && soDigitos(endereco.cMun).length === 7
      ? municipioPorCodigo(municipios, soDigitos(endereco.cMun))
      : null),
    [municipios, endereco.cMun],
  );

  // O regime que o SERVIDOR vai declarar, confrontado com o do cadastro. Não é escolha da tela:
  // é o espelho do `opSimpNac` que o backend crava, exposto para o contador ver antes de emitir.
  const regime = useMemo(() => regimeDeclaradoNaNota(regimeCadastrado), [regimeCadastrado]);
  // O município emissor (`cLocEmi`) é da EMPRESA, não da nota: ou está no cadastro, ou nada sai.
  const municipio = useMemo(() => impedimentoDeEmissao(codigoMunicipioIbge), [codigoMunicipioIbge]);
  // O resto da configuração da EMPRESA — o mesmo conjunto que `buildMissingFields` confere, na
  // mesma ordem. Vazio = nada falta. ⚠ Sem `cadastroEmissao` a lista sai vazia de propósito: quem
  // não passou a prop não sabe nada sobre o cadastro, e afirmar "falta tudo" seria pior que calar.
  const faltas = useMemo(() => (cadastroEmissao ? faltasParaEmitir(cadastroEmissao) : []), [cadastroEmissao]);
  // ⚠ A CARGA TRIBUTÁRIA APROXIMADA — o outro impedimento da EMPRESA, e só do NÃO OPTANTE.
  //
  // O backend recusa a emissão do não optante sem os TRÊS percentuais
  // (`MISSING_TOT_TRIB_NAO_SIMPLES`, com `err.faltando` nomeando quais). Aqui a mesma exigência é
  // espelhada por `faltasDaCargaTributaria` e mostrada no passo 1 — a alternativa é o contador
  // preencher a nota inteira para ouvir "não" no clique.
  //
  // ⚠ `regime.exigeTotTribNaoSimples` GUARDA A PORTA NOS DOIS SENTIDOS: a empresa do Simples não vê
  // estes campos (eles não vão ao XML dela; ela declara `pTotTribSN`), e o regime INDEFINIDO também
  // não os cobra — ali já não se sabe nem qual dos dois grupos a nota vai levar, e a emissão já está
  // bloqueada pelo regime, com o seu próprio motivo.
  //
  // ⚠ Sem `cadastroEmissao` a lista sai vazia, pelo mesmo motivo de `faltas`: prop ausente quer
  // dizer "esta tela não recebeu o cadastro", não "o cadastro está vazio".
  const faltasDaCarga = useMemo(
    () => (cadastroEmissao && regime.exigeTotTribNaoSimples ? faltasDaCargaTributaria(cadastroEmissao) : []),
    [cadastroEmissao, regime.exigeTotTribNaoSimples],
  );
  const leituraPTot = useMemo(
    () => lerPTotTribSN(pTotTribSN, { exigido: regime.exigePTotTribSN }),
    [pTotTribSN, regime.exigePTotTribSN],
  );

  // ⚠ Endereço é TUDO OU NADA — é assim que o backend o trata. Um campo preenchido e outro não
  // faria o servidor descartar o bloco inteiro sem avisar ninguém.
  const camposEndereco = [endereco.cMun, endereco.CEP, endereco.xLgr, endereco.nro, endereco.xBairro];
  const enderecoCompleto = camposEndereco.every(Boolean);
  const enderecoParcial = camposEndereco.some(Boolean) && !enderecoCompleto;

  // ⚠ UMA LISTA SÓ DE PENDÊNCIAS, E CADA UMA SABE ONDE SE RESOLVE.
  // A ordem é a de sempre e ela é deliberada: primeiro o que impede a EMPRESA de emitir (não
  // depende de nada digitado aqui e não se resolve nesta tela), depois tomador, serviço e valores,
  // na ordem em que aparecem no formulário. `campo` é o id do input — é o que faz o item da lista
  // levar ao lugar em vez de só nomeá-lo.
  //
  // ⚠⚠ `grave` SEPARA "AINDA NÃO PREENCHI" DE "ESTÁ ERRADO", e essa distinção nasceu de juntar os
  // três passos num só: com quatro telas, cada uma mostrava duas pendências por vez; numa tela só,
  // abrir o assistente vazio mostraria CINCO LINHAS VERMELHAS de uma vez — o paredão que o projeto
  // passa o dia desmontando ("quando o padrão grita, a exceção some"). Campo vazio é o estado
  // NORMAL de um formulário recém-aberto e vai em cinza (`--state-neutral`, o token de "falta");
  // vermelho fica para o que está preenchido e não serve — e-mail sem arroba, endereço pela
  // metade, percentual fora de 0–100, retenção sem alíquota — e para o que a EMPRESA não tem.
  // Os dois desabilitam o Continuar igualmente: a cor fala do que fazer, não do que vale.
  const problemasDaNota = useMemo(() => {
    const problemaAliquota = problemaAliquotaComRetencao({ issRetido: servico.issRetido, aliquota: servico.aliquota });
    const valorEmBranco = !String(servico.valorServicos).trim();
    return [
      municipio.bloqueia && { texto: municipio.motivoCurto, campo: null, grave: true },
      // Os campos de `buildMissingFields`, na mesma posição e pelo mesmo motivo do município: são
      // impedimentos da EMPRESA, que não se resolvem nesta tela.
      ...faltas.map((f) => ({ texto: f.motivoCurto, campo: null, grave: true })),
      // Mesma posição e mesmo motivo: é a EMPRESA que não está configurada, e isso não se resolve
      // nesta tela. Uma linha POR PERCENTUAL — "falta a carga tributária" mandaria conferir os três.
      ...faltasDaCarga.map((f) => ({ texto: f.motivoCurto, campo: null, grave: true })),
      !docValido && {
        texto: "informe um CNPJ (14 dígitos) ou CPF (11 dígitos) válido",
        campo: CAMPO.DOC,
        // Documento com dígitos a mais ou a menos é ERRO; campo intocado é só falta.
        grave: docLimpo.length > 0,
      },
      !String(tomador.nome).trim() && { texto: "informe o nome ou a razão social do tomador", campo: CAMPO.NOME, grave: false },
      !emailValido && { texto: "o e-mail informado não parece um e-mail", campo: CAMPO.EMAIL, grave: true },
      enderecoParcial && {
        texto: "o endereço precisa estar completo (município, CEP, logradouro, número e bairro) ou totalmente vazio — o servidor descarta endereço incompleto",
        campo: CAMPO.CMUN,
        grave: true,
      },
      !String(servico.descricao).trim() && { texto: "descreva o serviço prestado", campo: CAMPO.DESCRICAO, grave: false },
      (!Number.isFinite(valor) || valor <= 0) && {
        texto: "o valor do serviço precisa ser maior que zero",
        campo: CAMPO.VALOR,
        grave: !valorEmBranco,
      },
      problemaAliquota && { texto: problemaAliquota, campo: CAMPO.ALIQUOTA, grave: true },
      leituraPTot.problema && {
        texto: leituraPTot.problema,
        campo: CAMPO.P_TOT_TRIB_SN,
        grave: leituraPTot.preenchido,
      },
      // ⚠ O bloqueio do regime é do SERVIDOR, e é o único problema desta lista que o contador não
      // resolve nesta tela. Ele entra aqui mesmo assim: um passo que deixa avançar até o botão
      // Emitir para depois recusar é pior que dizer não na hora, com o motivo. Aqui vai a versão
      // CURTA — a explicação inteira está no bloco do regime, na mesma tela.
      regime.bloqueiaEmissao && { texto: regime.motivoCurto, campo: null, grave: true },
    ].filter(Boolean);
  }, [municipio, faltas, faltasDaCarga, docValido, docLimpo, tomador.nome, emailValido, enderecoParcial,
    servico.descricao, servico.valorServicos, valor, servico.issRetido, servico.aliquota,
    leituraPTot.problema, leituraPTot.preenchido, regime]);

  const prontoParaEmitir = problemasDaNota.length === 0;
  const textoDosProblemas = problemasDaNota.map((p) => p.texto).join(" · ");
  const temProblemaGrave = problemasDaNota.some((p) => p.grave);

  // ── Ir para o campo ───────────────────────────────────────────────────────
  // ⚠ Nomear o campo não basta: o formulário rola, e o endereço fica dentro de uma seção fechada.
  // O foco é dado depois do render (o passo pode ter mudado, a seção pode ter acabado de abrir).
  const [campoAlvo, setCampoAlvo] = useState(null);
  function irParaCampo(id) {
    if (!id) return;
    setPasso(0);
    if (CAMPOS_DO_ENDERECO.has(id)) setEnderecoAberto(true);
    setCampoAlvo(id);
  }
  useEffect(() => {
    if (!campoAlvo) return;
    const el = typeof document !== "undefined" ? document.getElementById(campoAlvo) : null;
    if (el) {
      el.focus?.();
      el.scrollIntoView?.({ block: "center" });
    }
    setCampoAlvo(null);
  }, [campoAlvo, passo, enderecoAberto]);

  // A nota como ela vai ser declarada — uma descrição só, lida pelo espelho, pelo painel ao vivo e
  // pelo confirm.
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
    setRejeicao(null);
    if (!window.confirm(textoDeConfirmacao(dadosDaDeclaracao))) return;
    setEnviando(true);
    try {
      const r = await onEmitir(montarPayload());
      setResultado(r);
      onEmitida?.(r);
    } catch (e) {
      // ⚠ O que o servidor mandou é lido INTEIRO — camada, código, `correcao` e a lista `missing`.
      // Antes só `e.message` aparecia, e o "o que fazer" que a rota já escrevia era descartado.
      setRejeicao(lerRejeicao(e));
    } finally {
      setEnviando(false);
    }
  }

  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
  const caixa = { background: "var(--bg-surface)", border: `1px solid ${PANEL.border}`, borderRadius: 12, padding: 20, width: 960, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", color: PANEL.text, boxSizing: "border-box" };

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
        <div style={{ ...caixa, width: 620 }}>
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
  // ⚠⚠ DESFECHO DESCONHECIDO TRAVA O BOTÃO. Falha de transporte quer dizer que a nota PODE ter sido
  // autorizada do outro lado; clicar de novo é como se duplica nota fiscal. Ver `rejeicaoDaEmissao`.
  const travadoPelaRejeicao = Boolean(rejeicao?.desfechoDesconhecido);

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={caixa}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Emitir nota de serviço</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {/* ⚠ IMPEDIMENTO DA EMPRESA — fica ACIMA da trilha, visível em todos os passos, porque não
            é um campo que falta: é a empresa que ainda não emite. A lista de problemas repete a
            versão curta; aqui vai o motivo inteiro e onde se resolve. */}
        {(municipio.bloqueia || faltas.length > 0 || faltasDaCarga.length > 0) && (
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
            {/* ⚠ A CARGA APROXIMADA VEM EM UM PARÁGRAFO SÓ, não em três itens com a mesma
                explicação repetida: o que muda de um para o outro é só o NOME da parcela, e o
                motivo (os três são exigidos juntos, inclusive quando algum é 0,00) é o mesmo.
                Os nomes aparecem — é o que a recusa do servidor devolve em `faltando`. */}
            {faltasDaCarga.length > 0 && (
              <div style={{ marginTop: (municipio.bloqueia || faltas.length > 0) ? 8 : 0 }}>
                <strong>
                  Carga tributária aproximada — falta{" "}
                  {faltasDaCarga.map((f) => f.rotulo.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " e $1")}.
                </strong>{" "}
                Esta empresa não é optante do Simples: a nota declara os percentuais de tributos
                aproximados da Lei 12.741/2012, e o servidor recusa a emissão sem eles.{" "}
                {PORQUE_OS_TRES}{" "}
                <span style={{ opacity: 0.9 }}>Preencha em {ONDE_CARGA_TRIBUTARIA}.</span>
              </div>
            )}
          </div>
        )}

        {/* Fica DEPOIS do impedimento da empresa (que é o que decide se sai nota) e ANTES da
            trilha: é o contexto da tela inteira, não de um passo. */}
        <AvisoDeReaproveitamento modelo={valoresIniciais} />

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

        {/* ⚠ NA CONFERÊNCIA O ESPELHO É A TELA INTEIRA, e ele é O MESMO painel — não uma segunda
            cópia da declaração ao lado da primeira. Enquanto havia as duas, a mesma nota aparecia
            duas vezes na mesma tela, que é exatamente o defeito que `linhasDoEspelho` existe para
            não ter. */}
        {passo === PASSO_CONFERIR && (
          <p style={{ fontSize: "0.82rem", color: PANEL.muted, margin: "0 0 12px" }}>
            Confira a nota abaixo antes de emitir. Depois de autorizada, desfazer exige cancelamento
            com justificativa, dentro do prazo da prefeitura.
          </p>
        )}

        {/* O formulário e o espelho lado a lado. Abaixo de 900px a grade vira uma coluna e o
            espelho fica embaixo — ver `.emitir-nfse-corpo` no `App.css`. */}
        <div className={passo === PASSO_CONFERIR ? "emitir-nfse-corpo emitir-nfse-corpo--conferir" : "emitir-nfse-corpo"}>
          {passo === 0 && (
            <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
              <>
                {/* ── Para quem ─────────────────────────────────────────── */}
                <Bloco titulo="Para quem">
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <label htmlFor={CAMPO.DOC} style={{ ...rotulo, flex: 1 }}>CNPJ ou CPF do tomador
                      <input
                        id={CAMPO.DOC}
                        value={tomador.cnpjCpf}
                        onChange={(e) => setTomador({ ...tomador, cnpjCpf: e.target.value })}
                        placeholder="Só números"
                        style={campo}
                      />
                    </label>
                    {/* ⚠ O botão existe para a RETENTATIVA: a consulta automática não repete o mesmo
                        CNPJ, e sem ele uma queda de rede deixaria o contador sem como tentar de novo
                        (teria de apagar e redigitar o documento). Com CPF ele nem aparece. */}
                    {docLimpo.length === 14 && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => consultarTomador(docLimpo)}
                        disabled={consulta?.estado === "consultando"}
                      >
                        {consulta?.estado === "consultando" ? "consultando…" : "consultar Receita"}
                      </Button>
                    )}
                  </div>

                  {/* ⚠ COM CPF (11 dígitos) NADA É RENDERIZADO AQUI. `consulta` fica `null`: sem erro,
                      sem "não encontrado", sem piscar. A BrasilAPI é base de CNPJ. */}
                  {consulta?.estado === "consultando" && (
                    <div style={{ fontSize: "0.78rem", color: PANEL.muted }}>Consultando o CNPJ na Receita…</div>
                  )}
                  {consulta?.estado === "recusada" && (
                    <div style={{
                      padding: 10, borderRadius: 6, fontSize: "0.8rem",
                      background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)",
                      color: "var(--state-warn)",
                    }}>
                      {consulta.mensagem}{" "}
                      {/* A frase que mantém a consulta como AJUDA: nada aqui impede emitir. */}
                      <span style={{ opacity: 0.9 }}>
                        A consulta é só uma ajuda — preencha os campos à mão e a emissão segue normalmente.
                      </span>
                    </div>
                  )}
                  {consulta?.estado === "ok" && (
                    <div style={{
                      padding: 10, borderRadius: 6, fontSize: "0.8rem", display: "grid", gap: 6,
                      background: "var(--state-neutral-surface)", border: `1px solid ${PANEL.border}`,
                      color: PANEL.text,
                    }}>
                      <div>
                        <span style={{ color: PANEL.muted }}>Razão social na Receita: </span>
                        <strong>{consulta.nome || "não informada na resposta"}</strong>
                      </div>
                      {consulta.avisoSituacao && (
                        <div style={{ color: "var(--state-warn)" }}>⚠ {consulta.avisoSituacao}</div>
                      )}
                      {/* ⚠ O DIGITADO VENCE — e os dois lados ficam à vista. Sumir com um deles faria
                          "por que o nome mudou?" (ou não mudou) ficar sem resposta na tela. */}
                      {consulta.nomeRecusado && (
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ color: PANEL.muted }}>
                            O nome digitado foi mantido — o que você escreve vence a consulta.
                          </span>
                          <Button type="button" variant="secondary" size="sm" onClick={() => usarNomeDaReceita(consulta.nomeRecusado)}>
                            usar o da Receita
                          </Button>
                        </div>
                      )}
                      <div style={{ color: consulta.enderecoAplicado ? PANEL.muted : "var(--state-warn)" }}>
                        {consulta.mensagemEndereco}
                      </div>
                    </div>
                  )}

                  {/* ⚠ SUGESTÃO, NÃO CADASTRO. Só existe quando a aba trouxe notas com tomador — e o
                      rótulo diz de onde a lista vem, porque ela é uma PÁGINA filtrada. */}
                  {tomadoresRecentes.length > 0 ? (
                    <CampoComBusca
                      id={CAMPO.NOME}
                      rotulo="Nome ou razão social"
                      aoLadoDoRotulo={rotuloOrigem(origemNome) ? (
                        <span style={{ marginLeft: 6, fontSize: "0.72rem", opacity: 0.85 }}>
                          ({rotuloOrigem(origemNome)})
                        </span>
                      ) : null}
                      valor={tomador.nome}
                      onChangeTexto={(v) => { marcarOrigemNome(ORIGEM.DIGITADO); setTomador({ ...tomador, nome: v }); }}
                      buscar={buscarSugestoesDeTomador}
                      chaveDoItem={(t) => t.doc}
                      rotuloDoItem={(t) => t.nome}
                      detalheDoItem={(t) => `${formatarDoc(t.doc)} · ${t.notas} nota(s)`}
                      onEscolher={escolherTomadorSugerido}
                      textoVazio="Nenhum tomador com esse texto nas notas desta lista — digite o nome e siga."
                      ajuda={
                        "Sugestões vindas das notas já capturadas nesta lista (não é um cadastro de "
                        + "clientes): quem não aparece aqui pode existir — é só digitar."
                      }
                    />
                  ) : (
                    <label htmlFor={CAMPO.NOME} style={rotulo}>
                      Nome ou razão social
                      {rotuloOrigem(origemNome) && (
                        <span style={{ marginLeft: 6, fontSize: "0.72rem", opacity: 0.85 }}>
                          ({rotuloOrigem(origemNome)})
                        </span>
                      )}
                      <input
                        id={CAMPO.NOME}
                        value={tomador.nome}
                        onChange={(e) => { marcarOrigemNome(ORIGEM.DIGITADO); setTomador({ ...tomador, nome: e.target.value }); }}
                        style={campo}
                      />
                    </label>
                  )}

                  <label htmlFor={CAMPO.EMAIL} style={rotulo}>E-mail (opcional)
                    <input id={CAMPO.EMAIL} value={tomador.email} onChange={(e) => setTomador({ ...tomador, email: e.target.value })} style={campo} />
                  </label>

                  <details open={enderecoAberto} onToggle={(e) => setEnderecoAberto(e.currentTarget.open)}>
                    <summary style={{ cursor: "pointer", fontSize: "0.78rem", color: PANEL.muted }}>
                      Endereço do tomador (opcional — mas só vale completo)
                      {rotuloOrigem(origemEndereco) && <span style={{ marginLeft: 6 }}>({rotuloOrigem(origemEndereco)})</span>}
                    </summary>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                      {/* ⚠ O CÓDIGO DO MUNICÍPIO ERA SETE DÍGITOS DIGITADOS À MÃO — e errar um deles
                          emite a nota com o município do tomador errado, descoberto depois. Agora se
                          BUSCA na mesma lista oficial versionada do IBGE que o cadastro usa. A busca
                          ENCONTRA: nada se autosseleciona, e o que está escolhido aparece com nome,
                          UF e código para conferência. Sem a lista carregada, o campo continua
                          aceitando o código digitado. */}
                      <div style={{ gridColumn: "1 / -1" }}>
                        <CampoComBusca
                          id={CAMPO.CMUN}
                          rotulo="Código do município (IBGE) — busque pelo nome"
                          valor={endereco.cMun}
                          onChangeTexto={(v) => alterarEndereco("cMun", v)}
                          buscar={buscarMunicipioDoTomador}
                          chaveDoItem={(m) => m[0]}
                          rotuloDoItem={(m) => `${m[1]} / ${m[2]}`}
                          detalheDoItem={(m) => m[0]}
                          onEscolher={(m) => alterarEndereco("cMun", m[0])}
                          inputMode="numeric"
                          placeholder={municipios ? "Busque pelo nome do município, UF ou código" : "Carregando a lista do IBGE…"}
                          textoVazio={municipios
                            ? "Nenhum município com esse texto. Tente só o nome, ou nome + UF."
                            : "A lista do IBGE ainda não carregou — digite o código de 7 dígitos."}
                          ajuda={municipioEscolhido
                            ? `Escolhido: ${municipioEscolhido[1]} / ${municipioEscolhido[2]}`
                            : "Município e UF juntos — é a UF que separa os homônimos."}
                        />
                      </div>
                      <label htmlFor={CAMPO.CEP} style={rotulo}>CEP<input id={CAMPO.CEP} value={endereco.CEP} onChange={(e) => alterarEndereco("CEP", e.target.value)} style={campo} /></label>
                      <label htmlFor={CAMPO.NUMERO} style={rotulo}>Número<input id={CAMPO.NUMERO} value={endereco.nro} onChange={(e) => alterarEndereco("nro", e.target.value)} style={campo} /></label>
                      <label htmlFor={CAMPO.LOGRADOURO} style={{ ...rotulo, gridColumn: "1 / -1" }}>Logradouro<input id={CAMPO.LOGRADOURO} value={endereco.xLgr} onChange={(e) => alterarEndereco("xLgr", e.target.value)} style={campo} /></label>
                      <label style={rotulo}>Complemento<input value={endereco.xCpl} onChange={(e) => alterarEndereco("xCpl", e.target.value)} style={campo} /></label>
                      <label htmlFor={CAMPO.BAIRRO} style={rotulo}>Bairro<input id={CAMPO.BAIRRO} value={endereco.xBairro} onChange={(e) => alterarEndereco("xBairro", e.target.value)} style={campo} /></label>
                    </div>
                  </details>
                </Bloco>

                {/* ── O que ─────────────────────────────────────────────── */}
                <Bloco titulo="O que">
                  {/* ⚠ O CÓDIGO DE SERVIÇO É O QUE SE DECLARA AO FISCO, e ele vinha invisível: a nota
                      saía com o `cTribNac` do cadastro e o contador não via qual, nem com que descrição.
                      Fica ANTES da descrição livre de propósito — a descrição do serviço se escreve
                      olhando para o serviço que está sendo declarado, não o contrário.
                      ⚠ E continua sendo CONFERÊNCIA, não escolha: `buildDpsXml` lê
                      `company.codigoServicoNacional` e o validador do payload não declara campo de
                      serviço. Um seletor aqui pareceria funcionar e a nota sairia com outro código —
                      erro fiscal silencioso. Conferido no backend nesta entrega: continua assim. */}
                  <ServicoNacionalDaNota cadastroEmissao={cadastroEmissao} />
                  <label htmlFor={CAMPO.DESCRICAO} style={rotulo}>Descrição do serviço
                    <textarea id={CAMPO.DESCRICAO} value={servico.descricao} onChange={(e) => setServico({ ...servico, descricao: e.target.value })} rows={3} style={{ ...campo, resize: "vertical" }} />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label htmlFor={CAMPO.COMPETENCIA} style={rotulo}>Competência (opcional)
                      <input id={CAMPO.COMPETENCIA} type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} style={{ ...campo, colorScheme: "dark" }} />
                    </label>
                    <label htmlFor={CAMPO.REFERENCIA} style={rotulo}>Referência interna (opcional)
                      <input id={CAMPO.REFERENCIA} value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ex.: contrato, pedido" style={campo} />
                    </label>
                  </div>
                </Bloco>

                {/* ── Quanto ────────────────────────────────────────────── */}
                <Bloco titulo="Quanto">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label htmlFor={CAMPO.VALOR} style={rotulo}>Valor dos serviços (R$)
                      <input id={CAMPO.VALOR} value={servico.valorServicos} onChange={(e) => setServico({ ...servico, valorServicos: e.target.value })} placeholder="0,00" inputMode="decimal" style={campo} />
                    </label>
                    <label htmlFor={CAMPO.ALIQUOTA} style={rotulo}>Alíquota de ISS (%) — opcional
                      <input id={CAMPO.ALIQUOTA} value={servico.aliquota} onChange={(e) => setServico({ ...servico, aliquota: e.target.value })} placeholder="Vazio = a da prefeitura" inputMode="decimal" style={campo} />
                    </label>
                  </div>

                  {/* ⚠ Retenção fica VISÍVEL como escolha, não escondida num default: ela muda quem
                      recolhe o ISS, e passar batido é erro que só aparece na conciliação. O rótulo diz a
                      CONSEQUÊNCIA, não o nome do campo. */}
                  <div style={{ border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 10 }}>
                    <label htmlFor={CAMPO.ISS_RETIDO} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", cursor: "pointer" }}>
                      <input id={CAMPO.ISS_RETIDO} type="checkbox" checked={servico.issRetido} onChange={(e) => setServico({ ...servico, issRetido: e.target.checked })} />
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
                      <label htmlFor={CAMPO.P_TOT_TRIB_SN} style={rotulo}>
                        Total de tributos do Simples Nacional (%) — obrigatório
                        <input
                          id={CAMPO.P_TOT_TRIB_SN}
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
                </Bloco>
              </>
            </div>
          )}

          {/* ⚠ O ESPELHO AO VIVO. Ele é a MESMA `linhasDoEspelho` que o `confirm` repete — não uma
              segunda descrição da nota. No passo 0 ele acompanha a digitação; na conferência ele é
              a tela, com a borda em accent. */}
          <PainelDaNota dados={dadosDaDeclaracao} pTotTribSN={leituraPTot.valor} destaque={passo === PASSO_CONFERIR} />
        </div>

        {/* Opção desabilitada NUNCA fica sem explicação — e agora cada motivo LEVA ao campo. */}
        {problemasDaNota.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: "0.78rem", color: temProblemaGrave ? "var(--state-danger)" : "var(--state-neutral)", fontWeight: 700 }}>
              {temProblemaGrave ? "Antes de emitir, corrija:" : "Falta preencher:"}
            </div>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: "0.78rem", display: "grid", gap: 4 }}>
              {problemasDaNota.map((p) => (
                <li key={p.texto} style={{ color: p.grave ? "var(--state-danger)" : "var(--state-neutral)" }}>
                  {p.texto}
                  {p.campo && (
                    <button
                      type="button"
                      onClick={() => irParaCampo(p.campo)}
                      style={{
                        marginLeft: 8, background: "none", border: "none", padding: 0,
                        color: PANEL.accent, cursor: "pointer", font: "inherit", textDecoration: "underline",
                      }}
                    >
                      ir para o campo
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── A recusa do servidor: o que houve, o que fazer, e onde ────────── */}
        {rejeicao && (
          <div
            role="alert"
            style={{
              marginTop: 14, padding: 12, borderRadius: 6,
              background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)",
              color: PANEL.text, fontSize: "0.82rem", display: "grid", gap: 8,
            }}
          >
            <strong style={{ color: "var(--state-danger)" }}>
              {rejeicao.desfechoDesconhecido
                ? "A emissão falhou e o desfecho é DESCONHECIDO."
                : "A nota não foi emitida."}
            </strong>
            <div>{rejeicao.mensagem}</div>
            {rejeicao.codigoDoProvedor && (
              <div style={{ color: PANEL.muted }}>Código do provedor: <code>{rejeicao.codigoDoProvedor}</code></div>
            )}
            {rejeicao.camposDoCadastro.length > 0 && (
              <div style={{ color: PANEL.muted }}>
                Campos que o servidor apontou no cadastro: {rejeicao.camposDoCadastro.join(", ")}.
              </div>
            )}
            {rejeicao.oQueFazer ? (
              <div>
                <strong>O que fazer:</strong> {rejeicao.oQueFazer}
              </div>
            ) : (
              /* ⚠ Recusa que a tela não conhece NÃO ganha procedimento inventado. Dizer "tente de
                 novo" para um código nunca visto é palpite sobre ato fiscal. */
              <div style={{ color: PANEL.muted }}>
                Esta tela não conhece este motivo e não vai sugerir um procedimento. Confira a
                mensagem acima antes de tentar de novo.
              </div>
            )}
            {rejeicao.campo && (
              <div>
                <Button type="button" variant="secondary" size="sm" onClick={() => irParaCampo(rejeicao.campo)}>
                  Ir para “{rejeicao.rotuloDoCampo}”
                </Button>
              </div>
            )}
            {rejeicao.desfechoDesconhecido && (
              <div style={{ color: "var(--state-warn)" }}>
                O botão Emitir fica travado até você fechar este assistente: reemitir sem consultar
                pode duplicar a nota. Feche, use <strong>“🔄 Buscar NFS-e”</strong> na aba de notas
                e só então decida.
              </div>
            )}
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
          {passo < PASSO_CONFERIR ? (
            <Button
              type="button"
              onClick={() => setPasso(passo + 1)}
              disabled={!prontoParaEmitir}
              title={prontoParaEmitir ? undefined : textoDosProblemas}
            >
              Continuar →
            </Button>
          ) : (
            /* ⚠ Era verde #69FF47. Emitir nota é o oposto de "concluído" — é o ato fiscal
               acontecendo. Ação primária usa o accent. */
            <Button
              type="button"
              onClick={emitir}
              disabled={enviando || !prontoParaEmitir || travadoPelaRejeicao}
              title={
                enviando ? "Emissão em andamento — aguarde a resposta do servidor."
                  : travadoPelaRejeicao ? "O desfecho da tentativa anterior é desconhecido: consulte antes de emitir de novo."
                    : prontoParaEmitir ? undefined
                      : `Faltam dados: ${textoDosProblemas}`
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
