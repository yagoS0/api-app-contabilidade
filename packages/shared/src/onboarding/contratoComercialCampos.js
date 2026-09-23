// Somente metadados públicos. Cláusulas e valores ficam na biblioteca privada.
const campo = (chave, rotulo, grupo, extra = {}) => ({ chave, rotulo, grupo, tipo: 'text', ...extra });
export const CAMPOS_CONTRATO = [
  campo('contratante', 'Razão social da contratante', 'Empresa'),
  campo('cnpj', 'CNPJ da contratante', 'Empresa', { documento: 14 }),
  campo('endereco', 'Endereço completo da contratante', 'Empresa'),
  campo('regimeTributario', 'Regime tributário contratado', 'Empresa'),
  campo('nome', 'Nome do representante', 'Representante'),
  campo('cpf', 'CPF do representante', 'Representante', { documento: 11 }),
  campo('enderecoRepresentante', 'Endereço completo da pessoa contratante', 'Representante'),
  campo('cargo', 'Cargo do representante', 'Representante'),
  campo('email', 'E-mail do representante', 'Representante', { tipo: 'email' }),
  campo('whatsapp', 'WhatsApp do representante', 'Representante', { tipo: 'tel' }),
  campo('escritorio', 'Nome do escritório', 'Escritório'),
  campo('contratadaRazaoSocial', 'Razão social do escritório', 'Escritório'),
  campo('contratadaCnpj', 'CNPJ do escritório', 'Escritório', { documento: 14 }),
  campo('contratadaEndereco', 'Endereço completo do escritório', 'Escritório'),
  campo('contadorNome', 'Nome do responsável técnico', 'Escritório'),
  campo('contadorCrc', 'Registro CRC do responsável técnico', 'Escritório'),
  campo('procuradorCnpj', 'CNPJ do procurador', 'Escritório', { documento: 14 }),
  campo('servico', 'Escopo da opção aceita', 'Proposta aceita', { protegido: true, multiline: true }),
  campo('honorarios', 'Honorários da opção aceita', 'Proposta aceita', { protegido: true }),
  campo('honorariosMensais', 'Honorários mensais', 'Proposta aceita', { protegido: true }),
  campo('honorariosMensaisExtenso', 'Honorários mensais por extenso', 'Proposta aceita', { protegido: true }),
  campo('honorariosUnicos', 'Valor do serviço inicial ou avulso', 'Proposta aceita', { protegido: true }),
  campo('honorariosRegularizacao', 'Regularização contratada', 'Proposta aceita', { protegido: true }),
  campo('totalInicialHonorarios', 'Total inicial de honorários', 'Proposta aceita', { protegido: true }),
  campo('taxasPublicas', 'Taxas públicas da proposta', 'Proposta aceita', { protegido: true }),
  campo('condicaoInicioMensal', 'Condição para iniciar o acompanhamento mensal', 'Proposta aceita', { protegido: true, multiline: true }),
  campo('condicoes', 'Condições da proposta aceita', 'Proposta aceita', { protegido: true, multiline: true }),
  campo('faixaContratada', 'Faixa contratada', 'Escopo e limites'),
  campo('limiteDocumentos', 'Documentos de entrada incluídos por mês', 'Escopo e limites', { tipo: 'number', min: 0, max: 1000000 }),
  campo('limiteFuncionarios', 'Funcionários incluídos na folha', 'Escopo e limites', { tipo: 'number', min: 0, max: 1000000 }),
  campo('adicionaisContratados', 'Adicionais contratados', 'Escopo e limites', { multiline: true }),
  campo('condicoesPartida', 'Condições de início dos serviços', 'Escopo e limites', { multiline: true }),
  campo('diaVencimento', 'Dia de vencimento dos honorários', 'Prazos e assinatura', { tipo: 'number', min: 1, max: 31 }),
  campo('antecedenciaGuiasDias', 'Antecedência das guias em dias úteis', 'Prazos e assinatura', { tipo: 'number', min: 0, max: 31 }),
  campo('diaEntregaDocumentos', 'Dia limite de entrega dos documentos', 'Prazos e assinatura', { tipo: 'number', min: 1, max: 31 }),
  campo('diasSuspensao', 'Dias de atraso para suspensão', 'Prazos e assinatura', { tipo: 'number', min: 1, max: 365 }),
  campo('diasRescisao', 'Dias de atraso para rescisão', 'Prazos e assinatura', { tipo: 'number', min: 1, max: 365 }),
  campo('foro', 'Comarca do foro', 'Prazos e assinatura'),
  campo('localAssinatura', 'Cidade da assinatura', 'Prazos e assinatura'),
  campo('dataAssinatura', 'Data prevista de assinatura', 'Prazos e assinatura', { tipo: 'date' }),
  campo('inicioVigencia', 'Início da vigência do anexo', 'Prazos e assinatura', { tipo: 'date' }),
  campo('anexoAnterior', 'Data do anexo anterior ou não se aplica', 'Prazos e assinatura'),
  campo('linkAutorizacao', 'Link da orientação de autorização', 'Outros', { tipo: 'url' }),
  campo('linkProposta', 'Link da proposta', 'Outros', { tipo: 'url' }),
];
export const VARIAVEIS_CONTRATO_PROTEGIDAS = CAMPOS_CONTRATO.filter(c => c.protegido).map(c => c.chave);
const monetario = c => Number.isSafeInteger(c) && c >= 0 ? (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
export function valorPorExtenso(centavos) {
  if (!Number.isSafeInteger(centavos) || centavos < 0 || centavos >= 1e14) return '';
  const unidades = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  function numero(n) {
    if (n < 20) return unidades[n];
    if (n < 100) return dezenas[Math.floor(n / 10)] + (n % 10 ? ' e ' + numero(n % 10) : '');
    if (n === 100) return 'cem';
    if (n < 1000) return centenas[Math.floor(n / 100)] + (n % 100 ? ' e ' + numero(n % 100) : '');
    const escala = n >= 1e9 ? 1e9 : n >= 1e6 ? 1e6 : 1000;
    const q = Math.floor(n / escala), resto = n % escala;
    const inicio = escala === 1000 ? (q === 1 ? 'mil' : numero(q) + ' mil') : numero(q) + (escala === 1e6 ? (q === 1 ? ' milhão' : ' milhões') : (q === 1 ? ' bilhão' : ' bilhões'));
    return inicio + (resto ? (resto < 100 || resto % 100 === 0 ? ' e ' : ' ') + numero(resto) : '');
  }
  const reais = Math.floor(centavos / 100), cent = centavos % 100;
  const moeda = numero(reais) + (reais === 1 ? ' real' : reais && reais % 1000000 === 0 ? ' de reais' : ' reais');
  return (reais || !cent ? moeda : '') + (cent ? (reais ? ' e ' : '') + numero(cent) + (cent === 1 ? ' centavo' : ' centavos') : '');
}
export const variaveisDoModelo = texto => [...new Set([...String(texto || '').matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)].map(m => m[1]))];
export function enderecoContrato(valor) {
  if (typeof valor === 'string') return valor;
  if (!valor || typeof valor !== 'object') return '';
  return [valor.logradouro || valor.street, valor.numero || valor.number, valor.complemento, valor.bairro, valor.municipio || valor.cidade || valor.city, valor.uf || valor.estado, valor.cep].filter(v => typeof v === 'string' || typeof v === 'number').join(', ');
}
export function sugerirVariaveisContrato({ onboarding = {}, proposta = {}, modelo = {}, institucional = {}, variaveis = {} } = {}) {
  const d = onboarding.dados || {}, s = proposta.snapshot || {}, i = institucional.dados || institucional;
  const opcao = s.opcoes?.find(o => o.chave === proposta.opcaoAceita);
  const preenchidos = (v, aceitarVazio = false) => Object.fromEntries(Object.entries(v || {}).filter(([k, valor]) => CAMPOS_CONTRATO.some(c => c.chave === k) && ['string', 'number'].includes(typeof valor) && (aceitarVazio || String(valor).trim() !== '')));
  const cadastro = preenchidos({
    contratante: onboarding.razaoSocial || d.razaoSocial, cnpj: onboarding.cnpj,
    nome: onboarding.responsavelNome || d.responsavelNome, email: onboarding.responsavelEmail || d.responsavelEmail,
    cpf: d.responsavelCpf, cargo: d.responsavelCargo, whatsapp: onboarding.responsavelTelefone || d.responsavelTelefone,
    enderecoRepresentante: enderecoContrato(d.responsavelEndereco),
    endereco: enderecoContrato(d.endereco || d.enderecoPretendido),
    regimeTributario: ({ SIMPLES: 'Simples Nacional', LUCRO_PRESUMIDO: 'Lucro Presumido', LUCRO_REAL: 'Lucro Real' })[s.perfil?.regime || d.regimeAtual || d.regimePretendido],
  });
  const valores = { ...preenchidos(modelo.dados?.camposPadrao), ...preenchidos(i), ...cadastro, ...preenchidos(variaveis, true) };
  if (onboarding.cnpj) valores.cnpj = String(onboarding.cnpj).replace(/\D/g, '');
  if (s.perfil?.regime && cadastro.regimeTributario) valores.regimeTributario = cadastro.regimeTributario;
  if (opcao) {
    const regularizacao = Number.isSafeInteger(s.regularizacaoCentavos) && s.regularizacaoCentavos >= 0 ? s.regularizacaoCentavos : 0;
    const regularizacaoExtra = opcao.regularizacaoIncluida ? 0 : regularizacao;
    const unicoValido = Number.isSafeInteger(opcao.unicoCentavos) && opcao.unicoCentavos >= 0;
    const total = unicoValido && Number.isSafeInteger(opcao.unicoCentavos + regularizacaoExtra) ? opcao.unicoCentavos + regularizacaoExtra : null;
    Object.assign(valores, {
      servico: opcao.escopo || '', honorarios: monetario(opcao.unicoCentavos) + ' de serviço' + (regularizacaoExtra ? '; ' + monetario(regularizacaoExtra) + ' de regularização' : '') + (opcao.recorrente ? '; ' + monetario(opcao.mensalCentavos) + ' por mês' : ''),
      honorariosMensais: monetario(opcao.mensalCentavos), honorariosMensaisExtenso: valorPorExtenso(opcao.mensalCentavos),
      honorariosUnicos: monetario(opcao.unicoCentavos), condicoes: s.condicoes || '',
      honorariosRegularizacao: opcao.regularizacaoIncluida ? 'Incluída no valor do serviço avulso' : monetario(regularizacao),
      totalInicialHonorarios: monetario(total),
      taxasPublicas: s.taxasConfirmadas && Number.isSafeInteger(s.taxasCentavos) && s.taxasCentavos >= 0 ? monetario(s.taxasCentavos) : 'A confirmar separadamente, antes de qualquer recolhimento',
      condicaoInicioMensal: !opcao.recorrente ? 'Não há acompanhamento mensal nesta contratação.'
        : ({ APOS_REGULARIZACAO: 'Após a execução e conferência da regularização prevista na proposta aceita.', SEM_REGULARIZACAO: 'Conforme a vigência e o escopo da proposta aceita; não há regularização prévia contratada.' })[s.decisaoRegularizacao?.condicaoInicioMensal]
          || s.decisaoRegularizacao?.condicaoInicioMensal || (s.decisaoRegularizacao?.necessaria ? 'Após a regularização prevista na proposta aceita.' : 'Conforme a vigência e o escopo da proposta aceita.'),
    });
    if (opcao.recorrente && s.limitesPlano) {
      if (Number.isInteger(s.limitesPlano.funcionarios)) valores.limiteFuncionarios = s.limitesPlano.funcionarios;
      if (Number.isInteger(s.limitesPlano.documentosEntradaMes)) valores.limiteDocumentos = s.limitesPlano.documentosEntradaMes;
      if (Number.isInteger(s.limitesPlano.funcionarios)) valores.faixaContratada = 'Até ' + s.limitesPlano.funcionarios + ' funcionários';
    }
  }
  return valores;
}
export function camposDoContrato({ modelo = {}, onboarding = {}, proposta = {} } = {}) {
  const usados = variaveisDoModelo(modelo.texto);
  return CAMPOS_CONTRATO.filter(c => usados.includes(c.chave)).map(c => ({
    ...c,
    protegido: Boolean(c.protegido || c.chave === 'cnpj' && onboarding.cnpj
      || c.chave === 'regimeTributario' && proposta.snapshot?.perfil?.regime
      || ['limiteFuncionarios', 'limiteDocumentos', 'faixaContratada'].includes(c.chave) && proposta.snapshot?.limitesPlano),
  }));
}
export function problemasDosCamposContrato(campos, valores) {
  return campos.flatMap(c => {
    const valor = String(valores[c.chave] ?? '').trim();
    if (!valor) return [{ chave: c.chave, mensagem: 'Preencha ' + c.rotulo.toLowerCase() + '.' }];
    if (valor.length > 10000) return [{ chave: c.chave, mensagem: c.rotulo + ': texto muito longo.' }];
    if (c.tipo === 'number' && (!/^\d+$/.test(valor) || +valor < c.min || +valor > c.max)) return [{ chave: c.chave, mensagem: c.rotulo + ': informe um número inteiro de ' + c.min + ' a ' + c.max + '.' }];
    if (c.documento && valor.replace(/\D/g, '').length !== c.documento) return [{ chave: c.chave, mensagem: c.rotulo + ': confira os ' + c.documento + ' dígitos.' }];
    if (c.tipo === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) return [{ chave: c.chave, mensagem: 'Confira o e-mail do representante.' }];
    if (c.tipo === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || !Number.isFinite(Date.parse(valor)) || new Date(valor).toISOString().slice(0, 10) !== valor)) return [{ chave: c.chave, mensagem: 'Confira ' + c.rotulo.toLowerCase() + '.' }];
    if (c.tipo === 'url' && !/^https:\/\//.test(valor)) return [{ chave: c.chave, mensagem: c.rotulo + ': use um endereço HTTPS.' }];
    return [];
  });
}
