import { normalizarCadastroCnpj } from "./cadastroCnpj.js";
// Questionário canônico: formulário e atendimento conversacional.
export const ONBOARDING_ORIGENS = Object.freeze([
  Object.freeze({ chave: "PESSOA_FISICA", titulo: "Pessoa física", subtitulo: "Serviço pessoal, como IRRF ou declaração de renda, sem CNPJ.", acento: "--accent-cyan" }),
  Object.freeze({
    chave: "ABERTURA",
    titulo: "Vai abrir a empresa",
    subtitulo: "Ainda não existe CNPJ. Informe a atividade, as pessoas responsáveis e onde a empresa vai funcionar.",
    // Acento de CATEGORIA (não de estado), reusado no crachá do quadro para os dois se ensinarem.
    acento: "--accent-cyan",
  }),
  Object.freeze({
    chave: "TRANSFERENCIA",
    titulo: "Está trocando de contador",
    subtitulo: "A empresa já opera. A papelada chega em partes e o passado fiscal vem junto.",
    acento: "--accent-orange",
  }),
  Object.freeze({
    chave: "INATIVA",
    titulo: "Empresa parada",
    subtitulo: "Sem movimento há algum tempo. O trabalho é dimensionar o passivo e decidir: reativar ou dar baixa.",
    acento: "--accent-purple",
  }),
]);

export const ONBOARDING_PASSOS = Object.freeze([
  Object.freeze({ chave: "origem", titulo: "Origem" }),
  Object.freeze({ chave: "identificacao", titulo: "Identificação" }),
  Object.freeze({ chave: "responsavel", titulo: "Responsável" }),
  Object.freeze({ chave: "situacao", titulo: "Situação" }),
  Object.freeze({ chave: "revisao", titulo: "Revisão" }),
]);

const TODAS = ["ABERTURA", "TRANSFERENCIA", "INATIVA"];

// Tipo SOCIETÁRIO — ⚠ NÃO é regime tributário. "MEI" aqui responde "que tipo de empresa é",
// e `regimeTributario` responde "como ela é tributada". Confundir os dois é o bug que aparece no
// primeiro MEI real: o cadastro de empresa só aceita SIMPLES | LUCRO_PRESUMIDO | LUCRO_REAL, e um
// "MEI" mandado como regime é recusado com `company_regime_tributario_invalid`.
const TIPOS_EMPRESA = Object.freeze([
  { valor: "MEI", rotulo: "MEI — Microempreendedor Individual" },
  { valor: "EI", rotulo: "EI — Empresário Individual" },
  { valor: "SLU", rotulo: "SLU — Sociedade Limitada Unipessoal" },
  { valor: "LTDA", rotulo: "LTDA — Sociedade Limitada" },
  { valor: "SA", rotulo: "S/A — Sociedade Anônima" },
  { valor: "OUTRO", rotulo: "Outro" },
]);

const REGIMES_DECLARADOS = Object.freeze([
  { valor: "SIMPLES", rotulo: "Simples Nacional" },
  { valor: "LUCRO_PRESUMIDO", rotulo: "Lucro Presumido" },
  { valor: "LUCRO_REAL", rotulo: "Lucro Real" },
  { valor: "MEI", rotulo: "MEI" },
  // ⚠ "Não sei" é resposta legítima e precisa existir. Sem ela o contador chuta um regime para
  // conseguir avançar — e um chute registrado como declaração é pior que a ausência do dado.
  { valor: "NAO_SEI", rotulo: "Não sei / preciso confirmar" },
]);

const semSocios = (dados) => !["MEI", "EI"].includes(String(dados?.tipoEmpresa || ""));

/**
 * OS CAMPOS. Cada descritor:
 *   { passo, campo, rotulo, tipo, origens?, visivel?(dados), obrigatorio?(dados),
 *     opcoes?, colunas?, sensivel?, ajuda?, consultaReceita? }
 *
 * - `origens` ausente = vale para as três.
 * - `visivel` ausente = sempre visível.  `obrigatorio` ausente = nunca obrigatório.
 * - ⚠ `visivel` e `obrigatorio` recebem `dados` INTEIRO, não o valor do campo. "MEI esconde
 *   sócios" é regra do rascunho, não do campo — e escrevê-la como função do próprio valor
 *   obrigaria a duplicar a condição em todo campo dependente.
 * - `sensivel: true` = dado DECLARADO, ainda não conferido. Ganha o selo na ficha do escritório.
 */
