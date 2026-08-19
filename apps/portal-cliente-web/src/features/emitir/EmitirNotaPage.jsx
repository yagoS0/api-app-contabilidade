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
import { SeletorMunicipio } from "./SeletorMunicipio";
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
 *   5. alíquota de ISS fora do formulário no Simples — ver `O ISS NO SIMPLES`, abaixo
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

const REGIME = { SIMPLES: "simples", OUTRO: "outro", DESCONHECIDO: "desconhecido" };

/**
 * O REGIME DA EMPRESA, do jeito que ESTA TELA consegue lê-lo — com a ressalva no nome.
 *
 * ⚠ **A AUTORIDADE NÃO É ESTE CAMPO.** No servidor quem decide é `CadastroFiscal.regime`, com
 * `Company.regimeTributario` como SEGUNDA leitura (`carregarRegimeDaEmpresa`, em `NfseService`), e
 * `GET /client/companies` só nos manda a segunda. As duas podem discordar.
 *
 * ⚠ Por isso a resposta tem TRÊS estados, e o terceiro não é "não". Regime ausente ou não
 * reconhecido devolve `DESCONHECIDO`, e no desconhecido a tela **não esconde nada** — mostrar um
 * campo a mais é um incômodo, escondê-lo indevidamente é uma emissão recusada pelo servidor com o
 * campo que a resolveria fora da tela.
 *
 * A normalização copia `resolverOpSimpNac` (`apps/api/src/application/nfse/dpsCodigos.js`),
 * inclusive o alias SIMPLES → SIMPLES_NACIONAL. ⚠ `optanteSimples` existe na resposta e **não é
 * usado**: o backend não o consulta para o `opSimpNac`, e eleger aqui uma autoridade que lá não
 * existe é como as duas pontas passam a discordar.
 */
function lerRegime(empresa) {
  const bruto = String(empresa?.legacyCompany?.regimeTributario || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!bruto) return REGIME.DESCONHECIDO;
  if (bruto === "SIMPLES" || bruto === "SIMPLES_NACIONAL") return REGIME.SIMPLES;
  if (bruto === "LUCRO_PRESUMIDO" || bruto === "LUCRO_REAL") return REGIME.OUTRO;
  return REGIME.DESCONHECIDO;
}

function apenasDigitos(valor) {
  return String(valor || "").replace(/\D+/g, "");
}

/**
 * Número de um `<input type="number">`.
 *
 * ⚠ ISTO NÃO VALE MAIS PARA O VALOR DOS SERVIÇOS, e a razão antiga fica registrada porque ela
 * estava CERTA para o que sabia: *"o campo é `type="number"` de propósito, e não um texto com
 * máscara: máscara de moeda em pt-BR precisa decidir se `1.234` é mil duzentos e trinta e quatro ou
 * um vírgula dois — e essa decisão, errada, vira o VALOR DA NOTA"*. O dono pediu o campo com
 * vírgula (18/08/2026), e `lib/valorDaNota.js` resolve aquele receio pelo outro lado: a máscara não
 * DECIDE nada, porque a grafia ambígua não pode ser digitada; e a COLAGEM, que era o resto do
 * receio, é recusada em vez de convertida.
 *
 * ⚠ ELE CONTINUA VALENDO PARA OS PERCENTUAIS (alíquota de ISS e `pTotTribSN`), que seguem em
 * `type="number"`: percentual de 0 a 100 não tem separador de milhar, logo não tem a ambiguidade —
 * e uma máscara de centavos ali transformaria "5" em "0,05".
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
 * `Company.codigoServicoNacional`, que é o comportamento de sempre — e a tela DIZ qual é ele.
 *
 * ⚠ **O ISS NO SIMPLES.** Com `issNoFormulario: false` (empresa do Simples), a alíquota de ISS
 * **não é enviada** e `issRetido` vai `false` — não "o que estiver no estado". Os dois andam
 * juntos por exigência do servidor, não por estética: `buildDpsXml` recusa
 * `issRetido: true` sem alíquota > 0 (`NFSE_ISS_RETIDO_SEM_ALIQUOTA`). Ver o bloco Impostos.
 */
