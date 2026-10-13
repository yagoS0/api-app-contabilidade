import { camposDaOrigem, camposDoPasso, podarInvisiveis } from './onboardingSpec.js';

export const RESPOSTAS_ESPECIAIS = ['NAO_SEI', 'NAO_APLICAVEL'];
export const respostaEspecial = v => RESPOSTAS_ESPECIAIS.includes(v);
export const CAMPOS_QUALIFICACAO = ['qtdFuncionarios', 'notasRecebidasMes', 'notasEmitidasMes', 'faturamentoMensal', 'temProLabore', 'regimeAtual'];
export const permiteRespostaEspecial = d => CAMPOS_QUALIFICACAO.includes(d.campo) || ['temDebitos', 'temParcelamento', 'ultimaCompetenciaEntregue', 'inicioCompetenciaAltan'].includes(d.campo);
export const valorConhecido = v => v !== undefined && v !== null && v !== '' && !respostaEspecial(v);

export function numeroDeclarado(v) {
  if (!valorConhecido(v)) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const s = v.trim().replace(/^R\$\s*/, '').replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+([,.]\d{1,2})?$/.test(s)) return Number(s.replace(',', '.'));
  return NaN;
}

// Ausência é permitida no rascunho; uma resposta preenchida precisa ser coerente.
export function validarDadosOnboarding(origem, entrada, { passo } = {}) {
  const dados = podarInvisiveis(origem, entrada), erros = {};
  const descritores = passo ? camposDoPasso(origem, passo, dados) : camposDaOrigem(origem);
  for (const d of descritores) {
    const v = dados[d.campo];
    if (v === undefined || v === null || v === '') continue;
    if (respostaEspecial(v) && permiteRespostaEspecial(d)) continue;
    let invalido = false;
    if (['inteiro', 'moeda'].includes(d.tipo)) {
      const n = d.tipo === 'inteiro' && typeof v === 'string' ? (/^\d+$/.test(v.trim()) ? Number(v) : NaN) : numeroDeclarado(v);
      invalido = !Number.isFinite(n) || n < 0 || n > 1e12 || d.tipo === 'inteiro' && !Number.isSafeInteger(n);
      if (!invalido) dados[d.campo] = n;
    } else if (d.tipo === 'booleano') invalido = typeof v !== 'boolean';
    else if (d.tipo === 'lista') {
      invalido = !Array.isArray(v) || v.length > 100 || v.some(s => !s || typeof s !== 'object' || Array.isArray(s)
        || s.cpf && !/^\d{11}$/.test(String(s.cpf).replace(/[.\s-]/g, ''))
        || s.participacao != null && s.participacao !== '' && (!Number.isFinite(numeroDeclarado(s.participacao)) || numeroDeclarado(s.participacao) < 0 || numeroDeclarado(s.participacao) > 100));
    } else {
      invalido = typeof v !== 'string' || v.length > 2000;
      if (!invalido) {
        dados[d.campo] = v.trim();
        if (d.tipo === 'email') invalido = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
        if (d.tipo === 'telefone') invalido = !/^\+?[\d\s().-]+$/.test(v) || v.replace(/\D/g, '').length < 10 || v.replace(/\D/g, '').length > 15;
        if (d.tipo === 'cnpj') invalido = !/^[A-Z\d]{12}\d{2}$/i.test(v.replace(/[.\s/-]/g, ''));
        if (d.tipo === 'cpf') invalido = !/^\d{11}$/.test(v.replace(/[.\s-]/g, ''));
        if (d.tipo === 'mesAno') invalido = !/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
        if (d.opcoes) invalido = !d.opcoes.some(o => o.valor === v);
      }
    }
    if (invalido) erros[d.campo] = ['inteiro', 'moeda'].includes(d.tipo) ? `Informe ${d.tipo === 'inteiro' ? 'uma quantidade inteira' : 'um valor'} maior ou igual a zero.` : `Confira ${d.rotulo.toLowerCase()}.`;
  }
  return { ok: !Object.keys(erros).length, dados, erros };
}

export function exigirDadosOnboarding(origem, entrada) {
  const r = validarDadosOnboarding(origem, entrada);
  if (!r.ok) throw Object.assign(new Error(Object.values(r.erros)[0]), { code: 'dados_invalidos', status: 400, erros: r.erros });
  return r.dados;
}

// Campos sem conflito são combinados; divergências exigem escolha explícita.
export function reconciliarDados(base = {}, local = {}, remoto = {}) {
  const dados = { ...remoto }, conflitos = [];
  const igual = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
  for (const campo of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remoto)])) {
    if (igual(local[campo], base[campo])) continue;
    if (!igual(remoto[campo], base[campo]) && !igual(local[campo], remoto[campo])) conflitos.push({ campo, local: local[campo], remoto: remoto[campo] });
    if (campo in local) dados[campo] = local[campo]; else delete dados[campo];
  }
  return { dados, conflitos };
}

export function proximaPerguntaOnboarding(r, { desconhecidos = [] } = {}) {
  if (!r) return { campo: 'origem', pergunta: 'Você quer abrir uma empresa, trocar de contador, resolver uma empresa parada ou um serviço pessoal?' };
  const d = r.dados || {};
  const encerramento = r.origem === 'INATIVA' && d.pretendeReativar === 'BAIXAR';
  const ordem = r.origem === 'PESSOA_FISICA' ? ['responsavelNome', 'servicoSolicitado', 'responsavelTelefone']
    : [...(r.origem === 'ABERTURA' ? ['responsavelNome', 'atividadePretendida'] : ['cnpj', 'responsavelNome']), ...(r.origem === 'INATIVA' ? ['paradaDesde', 'pretendeReativar'] : []),
      ...(!encerramento ? ['modalidadeServico', ...(d.modalidadeServico !== 'AVULSO' ? CAMPOS_QUALIFICACAO.filter(c => c !== 'regimeAtual' || r.origem !== 'ABERTURA') : [])] : []),
      ...(r.origem === 'ABERTURA' ? ['municipioAtendimento', 'enderecoPretendido'] : r.origem === 'TRANSFERENCIA' ? ['contadorAnterior', 'contatoContadorAnterior', 'ultimaCompetenciaEntregue', 'inicioCompetenciaAltan', 'temDebitos', 'temParcelamento'] : [])];
  const descritores = camposDaOrigem(r.origem);
  for (const campo of ordem) {
    const descritor = descritores.find(x => x.campo === campo);
    if (!descritor || desconhecidos.includes(campo) || valorConhecido(d[campo]) || respostaEspecial(d[campo])) continue;
    return { campo, pergunta: descritor.pergunta || `${descritor.rotulo}?`, opcoes: descritor.opcoes };
  }
  return { campo: null, pergunta: 'Os dados iniciais foram registrados. A equipe vai conferir as respostas e as pendências antes de preparar a proposta.' };
}
