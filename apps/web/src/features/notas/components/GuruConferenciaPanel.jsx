import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Painel } from '../../../components/ui/Painel';
import { Modal } from '../../../components/ui/Modal';
import './guru-conferencia.css';

const estados = { PREPARADA: 'A conferir', CONFERIDA: 'Conferida internamente', CONFLITO: 'Origem alterada — conferir novamente' };
const erros = {
  guru_piloto_desabilitado: 'Conferência Guru indisponível. Solicite ao administrador a configuração e habilitação do piloto no servidor.',
  guru_empresa_fora_piloto: 'Esta empresa não está vinculada ao piloto Guru.',
  guru_desconectado: 'Conexão Guru pendente de credencial segregada e vínculo com a conta.',
  guru_importacao_ocupada: 'Outra importação está em andamento. Releia a lista após a conclusão.',
  guru_revisao_desatualizada: 'O registro mudou. Releia e confira a revisão atual.',
  guru_limite_requisicoes: 'Guru limitou as consultas. Aguarde antes de importar novamente.',
  guru_limite_importacao: 'Limite de importação atingido. Use um período menor; nenhum registro desta tentativa foi gravado.',
  guru_periodo_invalido: 'Informe datas válidas, em ordem, abrangendo até 180 dias.',
  guru_credencial_recusada: 'Guru recusou a credencial. A configuração precisa ser conferida no servidor.',
  guru_timeout: 'Guru não respondeu no prazo. Nenhum registro desta tentativa foi gravado.',
  guru_pagina_repetida: 'Guru repetiu registros ou páginas. Importação interrompida sem gravar registros.',
  guru_total_divergente: 'A quantidade recebida diverge do total da origem. Importação não gravada; confira e tente novamente.',
  guru_configuracao_alterada: 'A configuração mudou durante a importação. Releia a lista.',
  guru_nota_nao_encontrada: 'Nota não encontrada nesta empresa. Confira a identidade da nota salva.',
  guru_documento_fiscal_invalido: 'Esta nota não tem documento fiscal válido para vinculação.',
  guru_filtro_invalido: 'Confira o estado selecionado no filtro.',
  guru_identidade_empresa_divergente: 'O cadastro da empresa diverge do cadastro do portal. Confira os vínculos antes de continuar.',
  danfse_sem_qrcode: 'DANFSe indisponível: não foi possível gerar o QR Code obrigatório do documento salvo.',
  xml_indisponivel: 'O XML desta nota não está disponível.',
  xml_nao_e_nfse: 'O documento salvo não é uma NFS-e válida.',
  nota_nao_autorizada: 'O documento salvo é um pedido de emissão, não uma nota autorizada.',
};
const mensagem = e => erros[e?.code] || 'Não foi possível concluir. Releia os dados antes de tentar novamente.';
// O resumo serializa Decimal como texto (inclusive notação exponencial).
// Apenas deslocamos o separador: nenhum dígito financeiro passa por ponto flutuante.
function totalResumo(total) {
  if (total == null) return 'Não informado';
  // Compatibilidade com mocks antigos; não apresentar inteiro impreciso como exato.
  if (typeof total === 'number' && (!Number.isFinite(total) || Math.abs(total) > Number.MAX_SAFE_INTEGER)) return 'Valor inválido';
  if (typeof total !== 'string' && typeof total !== 'number') return 'Valor inválido';
  const partes = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(total));
  if (!partes) return 'Valor inválido';
  const [, sinal, inteiro, fracao = '', expoente = '0'] = partes;
  // O expoente é um índice, não o valor financeiro. Expoentes extremos permanecem
  // exatos em notação científica para não alocar milhões de zeros na interface.
  const deslocamento = parseInt(expoente, 10);
  if (Math.abs(deslocamento) > 10000) return `${sinal}${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${fracao ? `,${fracao}` : ''} × 10^${expoente}`;
  const digitos = inteiro + fracao;
  const posicao = inteiro.length + deslocamento;
  const unidades = (posicao <= 0 ? '0' : digitos.slice(0, posicao).padEnd(posicao, '0')).replace(/^0+(?=\d)/, '');
  const decimais = posicao <= 0 ? '0'.repeat(-posicao) + digitos : digitos.slice(posicao);
  return `${sinal}${unidades.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${decimais ? `,${decimais}` : ''}`;
}
const valor = dados => dados?.financeiro?.total == null ? (dados?.valorCentavos == null ? 'Não informado' : `${dados.moeda} ${(dados.valorCentavos / 100).toFixed(2)}`)
  : `${dados.financeiro.moeda || 'Moeda não informada'} ${dados.financeiro.total.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}`;