export const CAMPOS_INTERNOS = Object.freeze(['modalidadeServico', 'consultoriaMensal', 'regimePretendido', 'regimeAtual', 'contadorAnterior', 'contatoContadorAnterior', 'motivoTroca', 'ultimaCompetenciaEntregue', 'inicioCompetenciaAltan', 'temDebitos', 'debitosDeclarados', 'temParcelamento', 'paradaDesde', 'notasRecebidasMes']);
export const empresaIndividual = dados => ['MEI', 'EI'].includes(dados?.tipoEmpresa);
export const pessoaPreenchida = pessoa => pessoa && ['nome', 'cpf', 'participacao'].some(c => String(pessoa[c] ?? '').trim());
export const COLUNAS_PESSOA = [{ campo: 'nome', rotulo: 'Nome', tipo: 'texto' }, { campo: 'cpf', rotulo: 'CPF', tipo: 'cpf' }];
export const CAMPOS_ENDERECO = [{ campo: 'cep', rotulo: 'CEP' }, { campo: 'rua', rotulo: 'Logradouro' }, { campo: 'numero', rotulo: 'Número' }, { campo: 'complemento', rotulo: 'Complemento (opcional)' }, { campo: 'bairro', rotulo: 'Bairro' }, { campo: 'cidade', rotulo: 'Município' }, { campo: 'uf', rotulo: 'UF' }, { campo: 'inscricaoImobiliaria', rotulo: 'Inscrição imobiliária / número do cadastro do IPTU' }];
export function formatarEnderecoAbertura(v) {
  if (typeof v === 'string') return v;
  if (!v || typeof v !== 'object') return '';
  return [...CAMPOS_ENDERECO.map(c => c.campo === 'inscricaoImobiliaria' ? (v.iptuDesconhecido ? 'IPTU: não informado; conferir' : v[c.campo] ? `Cadastro IPTU: ${v[c.campo]}` : '') : c.campo === 'numero' && v.semNumero ? 'Sem número' : v[c.campo]), v.legado].filter(Boolean).join(' · ');
}
export function cpfValido(valor) {
  const cpf = String(valor ?? '').replace(/[.\s-]/g, '');
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let n = 9; n <= 10; n++) {
    const soma = [...cpf.slice(0, n)].reduce((total, digito, i) => total + Number(digito) * (n + 1 - i), 0);
    const dv = (soma * 10) % 11 % 10;
    if (dv !== Number(cpf[n])) return false;
  }
  return true;
}
export function errosConclusaoPessoas(dados = {}) {
  const individual = empresaIndividual(dados), campo = individual ? 'titular' : 'socios';
  const pessoas = (Array.isArray(dados[campo]) ? dados[campo] : []).filter(pessoaPreenchida);
  const outro = individual ? 'socios' : 'titular';
  if (Array.isArray(dados[outro]) && dados[outro].some(pessoaPreenchida)) return { [campo]: 'Confira a mudança entre sócios e titular. As pessoas anteriores foram preservadas; adeque a identificação antes de concluir.' };
  if (!pessoas.length || individual && pessoas.length !== 1) return { [campo]: individual ? 'Identifique um titular com nome e CPF válidos.' : 'Identifique pelo menos um sócio com nome e CPF válidos.' };
  const indice = pessoas.findIndex(p => typeof p.nome !== 'string' || !p.nome.trim() || p.nome.length > 200 || !cpfValido(p.cpf));
  return indice < 0 ? {} : { [campo]: `Confira nome e CPF de ${individual ? 'Titular' : 'Sócio ' + (indice + 1)} ou remova o cartão incompleto.` };
}

