import { CnpjDaConversa } from "./ConversaVisual";

const INTENCOES = { ABERTURA: "Abrir empresa", TRANSFERENCIA: "Trocar de contador", INATIVA: "Regularizar empresa", PLANEJAMENTO: "Planejamento tributário", GESTAO: "Resultados e gestão" };
const CAMPOS_IA = { cnpj: "CNPJ", nome: "Nome", atividade: "Atividade", cidade: "Cidade", necessidade: "O que precisa", origemDeclarada: "Origem informada", urgencia: "Prazo", preferenciaContato: "Preferência de contato", estrutura: "Operação", faturamento: "Faturamento informado" };

export function ResumoPreatendimento({ atendimento, atendimentoHumano = false }) {
  const pre = atendimento?.triagem?.preatendimento;
  if (!pre || !INTENCOES[pre.intencao]) return null;
  const evidencias = { ...pre.evidenciasIa, ...pre.evidenciasDeclaradas };
  const dados = [
    ["Nome", pre.nome], ["Atividade", pre.atividade], ["Cidade", pre.cidade],
    ["O que precisa", pre.necessidade], ["Urgência informada", pre.urgencia],
    ["Preferência de contato", pre.preferenciaContato],
    ["Operação", pre.estrutura], ["Faturamento informado", pre.faturamento],
    ["CNPJ informado", pre.cnpj || pre.dadosInformados?.cnpj],
    ["Origem informada", pre.origemDeclarada], ["Palavra de entrada", pre.palavraEntrada],
  ].filter(([, valor]) => valor);
  return <section className="wa-pre-summary" aria-label="Resumo do pré-atendimento">
    <header><h3>{INTENCOES[pre.intencao]}</h3><span>{atendimento.encerradoEm ? "Solicitação anterior" : atendimentoHumano || pre.estado === "ENCAMINHADO" ? "Com a equipe" : "Conversa inicial"}</span></header>
    <p>Continue a conversa a partir do que a pessoa já contou. Confira os dados antes de preparar uma proposta.</p>
    {pre.ultimaInterpretacaoIa && <p>{pre.ultimaInterpretacaoIa.estado === 'APLICADA' ? 'Última mensagem interpretada com IA. Confira as informações abaixo.' : pre.ultimaInterpretacaoIa.estado === 'FALLBACK' ? 'A IA não conseguiu interpretar a última mensagem. O atendimento foi encaminhado à equipe; confira o relato recebido.' : 'A IA não participou da última resposta. O atendimento continuou pelo fluxo padrão.'}</p>}
    {Object.keys(evidencias).length > 0 && <details><summary>Trechos que sustentam o resumo</summary><ul>{Object.entries(evidencias).filter(([campo]) => CAMPOS_IA[campo]).map(([campo, evidencia]) => <li key={campo}><strong>{CAMPOS_IA[campo]}: </strong><q>{evidencia.trecho}</q>{pre.evidenciasDeclaradas?.[campo] ? ' — relato registrado diretamente da mensagem' : ''}{evidencia.valor === null ? ' — informação removida do resumo' : ''}</li>)}</ul></details>}
    {dados.length > 0 && <dl>{dados.map(([titulo, valor]) => <div key={titulo}><dt>{titulo}</dt><dd>{titulo === "CNPJ informado" ? <CnpjDaConversa cnpj={valor} empresa="empresa informada" /> : String(valor)}</dd></div>)}</dl>}
    <CadastroConsultado consulta={pre.consultaPublica} />
    {pre.ultimoRelato && <details><summary>Último relato recebido</summary><p>{pre.ultimoRelato}</p></details>}
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
