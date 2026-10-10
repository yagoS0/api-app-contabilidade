import { CnpjDaConversa } from "./ConversaVisual";

const INTENCOES = { ABERTURA: "Abrir empresa", TRANSFERENCIA: "Trocar de contador", INATIVA: "Regularizar empresa", PLANEJAMENTO: "Planejamento tributário", GESTAO: "Resultados e gestão" };
const CAMPOS_IA = { cnpj: "CNPJ", nome: "Nome", atividade: "Atividade", cidade: "Cidade", necessidade: "O que precisa", origemDeclarada: "Origem informada", urgencia: "Prazo", preferenciaContato: "Preferência de contato", estrutura: "Operação", faturamento: "Faturamento informado", periodoPendencias: "Período das pendências", tipoPendencias: "Pendências relatadas", situacaoOperacional: "Situação relatada" };

export function ResumoPreatendimento({ atendimento, atendimentoHumano = false }) {
  const pre = atendimento?.triagem?.preatendimento;
  if (!pre || !INTENCOES[pre.intencao]) return null;
  const evidencias = { ...pre.evidenciasIa, ...pre.evidenciasDeclaradas };
  const relatos = Array.isArray(pre.relatosCliente) ? pre.relatosCliente.filter(r => typeof r?.texto === 'string' && r.texto.trim()) : [];
  const cnpj = pre.aguardandoConfirmacaoCnpj ? null : pre.cnpj || pre.dadosInformados?.cnpj;
  const dados = [
    ["Nome", pre.nome], ["Atividade", pre.atividade, 'atividade'], ["Cidade", pre.cidade, 'cidade'],
    ["O que precisa", pre.necessidade], ["Urgência informada", pre.urgencia],
    ["Situação relatada", pre.situacaoOperacional], ["Período das pendências", pre.periodoPendencias], ["Pendências relatadas", pre.tipoPendencias],
    ["Preferência de contato", pre.preferenciaContato],
    ["Operação", pre.estrutura], ["Faturamento informado", pre.faturamento],
    ["CNPJ informado", cnpj],
    ["Origem informada", pre.origemDeclarada], ["Palavra de entrada", pre.palavraEntrada],
  ].filter(([, valor]) => valor);
  return <section className="wa-pre-summary" aria-label="Resumo do pré-atendimento">
    <header><h3>{INTENCOES[pre.intencao]}</h3><span>{atendimento.encerradoEm ? "Solicitação anterior" : atendimentoHumano || pre.estado === "ENCAMINHADO" ? "Com a equipe" : "Conversa inicial"}</span></header>
    {pre.autorizacaoFiscal?.estado === 'AGUARDANDO_AUTORIZACAO' && <p role="status">Autorização solicitada. O contador acompanha o aceite na Receita e a consulta fiscal.</p>}
    {pre.autorizacaoFiscal?.estado === 'REVISAO_NECESSARIA' && <p role="status">A equipe precisa conferir a orientação de autorização.</p>}
    {pre.ultimaInterpretacaoIa?.estado === 'FALLBACK' && <p>A IA não conseguiu interpretar a última mensagem. O atendimento foi encaminhado à equipe; confira o relato recebido.</p>}
    {Object.keys(evidencias).length > 0 && <details><summary>Trechos que sustentam o resumo</summary><ul>{Object.entries(evidencias).filter(([campo]) => CAMPOS_IA[campo]).map(([campo, evidencia]) => <li key={campo}><strong>{CAMPOS_IA[campo]}: </strong><q>{evidencia.trecho}</q>{pre.evidenciasDeclaradas?.[campo] ? ' — relato registrado diretamente da mensagem' : ''}{evidencia.valor === null ? ' — informação removida do resumo' : ''}</li>)}</ul></details>}
    {dados.length > 0 && <dl>{dados.map(([titulo, valor, campo]) => <div key={titulo}><dt>{titulo}{campo && pre.fontesPublicas?.[campo]?.valor === valor ? ' · cadastro público' : ''}</dt><dd>{titulo === "CNPJ informado" ? <CnpjDaConversa cnpj={valor} empresa="empresa informada" /> : String(valor)}</dd></div>)}</dl>}
    {pre.aguardandoConfirmacaoCnpj && <p>CNPJ não confirmado.</p>}
    <CadastroConsultado consulta={pre.consultaPublica} />
    {relatos.length > 0 ? <details><summary>Relatos do cliente ({relatos.length})</summary><ol>{relatos.map((relato, i) => <li key={relato.mensagemId || i}><p style={{whiteSpace:'pre-wrap'}}>{relato.texto}</p></li>)}</ol></details>
      : pre.ultimoRelato && <details><summary>Último relato recebido</summary><p>{pre.ultimoRelato}</p></details>}
    {pre.dispensados?.length > 0 && <p>Não informado: {pre.dispensados.map(k => CAMPOS_IA[k]).filter(Boolean).join(', ')}.</p>}
    {atendimento.triagem.proximaSolicitacao && <p><strong>Outro pedido na conversa:</strong> {atendimento.triagem.proximaSolicitacao.relato || INTENCOES[atendimento.triagem.proximaSolicitacao.intencao]}</p>}
    {!atendimento.onboardingId && <p>Este pedido segue com a equipe pelo chat. Uma ficha de abertura ou transferência só é necessária se esse serviço também for solicitado.</p>}
  </section>;
}

function CadastroConsultado({ consulta }) {
  if (!consulta) return null;
  if (consulta.estado !== 'CONCLUIDA') return <p>Consulta pública indisponível. O atendimento continua com os dados informados.</p>;
  const d = consulta.dados || {};
  const simNao = v => typeof v === 'boolean' ? v ? 'Sim' : 'Não' : null;
  const dados = [
    ['Razão social', d.razaoSocial], ['Nome fantasia', d.nomeFantasia], ['Situação cadastral', d.situacaoCadastral],
    ['Data da situação', d.dataSituacao], ['Motivo cadastral', d.motivoSituacao], ['Data de abertura', d.dataAbertura],
    ['Natureza jurídica', d.naturezaJuridica], ['Porte', d.porte], ['CNAE principal', [d.cnaePrincipal,d.atividadePrincipal].filter(Boolean).join(' — ')],
    ['Endereço cadastral', d.endereco], ['Município/UF', [d.municipio,d.uf].filter(Boolean).join('/')],
    ['Telefone cadastral', d.telefone], ['E-mail cadastral', d.email],
    ['Capital social', d.capitalSocial == null ? null : new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(d.capitalSocial)],
    ['Opção pelo Simples', simNao(d.opcaoSimples)], ['Opção pelo MEI', simNao(d.opcaoMei)],
  ].filter(([,v])=>v != null && v !== '');
  return <details><summary>Cadastro consultado</summary>
    <p>{d.fonte} · {new Date(d.consultadoEm).toLocaleString('pt-BR')} · Dados cadastrais, sem diagnóstico fiscal.</p>
    <dl>{dados.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
    {d.cnaesSecundarios?.length > 0 && <><h4>Atividades secundárias</h4><ul>{d.cnaesSecundarios.map((c,i)=><li key={i}>{[c.codigo,c.descricao].filter(Boolean).join(' — ')}</li>)}</ul></>}
    {d.socios?.length > 0 && <><h4>Quadro societário</h4><ul>{d.socios.map((s,i)=><li key={i}>{[s.nome,s.qualificacao,s.entrada].filter(Boolean).join(' — ')}</li>)}</ul></>}
  </details>;
}
