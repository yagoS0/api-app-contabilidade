import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { TRACO, brl, fmtCompetencia, pct, texto } from "../../lib/format";
import { useCarregamento } from "../../lib/hooks";
import { roleLabel } from "../../lib/roles";
import { carregarMunicipiosIbge } from "../../lib/municipios/municipioIbge";
import { ESTADO, lerPortaoEmissao } from "./lib/portaoEmissao";
import { TIPO, lerErroEmissao, lerResultado } from "./lib/desfechoEmissao";
import {
  NAO_CONSULTA,
  ORIGEM,
  aplicarEndereco,
  aplicarNome,
  avisoSituacao,
  decidirConsulta,
  enderecoDaReceita,
  mensagemEndereco,
  nomeDaReceita,
  rotuloOrigem,
  soDigitosDoc,
} from "./lib/consultaTomador";
import {
  ORIGEM_ALIQUOTA,
  escolherAliquotaEfetiva,
  janelaDaConsulta,
  textoDaProcedencia,
} from "./lib/aliquotaEfetiva";
// ⚠ A CARGA TRIBUTÁRIA APROXIMADA DO CADASTRO (dono, 19/08/2026: *"o portal do cliente deve enxergar
// sim, no caso do presumido"*) — LEITURA, nunca campo. Ver o bloco `A CARGA TRIBUTÁRIA APROXIMADA`,
// abaixo, e o cabeçalho de `lib/cargaTributaria.js` para o porquê de ela não ir no payload.
import {
  CARGA_NAO_RECEBIDA,
  ESTADO_CARGA,
  O_QUE_E_A_CARGA,
  QUEM_CONFIGURA,
  frasePendencia,
  lerCargaTributaria,
} from "./lib/cargaTributaria";
import { registrarDescricao, sugerirDescricoes } from "./lib/descricoesRecentes";
// ⚠ A DESCRIÇÃO SUGERIDA a partir da ATIVIDADE do cadastro da empresa (dono, 18/08/2026). Convive
// com `descricoesRecentes` — a precedência está escrita no bloco `A DESCRIÇÃO SUGERIDA`, abaixo.
import {
  montarFrase as montarFraseDaAtividade,
  sugerirDescricaoDaNota,
  textoDoMotivo,
} from "./lib/descricaoSugerida";
// ⚠ O VALOR EM MOEDA BRASILEIRA. Ver o cabeçalho de `lib/valorDaNota.js`, inclusive por que a
// decisão anterior deste arquivo (campo `type="number"`, separador ponto) está revertida.
import {
  lerValorColado,
  lerValorDoCampo,
  mascararValorDigitado,
  textoDaRecusaDeColagem,
} from "./lib/valorDaNota";
import {
  SITUACAO as SITUACAO_CODIGO,
  carregarServicosNacionais,
  codigoParaOPayload,
  codigosOferecidos,
  conferirCodigoEscolhido,
  descricaoDoCodigo,
  rotuloDoCodigo,
} from "./lib/codigoServicoDaNota";
// ⚠⚠ OS CAMPOS DE IMPOSTO QUE ESTA NOTA LEVA — e, por consequência, quais VIAJAM. Regime e
// retenção decidem juntos, num lugar só: duas leituras (uma para renderizar, outra para montar o
// corpo) divergem na primeira correção, e foi exatamente essa divergência que produziu o defeito de
// produção de 20/08/2026. Ver `lib/impostosDaNota.js`.
import {
  REGIME,
  aliquotaIssParaOPayload,
  camposDeImposto,
  conferirAliquotaIss,
  lerRegime,
  pTotTribSNParaOPayload,
} from "./lib/impostosDaNota";
// ⚠ A MEMÓRIA DE TOMADORES (dono, 20/08/2026). ⚠ O cadastro NÃO nasce aqui: ele é
// `apps/api/src/application/nfse/tomadorEmitido.js`, alimentado por cada emissão autorizada. Esta
// tela só LÊ. Ver `lib/tomadoresEmitidos.js`.
import {
  CAMPOS_DE_ENDERECO,
  ORIGEM_MEMORIA,
  aplicarTomadorEmitido,
  enderecoVeioDaMemoria,
  normalizarTomadores,
  textoDosPreservados,
} from "./lib/tomadoresEmitidos";
import { SeletorMunicipio } from "./SeletorMunicipio";
import { SeletorTomador } from "./SeletorTomador";
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
 *
 * Ajustes de 18/08/2026, a pedido do dono (cada um com o seu ⚠ no lugar em que mora):
 *   1. consulta do CNPJ do tomador (ajuda, nunca portão) — `lib/consultaTomador.js`
 *   2. abre na competência CORRENTE — `lib/format.js`, `competenciaPadrao`
 *   3. município por NOME, não por código — `SeletorMunicipio.jsx`
 *   4. data da competência escolhível — ver `DATA DA COMPETÊNCIA`, abaixo
 *   5. alíquota de ISS fora do formulário no Simples — hoje em `lib/impostosDaNota.js` (ver 10)
 *   6. alíquota efetiva pré-preenchida, com a origem à vista — `lib/aliquotaEfetiva.js`
 *   7. descrição sugerida — `lib/descricoesRecentes.js`
 *
 * Ajustes de 19/08/2026, a pedido do dono:
 *   8. reaproveitar uma nota já emitida, **com o valor em branco** — `lib/reaproveitarNota.js`, e o
 *      bloco `REAPROVEITAR UMA NOTA JÁ EMITIDA` abaixo (a ligação)
 *   9. ⚠⚠ **AS LEGENDAS ENCOLHERAM, E O CRITÉRIO ESTÁ ESCRITO AQUI** — *"esse tanto de legenda é
 *      desnecessário"*, com esta tela na frente. Quem lê é o CLIENTE, não o contador:
 *        FICA o texto que (a) muda uma decisão de quem emite, (b) avisa de consequência fiscal, ou
 *          (c) diz o que fazer quando algo falta;
 *        SAI o que explica o nosso raciocínio interno ou nomeia peça de integração (`dCompet`, a
 *          dedução de CNAE, a citação da LC 116).
 *      ⚠ ENCOLHER NÃO É APAGAR A DISTINÇÃO. "Sem sugestão" virou uma linha curta e **não sumiu** —
 *      senão o campo vazio vira mistério. Corta-se palavra, nunca significado.
 *      ⚠ E a frase que descreve um comportamento é PARTE do comportamento: as duas legendas falsas
 *      encontradas aqui (o valor "com ponto", e a trava do não optante) ficaram falsas no dia em
 *      que o campo e o backend mudaram, e cada uma tem hoje o seu ⚠ no lugar em que mora.
 *
 * Ajustes de 20/08/2026, a pedido do dono:
 *  10. ⚠⚠ **AS GUARDAS DE IMPOSTO, NOS DOIS LADOS** — `lib/impostosDaNota.js`. Uma delas é conserto
 *      de DEFEITO EM PRODUÇÃO (*"empresa presumida aparecendo isso na nota: Alíquota efetiva do
 *      Simples (%). Não pode."*): o `pTotTribSN` era renderizado **sem condição de regime nenhuma**.
 *      A outra é a alíquota de ISS, que passou a existir só com a RETENÇÃO marcada.
 *      ⚠ **A TELA E O PAYLOAD SAEM DA MESMA RESPOSTA** (`camposDeImposto`): campo escondido que
 *      continua viajando é o defeito pior, porque a tela mente e o servidor recebe.
 *  11. seletor de TOMADORES JÁ EMITIDOS — `lib/tomadoresEmitidos.js` + `SeletorTomador.jsx`.
 *      ⚠ O cadastro **já existia** (`apps/api/src/application/nfse/tomadorEmitido.js`); o que
 *      nasceu aqui é a leitura e a tela. Encontra e nunca escolhe; o digitado vence.
 */

const CAMPOS_VAZIOS = {
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
 * Data de hoje em 'YYYY-MM-DD', pelo relógio LOCAL.
 *
 * ⚠ Sem `toISOString()`: ele converte para UTC, e às 22h de Brasília (UTC-3) devolveria a data de
 * AMANHÃ. A data que vai no `dCompet` da nota não pode depender da hora em que se emite.
 */
function dataDeHoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * ⚠ FUNÇÃO, NÃO CONSTANTE: a data de hoje muda, e um `const` avaliado na carga do módulo deixaria
 * uma aba aberta durante a virada do dia oferecendo a data de ontem.
 */
function formVazio() {
  return { ...CAMPOS_VAZIOS, competencia: dataDeHoje() };
}

const CONSULTA_OCIOSA = { estado: "ocioso", recusa: null, aviso: null, endereco: null, nome: "" };

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

// ⚠⚠ `REGIME` E `lerRegime` MUDARAM-SE PARA `lib/impostosDaNota.js` EM 20/08/2026, junto com as
// três decisões que dependem deles (o bloco de ISS, a alíquota de ISS e o `pTotTribSN`). Estavam
// aqui dentro, e o defeito que isso produziu foi medido em produção: o campo "Alíquota efetiva do
// Simples" aparecia para empresa do Lucro Presumido, porque a guarda de regime existia para os
// vizinhos e faltou neste. Regra de tela mora em `lib/`, com teste próprio — a tela só liga.

function apenasDigitos(valor) {
  return String(valor || "").replace(/\D+/g, "");
}

// ⚠⚠ `numeroDoCampo` SAIU DAQUI EM 20/08/2026 — ela foi para `lib/impostosDaNota.js` (`percentual`),
// junto com os dois únicos campos que a usavam (a alíquota de ISS e o `pTotTribSN`). Ficar aqui sem
// chamador seria código morto, e código morto é o que alguém "conserta" reintroduzindo o caminho que
// se acabou de fechar.
//
// ⚠ A DISTINÇÃO QUE ELA CARREGAVA CONTINUA VALENDO, e por isso fica escrita: a leitura por
// `Number()` **não vale mais para o VALOR DOS SERVIÇOS** — o campo é texto com máscara desde
// 18/08/2026, e quem lê é `lib/valorDaNota.js`. A razão antiga estava CERTA para o que sabia
// (*"máscara de moeda em pt-BR precisa decidir se `1.234` é mil duzentos e trinta e quatro ou um
// vírgula dois — e essa decisão, errada, vira o VALOR DA NOTA"*); o que mudou é que a máscara não
// DECIDE nada, porque a grafia ambígua não pode ser digitada, e a colagem ambígua é recusada.
// ⚠ Para PERCENTUAL ela continua sendo a leitura certa: de 0 a 100 não há separador de milhar, logo
// não há ambiguidade — e reusar a máscara de centavos ali transformaria "5" em "0,05".

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
 * `Company.codigoServicoNacional`, que é o comportamento de sempre — e a tela DIZ qual é ele.
 *
 * ⚠⚠ **O QUE NÃO ESTÁ NA TELA NÃO PODE ESTAR NO CORPO — e quem decide isso é `lib/impostosDaNota.js`,
 * o MESMO módulo que decide o que renderizar.** Campo escondido que continua viajando é o defeito
 * pior: a tela mostra uma coisa e o servidor recebe outra, e quem confere a tela nunca descobre.
 * Três campos passam por essa guarda, e cada um por um motivo próprio:
 *
 *   • **`issRetido`** — no Simples vai `false`, não "o que estiver no estado". Ele e a alíquota
 *     andam juntos por exigência do servidor: `buildDpsXml` recusa `issRetido: true` sem alíquota
 *     > 0 (`NFSE_ISS_RETIDO_SEM_ALIQUOTA`).
 *   • **`servico.aliquota`** — só existe com RETENÇÃO marcada (dono, 20/08/2026), e só fora do
 *     Simples. Desmarcar a caixa tem de tirar o valor do corpo, e não só da tela: ele fica preso no
 *     estado do formulário, e informar `pAliq` sendo não optante é a rejeição **E0617**.
 *   • **`totTrib.pTotTribSN`** — só o Simples declara. ⚠ Este era o DEFEITO: o campo era
 *     renderizado sem nenhuma condição de regime, e o valor viajava para toda empresa.
 *
 * ⚠ `regime` entra AQUI em vez de um punhado de booleanos porque a decisão é uma só. Dois
 * parâmetros que precisam concordar são dois parâmetros que um dia não vão concordar.
 */
function montarPayload(form, { regime, codigoServicoEscolhido = null }) {
  const { issNoFormulario } = camposDeImposto({ regime, issRetido: form.issRetido });
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
      // ⚠ NÚMERO, nunca a string mascarada: `validators/nfsePayload.js` espera `valorServicos`
      // numérico, e é ele que vira `<vServ>` no XML. A leitura é por centavos inteiros — o mesmo
      // número que o campo mostra e que a pré-visualização confirma.
      valorServicos: lerValorDoCampo(form.valorServicos),
      issRetido: issNoFormulario ? form.issRetido === true : false,
    },
  };

  // ⚠⚠ O CÓDIGO ESCOLHIDO VAI NO PAYLOAD — e este é o OPOSTO do caso da carga tributária, onde a
  // tela MOSTRA e não manda. Aqui a escolha é **da nota**: um seletor que parece funcionar e emite
  // outro código é erro fiscal SILENCIOSO, pior que a ausência do seletor.
  //
  // ⚠ `null` significa NÃO MANDAR O CAMPO, e é o caminho de hoje: com um código só (0 de 33
  // empresas têm lista plural) nada é enviado e o servidor usa `Company.codigoServicoNacional`,
  // exatamente como sempre usou. Nenhuma emissão existente muda de comportamento.
  //
  // ⚠ E o CADASTRO continua sendo a autoridade: quem confere se o código está habilitado é
  // `escolherCodigoServicoNacional`, no servidor, a cada emissão. Isto aqui não autoriza nada.
  if (codigoServicoEscolhido) payload.servico.codigoServicoNacional = codigoServicoEscolhido;

  const email = form.tomadorEmail.trim();
  if (email) payload.tomador.email = email;

  // ⚠ `null` significa NÃO MANDAR O CAMPO — e ele é `null` sempre que a alíquota não está na tela
  // (Simples, ou caixa de retenção desmarcada). Ver o cabeçalho.
  const aliquota = aliquotaIssParaOPayload({ regime, issRetido: form.issRetido, aliquota: form.aliquota });
  if (aliquota !== null) payload.servico.aliquota = aliquota;

  const local = apenasDigitos(form.cLocPrestacao);
  if (local) payload.servico.cLocPrestacao = local;

  // ⚠⚠ FORA DO SIMPLES O GRUPO `totTrib` NÃO EXISTE NESTE CORPO. Não é "vai vazio": a chave não é
  // criada. O não optante declara os TRÊS percentuais da Lei 12.741/2012, que vêm do CADASTRO e
  // esta tela nunca envia (ver `lib/cargaTributaria.js`); o regime indefinido não declara nada,
  // porque ninguém sabe qual grupo a nota leva.
  const pTotTribSN = pTotTribSNParaOPayload({ regime, pTotTribSN: form.pTotTribSN });
  if (pTotTribSN !== null) payload.totTrib = { pTotTribSN };

  // ── DATA DA COMPETÊNCIA ────────────────────────────────────────────────────────────────────
  //
  // ⚠ A DATA VAI INTEIRA, e antes só ia o mês. O campo era `<input type="month">` e o código
  // acrescentava `-01`: toda nota declarava o primeiro dia do mês. Agora é a data escolhida.
  //
  // ⚠ **ESTE É O `dCompet`, NÃO O `dhEmi`.** É a única data desta nota que o cliente controla:
  // `buildDpsXml` faz `formatDateOnly(data.competencia)` → `<dCompet>`, e é justamente o
  // `formatDateOnly(null)` (a data de HOJE) que este campo passa a substituir. O `<dhEmi>` — o
  // instante da emissão — é `formatDateTimeWithOffset(new Date())` cravado no servidor, **não
  // existe no payload do validador**, e não foi inventado aqui. Ver o bloco do campo na tela.
  if (form.competencia) payload.competencia = form.competencia;

  return payload;
}