// Mesma allowlist dos contratos normalizados, sem exibir payload bruto da origem.
const camposDetalhe = [
  ['transacaoId', 'Transação'], ['statusOriginal', 'Estado original Guru'],
  ['datas.confirmed_at', 'Aprovação na origem (Unix, segundos)'],
  ['datas.updated_at', 'Atualização na origem (Unix, segundos)'],
  ['datas.ordered_at', 'Venda na origem (Unix, segundos)'],
  ['datas.cancelled_at', 'Cancelamento na origem (Unix, segundos)'],
  ['financeiro.total', 'Total financeiro'], ['financeiro.moeda', 'Moeda'],
  ['financeiro.bruto', 'Valor bruto'], ['financeiro.liquido', 'Valor líquido'],
  ['financeiro.parcelas.quantidade', 'Parcelas financeiras'],
  ['financeiro.parcelas.valor', 'Valor da parcela'], ['financeiro.parcelas.juros', 'Juros das parcelas'],
  ['produto.nome', 'Produto'], ['produto.idInterno', 'Identidade interna do produto'],
  ['produto.ofertaId', 'Identidade da oferta'],
  ['fatura.id', 'Identidade da fatura'], ['fatura.ciclo', 'Ciclo da fatura'],
  ['fatura.inicio', 'Início da fatura na origem'], ['fatura.fim', 'Fim da fatura na origem'],
  ['fatura.valor', 'Valor da fatura'], ['fatura.statusOriginal', 'Estado original da fatura'],
  ['assinatura.idInterno', 'Identidade interna da assinatura'], ['assinatura.id', 'Identidade da assinatura'],
  ['referenciaOrigem', 'Referência manual da origem'], ['valorCentavos', 'Valor manual em centavos'],
  ['moeda', 'Moeda manual'], ['situacaoPagamento', 'Situação de pagamento declarada'],
];
const campo = (dados, caminho) => caminho.split('.').reduce((v, chave) => v?.[chave], dados);
// Não arredondar a evidência: diferenças menores que um centavo também alteram o hash.
const evidencia = v => v == null ? 'Não informado' : String(v);
const origemNota = origem => ({ PortalInvoice: 'Nota capturada', ServiceInvoice: 'Registro de emissão' }[origem] || 'Origem não informada');
function dataOrigem(segundos) {
  if (segundos == null || !Number.isFinite(Number(segundos))) return 'Não informada';
  const data = new Date(Number(segundos) * 1000);
  return Number.isNaN(data.getTime()) ? 'Data inválida' : data.toLocaleString('pt-BR', { timeZone: 'UTC' });
}

function DadosGuru({ dados }) {
  return <><dl className="guru-conferencia__dados">
    <div><dt>Produto</dt><dd>{dados.produto?.nome || 'Não informado'}</dd></div>
    <div><dt>Valor financeiro (não base fiscal)</dt><dd className="guru-conferencia__dinheiro">{valor(dados)}</dd></div>
    <div><dt>Estado da venda</dt><dd>{dados.statusOriginal || dados.situacaoPagamento || 'Não informado'}</dd></div>
    <div><dt>Estado da cobrança</dt><dd>{dados.fatura?.statusOriginal || 'Não informado'}</dd></div>
    {['ordered_at', 'confirmed_at', 'cancelled_at'].filter(c => dados.datas?.[c] != null).map(c => <div key={c}>
      <dt>{{ ordered_at: 'Venda na origem (UTC)', confirmed_at: 'Aprovação na origem (UTC)', cancelled_at: 'Cancelamento na origem (UTC)' }[c]}</dt>
      <dd>{dataOrigem(dados.datas[c])}</dd></div>)}
  </dl><details><summary>Dados técnicos da origem</summary><dl className="guru-conferencia__dados">
    {camposDetalhe.filter(([caminho]) => campo(dados, caminho) !== undefined
      && !['produto.nome', 'statusOriginal', 'situacaoPagamento', 'fatura.statusOriginal'].includes(caminho)).map(([caminho, rotulo]) =>
      <div key={caminho}><dt>{rotulo}</dt><dd>{evidencia(campo(dados, caminho))}</dd></div>)}
  </dl></details></>;
}