export const ONBOARDING_CAMPOS = Object.freeze([

  { passo: 'situacao', campo: 'enderecoAbertura', tipo: 'endereco', origens: ['ABERTURA'], rotulo: 'Endereço onde a empresa vai funcionar' },
  { passo: "identificacao", campo: "servicoSolicitado", tipo: "texto", origens: ["PESSOA_FISICA"], rotulo: "O que precisa resolver?", obrigatorio: () => true },
  { passo: "responsavel", campo: "responsavelCpf", tipo: "cpf", origens: ["PESSOA_FISICA"], rotulo: "CPF (opcional neste momento)" },
  { passo: "situacao", campo: "modalidadeServico", tipo: "escolha", rotulo: "Serviço desejado", opcoes: [{ valor: "AVULSO", rotulo: "Somente serviço avulso" }, { valor: "RECORRENTE", rotulo: "Serviço e contabilidade mensal" }, { valor: "COMPARAR", rotulo: "Quero comparar as opções" }] },
  { passo: "situacao", campo: "notasRecebidasMes", tipo: "inteiro", rotulo: "Notas recebidas e despesas por mês", ajuda: "Não inclui notas emitidas. Conte cada documento uma única vez; uma estimativa é suficiente." },
  { passo: "situacao", campo: "consultoriaMensal", tipo: "booleano", rotulo: "Deseja consultoria mensal?" },
  { passo: "situacao", campo: "municipioAtendimento", tipo: "texto", origens: ["TRANSFERENCIA", "INATIVA"], rotulo: "Município e UF do estabelecimento" },
  { passo: "situacao", campo: "enderecoPretendido", tipo: "texto", origens: ["ABERTURA"], rotulo: "Endereço pretendido para análise de viabilidade" },

  { passo: "situacao", campo: "notasEmitidasMes", tipo: "inteiro", rotulo: "Média de notas emitidas por mês", sensivel: true, ajuda: "Notas de vendas ou serviços emitidas pela empresa. Uma estimativa é suficiente." },
  { passo: "situacao", campo: "faturamentoMensal", tipo: "moeda", origens: ["TRANSFERENCIA", "INATIVA"], rotulo: "Faturamento mensal aproximado (R$)", sensivel: true, ajuda: "Informe a média dos meses com movimento. Não é o lucro." },
  { passo: "situacao", campo: "contatoContadorAnterior", tipo: "texto", origens: ["TRANSFERENCIA"], rotulo: "Contato do contador anterior (opcional)", ajuda: "Telefone ou e-mail, se souber. Usado pela equipe para organizar a transferência." },
  { passo: "situacao", campo: "inicioCompetenciaAltan", tipo: "mesAno", origens: ["TRANSFERENCIA"], rotulo: "Mês pretendido para início na ALTAN", ajuda: "A equipe confirmará a divisão das responsabilidades com você." },

  // ── Identificação ───────────────────────────────────────────────────────────
  {
    passo: "identificacao", campo: "razaoSocial", tipo: "texto",
    origens: ["ABERTURA"],
    rotulo: "Nome pretendido",
    ajuda: "Ainda não é razão social de ninguém — é o nome que se vai tentar registrar.",
    obrigatorio: () => true,
  },
  {
    passo: "identificacao", campo: "razaoSocial", tipo: "texto",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "Razão social",
    obrigatorio: () => true,
  },
  {
    passo: "identificacao", campo: "cnpj", tipo: "cnpj",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "CNPJ",
    obrigatorio: () => true,
    consultaReceita: true,
    // Sensível enquanto vier digitado à mão: a consulta à Receita é o que o torna conferido, e ela
    // pode ter falhado (rede corporativa, bloqueador, offline).
    sensivel: true,
  },
  {
    passo: "identificacao", campo: "nomeFantasia", tipo: "texto",
    origens: ["TRANSFERENCIA", "INATIVA"], rotulo: "Nome fantasia",
  },
  {
    passo: "identificacao", campo: "tipoEmpresa", tipo: "escolha",
    rotulo: "Tipo de empresa",
    ajuda: "Se não souber, a equipe ajuda a identificar.",
    opcoes: TIPOS_EMPRESA,
  },
  {
    passo: "identificacao", campo: "atividadePretendida", tipo: "textarea",
    origens: ["ABERTURA"],
    rotulo: "Descreva a atividade que a empresa vai exercer",
    ajuda: "Conte quais produtos vai vender ou quais serviços vai prestar.",
    obrigatorio: () => true,
  },
  {
    passo: "identificacao", campo: "municipioPretendido", tipo: "texto",
    origens: ["ABERTURA"], rotulo: "Município da sede (pretendido)",
  },
  {
    passo: "identificacao", campo: "capitalSocialPretendido", tipo: "moeda",
    origens: ["ABERTURA"], rotulo: "Capital social pretendido",
  },
  { passo: 'identificacao', campo: 'titular', tipo: 'lista', rotulo: 'Titular', visivel: dados => empresaIndividual(dados) || (dados.titular || []).some(pessoaPreenchida), colunas: COLUNAS_PESSOA },
  {
    passo: "identificacao", campo: "socios", tipo: "lista",
    rotulo: "Sócios",
    // MEI/EI usam titular. Pessoas anteriores ficam visíveis até adequação explícita.
    visivel: dados => semSocios(dados) || (dados.socios || []).some(pessoaPreenchida),
    colunas: [
      { campo: "nome", rotulo: "Nome", tipo: "texto" },
      { campo: "cpf", rotulo: "CPF", tipo: "cpf" },
      { campo: "participacao", rotulo: "Participação (%)", tipo: "texto" },
    ],
  },

  // ── Responsável ─────────────────────────────────────────────────────────────
  {
    passo: "responsavel", campo: "responsavelNome", tipo: "texto",
    rotulo: "Nome do responsável", obrigatorio: () => true,
  },
  {
    passo: "responsavel", campo: "responsavelEmail", tipo: "email",
    rotulo: "E-mail do responsável",
    ajuda: "Usado para contato e acesso aos serviços contratados.",
    obrigatorio: () => true,
  },
  {
    passo: "responsavel", campo: "responsavelTelefone", tipo: "telefone",
    rotulo: "Telefone / WhatsApp", obrigatorio: () => true,
  },
  {
    passo: "responsavel", campo: "responsavelCargo", tipo: "texto",
    rotulo: "Cargo / relação com a empresa",
  },

  // ── Situação — TRANSFERÊNCIA ────────────────────────────────────────────────
  {
    passo: "situacao", campo: "regimeAtual", tipo: "escolha",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "Regime tributário atual", opcoes: REGIMES_DECLARADOS,
    obrigatorio: () => true, sensivel: true,
  },
  {
    passo: "situacao", campo: "contadorAnterior", tipo: "texto",
    origens: ["TRANSFERENCIA"], rotulo: "Contador/escritório anterior",
  },
  {
    passo: "situacao", campo: "motivoTroca", tipo: "texto",
    origens: ["TRANSFERENCIA"], rotulo: "Motivo da troca",
  },
  {
    passo: "situacao", campo: "ultimaCompetenciaEntregue", tipo: "mesAno",
    origens: ["TRANSFERENCIA"],
    rotulo: "Última competência entregue pelo contador anterior", sensivel: true,
  },
  {
    passo: "situacao", campo: "paradaDesde", tipo: "mesAno",
    origens: ["INATIVA"], rotulo: "Parada desde", obrigatorio: () => true, sensivel: true,
  },
  {
    passo: "situacao", campo: "pretendeReativar", tipo: "escolha",
    origens: ["INATIVA"], rotulo: "O que o cliente pretende",
    opcoes: [
      { valor: "REATIVAR", rotulo: "Reativar a empresa" },
      { valor: "BAIXAR", rotulo: "Dar baixa" },
      { valor: "INDECISO", rotulo: "Ainda não decidiu" },
    ],
    obrigatorio: () => true,
  },
  {
    passo: "situacao", campo: "regimePretendido", tipo: "escolha",
    origens: ["ABERTURA"], rotulo: "Regime tributário pretendido",
    ajuda: "Intenção declarada. O enquadramento definitivo é decidido no cadastro da empresa.",
    opcoes: [
      { valor: "SIMPLES", rotulo: "Simples Nacional" },
      { valor: "LUCRO_PRESUMIDO", rotulo: "Lucro Presumido" },
      { valor: "LUCRO_REAL", rotulo: "Lucro Real" },
      { valor: "A_DEFINIR", rotulo: "A definir com o contador" },
    ],
    sensivel: true,
  },
  {
    passo: "situacao", campo: "previsaoFaturamento", tipo: "moeda",
    origens: ["ABERTURA"], rotulo: "Previsão de faturamento mensal", sensivel: true,
  },

  // ── Situação — comum a quem já opera (e à abertura, na forma de intenção) ────
  {
    passo: "situacao", campo: "temDebitos", tipo: "booleano",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "O cliente informa ter débitos em aberto", sensivel: true,
  },
  {
    passo: "situacao", campo: "debitosDeclarados", tipo: "moeda",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "Valor aproximado dos débitos declarados",
    ajuda: "Valor DECLARADO pelo cliente. O número que vale é o do relatório de situação fiscal.",
    visivel: (dados) => dados?.temDebitos === true,
    sensivel: true,
  },
  {
    passo: "situacao", campo: "temParcelamento", tipo: "booleano",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "Tem parcelamento em andamento", sensivel: true,
  },
  {
    passo: "situacao", campo: "pendenciasDeclaradas", tipo: "textarea",
    origens: ["TRANSFERENCIA", "INATIVA"],
    rotulo: "Deseja relatar alguma informação importante sobre a empresa?", sensivel: true,
  },
  {
    passo: "situacao", campo: "qtdFuncionarios", tipo: "inteiro",
    rotulo: "Quantidade de funcionários", sensivel: true, ajuda: "Informe zero se não houver. Não conte os sócios.", pergunta: "A empresa tem ou pretende ter funcionários? Quantos, sem contar os sócios?",
  },
  {
    passo: "situacao", campo: "temProLabore", tipo: "booleano",
    rotulo: "O titular ou algum sócio recebe uma remuneração pelo trabalho na empresa?",
    ajuda: "Essa remuneração é chamada de pró-labore. É diferente da distribuição de lucros.",
    sensivel: true,
  },

  // ── Revisão ─────────────────────────────────────────────────────────────────
  {
    passo: "revisao", campo: "observacoes", tipo: "texto",
    rotulo: "Observações do atendimento",
  },
]);