/**
 * ⚠ O PROP DE VOLTA MUDOU DE NOME EM 19/08/2026 (o antigo dizia "navegar"). A emissão deixou de ser
 * uma ABA e virou um MODO da tela de Notas (`shell/AppShell.jsx`): não há mais para onde navegar,
 * há o modo a fechar. O prop antigo só era usado com o destino `"notas"`, então o nome novo diz o
 * que a chamada sempre fez.
 *
 * ⚠⚠ E POR ISSO ESTA TELA GANHOU UMA SAÍDA PRÓPRIA, EM TODOS OS RAMOS. Enquanto "Emitir" era aba,
 * a saída era o menu; sem a aba, uma tela sem botão de voltar é uma armadilha — e o ramo do
 * PORTÃO FECHADO é o pior deles, porque quem cai nele é justamente quem não pode fazer nada ali.
 */
export function EmitirNotaPage({ empresa, aoVoltarParaNotas, aoRecarregarEmpresas, modelo = null, aoDescartarModelo }) {
  const companyId = empresa.companyId;
  const [form, setForm] = useState(formVazio);
  const [enviando, setEnviando] = useState(false);
  const [desfecho, setDesfecho] = useState(null);
  // A linha da tentativa anterior, quando o servidor disse que o número dela é reaproveitável.
  // ⚠ Reenviar SEM ela queimaria um número novo a cada correção — e número pulado é buraco
  // permanente. Nunca é preenchida depois de uma falha de TRANSPORTE.
  const [retryInvoiceId, setRetryInvoiceId] = useState(null);

  // ⚠⚠ O ESPELHO SÍNCRONO DE `descricaoDigitada`, E ELE CONSERTA UM DEFEITO DE ORDEM DE EFEITOS
  // MEDIDO EM 19/08/2026 — quando a descrição passou a chegar da nota de origem.
  //
  // O defeito: o efeito do MODELO (mais acima) escreve a descrição e chama
  // marcava a descrição como digitada. O efeito da SUGESTÃO (mais abaixo) roda no MESMO commit, depois
  // dele, e lê `descricaoDigitada` pelo closure daquele render — ou seja, ainda `false`. Resultado:
  // ele sobrescrevia a descrição vinda da nota com a sugestão do cadastro (vazia, quando a empresa
  // não tem atividade cadastrada). **O campo abria em branco.**
  //
  // ⚠ ELE ERA LATENTE, NÃO NOVO: enquanto `modelo.campos.descricao` era SEMPRE `""`, a
  // sobrescrita era um no-op e ninguém via. A primeira nota com descrição real o acendeu — e quem
  // o acendeu foi o teste de LIGAÇÃO, não o de regra: a regra devolvia a descrição certa o tempo
  // todo. É a mesma família do defeito de `StrictMode` que este arquivo já registra.
  //
  // ⚠ `useState` não serve aqui: o guarda precisa valer NO MESMO commit em que o modelo é aplicado.
  const descricaoProtegidaRef = useRef(false);
  /** Mantém estado e ref juntos — quem esquecer um dos dois reabre o defeito acima. */
  function marcarDescricaoDigitada(valor) {
    descricaoProtegidaRef.current = Boolean(valor);
    setDescricaoDigitada(Boolean(valor));
  }

  // Consulta do tomador na Receita.
  const [consulta, setConsulta] = useState(CONSULTA_OCIOSA);
  const [origemNome, setOrigemNome] = useState(ORIGEM.AUSENTE);
  const [origemEndereco, setOrigemEndereco] = useState(ORIGEM.AUSENTE);
  const ultimoConsultado = useRef(null);
  const [gatilhoConsulta, setGatilhoConsulta] = useState(0);

  // A última escolha no seletor de tomadores já emitidos — para a tela poder DIZER o que ela fez, e
  // para os rótulos de origem. ⚠ `null` é "ninguém escolheu nada"; não é "escolheu e nada mudou".
  // Ver o bloco `OS TOMADORES PARA QUEM ESTA EMPRESA JÁ EMITIU`, abaixo.
  const [escolhaDaMemoria, setEscolhaDaMemoria] = useState(null);

  // Alíquota efetiva do Simples (`pTotTribSN`).
  const [origemPTot, setOrigemPTot] = useState(ORIGEM_ALIQUOTA.AUSENTE);

  // ⚠ Espelhos do estado para a resposta ASSÍNCRONA da consulta ler. Ela chega centenas de
  // milissegundos depois, e precisa do que está na tela NAQUELE instante — não do que estava
  // quando o efeito começou. Fechar sobre `form`/`origem…` faria o "o digitado vence" perder para
  // o que o usuário digitou durante a espera, que é justo o caso em que a regra importa.
  const formRef = useRef(form);
  formRef.current = form;
  const origemNomeRef = useRef(origemNome);
  origemNomeRef.current = origemNome;
  const origemEnderecoRef = useRef(origemEndereco);
  origemEnderecoRef.current = origemEndereco;

  // ⚠ TROCAR DE EMPRESA ZERA TUDO. Uma nota meio preenchida que sobrevivesse à troca seria emitida
  // no CNPJ errado — o pior desfecho possível num portal multi-empresa, e irreversível aqui.
  useEffect(() => {
    setForm(formVazio());
    marcarDescricaoDigitada(false);
    setDesfecho(null);
    setRetryInvoiceId(null);
    setConsulta(CONSULTA_OCIOSA);
    setOrigemNome(ORIGEM.AUSENTE);
    setOrigemEndereco(ORIGEM.AUSENTE);
    setOrigemPTot(ORIGEM_ALIQUOTA.AUSENTE);
    // ⚠ A MEMÓRIA É DA EMPRESA. Um tomador escolhido que sobrevivesse à troca deixaria na tela o
    // rótulo "de uma nota já emitida" apontando para uma nota que a empresa NOVA nunca emitiu.
    setEscolhaDaMemoria(null);
    ultimoConsultado.current = null;
  }, [companyId]);

  // ── REAPROVEITAR UMA NOTA JÁ EMITIDA ──────────────────────────────────────────────────────
  //
  // > *"não podemos usar uma nota já emitida para preencher os dados do tomador, e da nota no
  // > geral, apenas apagando o valor — isso deveria ser possível."* (dono, 19/08/2026)
  //
  // ⚠ A REGRA NÃO MORA AQUI: `lib/reaproveitarNota.js` decide o que se copia, o que não se copia e
  // o que a tela é obrigada a dizer. Este bloco é só a LIGAÇÃO — ele aplica os campos ao formulário
  // NORMAL, com todas as travas de sempre no lugar (portão, cadastro incompleto, consulta do CNPJ,
  // desfechos). Não existe caminho que emita "a partir de uma nota" por fora daqui.
  //
  // ⚠⚠ CONFERÊNCIA DE EMPRESA ANTES DE APLICAR. O modelo atravessa a casca do app (a lista de notas
  // é outra tela), e aplicar numa empresa o modelo tirado da nota de OUTRA emitiria no CNPJ errado.
  // O `companyId` viaja dentro do modelo justamente para poder ser recusado aqui.
  //
  // ⚠⚠ ESTE EFEITO É IDEMPOTENTE DE PROPÓSITO, E JÁ FOI O CONTRÁRIO — o defeito apareceu no
  // NAVEGADOR e passou batido nos testes. Ele tinha uma guarda `if (modelo === jaAplicado) return`
  // num ref, e o `StrictMode` do React 19 (`main.jsx`) executa cada efeito DUAS VEZES na montagem:
  // na segunda passada o efeito que zera o formulário na troca de empresa (logo acima) rodava de
  // novo e limpava tudo, enquanto este via "já apliquei" e não repunha nada. Resultado: o painel
  // dizia "preenchido a partir da nota nº X" em cima de um formulário VAZIO — exatamente a classe
  // de defeito (a frase que descreve um comportamento que não é o comportamento) que esta entrega
  // existe para consertar.
  // ⚠ A guarda não é necessária: as dependências são `[modelo, companyId]`, e as duas só mudam
  // quando aplicar de novo é o certo. Reaplicar os MESMOS valores é inofensivo; não reaplicar,
  // não. `render` duas vezes tem de dar o mesmo resultado que uma.
  const [modeloNaTela, setModeloNaTela] = useState(null);
  useEffect(() => {
    if (!modelo || (modelo.companyId && modelo.companyId !== companyId)) {
      setModeloNaTela(null);
      return;
    }
    // ⚠ O ESPALHAMENTO É SOBRE O FORMULÁRIO VAZIO, não sobre o que estava na tela: o modelo é um
    // ponto de partida inteiro, e restos de uma digitação anterior misturados a ele produziriam uma
    // nota que ninguém montou. `formVazio()` traz a competência de HOJE — a da nota de origem é
    // dela, e não é copiada.
    setForm({ ...formVazio(), ...modelo.campos });
    // ⚠ Descrição VAZIA não conta como digitada: assim o pré-preenchimento pela atividade do
    // cadastro continua valendo (é o caminho de verdade neste portal, ver `reaproveitarNota.js`).
    marcarDescricaoDigitada(Boolean(modelo.campos.descricao));
    // ⚠ O NOME COPIADO ENTRA COMO `DIGITADO` — a mesma decisão do portal do escritório. É o que
    // impede a consulta de CNPJ, que o próprio preenchimento do documento dispara, de trocá-lo
    // sozinho pelo da Receita.
    setOrigemNome(modelo.campos.tomadorNome ? ORIGEM.DIGITADO : ORIGEM.AUSENTE);
    setOrigemEndereco(ORIGEM.AUSENTE);
    // ⚠ A alíquota efetiva volta a ser recalculada: o `setForm` acima zerou `pTotTribSN`, e sem
    // devolver a origem para `AUSENTE` o efeito que preenche o campo não reexecutaria — o campo
    // ficaria vazio com "preenchido pelo portal" ao lado.
    setOrigemPTot(ORIGEM_ALIQUOTA.AUSENTE);
    setConsulta(CONSULTA_OCIOSA);
    // ⚠ O modelo substitui o formulário inteiro; o rótulo da escolha anterior descreveria campos
    // que já não estão lá.
    setEscolhaDaMemoria(null);
    ultimoConsultado.current = null;
    setDesfecho(null);
    setRetryInvoiceId(null);
    setModeloNaTela(modelo);
  }, [modelo, companyId]);

  /** Tira o modelo do caminho — o formulário volta a ser um formulário em branco. */
  function esquecerModelo() {
    setModeloNaTela(null);
    // ⚠ E avisa quem GUARDA o modelo (a casca). Sem isto o painel voltaria na próxima vez que o
    // efeito acima rodasse, porque a prop continuaria apontando para a nota de origem.
    if (aoDescartarModelo) aoDescartarModelo();
  }

  const portao = lerPortaoEmissao(empresa);
  const legacy = empresa.legacyCompany || null;
  const codigoServicoNacional = legacy?.codigoServicoNacional || null;
  const cadastroIncompleto = legacy
    ? CAMPOS_EXIGIDOS_DA_EMPRESA.filter(([campo]) => !legacy[campo]).map(([, nome]) => nome)
    : [];

  const regime = lerRegime(empresa);
  // ── OS CAMPOS DE IMPOSTO DESTA NOTA ───────────────────────────────────────────────────────
  //
  // ⚠⚠ **UMA LEITURA SÓ, e ela é a MESMA que `montarPayload` usa.** Enquanto a decisão de
  // renderizar morava no JSX e a de enviar morava no `montarPayload`, elas podiam divergir — e
  // divergiram: o `pTotTribSN` aparecia (e viajava) para empresa do Presumido, defeito relatado em
  // produção pelo dono em 20/08/2026. A regra e os três motivos estão em `lib/impostosDaNota.js`.
  //
  //   • `issNoFormulario`      — o bloco de ISS. Sai só no Simples; INDEFINIDO mantém.
  //   • `aliquotaNoFormulario` — a alíquota de ISS. Só com a caixa de retenção MARCADA.
  //   • `pTotTribSNNoFormulario` — a alíquota efetiva do Simples. SÓ no Simples: o não optante não
  //     declara esse campo, e o indefinido não pode afirmar que declara.
  const { issNoFormulario, aliquotaNoFormulario, pTotTribSNNoFormulario } = camposDeImposto({
    regime,
    issRetido: form.issRetido,
  });

  // ── A CARGA TRIBUTÁRIA APROXIMADA (Lei 12.741/2012) ───────────────────────────────────────
  //
  // ⚠⚠ **O GUARDA VALE NOS DOIS SENTIDOS, E ELE É O MESMO DO PORTAL DO ESCRITÓRIO** (commit
  // `0905d58e`), não uma segunda leitura: só o regime `OUTRO` (não optante) vê isto.
  //   • **Simples não vê**: ela declara `pTotTribSN`, que é outra coisa e já está no formulário
  //     logo abaixo. Mostrar os três ali faria a pessoa procurar um campo que a nota dela não leva.
  //   • **Regime INDEFINIDO também não vê**: ali não se sabe qual grupo a nota leva, e afirmar
  //     "não optante" é o default silencioso que este projeto proíbe. ⚠ Isto NÃO é esconder por
  //     desconhecimento: nada some do formulário (o ISS continua lá, ver `issNoFormulario`) — o que
  //     não aparece é uma AFIRMAÇÃO sobre o cadastro de uma empresa cujo regime ninguém afirmou.
  //
  // ⚠ SÓ LEITURA. Não há campo, não há `onChange`, não entra em `form` e não vai no payload — quem
  // configura é o contador, no portal dele. Ver o cabeçalho de `lib/cargaTributaria.js`.
  // ⚠ `useMemo` só pela IDENTIDADE: `lerCargaTributaria` devolve objeto e array novos a cada
  // chamada, e sem isto o `valoresDaPrevia` abaixo recalcularia a cada render (a prévia depende
  // dele). Nada aqui é caro; o que se preserva é a estabilidade da referência.
  const carga = useMemo(
    () => (regime === REGIME.OUTRO ? lerCargaTributaria(legacy) : null),
    [regime, legacy]
  );
  // O que o ESPELHO DA NOTA mostra. ⚠ `null` quando não se recebeu o cadastro: a prévia desenha o
  // que VAI SER DECLARADO, e uma linha em traço ali diria "vai sair em branco" — que é uma
  // afirmação, e não o que se mediu.
  const cargaDaPrevia = carga && carga.estado !== ESTADO_CARGA.NAO_RECEBIDA ? carga.itens : null;

  // ── A CONSULTA DO TOMADOR ─────────────────────────────────────────────────────────────────
  //
  // ⚠ CPF NÃO SE CONSULTA: 11 dígitos ⇒ nada acontece, e o painel de uma consulta anterior é
  // limpo. Sem chamada, sem "não encontrado", sem botão. A BrasilAPI é base de CNPJ.
  // ⚠ FALHA NÃO BLOQUEIA: a recusa aparece com "a emissão segue normalmente" e o botão Emitir
  // continua exatamente como estava.
  const documento = form.tomadorDoc;
  useEffect(() => {
    const decisao = decidirConsulta(documento, { ultimoConsultado: ultimoConsultado.current });
    if (!decisao.consultar) {
      if (decisao.motivo === NAO_CONSULTA.CPF || decisao.motivo === NAO_CONSULTA.FORA_DE_FORMA) {
        setConsulta((anterior) => (anterior === CONSULTA_OCIOSA ? anterior : CONSULTA_OCIOSA));
      }
      return undefined;
    }

    // ⚠ Marcado ANTES do `await`. Sem isso o StrictMode do React 19 (que executa o efeito duas
    // vezes em desenvolvimento) dispararia duas chamadas para a BrasilAPI, que é pública e tem
    // throttle — e o defeito só apareceria como "às vezes não consulta".
    ultimoConsultado.current = decisao.digitos;
    let descartado = false;
    setConsulta({ ...CONSULTA_OCIOSA, estado: "consultando" });

    // ⚠⚠ O QUE VEIO DA RECEITA DO TOMADOR ANTERIOR SAI DA TELA AGORA — antes de saber o desfecho
    // desta consulta. Exercido no navegador: consultar um CNPJ, depois trocar por outro cuja
    // resposta não traga endereço aceitável deixava na tela o nome NOVO com o **endereço da
    // empresa anterior**, e "preencha à mão" ao lado de campos que pareciam preenchidos. Isso
    // emite nota fiscal com o endereço de outra pessoa jurídica.
    //
    // ⚠ **SÓ SAI O QUE ERA `da Receita`.** O que a pessoa digitou continua sendo dela e vence,
    // aqui como em qualquer outro ponto — é a mesma regra, aplicada ao caso em que o valor na tela
    // não é de ninguém que esteja nela: é de um CNPJ que já não é o do formulário.
    //
    // ⚠ Os REFS são atualizados na mesma linha do `set…`. Quem lê o estado depois do `await` são
    // eles; deixar a limpeza só no estado do React faria a leitura pós-consulta depender de o
    // React ter re-renderizado antes de a promessa resolver — verdade hoje, e silenciosamente
    // falso no dia em que a resposta vier de um cache.
    if (origemNomeRef.current === ORIGEM.DA_RECEITA) {
      origemNomeRef.current = ORIGEM.AUSENTE;
      formRef.current = { ...formRef.current, tomadorNome: "" };
      setOrigemNome(ORIGEM.AUSENTE);
      setForm((anterior) => ({ ...anterior, tomadorNome: "" }));
    }
    if (origemEnderecoRef.current === ORIGEM.DA_RECEITA) {
      const vazio = { cMun: "", cep: "", logradouro: "", numero: "", complemento: "", bairro: "" };
      origemEnderecoRef.current = ORIGEM.AUSENTE;
      formRef.current = { ...formRef.current, ...vazio };
      setOrigemEndereco(ORIGEM.AUSENTE);
      setForm((anterior) => ({ ...anterior, ...vazio }));
    }

    (async () => {
      const resposta = await api.consultarCnpj(decisao.digitos);
      // A lista oficial é esperada AQUI, e não lida de um estado que talvez ainda não tenha
      // chegado: sem ela, `codigoMunicipioVerificado` recusa o código e o endereço inteiro cai
      // junto — uma consulta boa viraria "a consulta não trouxe o município" por corrida de carga.
      const municipios = await carregarMunicipiosIbge().catch(() => null);
      if (descartado) return;

      if (!resposta?.ok) {
        setConsulta({ ...CONSULTA_OCIOSA, estado: "recusa", recusa: resposta?.mensagem || null });
        return;
      }

      const nome = nomeDaReceita(resposta.bruto);
      const leituraEndereco = enderecoDaReceita(resposta.bruto, { municipios });

      // ⚠ O estado atual é lido do REF, e não de dentro de um `setForm(anterior => …)`. Duas
      // razões: (1) chamar `setOrigem…` dentro de um updater é efeito colateral em função que o
      // React pode reexecutar — no StrictMode ela roda duas vezes; (2) o ref carrega o que o
      // usuário digitou DURANTE a consulta, que é exatamente o que tem de vencer.
      const atual = formRef.current;
      const passoNome = aplicarNome({
        nomeAtual: atual.tomadorNome,
        origemAtual: origemNomeRef.current,
        nome,
      });
      const passoEndereco = aplicarEndereco({
        enderecoAtual: {
          cMun: atual.cMun,
          CEP: atual.cep,
          xLgr: atual.logradouro,
          nro: atual.numero,
          xCpl: atual.complemento,
          xBairro: atual.bairro,
        },
        origemAtual: origemEnderecoRef.current,
        endereco: leituraEndereco.endereco,
      });
      if (passoNome.aplicou) setOrigemNome(ORIGEM.DA_RECEITA);
      if (passoEndereco.aplicou) setOrigemEndereco(ORIGEM.DA_RECEITA);
      setForm((anterior) => ({
        ...anterior,
        tomadorNome: passoNome.nome,
        cMun: passoEndereco.endereco.cMun || "",
        cep: passoEndereco.endereco.CEP || "",
        logradouro: passoEndereco.endereco.xLgr || "",
        numero: passoEndereco.endereco.nro || "",
        complemento: passoEndereco.endereco.xCpl || "",
        bairro: passoEndereco.endereco.xBairro || "",
      }));

      setConsulta({
        estado: "ok",
        recusa: null,
        aviso: avisoSituacao(resposta.situacao),
        endereco: mensagemEndereco(leituraEndereco),
        nome,
      });
    })();

    return () => {
      descartado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documento, gatilhoConsulta, companyId]);

  function consultarDeNovo() {
    // ⚠ O botão existe para a RETENTATIVA. A consulta automática não repete o mesmo CNPJ; sem ele,
    // uma queda de rede exigiria apagar e redigitar o documento inteiro.
    ultimoConsultado.current = null;
    setGatilhoConsulta((n) => n + 1);
  }

  // ── OS TOMADORES PARA QUEM ESTA EMPRESA JÁ EMITIU ─────────────────────────────────────────
  //
  // > Dono (20/08/2026): *"na aba de emissão deve haver um seletor para selecionarmos tomadores já
  // > emitidos."*
  //
  // ⚠⚠ **O CADASTRO JÁ EXISTIA** — `apps/api/src/application/nfse/tomadorEmitido.js`, alimentado
  // por CADA emissão autorizada, escopado por empresa, com documento, nome, e-mail e endereço
  // completo. O que faltava era a porta de leitura para este portal. Nada aqui grava, edita ou
  // apaga tomador; não existe caminho para isso do lado do cliente.
  //
  // ⚠ A REGRA NÃO MORA AQUI: `lib/tomadoresEmitidos.js` decide o que a lista mostra, o que a
  // escolha preenche e o que ela PRESERVA. Este bloco é a LIGAÇÃO.
  //
  // ⚠ Não é pedido a quem não pode emitir — a tela nem chega a montar o formulário.
  const memoriaTomadores = useCarregamento(
    () => api.getTomadoresEmitidos(companyId),
    [companyId],
    { habilitado: portao.podeEmitir }
  );
  const tomadores = useMemo(
    () => normalizarTomadores(memoriaTomadores.dados),
    [memoriaTomadores.dados]
  );

  /**
   * ⚠⚠ A ESCOLHA NÃO APAGA O QUE A PESSOA DIGITOU — e o que foi preservado aparece, com um botão
   * para trocar. É a MESMA regra do `consultaTomador` (`aplicarNome`/`aplicarEndereco`).
   *
   * ⚠ A PRECEDÊNCIA CONTRA A CONSULTA DA RECEITA É `ORIGEM.DIGITADO`, e a ETIQUETA é outra coisa.
   * Preencher o documento dispara a consulta do CNPJ segundos depois; sem marcar a origem, ela
   * sobrescreveria o nome e o endereço que a nota anterior de fato teve. `DIGITADO` é o valor certo
   * para a PRECEDÊNCIA (a pessoa clicou — foi um ato dela), e o rótulo na tela diz a verdade:
   * "de uma nota já emitida". Ver o rodapé de `lib/tomadoresEmitidos.js`.
   */
  function escolherTomadorDaMemoria(registro, { forcar = false } = {}) {
    const resultado = aplicarTomadorEmitido({ form: formRef.current, registro, forcar });
    setForm(resultado.form);
    if (resultado.aplicados.includes("tomadorNome")) setOrigemNome(ORIGEM.DIGITADO);
    if (enderecoVeioDaMemoria(resultado.aplicados)) setOrigemEndereco(ORIGEM.DIGITADO);
    setEscolhaDaMemoria({
      registro,
      aplicados: resultado.aplicados,
      divergentes: resultado.divergentes,
      nomeDaMemoria: resultado.aplicados.includes("tomadorNome"),
      enderecoDaMemoria: enderecoVeioDaMemoria(resultado.aplicados),
    });
  }

  // ── A ALÍQUOTA EFETIVA DO SIMPLES ─────────────────────────────────────────────────────────
  const competenciaDaNota = String(form.competencia || "").slice(0, 7);
  const serieAliquota = useCarregamento(
    () => api.getAliquotas(companyId, janelaDaConsulta(competenciaDaNota)),
    [companyId, competenciaDaNota],
    // ⚠ Não é pedido a quem não pode emitir: a tela nem chega a mostrar o formulário.
    // ⚠⚠ NEM A QUEM NÃO DECLARA `pTotTribSN`. Fora do Simples o número não tem campo, não tem
    // pré-visualização e não vai no corpo — pedi-lo seria buscar dado para não usar, e deixaria
    // `form.pTotTribSN` preenchido para um regime que não o declara. `habilitado: false` limpa o
    // estado (ver `useCarregamento`), então o efeito abaixo devolve o campo a `""`.
    { habilitado: portao.podeEmitir && pTotTribSNNoFormulario }
  );
  const escolhaAliquota = useMemo(
    () => escolherAliquotaEfetiva(serieAliquota.dados, competenciaDaNota),
    [serieAliquota.dados, competenciaDaNota]
  );

  // ⚠ PRÉ-PREENCHIDO ≠ TRAVADO. Assim que a pessoa digita por cima (`DIGITADA`), este efeito para
  // de escrever no campo — inclusive quando a competência muda e a sugestão vira outra. Os dois
  // números continuam à vista, com um botão para voltar ao sugerido.
  // ⚠ SEM DADO, CAMPO VAZIO — nunca zero. `escolherAliquotaEfetiva` já devolve `null` em vez do
  // zero que o backend fabrica; aqui isso vira string vazia, e a tela diz o motivo.
  useEffect(() => {
    if (origemPTot === ORIGEM_ALIQUOTA.DIGITADA) return;
    const valor = escolhaAliquota.valor === null ? "" : String(escolhaAliquota.valor);
    setForm((anterior) => (anterior.pTotTribSN === valor ? anterior : { ...anterior, pTotTribSN: valor }));
    setOrigemPTot(valor === "" ? ORIGEM_ALIQUOTA.AUSENTE : ORIGEM_ALIQUOTA.SUGERIDA);
  }, [escolhaAliquota, origemPTot]);

  // ── A DESCRIÇÃO SUGERIDA, e a PRECEDÊNCIA entre as duas fontes ────────────────────────────
  //
  // Existem duas coisas que sabem propor uma descrição, e elas NÃO competem — cada uma ocupa um
  // lugar, e a diferença é se houve uma ESCOLHA humana:
  //
  //   1. A ATIVIDADE DO CADASTRO (`lib/descricaoSugerida.js`) PRÉ-PREENCHE o campo. É dado da
  //      empresa, gravado pelo contador, igual em qualquer máquina, e o dono pediu que o campo
  //      "chegasse sugerido". Por ser dado e não escolha, ela cede a qualquer coisa que a pessoa
  //      faça — é o mesmo desenho da alíquota efetiva, logo acima.
  //   2. AS DESCRIÇÕES DESTE NAVEGADOR (`lib/descricoesRecentes.js`) continuam sendo BOTÕES, e
  //      clicar num deles VENCE: é uma escolha explícita, e o clique marca `DIGITADA`, o que
  //      desliga o pré-preenchimento dali em diante. A procedência delas é fraca de propósito (é o
  //      localStorage desta máquina, não o cadastro), então elas não podem ser o padrão — mas quem
  //      emite todo mês para o mesmo tomador repete a descrição, e essa lista é onde isso vive.
  //
  // ⚠⚠ A ARMADILHA QUE ISTO EVITA: `sugerirDescricoes` some quando `jaDigitado` não está vazio. Com
  // o campo pré-preenchido desde a abertura, passar `form.descricao` cru MATARIA a lista de
  // recentes para sempre — a sugestão nova teria comido a antiga em silêncio. Por isso o que viaja
  // como "já digitado" é o que a PESSOA escreveu, não o que o sistema escreveu por ela.
  const [descricaoDigitada, setDescricaoDigitada] = useState(false);
  // A recusa da última colagem no campo de valor. ⚠ Ela existe porque a colagem ambígua NÃO é
  // convertida: o campo fica como estava, e sem esta frase o Ctrl+V "não faria nada".
  const [recusaColagemValor, setRecusaColagemValor] = useState(null);

  // ── O CÓDIGO DE SERVIÇO DESTA NOTA ────────────────────────────────────────────────────────
  //
  // ⚠ A REGRA NÃO MORA AQUI: `lib/codigoServicoDaNota.js` é ESPELHO de
  // `apps/api/src/application/nfse/codigoServicoDaNota.js`, que é a AUTORIDADE. O que ela aceita, a
  // tela oferece; o que ela recusa, a tela não deixa escolher.
  const cadastroDeCodigos = useMemo(
    () => codigosOferecidos({
      lista: legacy?.codigosServicoNacional,
      singular: legacy?.codigoServicoNacional,
    }),
    [legacy]
  );
  const [codigoEscolhido, setCodigoEscolhido] = useState("");
  const [servicosOficiais, setServicosOficiais] = useState(null);

  // ⚠ TROCAR DE EMPRESA ZERA A ESCOLHA — o código é do cadastro DELA. Manter a escolha anterior
  // emitiria sob um serviço que a nova empresa pode nem declarar.
  useEffect(() => {
    setCodigoEscolhido("");
  }, [companyId]);

  // ⚠ A LISTA DOS 335 ENTRA POR `import()` DINÂMICO, e só quando há o que descrever — ela fica fora
  // do bundle inicial (~66 KB). Falha de carga NÃO vira lista vazia permanente nem impede emitir: o
  // campo continua mostrando o NÚMERO, que é o que a nota precisa.
  useEffect(() => {
    if (!cadastroDeCodigos.oferecidos.length) return undefined;
    let vivo = true;
    carregarServicosNacionais()
      .then((lista) => { if (vivo) setServicosOficiais(lista); })
      .catch(() => { if (vivo) setServicosOficiais(null); });
    return () => { vivo = false; };
  }, [cadastroDeCodigos.oferecidos.length]);

  const conferenciaCodigo = conferirCodigoEscolhido({
    situacao: cadastroDeCodigos.situacao,
    oferecidos: cadastroDeCodigos.oferecidos,
    escolhido: codigoEscolhido,
  });
  const sugestaoDoCadastro = useMemo(
    () => sugerirDescricaoDaNota({
      atividades: legacy?.atividades,
      cnaePrincipal: legacy?.cnaePrincipal,
      competencia: form.competencia,
      // ⚠ Prop ausente ≠ cadastro vazio: sem `legacyCompany` esta tela não afirma nada sobre as
      // atividades da empresa — ela só não sugere.
      temCadastro: Boolean(legacy),
    }),
    [legacy, form.competencia]
  );
  useEffect(() => {
    // ⚠⚠ O REF, NÃO O ESTADO — ver `descricaoProtegidaRef`. Ler `descricaoDigitada` aqui pega o
    // valor do render ANTERIOR, e no commit em que o modelo é aplicado ele ainda é `false`: a
    // sugestão do cadastro (vazia, quando não há atividade) apagava a descrição vinda da nota.
    if (descricaoProtegidaRef.current || descricaoDigitada) return;
    const t = sugestaoDoCadastro.texto || "";
    setForm((anterior) => (anterior.descricao === t ? anterior : { ...anterior, descricao: t }));
  }, [sugestaoDoCadastro, descricaoDigitada]);

  // ── As descrições já usadas DESTE navegador ───────────────────────────────────────────────
  const sugestoesDescricao = useMemo(
    () => sugerirDescricoes(companyId, {
      tomadorDoc: form.tomadorDoc,
      jaDigitado: descricaoDigitada ? form.descricao : "",
    }),
    [companyId, form.tomadorDoc, form.descricao, descricaoDigitada]
  );

  // ⚠ UMA LEITURA SÓ. Este é o mesmo `lerValorDoCampo` que `montarPayload` usa — o número que a
  // pré-visualização mostra é, por construção, o número que vai na nota.
  const valorServicos = lerValorDoCampo(form.valorServicos);
  // ⚠ A MESMA função que monta o corpo: a alíquota que a pré-visualização usa é, por construção, a
  // que vai (ou não vai) na nota. Fora do caso "não optante COM retenção" ela é `null` nos dois.
  const aliquota = aliquotaIssParaOPayload({ regime, issRetido: form.issRetido, aliquota: form.aliquota });
  const issRetido = issNoFormulario && form.issRetido;
  const issRetidoValor =
    issRetido && valorServicos !== null && aliquota !== null
      ? Number(((valorServicos * aliquota) / 100).toFixed(2))
      : null;
  const liquido =
    valorServicos === null
      ? null
      : issRetido
        ? issRetidoValor === null
          ? null
          : Number((valorServicos - issRetidoValor).toFixed(2))
        : valorServicos;

  // ⚠⚠ IDEM PARA O `pTotTribSN`: a prévia mostra o que VAI SER DECLARADO. Fora do Simples ela
  // recebe `null` e o espelho da nota não exibe a linha — mostrar ali um percentual que o corpo não
  // leva seria a mesma mentira do campo, só que na tela que existe para conferir o corpo.
  const pTotTribSN = pTotTribSNParaOPayload({ regime, pTotTribSN: form.pTotTribSN });

  // ⚠ A CONFERÊNCIA DA ALÍQUOTA DE ISS — a tela diz ANTES o que o servidor recusaria depois.
  const conferenciaAliquota = conferirAliquotaIss({
    regime,
    issRetido: form.issRetido,
    aliquota: form.aliquota,
  });

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
      issNoFormulario,
      issRetido,
      aliquota,
      issRetidoValor,
      liquido,
      pTotTribSN,
      // ⚠⚠ A PRÉVIA PRECISA DA MESMA GUARDA DO FORMULÁRIO. Sem ela, a linha "Tributos do Simples
      // nesta nota" aparecia (com traço) para a empresa do Presumido — o traço não salva, porque a
      // LINHA já afirma que a nota declara esse grupo.
      pTotTribSNNoFormulario,
      // ⚠ O ESPELHO DA NOTA MOSTRA A CARGA QUE VAI DECLARADA. Ela sai IMPRESSA ao tomador (Lei
      // 12.741/2012) e não vinha de lugar nenhum nesta tela — o cliente do Presumido só veria o
      // número depois de a nota existir. `null` quando não se aplica (Simples, regime indefinido)
      // ou quando a resposta não trouxe o cadastro.
      cargaAproximada: cargaDaPrevia,
      codigoServicoNacional,
    }),
    [
      form,
      valorServicos,
      aliquota,
      issRetido,
      issNoFormulario,
      issRetidoValor,
      liquido,
      pTotTribSN,
      pTotTribSNNoFormulario,
      cargaDaPrevia,
      codigoServicoNacional,
    ]
  );

  function campo(nome) {
    return (evento) => {
      const alvo = evento.target;
      const valor = alvo.type === "checkbox" ? alvo.checked : alvo.value;
      setForm((anterior) => ({ ...anterior, [nome]: valor }));
    };
  }

  /** O digitado VENCE o consultado — e a origem passa a dizer isso. */
  function campoDoTomador(nome, marcarOrigem) {
    return (evento) => {
      const valor = evento.target.value;
      marcarOrigem(ORIGEM.DIGITADO);
      // ⚠ E O RÓTULO DA MEMÓRIA SAI JUNTO. Escrever por cima de um campo que veio de uma nota
      // anterior torna "de uma nota já emitida" uma frase FALSA sobre aquele campo — e a frase que
      // descreve um comportamento é parte do comportamento. A saída é por GRUPO (nome × endereço),
      // que é a granularidade dos dois rótulos que a tela tem.
      esquecerRotuloDaMemoria(nome);
      setForm((anterior) => ({ ...anterior, [nome]: valor }));
    };
  }

  /** Tira o rótulo "de uma nota já emitida" do GRUPO a que este campo pertence. */
  function esquecerRotuloDaMemoria(nomeDoCampo) {
    setEscolhaDaMemoria((anterior) => {
      if (!anterior) return anterior;
      if (nomeDoCampo === "tomadorNome" && anterior.nomeDaMemoria) {
        return { ...anterior, nomeDaMemoria: false };
      }
      if (CAMPOS_DE_ENDERECO.includes(nomeDoCampo) && anterior.enderecoDaMemoria) {
        return { ...anterior, enderecoDaMemoria: false };
      }
      return anterior;
    });
  }

  async function emitir(evento) {
    evento.preventDefault();
    if (enviando) return;

    // ⚠⚠ COM VÁRIOS CÓDIGOS E NENHUM ESCOLHIDO, NADA SAI DAQUI — e esta trava não é cosmética.
    //
    // Sem ela, `codigoParaOPayload` devolve `null`, o campo não é enviado, e o servidor cai no
    // `Company.codigoServicoNacional` (o singular). Ou seja: a empresa que habilitou TRÊS serviços
    // emitiria sob o primeiro deles **em silêncio**, sem ninguém ter escolhido — exatamente o erro
    // fiscal silencioso que o backend descreve como "pior que a ausência do seletor".
    //
    // ⚠ A tela NÃO ELEGE por conta própria: ela recusa e diz o que falta. É a regra 3 da autoridade
    // ("nunca o primeiro da lista"), do lado de cá.
    if (!conferenciaCodigo.ok) {
      document.getElementById("emitir-codigo-servico")?.focus();
      return;
    }

    // ⚠⚠ COM O ISS RETIDO E SEM ALÍQUOTA (OU COM ZERO), NADA SAI DAQUI.
    //
    // `buildDpsXml` exige `aliquota > 0` quando `issRetido === true`
    // (`NFSE_ISS_RETIDO_SEM_ALIQUOTA`, `NfseService.js:766`), então a recusa viria de qualquer
    // jeito — e descobri-la no clique de um ato fiscal irreversível é o pior momento possível.
    // ⚠ `required` no HTML não basta: um **zero** digitado passa pelo navegador e morre no
    // servidor. Ver `conferirAliquotaIss`.
    if (!conferenciaAliquota.ok) {
      document.getElementById("emitir-aliquota")?.focus();
      return;
    }

    setEnviando(true);
    try {
      const payload = montarPayload(form, {
        regime,
        codigoServicoEscolhido: codigoParaOPayload({
          situacao: cadastroDeCodigos.situacao,
          escolhido: codigoEscolhido,
        }),
      });
      const resposta = await api.emitirNfse(companyId, payload, { retryInvoiceId });
      const lido = lerResultado(resposta);
      setDesfecho(lido);
      if (lido.tipo === TIPO.SUCESSO) {
        // ⚠ Só o SUCESSO vira sugestão. Uma descrição que o servidor recusou não pode voltar
        // oferecida como se tivesse dado certo.
        registrarDescricao(companyId, {
          descricao: form.descricao,
          tomadorDoc: form.tomadorDoc,
          tomadorNome: form.tomadorNome,
        });
        setRetryInvoiceId(null);
        setForm(formVazio());
        marcarDescricaoDigitada(false);
        setOrigemNome(ORIGEM.AUSENTE);
        setOrigemEndereco(ORIGEM.AUSENTE);
        setOrigemPTot(ORIGEM_ALIQUOTA.AUSENTE);
        setConsulta(CONSULTA_OCIOSA);
        ultimoConsultado.current = null;
        // ⚠ O MODELO SAI JUNTO COM O FORMULÁRIO. Um painel dizendo "preenchido a partir da nota nº
        // X" em cima de um formulário já limpo afirmaria uma coisa que deixou de ser verdade — a
        // classe de defeito que esta entrega inteira está consertando.
        esquecerModelo();
      }
    } catch (err) {
      const lido = lerErroEmissao(err);
      setDesfecho(lido);
      setRetryInvoiceId(lido.retryInvoiceId);
      // ⚠⚠ DESFECHO DESCONHECIDO APAGA O FORMULÁRIO. Não é limpeza de tela: é tirar do caminho o
      // "enviar de novo" de um clique só sobre uma nota que talvez já exista. Quem quiser
      // reemitir depois de consultar terá de digitar tudo outra vez, de propósito.
      if (lido.tipo === TIPO.TRANSPORTE || lido.tipo === TIPO.DESCONHECIDO) {
        setForm(formVazio());
        marcarDescricaoDigitada(false);
        setOrigemNome(ORIGEM.AUSENTE);
        setOrigemEndereco(ORIGEM.AUSENTE);
        setOrigemPTot(ORIGEM_ALIQUOTA.AUSENTE);
        setConsulta(CONSULTA_OCIOSA);
        ultimoConsultado.current = null;
        // ⚠ E aqui o modelo sai pelo MESMO motivo do apagamento: o "enviar de novo" de um clique só
        // sobre uma nota que talvez já exista é justamente o que este ramo tira do caminho. Deixar
        // o painel de pé ofereceria o atalho de volta.
        esquecerModelo();
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
          {/* ⚠ A SAÍDA PRECISA EXISTIR AQUI, e este é o ramo em que ela mais importa: sem a aba
              "Emitir", quem cai no portão fechado não tem menu nenhum a que voltar. */}
          <button type="button" className="btn" onClick={aoVoltarParaNotas}>
            Voltar para as notas
          </button>
        </div>
        <PortaoFechado portao={portao} empresa={empresa} aoRecarregar={aoRecarregarEmpresas} />
      </>
    );
  }

  const digitosDoc = soDigitosDoc(form.tomadorDoc);
  const ehCnpjCompleto = digitosDoc.length === 14;
  const nomeDivergeDaReceita =
    origemNome === ORIGEM.DIGITADO &&
    Boolean(consulta.nome) &&
    consulta.nome !== form.tomadorNome.trim();

  return (
    <>
      <div className="page-header">
        <h1>Emitir nota</h1>
        <button type="button" className="btn" onClick={aoVoltarParaNotas}>
          Voltar para as notas
        </button>
      </div>

      {desfecho ? (
        <DesfechoEmissao
          desfecho={desfecho}
          aoVoltarParaNotas={aoVoltarParaNotas}
          aoCorrigir={() => setDesfecho(null)}
          aoNovaNota={() => {
            setForm(formVazio());
            marcarDescricaoDigitada(false);
            esquecerModelo();
            setRetryInvoiceId(null);
            setOrigemNome(ORIGEM.AUSENTE);
            setOrigemEndereco(ORIGEM.AUSENTE);
            setOrigemPTot(ORIGEM_ALIQUOTA.AUSENTE);
            setConsulta(CONSULTA_OCIOSA);
            ultimoConsultado.current = null;
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

          {/* ⚠⚠ ESTE AVISO ERA FALSO, E A MEDIÇÃO ESTÁ AQUI. Ele afirmava que *"a emissão pelo
              portal do cliente ainda não cobre esse caso"* e que a nota *"provavelmente será
              recusada"* — verdade enquanto os três percentuais só pudessem vir no corpo da emissão,
              e MENTIRA desde que o cadastro passou a ser a fonte deles (18/08/2026, a pedido do
              dono: *"deve ser configurado do lado do contador, no portal do contador"*).
              O que `NfseService` faz hoje, lido e não deduzido: cada um de
              `pTotTribFed`/`pTotTribEst`/`pTotTribMun` resolve SOZINHO, **payload → cadastro**, e
              só falta o que não estiver em nenhum dos dois (`MISSING_TOT_TRIB_NAO_SIMPLES`, com a
              lista nomeada). Ou seja: com o cadastro completo, esta tela emite para o não optante
              sem precisar de campo nenhum a mais.
              ⚠⚠ **E DESDE 19/08/2026 A TELA SABE**, a pedido do dono: *"o portal do cliente deve
              enxergar sim, no caso do presumido"*. Os três percentuais entraram no
              `legacyCompanySelect` de `GET /client/companies` (`apps/api/src/routes/client/index.js`,
              com o ⚠ do porquê ao lado deles), então o texto abaixo virou UMA resposta em vez de
              duas — e a que descrevia as duas saídas sobrou só para o estado em que ela continua
              verdadeira: quando a resposta **não trouxe** as chaves (`ESTADO_CARGA.NAO_RECEBIDA`).
              ⚠ CHEGOU PARA VER, NÃO PARA MEXER. Não há campo aqui, e não pode haver: isto é
              configuração fiscal do ESCRITÓRIO, e o payload da emissão **não** leva os três — se
              levasse, o payload venceria o cadastro (`NfseService` resolve por campo, payload →
              cadastro) e um valor velho preso neste formulário sobrescreveria em silêncio a
              correção que o contador acabou de fazer.
              ⚠ AVISO, NÃO BLOQUEIO — pela mesma razão do cadastro incompleto logo acima: o regime
              que chega aqui é a SEGUNDA leitura do servidor (`Company.regimeTributario`), e a
              primeira (`CadastroFiscal.regime`) pode dizer outra coisa. */}
          {carga && carga.estado === ESTADO_CARGA.NAO_RECEBIDA ? (
            <div className="alerta alerta-aviso" role="status">
              <p>
                <strong>Esta empresa não é optante pelo Simples Nacional.</strong>
              </p>
              <p>{CARGA_NAO_RECEBIDA}</p>
            </div>
          ) : null}

          {/* ⚠ O CADASTRO ESTÁ COMPLETO: A TELA NÃO INSINUA RECUSA. O aviso antigo dizia que a nota
              "provavelmente será recusada" para toda empresa não optante — e com os três
              percentuais gravados isso é simplesmente falso: `NfseService` cai no cadastro e a nota
              sai. Um aviso que está sempre aceso não é aviso, é ruído.
              ⚠ `alerta-info`, não `alerta-aviso`: não há nada a consertar. O que há é um número que
              vai IMPRESSO ao tomador e que o cliente precisava ver antes de emitir. */}
          {carga && carga.estado === ESTADO_CARGA.COMPLETA ? (
            <div className="alerta alerta-info" role="status">
              <p>{O_QUE_E_A_CARGA}</p>
              <p>
                {carga.itens.map((item, i) => (
                  <span key={item.campo}>
                    {i ? " · " : ""}
                    {item.rotulo} <strong>{pct(item.valor)}</strong>
                  </span>
                ))}
              </p>
              <p className="hint">{QUEM_CONFIGURA}</p>
            </div>
          ) : null}

          {/* ⚠ FALTANDO: A TELA DIZ QUAIS, E DE QUEM É A CANETA. "Falta a carga tributária" mandaria
              o cliente conferir três números que ele não pode editar; e sem dizer que quem configura
              é o contador, ele procura o campo nesta tela até desistir. É o mesmo molde da recusa
              `MISSING_TOT_TRIB_NAO_SIMPLES` do servidor, que também NOMEIA o que falta. */}
          {carga && carga.estado === ESTADO_CARGA.PENDENTE ? (
            <div className="alerta alerta-aviso" role="status">
              <p>
                <strong>{frasePendencia(carga)}</strong>
              </p>
              <p>{QUEM_CONFIGURA}</p>
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

          {/* ⚠⚠ O PAINEL DO MODELO. Ele é a metade que impede a emissão errada, e por isso os
              avisos vêm da REGRA (`lib/reaproveitarNota.js`), não escritos aqui: quem muda o que se
              copia muda o que a tela diz, no mesmo arquivo — e foi essa disciplina que fez a
              reviravolta de 19/08/2026 custar uma linha, não uma caçada.

              ⚠ ATÉ 19/08/2026 o segundo aviso incondicional era "o valor NÃO foi copiado". O dono
              reverteu: o valor passou a ser COPIADO, e a linha virou CONFERÊNCIA. A frase antiga
              não sobreviveu ao comportamento — ela já estaria mentindo. */}
          {modeloNaTela ? (
            <div className="alerta alerta-info" role="status">
              <p>
                <strong>
                  Preenchido a partir da nota nº {texto(modeloNaTela.origem.numero)}
                  {modeloNaTela.origem.competencia
                    ? ` · ${fmtCompetencia(modeloNaTela.origem.competencia)}`
                    : ""}
                </strong>
              </p>
              {modeloNaTela.avisos.map((aviso) => (
                <p key={aviso.codigo}>
                  {aviso.tom === "atencao" ? <strong>{aviso.texto}</strong> : aviso.texto}
                </p>
              ))}
              <p>
                <button type="button" className="btn-link" onClick={() => {
                  setForm(formVazio());
                  marcarDescricaoDigitada(false);
                  setOrigemNome(ORIGEM.AUSENTE);
                  setOrigemEndereco(ORIGEM.AUSENTE);
                  setOrigemPTot(ORIGEM_ALIQUOTA.AUSENTE);
                  setConsulta(CONSULTA_OCIOSA);
                  ultimoConsultado.current = null;
                  esquecerModelo();
                }}>
                  Começar do zero
                </button>
              </p>
            </div>
          ) : null}

          <div className="page-split">
            <form className="pane pane-form" onSubmit={emitir}>
              <fieldset>
                <legend>Para quem</legend>

                {/* ── OS TOMADORES PARA QUEM ESTA EMPRESA JÁ EMITIU ───────────────────────────
                    > Dono (20/08/2026): *"na aba de emissão deve haver um seletor para
                    > selecionarmos tomadores já emitidos."*

                    ⚠⚠ **SEM TOMADORES, SEM SELETOR — E NADA É DITO.** Critério literal do dono:
                    *"sem sugestão não precisa ser falado, pois já está sem"*. Campo vazio numa
                    empresa que nunca emitiu se explica sozinho; um "você ainda não emitiu para
                    ninguém" fixo seria ruído em toda nota da empresa nova.
                    ⚠ Isto NÃO é o mesmo caso do `"Não preenchemos: …"` da alíquota, que FICOU:
                    aquele impede uma ausência de ser lida como AFIRMAÇÃO; este descreveria uma
                    ausência já visível.

                    ⚠ Enquanto a lista carrega, também não se diz nada: um "procurando…" que pisca
                    numa lista que quase sempre é curta chama atenção para o que não decide nada. */}
                {tomadores.length ? (
                  <SeletorTomador
                    id="emitir-tomador-memoria"
                    tomadores={tomadores}
                    aoEscolher={(registro) => escolherTomadorDaMemoria(registro)}
                  />
                ) : null}

                {/* ⚠⚠ O QUE A ESCOLHA FEZ FICA À VISTA — inclusive o que ela NÃO fez.
                    O digitado vence (mesma regra do `consultaTomador`), mas "vence em silêncio"
                    seria a pessoa achar que escolheu e a nota sair com metade dos dados do tomador
                    anterior. A substituição existe, e é uma SEGUNDA decisão dela. */}
                {escolhaDaMemoria ? (
                  <div className="alerta alerta-info" role="status">
                    <p>
                      Preenchido a partir de uma nota já emitida para{" "}
                      <strong>{texto(escolhaDaMemoria.registro.nome)}</strong>.
                    </p>
                    {escolhaDaMemoria.divergentes.length ? (
                      <>
                        <p>{textoDosPreservados(escolhaDaMemoria.divergentes)}</p>
                        <p>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() =>
                              escolherTomadorDaMemoria(escolhaDaMemoria.registro, { forcar: true })
                            }
                          >
                            usar os dados da nota anterior
                          </button>
                        </p>
                      </>
                    ) : null}
                  </div>
                ) : null}

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

                {/* ⚠ O BLOCO INTEIRO DA CONSULTA SÓ EXISTE PARA CNPJ. Com 11 dígitos (CPF) não há
                    nem painel, nem botão, nem "não encontrado": a BrasilAPI é base de CNPJ, e uma
                    recusa aqui seria uma mancha vermelha na tela de quem não errou nada. */}
                {ehCnpjCompleto ? (
                  <div className="consulta-receita">
                    {consulta.estado === "consultando" ? (
                      <p className="hint" role="status">
                        Consultando o CNPJ na Receita…
                      </p>
                    ) : null}

                    {consulta.estado === "recusa" ? (
                      <div className="alerta alerta-aviso" role="status">
                        <p>{texto(consulta.recusa)}</p>
                        {/* ⚠ A frase que separa aviso de bloqueio. A consulta é ajuda: nada aqui
                            impede a emissão, e o botão Emitir está exatamente como estava. */}
                        <p>
                          Preencha os dados do tomador à mão — <strong>a emissão segue normalmente</strong>.
                        </p>
                        <p>
                          <button type="button" className="btn-link" onClick={consultarDeNovo}>
                            Consultar de novo
                          </button>
                        </p>
                      </div>
                    ) : null}

                    {consulta.estado === "ok" ? (
                      <div className="alerta alerta-info" role="status">
                        {consulta.aviso ? (
                          <p>
                            <strong>{consulta.aviso}</strong> Emitir para este tomador continua
                            possível — a informação é para você decidir.
                          </p>
                        ) : null}
                        <p>{texto(consulta.endereco)}</p>
                        <p>
                          <button type="button" className="btn-link" onClick={consultarDeNovo}>
                            Consultar de novo
                          </button>
                        </p>
                      </div>
                    ) : null}

                    {consulta.estado === "ocioso" ? (
                      <p className="hint">
                        <button type="button" className="btn-link" onClick={consultarDeNovo}>
                          Consultar este CNPJ na Receita
                        </button>
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <label htmlFor="emitir-nome">
                  Nome ou razão social
                  <RotuloOrigem origem={origemNome} daMemoria={escolhaDaMemoria?.nomeDaMemoria} />
                  <input
                    id="emitir-nome"
                    required
                    value={form.tomadorNome}
                    onChange={campoDoTomador("tomadorNome", setOrigemNome)}
                  />
                </label>
                {/* ⚠ OS DOIS LADOS FICAM À VISTA. O digitado vence, inclusive numa consulta
                    posterior — mas "por que o nome mudou?" precisa ter resposta na tela. */}
                {nomeDivergeDaReceita ? (
                  <p className="hint">
                    Na Receita: <strong>{texto(consulta.nome)}</strong>{" "}
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => {
                        setForm((a) => ({ ...a, tomadorNome: consulta.nome }));
                        setOrigemNome(ORIGEM.DA_RECEITA);
                      }}
                    >
                      usar o da Receita
                    </button>
                  </p>
                ) : null}

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
                <legend>
                  Endereço do tomador
                  <RotuloOrigem
                    origem={origemEndereco}
                    daMemoria={escolhaDaMemoria?.enderecoDaMemoria}
                  />
                </legend>
                <label htmlFor="emitir-cep">
                  CEP
                  <input id="emitir-cep" inputMode="numeric" required value={form.cep} onChange={campoDoTomador("cep", setOrigemEndereco)} />
                </label>

                {/* ⚠ ERAM SETE DÍGITOS DIGITADOS À MÃO. Agora se busca pelo NOME, na tabela oficial
                    do IBGE versionada no repositório — ver `SeletorMunicipio.jsx`. */}
                <SeletorMunicipio
                  id="emitir-cmun"
                  rotulo="Município do tomador"
                  valor={form.cMun}
                  onChange={(codigo) => {
                    setOrigemEndereco(ORIGEM.DIGITADO);
                    // ⚠ O município tem seletor próprio e não passa por `campoDoTomador` — o
                    // rótulo da memória precisa sair aqui também, senão ele sobrevive a uma troca
                    // de município e passa a descrever um endereço que já não é o da nota anterior.
                    esquecerRotuloDaMemoria("cMun");
                    setForm((a) => ({ ...a, cMun: codigo }));
                  }}
                  ajuda="Busque pelo nome. Há cidades homônimas: confira a UF."
                />

                <label htmlFor="emitir-logradouro">
                  Logradouro
                  <input
                    id="emitir-logradouro"
                    required
                    value={form.logradouro}
                    onChange={campoDoTomador("logradouro", setOrigemEndereco)}
                  />
                </label>
                <div className="filters">
                  <label htmlFor="emitir-numero">
                    Número
                    <input id="emitir-numero" required value={form.numero} onChange={campoDoTomador("numero", setOrigemEndereco)} />
                  </label>
                  <label htmlFor="emitir-complemento">
                    Complemento (opcional)
                    <input
                      id="emitir-complemento"
                      value={form.complemento}
                      onChange={campoDoTomador("complemento", setOrigemEndereco)}
                    />
                  </label>
                </div>
                <label htmlFor="emitir-bairro">
                  Bairro
                  <input id="emitir-bairro" required value={form.bairro} onChange={campoDoTomador("bairro", setOrigemEndereco)} />
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
                    onChange={(e) => {
                      // ⚠ O DIGITADO VENCE. A partir daqui o pré-preenchimento pela atividade do
                      // cadastro para de escrever no campo — inclusive quando a competência muda.
                      // Apagar tudo devolve o campo à sugestão: é o desfazer natural.
                      marcarDescricaoDigitada(Boolean(e.target.value.trim()));
                      setForm((a) => ({ ...a, descricao: e.target.value }));
                    }}
                  />
                </label>

                {/* ⚠ A ORIGEM DA FRASE FICA NA TELA. Ela vai sair impressa no DANFSe que o tomador
                    recebe; texto de documento fiscal sem procedência é o que ninguém confere. */}
                {/* ⚠ "É sugestão: escreva por cima à vontade" SAIU — a procedência já começa com
                    "Sugerido a partir de…", e o campo é editável à vista de todos. */}
                {sugestaoDoCadastro.texto && !descricaoDigitada ? (
                  <span className="hint">{sugestaoDoCadastro.procedencia}</span>
                ) : null}

                {/* ⚠ SEM DADO, CAMPO VAZIO — e a tela diz POR QUÊ e a quem pedir. O cliente não
                    edita o próprio cadastro; quem cadastra a atividade é o escritório. */}
                {!sugestaoDoCadastro.texto
                  && textoDoMotivo(sugestaoDoCadastro.motivo, {
                    ondeSeResolve: "Quem cadastra a atividade é o seu escritório de contabilidade.",
                  }) ? (
                    <span className="hint">
                      {textoDoMotivo(sugestaoDoCadastro.motivo, {
                        ondeSeResolve: "Quem cadastra a atividade é o seu escritório de contabilidade.",
                      })}
                    </span>
                  ) : null}

                {/* ⚠ COM VÁRIAS ATIVIDADES A TELA OFERECE, NÃO ESCOLHE — nada vem marcado. É o
                    mesmo "encontra, nunca escolhe" do seletor de município aqui do lado. */}
                {!sugestaoDoCadastro.texto && sugestaoDoCadastro.opcoes.length > 1 ? (
                  <div className="sugestoes">
                    <span className="hint">Atividades cadastradas para esta empresa:</span>
                    {sugestaoDoCadastro.opcoes.map((o) => (
                      <button
                        key={o.bruto}
                        type="button"
                        className="btn"
                        onClick={() => {
                          marcarDescricaoDigitada(true);
                          setForm((a) => ({
                            ...a,
                            descricao: montarFraseDaAtividade(o.descricao, a.competencia),
                          }));
                        }}
                      >
                        <span className="truncar">{o.descricao}</span>
                        <span className="muted">{o.codigo || ""}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* ⚠ SUGESTÃO, NUNCA IMPOSIÇÃO: some assim que a pessoa começa a escrever, nada é
                    aplicado sem clique, e o rótulo diz de onde veio. Ver
                    `lib/descricoesRecentes.js` — inclusive por que a fonte é ESTE navegador. */}
                {sugestoesDescricao.length ? (
                  <div className="sugestoes">
                    {/* ⚠ "— é sugestão, não cadastro" saiu; "neste navegador" NÃO PODE SAIR: é ele
                        que impede o cliente de achar que esta lista é o cadastro da empresa. */}
                    <span className="hint">
                      Descrições que você já emitiu <strong>neste navegador</strong>:
                    </span>
                    {sugestoesDescricao.map((s) => (
                      <button
                        key={`${s.doc}-${s.em}`}
                        type="button"
                        className="btn"
                        onClick={() => {
                          // ⚠ CLIQUE É ESCOLHA, E ESCOLHA VENCE: marcar `DIGITADA` é o que impede o
                          // pré-preenchimento pela atividade do cadastro de reescrever por cima na
                          // próxima mudança de competência.
                          marcarDescricaoDigitada(true);
                          setForm((a) => ({ ...a, descricao: s.descricao }));
                        }}
                      >
                        <span className="truncar">{s.descricao}</span>
                        <span className="muted">
                          {s.doMesmoTomador ? "mesmo tomador" : texto(s.nome)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="filters">
                  <label htmlFor="emitir-valor">
                    Valor dos serviços (R$)
                    {/* ⚠⚠ CAMPO DE MOEDA MASCARADO — ele só consegue conter `1.234,56`. Era
                        `type="number"` (separador PONTO), e o dono pediu vírgula. A máscara não
                        "aceita as duas grafias": a ambígua não pode ser digitada. Ver
                        `lib/valorDaNota.js`. */}
                    <input
                      id="emitir-valor"
                      type="text"
                      inputMode="numeric"
                      placeholder="0,00"
                      required
                      value={form.valorServicos}
                      onChange={(e) => {
                        setRecusaColagemValor(null);
                        setForm((a) => ({ ...a, valorServicos: mascararValorDigitado(e.target.value) }));
                      }}
                      onPaste={(e) => {
                        // ⚠ A COLAGEM NÃO PASSA PELA MÁSCARA: colar "1500" por ela daria R$ 15,00, e
                        // quem colou de uma planilha quis mil e quinhentos. O texto é PARSEADO, e o
                        // que tiver duas leituras é recusado com o motivo — o campo fica intocado.
                        e.preventDefault();
                        const lido = lerValorColado(e.clipboardData?.getData?.("text") ?? "");
                        if (lido.ok) {
                          setRecusaColagemValor(null);
                          setForm((a) => ({ ...a, valorServicos: lido.mascarado }));
                        } else {
                          setRecusaColagemValor(lido);
                        }
                      }}
                    />
                  </label>
                  <label htmlFor="emitir-competencia">
                    Data da competência
                    <input
                      id="emitir-competencia"
                      type="date"
                      max={dataDeHoje()}
                      value={form.competencia}
                      onChange={campo("competencia")}
                    />
                  </label>
                </div>
                {/* ⚠ A RECUSA DA COLAGEM APARECE, com o motivo. Nada quebrou e nada errado foi
                    escrito na nota — é pendência, não falha. */}
                {recusaColagemValor ? (
                  <div className="alerta alerta-aviso" role="status">
                    <p>{textoDaRecusaDeColagem(recusaColagemValor)}</p>
                  </div>
                ) : null}
                {/* ⚠⚠ ESTA É A `dCompet`, E **NÃO** A DATA/HORA DA EMISSÃO.
                    O que foi MEDIDO antes de construir o campo:
                      • `buildDpsXml` (`apps/api/.../NfseService.js`) monta `<dCompet>` com
                        `formatDateOnly(data.competencia)` — sem competência, a data de HOJE. É este
                        campo, e antes ele era um seletor de MÊS que mandava sempre o dia 01;
                      • `<dhEmi>` é `formatDateTimeWithOffset(new Date())`, **cravado no servidor**.
                        Não existe campo para ele no validador (`validators/nfsePayload.js`) e nada
                        no repositório documenta se o sistema nacional aceita `dhEmi` retroativo —
                        `docs/nfse-preenchimento.md` §2 só descreve o formato. Por isso ele NÃO foi
                        oferecido: seria inventar comportamento de integração.
                    ⚠ O teto é HOJE — competência futura não é competência. Não há piso porque não
                    há, neste repositório, nenhum limite de retroatividade que se possa provar. */}
                {/* ⚠⚠ ESTA LEGENDA JÁ FOI FALSA, E FICA REGISTRADO PORQUE A CLASSE SE REPETE.
                    Ela dizia *"o valor usa ponto para os centavos (ex.: 1500.00)"* — verdade
                    enquanto o campo era `type="number"`, e MENTIRA no mesmo dia em que ele virou
                    máscara de moeda (18/08/2026): o ponto não entra na digitação, e a forma
                    canônica é `1.234,56`. A tela ensinava o OPOSTO do que o campo faz.
                    ⚠ E o conserto não foi reescrever a frase: foi APAGÁ-LA. Quem diz como se
                    escreve o valor é o próprio campo — a máscara não deixa escrever de outro jeito,
                    e o `placeholder` mostra a forma. Legenda que repete o que o campo já faz é a
                    legenda que ninguém atualiza quando o campo muda.
                    ⚠ O QUE SOBROU muda uma decisão: qual data é esta, e que a da emissão não se
                    escolhe. `dCompet` saiu — é nome de campo do XML, e o cliente não tem o que fazer
                    com ele. (O `dCompet`/`dhEmi` continua explicado no comentário de
                    `montarPayload`, que é onde essa distinção é do programador.) */}
                {/* ⚠⚠ ESTA LEGENDA SAIU DA TELA EM 19/08/2026 — pedido do dono, com a tela na
                    frente. Era: *"A data da competência é a que vai na nota. A data e a hora da
                    emissão são as do envio, e não se escolhem aqui."*
                    O rótulo do campo já diz que a data é a da COMPETÊNCIA, e a data de emissão
                    nunca esteve na tela para ser confundida — a frase respondia a uma pergunta que
                    o formulário não levanta. A distinção `dCompet` × `dhEmi` continua escrita no
                    comentário de `montarPayload`, que é onde ela é do programador. */}
                {/* ═══ O CÓDIGO DE SERVIÇO DESTA NOTA ═══════════════════════════════════════
                    ⚠ TRÊS RAMOS, e o do meio é o que RENDERIZA HOJE: 0 de 33 empresas em produção
                    têm lista plural. A regra é `lib/codigoServicoDaNota.js`, espelho do backend. */}
                {cadastroDeCodigos.situacao === SITUACAO_CODIGO.VARIOS ? (
                  <>
                    <label htmlFor="emitir-codigo-servico">
                      Código de serviço desta nota
                      <select
                        id="emitir-codigo-servico"
                        value={codigoEscolhido}
                        onChange={(e) => setCodigoEscolhido(e.target.value)}
                      >
                        {/* ⚠⚠ SEM PRÉ-SELEÇÃO, NEM QUANDO SÓ HÁ DOIS. "O primeiro da lista" seria o
                            sistema decidindo qual serviço a empresa declara ao fisco — a mesma
                            proibição que o cadastro carrega. A tela ENCONTRA; ela não escolhe. */}
                        <option value="">Escolha…</option>
                        {cadastroDeCodigos.oferecidos.map((codigo) => (
                          <option key={codigo} value={codigo}>
                            {rotuloDoCodigo(codigo, descricaoDoCodigo(servicosOficiais, codigo))}
                          </option>
                        ))}
                      </select>
                    </label>
                    {conferenciaCodigo.ok ? null : (
                      <span className="hint">{conferenciaCodigo.falta}</span>
                    )}
                  </>
                ) : cadastroDeCodigos.situacao === SITUACAO_CODIGO.UNICO ? (
                  <p className="hint">
                    {/* ⚠ UM CÓDIGO SÓ NÃO VIRA PERGUNTA. A tela DIZ qual vai — perguntar entre uma
                        opção é pedir confirmação de um fato. E ele NÃO é enviado no payload: sem o
                        campo, o servidor usa o cadastro, que é o caminho de sempre. */}
                    Código de serviço desta nota:{" "}
                    <strong>{texto(cadastroDeCodigos.oferecidos[0])}</strong>
                    {descricaoDoCodigo(servicosOficiais, cadastroDeCodigos.oferecidos[0])
                      ? ` — ${descricaoDoCodigo(servicosOficiais, cadastroDeCodigos.oferecidos[0])}`
                      : ""}
                  </p>
                ) : (
                  <p className="hint">
                    Não recebemos nenhum código de serviço cadastrado para esta empresa. Fale com o
                    seu contador antes de emitir.
                  </p>
                )}

                {/* ⚠⚠ CÓDIGO GRAVADO FORA DA FORMA NÃO SOME — ele aparece, marcado. Sumir faria o
                    cliente achar que a empresa tem MENOS códigos do que tem, e a coluna não tem
                    CHECK no banco (o Postgres proíbe subquery em CHECK), então isto acontece de
                    verdade. ⚠ Ele não é oferecível: o servidor o recusaria. */}
                {cadastroDeCodigos.invalidos.length ? (
                  <span className="hint">
                    O cadastro tem {cadastroDeCodigos.invalidos.length === 1 ? "um código" : "códigos"}{" "}
                    fora da forma de 6 dígitos ({cadastroDeCodigos.invalidos.join(", ")}) — não dá
                    para emitir com {cadastroDeCodigos.invalidos.length === 1 ? "ele" : "eles"}.
                    Fale com o seu contador.
                  </span>
                ) : null}
              </fieldset>

              <fieldset>
                <legend>Impostos</legend>

                {/* ── A ALÍQUOTA EFETIVA DO SIMPLES (`pTotTribSN`) ──────────────────────────
                    ⚠ PRÉ-PREENCHIDA, E COM A PROCEDÊNCIA NA TELA. "6,00%" e "6,00% — DAS de
                    07/2026 sobre a receita da mesma competência" são coisas diferentes: a primeira
                    é um número que apareceu sozinho.
                    ⚠ A conta é DAS ÷ receita. O INSS **não** entra — ele não está dentro do DAS,
                    e `pTotTribSN` é "total de tributos do SIMPLES NACIONAL". Ver
                    `lib/aliquotaEfetiva.js`.

                    ⚠⚠ **ESTE BLOCO INTEIRO SÓ EXISTE NO SIMPLES — E ISSO É UM CONSERTO DE
                    PRODUÇÃO (20/08/2026).** Palavras do dono: *"empresa presumida aparecendo isso
                    na nota: Alíquota efetiva do Simples (%). Não pode."* O campo era renderizado
                    **sem nenhuma condição de regime**, enquanto os dois vizinhos já tinham a sua (o
                    bloco de ISS sai no Simples; a carga tributária aparece só no não optante).

                    ⚠ A GUARDA VALE NOS DOIS SENTIDOS, e o **regime INDEFINIDO também não vê**: ali
                    não se sabe qual grupo a nota leva, e um campo chamado "do Simples" é uma
                    AFIRMAÇÃO sobre uma empresa cujo regime ninguém afirmou — o mesmo critério da
                    carga tributária (`0905d58e`).
                    ⚠ E esconder aqui não fabrica recusa nenhuma: o servidor só exige `pTotTribSN`
                    de quem é do Simples (`MISSING_P_TOT_TRIB_SN` está sob `if (isSimples …)`).
                    ⚠⚠ **ESCONDER NÃO BASTA**: `montarPayload` também não manda o grupo `totTrib`
                    fora do Simples. Campo escondido que continua viajando é o defeito pior. As duas
                    decisões saem do MESMO `camposDeImposto`. */}
                {pTotTribSNNoFormulario ? (
                <>
                <label htmlFor="emitir-ptottribsn">
                  Alíquota efetiva do Simples (%)
                  <span className="origem" data-origem={origemPTot}>
                    {origemPTot === ORIGEM_ALIQUOTA.SUGERIDA
                      ? "preenchido pelo portal"
                      : origemPTot === ORIGEM_ALIQUOTA.DIGITADA
                        ? "digitado por você"
                        : ""}
                  </span>
                  <input
                    id="emitir-ptottribsn"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={form.pTotTribSN}
                    // ⚠⚠ A PROCEDÊNCIA SAIU DA TELA E VEIO PARA CÁ (dono, 19/08/2026 — ver o bloco
                    // logo abaixo). `title` não é legenda: não ocupa a tela, e é o que existe para
                    // quem passa o mouse. O número continua CONFERÍVEL — quem precisar saber de que
                    // competência ele veio, e que ela não é a da nota, continua tendo como.
                    title={
                      serieAliquota.carregando
                        ? undefined
                        : textoDaProcedencia(escolhaAliquota, competenciaDaNota)
                    }
                    onChange={(e) => {
                      // ⚠ PRÉ-PREENCHIDO ≠ TRAVADO: a partir daqui o portal não escreve mais neste
                      // campo, nem quando a competência muda.
                      setOrigemPTot(ORIGEM_ALIQUOTA.DIGITADA);
                      setForm((a) => ({ ...a, pTotTribSN: e.target.value }));
                    }}
                  />
                </label>
                {/* ⚠⚠ A LEGENDA DA PROCEDÊNCIA SAIU DA TELA EM 19/08/2026 — pedido do dono, com a
                    tela na frente. Era: *"DAS de 07/2026 sobre a receita da mesma competência
                    (extrato do PGDAS-D). ⚠ É a última competência apurada — a da nota (08/2026)
                    ainda não tem extrato do PGDAS-D. Confira antes de emitir."*

                    ⚠ A REGRA CONTINUA VIVA E INTOCADA: `lib/aliquotaEfetiva.js` segue escolhendo a
                    competência, marcando `exata` e redigindo a frase — o que saiu foi o CONSUMO
                    VISÍVEL. A frase passou para o `title` do campo, logo acima.

                    ⚠ O QUE **NÃO** SAIU, e a distinção é o ponto: quando NÃO conseguimos preencher,
                    o motivo continua na tela ("Não preenchemos: …"). Aquilo não é legenda — é a
                    explicação de um campo VAZIO, e campo vazio sem motivo vira suspeita de defeito.
                    A mesma razão pela qual "Procurando…" também ficou. */}
                {/* ⚠⚠ A AUDITORIA DE 23/08/2026 PROPÔS TRAZER DE VOLTA O AVISO DO RAMO
                    `exata === false` (a alíquota é de OUTRA competência), e ela tem razão no
                    mérito: o critério do dono manda ficar o texto que muda uma decisão e avisa de
                    consequência fiscal, e `title` não aparece no teclado nem no toque.

                    ⚠⚠ NÃO FOI FEITO, E É DE PROPÓSITO. A decisão de tirar a frase é do dono, de
                    19/08/2026, tomada com a tela na frente — e o teste
                    `emitirNotaPage.ligacao.test.jsx:163` a trava MEDINDO A AUSÊNCIA, com o
                    argumento contrário escrito no próprio caso ("ele é bom e pode voltar"). Foi
                    tentado nesta data e revertido: o vermelho é a decisão falando, não um
                    obstáculo. Reabrir isto é conversa com o dono, não conserto.

                    ⚠ Esta é a QUARTA vez que um corte de legenda é reproposto e recusado por um
                    teste nesta base. O comentário existe para a quinta não custar o mesmo. */}
                {serieAliquota.carregando ? (
                  <span className="hint">Procurando a alíquota efetiva desta empresa…</span>
                ) : escolhaAliquota?.valor === null ? (
                  <span className="hint">{textoDaProcedencia(escolhaAliquota, competenciaDaNota)}</span>
                ) : null}
                {/* ⚠ OS DOIS LADOS À VISTA quando a pessoa sobrescreve — a mesma disciplina do
                    nome do tomador. */}
                {origemPTot === ORIGEM_ALIQUOTA.DIGITADA && escolhaAliquota.valor !== null ? (
                  <p className="hint">
                    O portal sugeria <strong>{pct(escolhaAliquota.valor)}</strong>.{" "}
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => {
                        setForm((a) => ({ ...a, pTotTribSN: String(escolhaAliquota.valor) }));
                        setOrigemPTot(ORIGEM_ALIQUOTA.SUGERIDA);
                      }}
                    >
                      voltar ao sugerido
                    </button>
                  </p>
                ) : null}
                </>
                ) : null}

                {/* ── O ISS ─────────────────────────────────────────────────────────────────
                    ⚠⚠ NO SIMPLES ESTE BLOCO NÃO EXISTE — decisão do dono, 18/08/2026: o ISS da
                    empresa do Simples está dentro do DAS, e não há alíquota de ISS a informar por
                    nota.
                    ⚠ O CHECKBOX SAIU JUNTO COM O CAMPO, E ISSO NÃO É ESTÉTICA: `buildDpsXml`
                    recusa `issRetido: true` sem alíquota > 0 (`NFSE_ISS_RETIDO_SEM_ALIQUOTA`).
                    Tirar só a alíquota deixaria na tela uma caixinha que faz o servidor recusar a
                    nota, com o campo do conserto fora da tela.
                    ⚠ MEDIDO: a alíquota de ISS **não entra no XML da DPS** — `buildDpsXml` só a
                    usa nessa guarda, e `NfseService` a grava em `ServiceInvoice.aliquota`. Não é
                    um valor declarado que se perde; é um campo do nosso registro.
                    ⚠ REGIME DESCONHECIDO MANTÉM O BLOCO (ver `lerRegime`). */}
                {issNoFormulario ? (
                  <>
                    <label htmlFor="emitir-iss-retido" className="linha-checkbox">
                      <input
                        id="emitir-iss-retido"
                        type="checkbox"
                        checked={form.issRetido}
                        onChange={campo("issRetido")}
                      />
                      O ISS desta nota é retido pelo tomador
                    </label>

                    {/* ⚠⚠ A ALÍQUOTA SÓ APARECE COM A CAIXA MARCADA — pedido do dono (20/08/2026):
                        *"a alíquota de ISS é apenas se for retido, correto? então só deve aparecer
                        campo de alíquota se clicar na caixa de retenção de ISS."*

                        ⚠ CONFIRMADO NA FONTE, por três caminhos independentes:
                          • `NfseService.js:766` — a alíquota **só é exigida** quando
                            `issRetido === true` (`NFSE_ISS_RETIDO_SEM_ALIQUOTA`);
                          • ela **não entra no XML**: o grupo `<tribMun>` leva só `<tribISSQN>` e
                            `<tpRetISSQN>`. `NfseService` a grava em `ServiceInvoice.aliquota`, que
                            é registro NOSSO, não valor declarado ao fisco;
                          • Anexo I: informar `pAliq` sendo **não optante** em município ativo é a
                            rejeição **E0617**. Mandar não é só inútil — seria errado.

                        ⚠⚠ DESMARCAR TIRA O CAMPO **E O VALOR**: `aliquotaIssParaOPayload` devolve
                        `null` com a caixa desmarcada, então o número que ficou preso no estado do
                        formulário não viaja. Esconder sem parar de mandar é o defeito pior.
                        ⚠ ISTO É SÓ PARA O NÃO OPTANTE — no Simples o bloco inteiro já saiu da tela
                        (o `issNoFormulario` acima), e nada aqui o reintroduz. */}
                    {aliquotaNoFormulario ? (
                      <>
                        <label htmlFor="emitir-aliquota">
                          Alíquota do ISS (%)
                          <input
                            id="emitir-aliquota"
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            required
                            value={form.aliquota}
                            onChange={campo("aliquota")}
                          />
                        </label>
                        {/* ⚠ A TELA DIZ ANTES o que o servidor recusaria depois — e o submit é
                            recusado aqui mesmo (ver `emitir`). ⚠ ZERO NÃO BASTA: `required` do
                            HTML o aceita, e `buildDpsXml` exige `> 0`.
                            ⚠ O RAMO "está tudo certo" NÃO DIZ NADA. Ele dizia "com o ISS retido, a
                            alíquota é obrigatória" — descrevendo o visível: este campo só existe
                            com a caixa marcada, e ele já é `required`. É a regra do app: sai a
                            frase que descreve uma ausência visível; fica a que impede uma ausência
                            de virar afirmação. O que falta continua sendo dito, e é o que importa. */}
                        {conferenciaAliquota.ok ? null : (
                          <span className="hint">{conferenciaAliquota.falta}</span>
                        )}
                      </>
                    ) : null}

                    {/* ⚠ O AVISO DO REGIME DESCONHECIDO NÃO DEPENDE DA CAIXA, e por isso saiu de
                        dentro da legenda da alíquota (que agora só existe com retenção). Ele
                        responde a um dado que NÃO recebemos — não é legenda fixa —, e some junto
                        com o campo seria justamente esconder a dúvida de quem mais precisa dela. */}
                    {regime === REGIME.DESCONHECIDO ? (
                      <span className="hint">
                        ⚠ Não recebemos o regime desta empresa. Se ela for do Simples, não há
                        alíquota de ISS a informar — confirme com o seu contador.
                      </span>
                    ) : null}
                  </>
                ) : null}
                {/* ⚠⚠ ESTA LEGENDA SAIU DA TELA EM 19/08/2026 — pedido do dono, com a tela na
                    frente. Era: *"Empresa do Simples Nacional: o ISS já está dentro do DAS, então
                    esta nota sai sem alíquota e sem retenção de ISS."*

                    ⚠ ISTO REVERTE O DESENHO ANTERIOR, que era o oposto e está registrado porque o
                    argumento continua valendo em outros lugares: a frase existia para que o cliente
                    do Simples não procurasse na tela um campo de ISS retirado de propósito —
                    "ausência sem explicação vira suspeita de defeito". O que mudou: no Simples a
                    ausência do campo é a REGRA, não a exceção, e um parágrafo fixo repetido em toda
                    nota é ruído. (Mesmo movimento da legenda da DEFIS no portal do escritório.)

                    ⚠ A REGRA NÃO SAIU: `regime === REGIME.SIMPLES` continua decidindo que o campo
                    de ISS não é renderizado, e o ramo do regime DESCONHECIDO continua avisando —
                    aquele não é legenda fixa, é a resposta a um dado que não recebemos. */}

                {/* ⚠ TAMBÉM ERAM SETE DÍGITOS À MÃO. É o campo que decide para QUAL MUNICÍPIO o
                    ISSQN é devido — errar aqui é recolher para a prefeitura errada. */}
                <SeletorMunicipio
                  id="emitir-loc-prestacao"
                  rotulo="Município da prestação (opcional)"
                  valor={form.cLocPrestacao}
                  onChange={(codigo) => setForm((a) => ({ ...a, cLocPrestacao: codigo }))}
                  // ⚠ A CITAÇÃO DA LC 116 SAIU (é conversa de contador); a DECISÃO ficou inteira —
                  // deixar em branco tem consequência, e a frase diz qual é e quando não deixar.
                  ajuda="Em branco, o ISS é devido no município da sua empresa. Só preencha se este serviço for uma exceção."
                />
              </fieldset>

              <div className="total">
                <span>{issRetido ? "A receber do tomador" : "Valor da nota"}</span>
                <strong>{liquido === null ? TRACO : brl(liquido)}</strong>
              </div>
              {issRetido ? (
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
 * A ORIGEM DO CAMPO, no rótulo — `da Receita` × `digitado` × nada.
 *
 * ⚠ Sem ela, "por que o nome mudou sozinho?" não tem resposta na tela. É o mesmo princípio do
 * planejamento tributário, que imprime a procedência de cada campo.
 */
function RotuloOrigem({ origem, daMemoria = false }) {
  // ⚠⚠ A MEMÓRIA DE TOMADORES TEM ETIQUETA PRÓPRIA, e ela VEM PRIMEIRO.
  //
  // A PRECEDÊNCIA contra a consulta da Receita é `ORIGEM.DIGITADO` (a pessoa clicou; foi um ato
  // dela — ver `escolherTomadorDaMemoria`), mas o RÓTULO não pode dizer "digitado": ninguém digitou
  // aquilo. `ORIGEM` é ESPELHO de `apps/web` ("mudou lá, muda aqui"), e um quarto valor só deste
  // lado faria as duas cópias divergirem no primeiro `rotuloOrigem` — por isso a etiqueta entra
  // aqui, e não lá. Ver o rodapé de `lib/tomadoresEmitidos.js`.
  if (daMemoria) {
    return (
      <span className="origem" data-origem="da_memoria">
        {ORIGEM_MEMORIA}
      </span>
    );
  }
  const rotulo = rotuloOrigem(origem);
  if (!rotulo) return null;
  return (
    <span className="origem" data-origem={origem}>
      {rotulo}
    </span>
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
        <p>Peça ao responsável pela empresa que ajuste o seu perfil.</p>
      </div>
    );
  }

  if (portao.estado === ESTADO.NAO_LIBERADA) {
    return (
      <div className="alerta alerta-info" role="status">
        <p>
          <strong>A emissão de notas ainda não foi liberada para esta empresa.</strong>
        </p>
        {/* ⚠ "no cadastro de X", "é um ajuste do lado dele" e "depois esta tela passa a mostrar
            o formulário" descreviam a NOSSA divisão de trabalho — e o terceiro descrevia o que
            está à vista. Fica o que o cliente faz com a informação. */}
        <p>Fale com o seu contador: quem libera é ele.</p>
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
      {/* ⚠ O TÍTULO ACIMA JÁ DIZ QUE NÃO SABEMOS — e era isso que este parágrafo repetia, duas
          vezes, com a nossa plumbing no meio ("esta tela não recebeu essa informação", "o portal
          não está recebendo o estado da liberação"). ⚠ O que NÃO pode sair é a distinção: não
          saber não é estar bloqueado. Ela ficou no título, que é onde ela se lê. */}
      <p>Tente recarregar. Se continuar assim, avise o seu contador.</p>
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