function montarPayload(form, { issNoFormulario }) {
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

  const email = form.tomadorEmail.trim();
  if (email) payload.tomador.email = email;

  if (issNoFormulario) {
    const aliquota = numeroDoCampo(form.aliquota);
    if (aliquota !== null) payload.servico.aliquota = aliquota;
  }

  const local = apenasDigitos(form.cLocPrestacao);
  if (local) payload.servico.cLocPrestacao = local;

  const pTotTribSN = numeroDoCampo(form.pTotTribSN);
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

export function EmitirNotaPage({ empresa, aoNavegar, aoRecarregarEmpresas, modelo = null, aoDescartarModelo }) {
  const companyId = empresa.companyId;
  const [form, setForm] = useState(formVazio);
  const [enviando, setEnviando] = useState(false);
  const [desfecho, setDesfecho] = useState(null);
  // A linha da tentativa anterior, quando o servidor disse que o número dela é reaproveitável.
  // ⚠ Reenviar SEM ela queimaria um número novo a cada correção — e número pulado é buraco
  // permanente. Nunca é preenchida depois de uma falha de TRANSPORTE.
  const [retryInvoiceId, setRetryInvoiceId] = useState(null);

  // Consulta do tomador na Receita.
  const [consulta, setConsulta] = useState(CONSULTA_OCIOSA);
  const [origemNome, setOrigemNome] = useState(ORIGEM.AUSENTE);
  const [origemEndereco, setOrigemEndereco] = useState(ORIGEM.AUSENTE);
  const ultimoConsultado = useRef(null);
  const [gatilhoConsulta, setGatilhoConsulta] = useState(0);

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
    setDescricaoDigitada(false);
    setDesfecho(null);
    setRetryInvoiceId(null);
    setConsulta(CONSULTA_OCIOSA);
    setOrigemNome(ORIGEM.AUSENTE);
    setOrigemEndereco(ORIGEM.AUSENTE);
    setOrigemPTot(ORIGEM_ALIQUOTA.AUSENTE);
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
    setDescricaoDigitada(Boolean(modelo.campos.descricao));
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
  // ⚠ O ISS SAI DO FORMULÁRIO SÓ NO SIMPLES — decisão do dono, 18/08/2026: no Simples o ISS está
  // dentro do DAS, e não há alíquota de ISS a informar por nota. Regime desconhecido MANTÉM os
  // campos (ver `lerRegime`).
  const issNoFormulario = regime !== REGIME.SIMPLES;

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

  // ── A ALÍQUOTA EFETIVA DO SIMPLES ─────────────────────────────────────────────────────────
  const competenciaDaNota = String(form.competencia || "").slice(0, 7);
  const serieAliquota = useCarregamento(
    () => api.getAliquotas(companyId, janelaDaConsulta(competenciaDaNota)),
    [companyId, competenciaDaNota],
    // ⚠ Não é pedido a quem não pode emitir: a tela nem chega a mostrar o formulário.
    { habilitado: portao.podeEmitir }
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
    if (descricaoDigitada) return;
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
  const aliquota = issNoFormulario ? numeroDoCampo(form.aliquota) : null;
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

  const pTotTribSN = numeroDoCampo(form.pTotTribSN);

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
      setForm((anterior) => ({ ...anterior, [nome]: valor }));
    };
  }

  async function emitir(evento) {
    evento.preventDefault();
    if (enviando) return;
    setEnviando(true);
    try {
      const payload = montarPayload(form, { issNoFormulario });
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
        setDescricaoDigitada(false);
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
        setDescricaoDigitada(false);
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
      </div>

      {desfecho ? (
        <DesfechoEmissao
          desfecho={desfecho}
          aoNavegar={aoNavegar}
          aoCorrigir={() => setDesfecho(null)}
          aoNovaNota={() => {
            setForm(formVazio());
            setDescricaoDigitada(false);
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
              ⚠ E O QUE ESTA TELA NÃO SABE ELA NÃO AFIRMA: os três percentuais **não estão** no
              `legacyCompanySelect` de `GET /client/companies` (conferido campo a campo em
              `apps/api/src/routes/client/index.js`), então daqui não dá para dizer se o cadastro
              está completo — e é por isso que o texto passou a descrever as duas saídas em vez de
              apostar numa. Ampliar aquele `select` é decisão do dono: ele expõe ao cliente a
              configuração fiscal que o contador fez.
              ⚠ AVISO, NÃO BLOQUEIO — pela mesma razão do cadastro incompleto logo acima: o regime
              que chega aqui é a SEGUNDA leitura do servidor (`Company.regimeTributario`), e a
              primeira (`CadastroFiscal.regime`) pode dizer outra coisa. */}
          {regime === REGIME.OUTRO ? (
            <div className="alerta alerta-aviso" role="status">
              <p>
                <strong>Esta empresa não é optante pelo Simples Nacional.</strong>
              </p>
              <p>
                A nota precisa declarar a carga tributária aproximada — três percentuais que o seu
                contador configura no cadastro da empresa. Esta tela não recebe esse cadastro: se
                ele estiver completo, a nota sai normalmente; se faltar algum, ela é recusada antes
                de sair daqui, sem consumir numeração.
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

          {/* ⚠⚠ O PAINEL DO MODELO. Ele é a metade que impede a emissão errada, e por isso os
              avisos vêm da REGRA (`lib/reaproveitarNota.js`), não escritos aqui: quem muda o que se
              copia muda o que a tela diz, no mesmo arquivo. Os dois avisos incondicionais são "isto
              é uma nota NOVA" e "o valor NÃO foi copiado" — sem o segundo, o campo em branco vira
              esquecimento e alguém emite achando que o valor veio junto. */}
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
                  setDescricaoDigitada(false);
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
                  <RotuloOrigem origem={origemNome} />
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
                  <RotuloOrigem origem={origemEndereco} />
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
                      setDescricaoDigitada(Boolean(e.target.value.trim()));
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
                          setDescricaoDigitada(true);
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
                          setDescricaoDigitada(true);
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
                <span className="hint">
                  A data da competência é a que vai na nota. A data e a hora da emissão são as do
                  envio, e não se escolhem aqui.
                </span>
                <p className="hint">
                  {/* ⚠ A tela DIZ qual código vai, em vez de oferecer uma escolha que o cadastro
                      recusaria. Ver `montarPayload`. */}
                  Código de serviço desta nota:{" "}
                  <strong>{codigoServicoNacional ? texto(codigoServicoNacional) : TRACO}</strong>{" "}
                  {codigoServicoNacional
                    ? "— para emitir com outro, fale com o seu contador."
                    : "— não recebemos o código cadastrado desta empresa. Confira com o seu contador antes de emitir."}
                </p>
              </fieldset>

              <fieldset>
                <legend>Impostos</legend>

                {/* ── A ALÍQUOTA EFETIVA DO SIMPLES (`pTotTribSN`) ──────────────────────────
                    ⚠ PRÉ-PREENCHIDA, E COM A PROCEDÊNCIA NA TELA. "6,00%" e "6,00% — DAS de
                    07/2026 sobre a receita da mesma competência" são coisas diferentes: a primeira
                    é um número que apareceu sozinho.
                    ⚠ A conta é DAS ÷ receita. O INSS **não** entra — ele não está dentro do DAS,
                    e `pTotTribSN` é "total de tributos do SIMPLES NACIONAL". Ver
                    `lib/aliquotaEfetiva.js`. */}
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
                    onChange={(e) => {
                      // ⚠ PRÉ-PREENCHIDO ≠ TRAVADO: a partir daqui o portal não escreve mais neste
                      // campo, nem quando a competência muda.
                      setOrigemPTot(ORIGEM_ALIQUOTA.DIGITADA);
                      setForm((a) => ({ ...a, pTotTribSN: e.target.value }));
                    }}
                  />
                </label>
                <span className="hint">
                  {serieAliquota.carregando
                    ? "Procurando a alíquota efetiva desta empresa…"
                    : textoDaProcedencia(escolhaAliquota, competenciaDaNota)}
                </span>
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
                    <span className="hint">
                      Com ISS retido, a alíquota é obrigatória — sem ela a nota é recusada antes de
                      sair daqui.
                      {regime === REGIME.DESCONHECIDO
                        ? " ⚠ Não recebemos o regime desta empresa. Se ela for do Simples, não há alíquota de ISS a informar — confirme com o seu contador."
                        : ""}
                    </span>
                  </>
                ) : (
                  // ⚠ ENCOLHEU, MAS NÃO SUMIU: sem esta frase o cliente procura na tela um campo de
                  // ISS que foi retirado de propósito — e ausência sem explicação vira suspeita de
                  // defeito. Saiu a última oração ("a carga tributária declarada ao tomador é a
                  // alíquota efetiva acima"), que descreve o nosso mapeamento de campos: o rótulo do
                  // campo logo acima já diz o que ele é.
                  <span className="hint">
                    <strong>Empresa do Simples Nacional:</strong> o ISS já está dentro do DAS, então
                    esta nota sai sem alíquota e sem retenção de ISS.
                  </span>
                )}

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
function RotuloOrigem({ origem }) {
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