// ─── SELETORES ────────────────────────────────────────────────────────────────
// Ficam NESTE arquivo de propósito: são eles que impedem a tela de reimplementar a regra. Um
// seletor no componente é uma segunda definição de "este campo aparece?".

function valeParaOrigem(descritor, origem) {
  if (!Array.isArray(descritor.origens)) return origem !== "PESSOA_FISICA" || ["responsavelNome", "responsavelEmail", "responsavelTelefone", "observacoes"].includes(descritor.campo);
  return descritor.origens.includes(origem);
}

function estaVisivel(descritor, dados) {
  if (CAMPOS_INTERNOS.includes(descritor.campo) || ['municipioPretendido', 'enderecoPretendido'].includes(descritor.campo)) return false;
  if (typeof descritor.visivel !== "function") return true;
  return descritor.visivel(dados || {}) === true;
}

export function ehObrigatorio(descritor, dados) {
  if (typeof descritor.obrigatorio !== "function") return false;
  return descritor.obrigatorio(dados || {}) === true;
}

/** Descritores VISÍVEIS de um passo, na ordem da spec. */
const ORDEM_SITUACAO = ["modalidadeServico", "regimeAtual", "regimePretendido", "faturamentoMensal", "previsaoFaturamento", "qtdFuncionarios", "temProLabore", "notasEmitidasMes", "notasRecebidasMes", "municipioAtendimento", "enderecoPretendido", "paradaDesde", "pretendeReativar", "contadorAnterior", "contatoContadorAnterior", "motivoTroca", "ultimaCompetenciaEntregue", "inicioCompetenciaAltan", "temDebitos", "debitosDeclarados", "temParcelamento", "pendenciasDeclaradas", "consultoriaMensal"];
export function camposDoPasso(origem, passo, dados) {
  return ONBOARDING_CAMPOS.filter(
    (d) => d.passo === passo && valeParaOrigem(d, origem) && estaVisivel(d, dados)
  ).map(d => d.campo === 'temProLabore' && origem === 'ABERTURA' ? { ...d, rotulo: 'O titular ou algum sócio pretende receber uma remuneração pelo trabalho na empresa?' } : d).sort((a, b) => passo === "situacao" ? ORDEM_SITUACAO.indexOf(a.campo) - ORDEM_SITUACAO.indexOf(b.campo) : Number(Boolean(b.consultaReceita)) - Number(Boolean(a.consultaReceita)));
}