function DiferencasGuru({ anterior, novo }) {
  const alterados = camposDetalhe.filter(([caminho]) => campo(anterior, caminho) !== campo(novo, caminho));
  return <section aria-label="Campos alterados na origem">
    <p>{alterados.length} {alterados.length === 1 ? 'campo alterado' : 'campos alterados'}. Valores financeiros não são base fiscal; datas da origem não são competência fiscal.</p>
    <dl className="guru-conferencia__dados">{alterados.map(([caminho, rotulo]) =>
      <div key={caminho}><dt>{rotulo}</dt>
        <dd>Anterior: {evidencia(campo(anterior, caminho))}</dd>
        <dd>Novo: {evidencia(campo(novo, caminho))}</dd>
      </div>)}</dl>
  </section>;
}

// A key do consumidor reinicia o contexto de empresa/competência. O wrapper
// também protege consumidores isolados que troquem companyId sem remontar.
export function GuruConferenciaPanel(props) {
  return <GuruConferenciaTrabalho key={props.companyId} {...props} />;
}
function GuruConferenciaTrabalho({ api, companyId }) {
  const [lista, setLista] = useState(null), [item, setItem] = useState(null);
  const [pagina, setPagina] = useState(1), [erro, setErro] = useState(''), [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [periodo, setPeriodo] = useState({ campo: 'confirmed_at', inicio: '', fim: '' });
  const [filtros, setFiltros] = useState({}), [rascunho, setRascunho] = useState({ campo: 'confirmed_at', inicio: '', fim: '', estado: '' });
  const [notaId, setNotaId] = useState(''), [candidata, setCandidata] = useState(null);
  const [notasEncontradas, setNotasEncontradas] = useState(null);
  const sequencia = useRef(0), detalhe = useRef(null), trava = useRef(null);
  useEffect(() => {
    setLista(null); setItem(null); setPagina(1); setCandidata(null); setNotaId(''); setNotasEncontradas(null); setErro(''); setAviso('');
    carregar(1);
    return () => { sequencia.current += 1; trava.current = null; };
  }, [api, companyId, filtros]);

  async function executar(acao) {
    if (trava.current) return;
    const seq = ++sequencia.current;
    trava.current = seq;
    setOcupado(true); setErro(''); setAviso('');
    try { await acao(() => seq === sequencia.current); }
    catch (e) { if (seq === sequencia.current) setErro(mensagem(e)); }
    finally { if (seq === sequencia.current && trava.current === seq) { setOcupado(false); trava.current = null; } }
  }
  async function ler(p) {
    const r = await api.listarGuruConferencia(companyId, p, filtros);
    if (!r || !Array.isArray(r.items) || !Number.isSafeInteger(r.total) || r.total < 0
      || !['DESCONECTADA', 'CONFIGURADA_NAO_VERIFICADA'].includes(r.conexao)) throw Error('resposta_invalida');
    return r;
  }
  function carregar(p = pagina) {
    return executar(async atual => {
      const r = await ler(p);
      if (atual()) { setLista(r); setPagina(p); setItem(null); }
    });
  }
  function abrir(id) {
    executar(async atual => {
      const r = await api.obterGuruConferencia(companyId, id);
      if (!r?.item?.hash || r.item.id !== id) throw Error('resposta_invalida');
      if (atual()) { setItem(r.item); setCandidata(null); setNotaId(''); setNotasEncontradas(null); requestAnimationFrame(() => { if (atual()) detalhe.current?.focus(); }); }
    });
  }
  function importar(e) {
    e.preventDefault();
    executar(async atual => {
      const r = await api.importarGuruConferencia(companyId, periodo);
      if (r?.estado !== 'CONCLUIDA') throw Error('persistencia_nao_confirmada');
      if (!atual()) return;
      setItem(null);
      setAviso(`Importação persistida: ${r.criadas} novas, ${r.repetidas} idênticas, ${r.conflitos} com conflito. ${r.lidas} transações lidas na origem.`);
      const nova = await ler(1);
      if (atual()) { setLista(nova); setPagina(1); }
    });
  }
  function conferir() {
    executar(async atual => {
      const r = await api.conferirGuruConferencia(companyId, item.id, {
        versao: item.versao, hash: item.conflito?.hash || item.hash, confirmada: true,
      });
      if (r?.item?.estado !== 'CONFERIDA' || r.item.id !== item.id) throw Error('persistencia_nao_confirmada');
      if (!atual()) return;
      setItem(r.item); setAviso('Conferência interna persistida. Emissão permanece bloqueada.');
      const nova = await ler(pagina);
      if (atual()) setLista(nova);
    });
  }
  function procurarNota(e, paginaNotas = 1) {
    e?.preventDefault();
    executar(async atual => {
      const r = await api.buscarNotasGuru(companyId, notaId.trim(), paginaNotas);
      if (!Array.isArray(r?.items) || !Number.isSafeInteger(r.total) || r.total < 0) throw Error('resposta_invalida');
      if (atual()) setNotasEncontradas(r);
    });
  }
  function escolherNota(nota) {
    executar(async atual => {
      const r = await api.obterNotaGuru(companyId, nota.id);
      if (!r?.nota?.hash || r.nota.id !== nota.id) throw Error('resposta_invalida');
      if (atual()) setCandidata(r.nota);
    });
  }
  function vincularNota() {
    executar(async atual => {
      const r = await api.vincularNotaGuru(companyId, item.id, { versao: item.versao, hash: item.hash,
        notaId: candidata.id, notaHash: candidata.hash, confirmada: true });
      if (r?.item?.id !== item.id || !r.item.notas?.some(n => n.id === candidata.id && n.conferencia === 'CONFERIDA')) throw Error('persistencia_nao_confirmada');
      if (!atual()) return;
      setItem(r.item); setCandidata(null); setNotaId(''); setAviso('Vínculo conferido e persistido. Nenhuma nota foi emitida.');
      const nova = await ler(pagina);
      if (atual()) setLista(nova);
    });
  }
  function baixar(nota, formato) {
    executar(async atual => {
      const blob = await api.baixarNotaGuru(companyId, item.id, nota.id, formato);
      if (!(blob instanceof Blob) || !blob.size) throw Error('documento_indisponivel');
      if (!atual()) return;
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `nota-${nota.numero || nota.id}.${formato === 'xml' ? 'xml' : 'pdf'}`;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  return <Painel titulo="Guru em conferência" className="guru-conferencia" aria-busy={ocupado}
    acoes={<Button variant="secondary" disabled={ocupado} onClick={() => carregar()}>Reler dados salvos</Button>}>
    <p>Somente conferência. Emissão bloqueada; eNotas não é alterado por esta conferência. Benefício municipal pendente de vigência.</p>
    {erro && <p role="alert" className="guru-conferencia__erro">{erro}{lista && ' A lista mantém a última leitura confirmada.'}</p>}
    {aviso && <p role="status">{aviso}</p>}
    {ocupado && <p role="status">Processando…</p>}
    {lista?.demonstracao && <p>Demonstração — conexão e gravação Guru indisponíveis.</p>}
    {lista?.conexao === 'DESCONECTADA' && <p>Conexão pendente de credencial e vínculo da conta no servidor. Os registros salvos continuam disponíveis.</p>}
    {lista?.ocupada && <p role="status">Importação em andamento. Releia após a conclusão.</p>}
    {lista?.ultimaImportacao && <details><summary>Última importação: {lista.ultimaImportacao.estado}</summary>
      <p>{lista.ultimaImportacao.periodo.inicio} a {lista.ultimaImportacao.periodo.fim} · {lista.ultimaImportacao.lidas ?? '—'} lidas</p>
      {lista.ultimaImportacao.erro && <p>{erros[lista.ultimaImportacao.erro] || 'Importação não concluída. Nenhum registro desta tentativa foi gravado.'}</p>}
    </details>}
    <details><summary>Importar vendas da origem</summary><form onSubmit={importar} className="guru-conferencia__filtros">
      <label>Período da origem<select value={periodo.campo} disabled={ocupado} onChange={e => setPeriodo({ ...periodo, campo: e.target.value })}>
        <option value="confirmed_at">Aprovação</option><option value="ordered_at">Venda</option><option value="cancelled_at">Cancelamento</option>
      </select></label>
      <label>Início<input type="date" required value={periodo.inicio} disabled={ocupado} onChange={e => setPeriodo({ ...periodo, inicio: e.target.value })} /></label>
      <label>Fim<input type="date" required value={periodo.fim} disabled={ocupado} onChange={e => setPeriodo({ ...periodo, fim: e.target.value })} /></label>
      <Button type="submit" disabled={ocupado || !lista || lista.conexao === 'DESCONECTADA' || lista.ocupada}>Importar para conferência</Button>
    </form>
    <p className="guru-conferencia__auxiliar">Até 180 dias por consulta. O período de importação não é competência fiscal.</p></details>
    <form aria-label="Filtrar vendas salvas" className="guru-conferencia__filtros" onSubmit={e => {
      e.preventDefault(); setFiltros({ ...(rascunho.inicio || rascunho.fim ? { campo: rascunho.campo, inicio: rascunho.inicio, fim: rascunho.fim } : {}), ...(rascunho.estado ? { estado: rascunho.estado } : {}) });
    }}>
      <label>Data da origem (UTC)<select value={rascunho.campo} onChange={e => setRascunho({ ...rascunho, campo: e.target.value })}>
        <option value="confirmed_at">Aprovação</option><option value="ordered_at">Venda</option><option value="cancelled_at">Cancelamento</option>
      </select></label>
      <label>Filtrar desde<input type="date" value={rascunho.inicio} onChange={e => setRascunho({ ...rascunho, inicio: e.target.value })} /></label>
      <label>Filtrar até<input type="date" value={rascunho.fim} onChange={e => setRascunho({ ...rascunho, fim: e.target.value })} /></label>
      <label>Conferência interna<select value={rascunho.estado} onChange={e => setRascunho({ ...rascunho, estado: e.target.value })}>
        <option value="">Todas</option>{Object.entries(estados).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select></label>
      <Button type="submit" variant="secondary">Filtrar registros salvos</Button>
    </form>
    <p className="guru-conferencia__auxiliar">{filtros.inicio ? `${filtros.inicio} a ${filtros.fim} · ${filtros.campo} (UTC)` : 'Todo o período salvo'} · {estados[filtros.estado] || 'Todas as conferências'}. Não é competência fiscal.</p>
    {lista && !lista.resumo && <p>Resumo do conjunto indisponível nesta resposta.</p>}
    {lista?.resumo && <section aria-label="Totais do conjunto filtrado" className="guru-conferencia__resumo">
      <p><strong>{lista.resumo.vendas}</strong> vendas · <strong>{lista.resumo.notasVinculadas}</strong> notas vinculadas distintas</p>
      <p>{lista.resumo.vendasSemVinculo} vendas sem documento vinculado — situação fiscal não verificada.</p>
      {lista.resumo.moedas.map(m => <p key={m.moeda}>{m.moeda}: {totalResumo(m.total)} · {m.informados} valores informados{m.ausentes ? ` · ${m.ausentes} ausentes` : ''}</p>)}
      {!!(lista.resumo.valoresAusentes || lista.resumo.moedasAusentes) && <p>{lista.resumo.valoresAusentes} valores ausentes · {lista.resumo.moedasAusentes} moedas ausentes. Totais parciais.</p>}
    </section>}
    {lista && <><p>{lista.total} registros salvos</p>
      {lista.total === 0 ? <p>Nenhum registro salvo neste filtro para esta empresa e conta.</p> : <div className="guru-conferencia__tabela" role="region" tabIndex={0} aria-label="Vendas Guru">
        <table className="tabela--densa"><thead><tr><th>Venda / produto</th><th>Valor financeiro</th><th>Estado Guru / cobrança</th><th>Conferência interna</th><th>Notas salvas</th><th>Detalhe</th></tr></thead>
        <tbody>{lista.items.map(r => <tr key={r.id}>
          <td>{r.dados.produto?.nome || r.dados.transacaoId}</td><td>{valor(r.dados)}</td>
          <td>{r.dados.statusOriginal || r.dados.situacaoPagamento || 'Não informado'} / {r.dados.fatura?.statusOriginal || 'Não informado'}</td>
          <td>{estados[r.estado] || 'Estado a verificar'}</td><td>{r.notas?.length ? `${r.notas.length} vinculadas${r.notas.some(n => n.conferencia !== 'CONFERIDA') ? ' · Reconferir' : ''}` : 'Não verificada'}</td>
          <td><Button variant="secondary" disabled={ocupado} onClick={() => abrir(r.id)} aria-label={`Conferir transação ${r.dados.transacaoId}`}>Ver registro</Button></td>
        </tr>)}</tbody></table></div>}
      <nav aria-label="Páginas dos registros Guru" className="guru-conferencia__acoes">
        <Button variant="secondary" disabled={ocupado || pagina <= 1} onClick={() => carregar(pagina - 1)}>Anterior</Button>
        <span>Página {pagina}</span><Button variant="secondary" disabled={ocupado || pagina * 20 >= lista.total} onClick={() => carregar(pagina + 1)}>Próxima</Button>
      </nav></>}
    {item && <section ref={detalhe} tabIndex={-1} aria-label="Detalhe da transação Guru" className="guru-conferencia__detalhe">
      <h3>{estados[item.estado]}</h3><DadosGuru dados={item.dados} />
      <p>Situação fiscal externa: NÃO VERIFICADA. Conferência interna não comprova emissão, pagamento ou baixa.</p>
      {item.conflito && <><h3>Nova evidência da origem</h3><p>A evidência acima foi preservada. Confira as diferenças antes de aceitar esta revisão.</p><DiferencasGuru anterior={item.dados} novo={item.conflito.dados} /></>}
      {item.estado !== 'CONFERIDA' && <Button disabled={ocupado} onClick={conferir}>{item.conflito ? 'Conferir e aceitar nova revisão' : 'Confirmar conferência interna'}</Button>}
      <h3>Notas vinculadas</h3>
      <p>Estado da nota salva, sem nova consulta ao autorizador. O estado da cobrança Guru não confirma emissão.</p>
      {!item.notas?.length ? <p>Sem documento fiscal vinculado. Isso não comprova ausência de emissão externa.</p> : <div className="guru-conferencia__tabela" role="region" tabIndex={0} aria-label="Notas vinculadas">
        <table className="tabela--densa"><thead><tr><th>Número</th><th>Valor</th><th>Estado salvo</th><th>Origem / conferência</th><th>Documentos</th></tr></thead>
        <tbody>{item.notas.map(n => <tr key={n.id}><td>{n.numero || 'Indisponível'}</td><td>{n.valor == null ? 'Não informado' : `${n.moeda} ${n.valor}`}</td>
          <td>{n.estado || 'Indisponível'} · {n.conferencia === 'CONFERIDA' ? 'Vínculo conferido' : 'Reconferir'}</td><td>{origemNota(n.origem)} · Manual · {n.conferidaEm}</td>
          <td>{['danfse', 'xml'].map(f => n.documentos?.[f] ? <Button key={f} variant="secondary" disabled={ocupado} onClick={() => baixar(n, f)}>{f === 'xml' ? 'XML' : 'DANFSe'}</Button> : <span key={f}>{f === 'xml' ? 'XML' : 'DANFSe'} indisponível </span>)}</td></tr>)}</tbody></table></div>}
      <form className="guru-conferencia__filtros" onSubmit={procurarNota}>
        <label>Número ou tomador da nota<input maxLength={120} value={notaId} disabled={ocupado} onChange={e => { setNotaId(e.target.value); setCandidata(null); setNotasEncontradas(null); }} /></label>
        <Button type="submit" variant="secondary" disabled={ocupado || item.estado === 'CONFLITO'}>Buscar notas salvas</Button>
      </form>
      <p className="guru-conferencia__auxiliar">Busca somente nesta empresa, sem consulta ao provedor. A associação é manual; comprador não informado pelo Guru não é inferido.</p>
      {notasEncontradas && <section aria-label="Notas encontradas">
        <p>{notasEncontradas.total} registros fiscais encontrados · página {notasEncontradas.pagina}</p>
        {!notasEncontradas.total && <p>Nenhuma nota salva corresponde à busca. A emissão externa continua não verificada.</p>}
        <ul className="guru-conferencia__lista">{notasEncontradas.items.map(n => <li key={n.id}>
          <span>Nota {n.numero || 'sem número'} · {n.tomadorNome || n.tomador || 'Tomador não informado'} · {n.valor == null ? 'Valor não informado' : `${n.moeda} ${n.valor}`} · {n.estado} · {origemNota(n.origem)}</span>{' '}
          <Button variant="secondary" disabled={ocupado} onClick={() => escolherNota(n)}>Conferir nota {n.numero || 'sem número'}</Button>
        </li>)}</ul>
        <div className="guru-conferencia__acoes">
          <Button variant="secondary" disabled={ocupado || notasEncontradas.pagina <= 1} onClick={() => procurarNota(null, notasEncontradas.pagina - 1)}>Notas anteriores</Button>
          <Button variant="secondary" disabled={ocupado || notasEncontradas.pagina * 20 >= notasEncontradas.total} onClick={() => procurarNota(null, notasEncontradas.pagina + 1)}>Próximas notas</Button>
        </div>
      </section>}
      <details><summary>Origem e histórico</summary><p>{item.origem} · revisão {item.versao}</p>
        <ul>{item.historico.map((h, i) => <li key={i}>{h.evento} · {h.instante} · {h.atorId}</li>)}</ul>
      </details>
    </section>}
    {candidata && <Modal titulo="Confirmar vínculo da nota existente" tamanho="sm" ocupado={ocupado} aoFechar={() => setCandidata(null)}
      rodape={<><Button variant="secondary" disabled={ocupado} onClick={() => setCandidata(null)}>Voltar</Button><Button disabled={ocupado || !candidata.vinculavel} onClick={vincularNota}>Confirmar vínculo fiscal</Button></>}>
      <p>Venda {item.dados.transacaoId} · nota {candidata.numero || candidata.id} · {candidata.valor == null ? 'Valor não informado' : `${candidata.moeda} ${candidata.valor}`} · estado salvo {candidata.estado}.</p>
      <dl className="guru-conferencia__dados">
        <div><dt>Prestador no XML</dt><dd>{candidata.prestador || 'Não informado'}</dd></div>
        <div><dt>Tomador no XML</dt><dd>{candidata.tomador || 'Não informado'} · {candidata.tomadorNome || 'Nome não informado'}</dd></div>
        <div><dt>Competência da nota</dt><dd>{candidata.competencia || 'Não informada'}</dd></div>
        <div><dt>Ambiente do documento</dt><dd>{candidata.ambiente || 'Não verificado'}</dd></div>
        <div><dt>Chave fiscal / origem</dt><dd>{candidata.identidadeFiscal || 'Não informada'} · {origemNota(candidata.origem)}</dd></div>
      </dl>
      {candidata.ciclo?.avisos?.map(a => <p key={a.codigo}>{a.texto}</p>)}
      <p>Esta confirmação registra somente a associação manual com a nota salva. Não emite, altera a nota ou consulta sua situação atual no autorizador.</p>
      {!candidata.vinculavel && <p role="alert">Vinculação bloqueada: exige XML de NFS-e nacional em produção, coerente com empresa, tomador, competência e valor salvos, sem cancelamento ou substituição pendente de conferência.</p>}
      {erro && <p role="alert">{erro}</p>}
    </Modal>}
  </Painel>;
}
