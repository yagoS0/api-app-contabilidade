const normalizar = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const CAMPOS_INVESTIGACAO = ['periodoPendencias', 'tipoPendencias', 'situacaoOperacional'];

export function periodoImpreciso(valor) {
  const t = normalizar(valor).trim().replace(/[.!]+$/g, '');
  return /^(?:(?:ja )?faz (?:muito |bastante |algum )?tempo|ha (?:muito |bastante |algum )?tempo|ha (?:anos|meses)|(?:muitos|varios|alguns) (?:anos|meses))$/.test(t);
}

export function tipoPendenciasGenerico(valor) {
  const t = normalizar(valor).trim().replace(/[.!]+$/g, '');
  return /^(?:(?:eu )?nao (?:pago|paguei|pagamos|pagava)(?: mais)?(?: nada| tudo)?|tudo|nada|tudo atrasado|(?:todos os |os )?pagamentos|(?:todas as |as )?pendencias)$/.test(t);
}

// Apenas relato comercial, nunca confirmação de dívida ou diagnóstico fiscal.
export function atualizarInvestigacao(pre, { texto, mensagemId, ia, revisaoIdentidade, falhaIa, anterior = {} }) {
  if (texto && mensagemId) {
    pre.relatosCliente = [...(pre.relatosCliente || []).filter(r => r.mensagemId !== mensagemId),
      { mensagemId, texto: texto.slice(0, 4000) }].slice(-40);
  }
  if (pre.intencao !== 'INATIVA' || revisaoIdentidade || falhaIa || ia?.comportamento !== 'DADOS') return;
  const t = normalizar(texto);
  // "Não pago nada" descreve o problema, mas não identifica quais obrigações.
  if (tipoPendenciasGenerico(pre.tipoPendencias)) {
    if (anterior.tipoPendencias && !tipoPendenciasGenerico(anterior.tipoPendencias)) {
      pre.tipoPendencias = anterior.tipoPendencias;
      if (anterior.evidenciasIa?.tipoPendencias) pre.evidenciasIa.tipoPendencias = anterior.evidenciasIa.tipoPendencias;
      else if (pre.evidenciasIa) delete pre.evidenciasIa.tipoPendencias;
    } else {
      delete pre.tipoPendencias;
      if (pre.evidenciasIa) delete pre.evidenciasIa.tipoPendencias;
    }
  }
  // Um comentário vago não substitui um período concreto previamente declarado.
  if (periodoImpreciso(pre.periodoPendencias) && anterior.periodoPendencias && !periodoImpreciso(anterior.periodoPendencias)
    && !/\b(?:corrigindo|correcao|errei|engano|desconsidere|na verdade)\b/.test(t)) {
    pre.periodoPendencias = anterior.periodoPendencias;
    if (anterior.evidenciasIa?.periodoPendencias) pre.evidenciasIa.periodoPendencias = anterior.evidenciasIa.periodoPendencias;
    else if (pre.evidenciasIa) delete pre.evidenciasIa.periodoPendencias;
  }
  if (/["“”]|^(?:se|caso|e se)\b|\b(?:disse|falou|perguntou)\s*:/.test(t)) return;
  // Uma declaração seguida de pedido de ajuda não vira hipótese por terminar em ?.
  // Só considerar a oração declarativa anterior à pergunta; perguntas puras não ativam.
  const relato = t.includes('?') ? t.split(/[,.;!?]/)[0] : t;
  if (t.includes('?') && (!/[,.;]/.test(t)
    || !/^(?:eu )?(?:nao (?:pago|paguei|pagamos|pagava|tenho pago)|deixei de pagar|parei de pagar|(?:a |minha )?empresa (?:esta|ficou|segue|continua)|tenho (?:dividas|pendencias|tudo atrasado))\b/.test(relato))) return;
  const negativa = /\b(?:nao (?:tenho|tem|temos|ha|existem)|sem|nenhuma?)\s+(?:mais\s+)?(?:dividas?|pendencias?|atrasos?)\b/g;
  const negacao = negativa.test(relato);
  const afirmacao = relato.replace(negativa, '');
  const pendencias = /\b(?:nao (?:pago|paguei|pagamos|pagava|tenho pago)|deixei de pagar|parei de pagar|sem pagar|pagamentos? atrasados?|impostos? atrasados?|guias? atrasadas?|obrigacoes? atrasadas?|dividas?|pendencias?)\b/.test(afirmacao)
    || /\b(?:empresa|ela)\s+(?:(?:esta|ficou|segue|continua)\s+)?(?:toda\s+)?atrasada\b|\b(?:esta |tenho |ficou )?tudo atrasado\b/.test(afirmacao);
  if (negacao && !pendencias) pre.investigacaoPendencias = false;
  else if (pendencias) pre.investigacaoPendencias = true;
  if (pendencias && !pre.necessidade) {
    pre.necessidade = texto;
    pre.evidenciasDeclaradas = { ...(pre.evidenciasDeclaradas || {}), necessidade: { valor: texto, trecho: texto, mensagemId } };
    if (pre.evidenciasIa) delete pre.evidenciasIa.necessidade;
  }
  if (!pre.investigacaoPendencias) return;
  // Evita perguntar novamente a situação que o próprio cliente acabou de relatar.
  if (!ia.dados.some(d => d.campo === 'situacaoOperacional')
    && /\b(?:empresa (?:esta|ficou|segue|continua) parada|esta parada|estamos parados|nao (?:estou|estamos) (?:operando|funcionando)|(?:empresa |ainda |continuo |continuamos )?(?:esta |estamos )?(?:funcionando|operando) (?:hoje|normalmente)|continuo (?:atendendo|vendendo))\b/.test(relato)) {
    const declaracao = t.includes('?') ? texto.split(/[,.;!?]/)[0] : texto;
    pre.situacaoOperacional = declaracao;
    pre.evidenciasDeclaradas = { ...(pre.evidenciasDeclaradas || {}), situacaoOperacional: { valor: declaracao, trecho: declaracao, mensagemId } };
    if (pre.evidenciasIa) delete pre.evidenciasIa.situacaoOperacional;
  }
}

export function dispensasInvestigacao(texto, esperado) {
  const t = normalizar(texto).trim();
  if (/\?|["“”]|^(?:se|caso|e se)\b|\b(?:disse|falou|perguntou)\s*:/.test(t)
    || !/\b(?:nao sei|nao lembro|prefiro nao|nao (?:quero|posso) informar)\b/.test(t)) return [];
  const campos = [];
  if (/\b(?:desde quando|periodo|ha quanto tempo|quando (?:parei|deixei|comecou))\b/.test(t)) campos.push('periodoPendencias');
  if (/\b(?:quais|qual|tipo|impostos?|guias?|obrigacoes?|tributos?)\b/.test(t)) campos.push('tipoPendencias');
  if (/\b(?:situacao|funciona|funcionando|operando|parada)\b/.test(t)) campos.push('situacaoOperacional');
  if (campos.length) return campos;
  if (CAMPOS_INVESTIGACAO.includes(esperado) && /^(?:(?:eu |ainda )?nao (?:sei|lembro)(?: dizer| informar)?(?: ainda| agora)?|prefiro nao(?: informar| falar(?: sobre isso)?)?|nao (?:quero|posso) informar)[.!]*$/.test(t)) return [esperado];
  return [];
}