/** Todos os descritores da origem, visíveis ou não — usado pela poda e pelo `rascunhoVazio`. */
export function camposDaOrigem(origem) {
  return ONBOARDING_CAMPOS.filter((d) => valeParaOrigem(d, origem));
}

/**
 * Os passos do wizard. Hoje todas as origens percorrem os cinco — a função existe para que a tela
 * NUNCA itere `ONBOARDING_PASSOS` direto: no dia em que uma origem pular um passo, muda aqui e
 * todas as telas acompanham.
 */
export function passosVisiveis(origem) {
  if (!ONBOARDING_ORIGENS.some((o) => o.chave === origem)) {
    // Sem origem escolhida existe UM passo: escolher a origem.
    return ONBOARDING_PASSOS.filter((p) => p.chave === "origem");
  }
  return origem === "PESSOA_FISICA" ? ONBOARDING_PASSOS.filter(p => p.chave !== "situacao") : ONBOARDING_PASSOS;
}

const VAZIO_POR_TIPO = {
  booleano: null, // ⚠ `null`, não `false`: "ninguém respondeu" ≠ "respondeu que não"
  lista: [],
};

/** O rascunho em branco daquela origem — a forma canônica de `Onboarding.dados`. */
export function rascunhoVazio(origem) {
  const out = origem === "PESSOA_FISICA" ? {} : { cartoesPessoas: 2 };
  for (const descritor of camposDaOrigem(origem)) {
    out[descritor.campo] = Object.prototype.hasOwnProperty.call(VAZIO_POR_TIPO, descritor.tipo)
      ? (descritor.tipo === "lista" ? [] : VAZIO_POR_TIPO[descritor.tipo])
      : "";
  }
  return out;
}

/**
 * Sócios/titular e dados internos sobrevivem à mudança de visibilidade. O conflito
 * de pessoas é resolvido explicitamente antes da conclusão, sem apagar histórico.
 *
 * Poda também o que não pertence à origem — o rascunho pode carregar resíduo de um estado anterior
 * da tela.
 */
export function podarInvisiveis(origem, dados) {
  const entrada = dados && typeof dados === "object" ? dados : {};
  const permitidos = new Set(camposDaOrigem(origem).map(d => d.campo));
  const out = {};
  for (const [chave, valor] of Object.entries(entrada)) {
    if (permitidos.has(chave) || chave === 'cartoesPessoas') out[chave] = valor;
  }
  if (origem !== "PESSOA_FISICA") {
    const cadastro = normalizarCadastroCnpj(entrada.cadastroCnpj, out.cnpj);
    if (cadastro) out.cadastroCnpj = cadastro;
  }
  if (out.cartoesPessoas !== undefined) out.cartoesPessoas = Number.isInteger(out.cartoesPessoas) ? Math.max(1, Math.min(100, out.cartoesPessoas)) : 1;
  for (const campo of ['socios', 'titular']) if (Array.isArray(out[campo])) out[campo] = out[campo].filter(pessoaPreenchida);
  return out;
}

// Campos internos e históricos vêm do estado persistido, nunca do body público.
export function combinarColetaPublica(origem, atual, entrada) {
  const permitidos = new Set(camposDaOrigem(origem).filter(d => !CAMPOS_INTERNOS.includes(d.campo) && !['enderecoPretendido', 'municipioPretendido'].includes(d.campo)).map(d => d.campo));
  return { ...atual, ...Object.fromEntries(Object.entries(entrada || {}).filter(([k]) => permitidos.has(k) || k === 'cartoesPessoas' || k === 'cadastroCnpj')) };
}

export function combinarFichaInterna(atual, entrada) {
  const preservados = new Set([...CAMPOS_INTERNOS, 'enderecoPretendido', 'municipioPretendido']);
  if (entrada?.tipoEmpresa !== undefined && entrada.tipoEmpresa !== atual?.tipoEmpresa) {
    preservados.add('socios'); preservados.add('titular');
  }
  return { ...Object.fromEntries(Object.entries(atual || {}).filter(([k]) => preservados.has(k))), ...entrada };
}

export function camposDaColeta(origem, dados = {}) {
  return passosVisiveis(origem).flatMap(p => camposDoPasso(origem, p.chave, dados));
}

// Metadados operacionais já persistidos não pertencem ao questionário e não podem
// ser substituídos por chaves extras de um formulário. Só o estado do servidor os fornece.
export function preservarDadosPersistidos(origem, atual, validado) {
  const questionario = new Set([...camposDaOrigem(origem).map(d => d.campo), 'cadastroCnpj', 'cartoesPessoas']);
  const dados = { ...Object.fromEntries(Object.entries(atual || {}).filter(([k]) => !questionario.has(k))), ...validado };
  const documento = v => String(v || '').replace(/[.\s/-]/g, '').toUpperCase();
  if (atual?.cadastroCnpj?.atorId && documento(atual.cnpj) && documento(atual.cnpj) === documento(validado.cnpj)) {
    dados.cadastroCnpj = atual.cadastroCnpj;
  }
  return dados;
}

function estaPreenchido(valor, tipo) {
  if (tipo === "lista") return Array.isArray(valor) && valor.length > 0;
  if (tipo === "booleano") return valor === true || valor === false;
  return String(valor ?? "").trim() !== "";
}

/**
 * Os problemas de UM passo: `[{ campo, rotulo, motivo }]`. Lista vazia = passo sem pendência.
 *
 * ⚠ Pendência aqui NÃO bloqueia o salvamento — o funil aceita preenchimento parcial por definição,
 * e é a razão de ele existir. Ela só acende o ponto de aviso na trilha e a lista na revisão.
 */
export function problemasDoPasso(origem, passo, dados) {
  const entrada = dados && typeof dados === "object" ? dados : {};
  const problemas = camposDoPasso(origem, passo, entrada)
    .filter((d) => ehObrigatorio(d, entrada) && !estaPreenchido(entrada[d.campo], d.tipo))
    .map((d) => ({ campo: d.campo, rotulo: d.rotulo, motivo: "obrigatorio" }));
  if (origem !== "PESSOA_FISICA" && passo === "identificacao") for (const [campo, rotulo] of Object.entries(errosConclusaoPessoas(entrada))) problemas.push({ campo, rotulo, motivo: "identificacao_pessoa" });
  return problemas;
}

/** Todos os problemas da ficha, passo a passo — o que a tela de revisão lista. */
export function problemasDoRascunho(origem, dados) {
  return passosVisiveis(origem)
    .filter((p) => p.chave !== "origem")
    .flatMap((p) => problemasDoPasso(origem, p.chave, dados).map((x) => ({ ...x, passo: p.chave })));
}

/** Descritor pelo par (origem, campo) — a ficha de leitura usa para achar rótulo e `sensivel`. */
export function descritorDe(origem, campo) {
  return camposDaOrigem(origem).find((d) => d.campo === campo) || null;
}

export const ONBOARDING_SPEC = Object.freeze({
  ONBOARDING_ORIGENS,
  ONBOARDING_PASSOS,
  ONBOARDING_CAMPOS,
});
