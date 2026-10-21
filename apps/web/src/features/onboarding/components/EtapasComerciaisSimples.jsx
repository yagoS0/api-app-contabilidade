import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { CamposDaEtapa, MensagemDoPasso, OrientacaoDoPasso } from './PassosDoLead';
import { camposDaOrigem } from '../lib/onboardingSpec';
import { rotuloDadoComercial, textoComercial } from './FluxoComercial.shared.js';

export function ProcuracaoSimples({ api, recursos, estado, conversaId, ocupado, acao, carregar, trabalho }) {
  const ficha = estado.onboarding;
  const manual = [ficha.dados?.procuracaoManual, estado.atendimento?.autorizacao?.validacaoManual].find(v =>
    v?.cnpj === ficha.cnpj && v?.atorId && v?.registradaEm && Number(v.cadastroRevisao || 0) === Number(ficha.dados?.cadastroRevisao || 0));
  const consultando = ['PENDENTE', 'PROCESSANDO', 'AGUARDANDO'].includes(trabalho?.status);
  return <section aria-label="Procuração">
    <OrientacaoDoPasso api={api} recursos={recursos} chaves={['autorizacao-acesso', 'autorizacao']} onboarding={estado.onboarding} conversaId={conversaId} onEnviado={carregar} disabled={ocupado} />
    {manual && <p role="status">Validação manual registrada{manual.atorId ? ` por ${manual.atorId}` : ''}{manual.registradaEm ? ` em ${new Date(manual.registradaEm).toLocaleString('pt-BR')}` : ''}. Não é verificação SERPRO.</p>}
    {trabalho && <p role="status">{trabalho.resultado?.mensagem || (consultando ? 'Consultando procuração…' : 'Confira o resultado da consulta.')}</p>}
    {estado.configuracao?.consultasFiscais === false && <p role="status">Consulta SERPRO indisponível nesta instalação.</p>}
    <div className="lead-form-actions">
      <Button disabled={ocupado || consultando || estado.configuracao?.consultasFiscais === false} onClick={() => acao('/consultas', { tipo: 'PROCURACAO', versao: estado.onboarding.versao, autorizada: true })}>Consultar procuração</Button>
      <Button variant="secondary" disabled={ocupado || consultando} onClick={() => acao('/procuracao/manual', { versao: estado.onboarding.versao, confirmada: true })}>Validado por mim</Button>
    </div>
  </section>;
}

export function SituacaoFiscalSimples({ estado, ocupado, acao, trabalho }) {
  const [manual, setManual] = useState(false), [texto, setTexto] = useState('');
  const [falhou, setFalhou] = useState(false);
  const consultando = ['PENDENTE', 'PROCESSANDO', 'AGUARDANDO'].includes(trabalho?.status);
  const indisponivel = estado.configuracao?.consultasFiscais === false;
  return <section aria-label="Consulta de situação fiscal">
    <Button disabled={ocupado || consultando || indisponivel} onClick={async () => { const ok = await acao('/consultas', { tipo: 'SITFIS', versao: estado.onboarding.versao, autorizada: true }); setFalhou(ok === false); }}>{consultando ? 'Consultando…' : 'Consultar situação fiscal'}</Button>
    {trabalho && <p role="status">{trabalho.resultado?.mensagem || trabalho.status}</p>}
    {indisponivel && <p role="status">Consulta SERPRO indisponível nesta instalação.</p>}
    <p className="onboarding-help">Uma consulta concluída não significa que a empresa está regular.</p>
    {estado.jornada?.fiscalAlternativa?.dados && <p role="status">{estado.jornada.fiscalAlternativa.dados.modo === 'MANUAL' ? 'Situação informada pelo contador.' : 'Consulta não realizada.'} {estado.jornada.fiscalAlternativa.dados.informacao || estado.jornada.fiscalAlternativa.dados.limitacao}</p>}
    {(falhou || indisponivel || ['ERRO', 'FALHOU', 'BLOQUEADO', 'RECUSADO'].includes(trabalho?.status)) && <>
      <div className="lead-form-actions"><Button variant="secondary" disabled={ocupado} onClick={() => setManual(true)}>Registrar situação manualmente</Button><Button variant="secondary" disabled={ocupado} onClick={() => acao('/jornada/fiscal-alternativa', { versao: estado.onboarding.versao, modo: 'PULADA' })}>Pular esta etapa</Button></div>
      {manual && <><label>Situação fiscal informada<textarea rows={4} value={texto} onChange={e => setTexto(e.target.value)} /></label><Button disabled={ocupado || !texto.trim()} onClick={() => acao('/jornada/fiscal-alternativa', { versao: estado.onboarding.versao, modo: 'MANUAL', informacao: texto })}>Salvar e prosseguir</Button></>}
    </>}
  </section>;
}

export function FichaDocumentosSimples({ api, estado, conversaId, ocupado, acao, executar, formulario }) {
  const o = estado.onboarding;
  const campos = camposDaOrigem(o.origem).map(c => c.campo);
  const internos = new Set(['cadastroCnpj', 'cadastroRevisao', 'derivadosCadastro', 'procuracaoManual']);
  return <section aria-label="Ficha e documentos">
    <h4>Ficha complementar</h4>{formulario}
    <CamposDaEtapa sempreAberto onboarding={o} campos={campos} ocupado={ocupado} onSalvar={b => acao('/campos', b)} />
    <details className="lead-support" aria-label="Dados capturados"><summary>Consultar dados recebidos</summary>
      <dl>{Object.entries(o.dados || {}).filter(([k]) => !internos.has(k)).map(([k, v]) => {
        const descritor = camposDaOrigem(o.origem).find(c => c.campo === k);
        return <div key={k}><dt>{descritor?.rotulo || rotuloDadoComercial(k)}</dt><dd><DadoRecebido valor={v} descritor={descritor} /></dd></div>;
      })}</dl>
    </details>
    <h4>Documentos</h4>
    <DocumentosDoChat key={o.id} api={api} onboarding={o} ocupado={ocupado} acao={acao} />
    <MensagemDoPasso api={api} conversaId={conversaId} disabled={ocupado} rotulo="Pedir documentos ao cliente" preparar={async () => ({ texto: 'Por favor, envie nesta conversa os documentos necessários para completar sua ficha. A equipe conferirá os arquivos recebidos.' })} />
    <label>Adicionar documento recebido por fora (PDF, até 5 MB)<input type="file" accept="application/pdf" disabled={ocupado} onChange={e => { const arquivo = e.target.files?.[0]; if (arquivo) executar(() => api.documentoComercial(o.id, arquivo)); }} /></label>
    {!estado.documentos?.length && <p>Nenhum documento vinculado.</p>}
    <ul className="lead-document-list">{(estado.documentos || []).map(d => <li key={d.id}><span>{d.nome}<small>{d.origem || 'Origem não informada'}</small></span><Button variant="secondary" disabled={ocupado} onClick={() => executar(async () => abrirDocumento(await api.baixarDocumentoComercial(o.id, d.id), d.nome))}>Abrir</Button></li>)}</ul>
  </section>;
}

function DadoRecebido({ valor, descritor }) {
  if (Array.isArray(valor)) return valor.length ? <ul>{valor.map((v, i) => <li key={i}><DadoRecebido valor={v} /></li>)}</ul> : 'Nenhum item informado';
  if (valor && typeof valor === 'object') return <dl>{Object.entries(valor).map(([k, v]) => <div key={k}><dt>{rotuloDadoComercial(k)}</dt><dd><DadoRecebido valor={v} /></dd></div>)}</dl>;
  return descritor?.opcoes?.find(o => o.valor === valor)?.rotulo || textoComercial(valor);
}

function DocumentosDoChat({ api, onboarding, ocupado, acao }) {
  const [arquivos, setArquivos] = useState([]), [erro, setErro] = useState(''), [carregando, setCarregando] = useState(true);
  const [revisao, setRevisao] = useState(0), [versao, setVersao] = useState(null), [temMais, setTemMais] = useState(false);
  useEffect(() => {
    let vivo = true; setCarregando(true); setErro('');
    api.comercial(`/onboardings/${onboarding.id}/documentos-chat`).then(r => {
      if (!vivo) return;
      if (!Array.isArray(r?.arquivos) || r.versao == null) throw new Error('Não foi possível conferir os documentos do chat.');
      setArquivos(r.arquivos); setVersao(r.versao); setTemMais(Boolean(r.temMais));
    }).catch(e => { if (vivo) setErro(e.message); }).finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [api, onboarding.id, onboarding.versao, revisao]);
  return <section aria-label="Documentos recebidos no chat">
    {erro && <p role="alert">{erro}</p>}
    {carregando ? <p role="status">Conferindo documentos recebidos…</p> : <ul className="lead-document-list">{arquivos.map(a => <li key={a.id}><span>{a.nomeArquivo}<small>Recebido pelo chat{a.recebidoEm ? ` em ${new Date(a.recebidoEm).toLocaleString('pt-BR')}` : ''}</small></span><Button disabled={ocupado || Boolean(erro)} variant="secondary" onClick={async () => { if (await acao('/documentos-chat', { arquivoId: a.id, versao })) setRevisao(v => v + 1); }}>Vincular à ficha</Button></li>)}</ul>}
    {temMais && <p role="status">Há mais arquivos na conversa. Esta lista mostra os documentos elegíveis retornados pelo servidor.</p>}
    <Button variant="secondary" disabled={ocupado || carregando} onClick={() => setRevisao(v => v + 1)}>Atualizar documentos do chat</Button>
  </section>;
}

function abrirDocumento(blob, nome, baixar = false) {
  const url = URL.createObjectURL(blob);
  if (baixar) { const a = document.createElement('a'); a.href = url; a.download = nome; a.click(); }
  else window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function EnviarContratoSimples({ api, onboardingId, contrato, conversaId, podeEnviar, ocupado, executar }) {
  const [previa, setPrevia] = useState(null), [erro, setErro] = useState(''), [incerto, setIncerto] = useState(false);
  const chave = `${onboardingId}:${contrato.id}:${contrato.aprovadoEm}:${conversaId}`;
  const contexto = useRef(chave); contexto.current = chave;
  useEffect(() => { setPrevia(null); setErro(''); setIncerto(false); }, [chave]);
  return <div className="lead-form-actions">
    {erro && <p role="alert">{erro}</p>}
    {incerto && <p role="alert">Envio sem confirmação. Confira a tentativa antes de reenviar.</p>}
    <Button disabled={ocupado || !podeEnviar || incerto} onClick={() => executar(async () => {
      try {
        if (!previa) {
          const r = await api.comercial(`/onboardings/${onboardingId}/contratos/${contrato.id}/envio`);
          if (!r?.conteudoHash) throw new Error('Contrato indisponível para envio. Confira a versão atual.');
          if (contexto.current === chave) setPrevia(r);
          return;
        }
        await api.comercial(`/onboardings/${onboardingId}/contratos/${contrato.id}/enviar`, { conversaId, conteudoHash: previa.conteudoHash, contratoRevisao: contrato.aprovadoEm });
        if (contexto.current === chave) setPrevia(null);
      } catch (e) {
        if (contexto.current === chave) { setErro(e.message); if (previa && (!e.status || e.status >= 500)) setIncerto(true); }
        throw e;
      }
    })}>{previa ? 'Confirmar envio ao cliente' : 'Enviar ao cliente'}</Button>
    {previa && <p role="status">Contrato atual preparado para o destinatário selecionado.</p>}
  </div>;
}

export function PagamentoComercialSimples({ api, estado, jornada, conversaId, ocupado, acao, executar }) {
  const [valor, setValor] = useState(''), [referencia, setReferencia] = useState(''), [url, setUrl] = useState('');
  const [documentoId, setDocumentoId] = useState(''), [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState(''), [canalExterno, setCanalExterno] = useState('WHATSAPP');
  const cobranca = jornada.cobranca || estado.jornada?.cobranca;
  const o = estado.onboarding, contrato = jornada.contrato;
  const revisaoPagamento = `${o.id}:${contrato?.id}:${contrato?.aprovadoEm}:${jornada.proposta?.versao}`;
  useEffect(() => {
    setValor(''); setReferencia(''); setUrl(''); setDocumentoId(''); setConfirmando(false); setErro('');
  }, [revisaoPagamento]);
  const centavos = /^\d+(?:[,.]\d{1,2})?$/.test(valor.trim()) ? Math.round(Number(valor.replace(',', '.')) * 100) : 0;
  const body = { versao: o.versao, contratoId: contrato?.id, propostaVersao: jornada.proposta?.versao, contratoRevisao: contrato?.aprovadoEm, valorCentavos: centavos, referencia, ...(documentoId ? { documentoId } : {}) };
  const valido = Boolean(contrato?.id && contrato.aprovadoEm && centavos > 0 && referencia.trim().length >= 3);
  function validarLink() {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !(u.hostname === 'asaas.com' || u.hostname.endsWith('.asaas.com'))) throw new Error('Informe o link HTTPS da cobrança criada no Asaas.');
    return u.href;
  }
  return <section aria-label="Pagamento externo">
    <p>Cadastre a cobrança criada no Asaas. O recebimento será confirmado pelo contador.</p>
    {cobranca?.id && <article aria-label="Cobrança salva"><h4>Cobrança salva</h4><p>{cobranca.dados?.referencia || 'Referência não informada'}{Number.isSafeInteger(cobranca.dados?.valorCentavos) ? ` · ${(cobranca.dados.valorCentavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}</p>{cobranca.dados?.url ? <p>{cobranca.dados.url}</p> : <p>{estado.documentos?.find(d => d.id === cobranca.dados?.documentoId)?.nome || 'Documento vinculado à cobrança'}</p>}</article>}
    <div className="lead-company-fields"><label>Valor recebido ou cobrado (R$)<input inputMode="decimal" value={valor} onChange={e => { setValor(e.target.value); setConfirmando(false); }} /></label><label>Referência da cobrança<input value={referencia} onChange={e => { setReferencia(e.target.value); setConfirmando(false); }} /></label></div>
    <label>Link da cobrança Asaas<input type="url" value={url} onChange={e => setUrl(e.target.value)} /></label>
    <label>Guia ou comprovante (PDF)<input type="file" accept="application/pdf" disabled={ocupado} onChange={e => { const f = e.target.files?.[0]; if (f) executar(async () => { const r = await api.documentoComercial(o.id, f); setDocumentoId(r.documento.id); }); }} /></label>
    <label>Documento vinculado<select value={documentoId} onChange={e => setDocumentoId(e.target.value)}><option value="">Sem documento</option>{(estado.documentos || []).map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}</select></label>
    {erro && <p role="alert">{erro}</p>}
    <div className="lead-form-actions"><Button variant="secondary" disabled={ocupado || !valido || (!url && !documentoId)} onClick={() => { try { const link = url ? validarLink() : undefined; setErro(''); acao('/jornada/cobranca-externa', { ...body, ...(link ? { url: link } : {}) }); } catch (e) { setErro(e.message); } }}>Salvar cobrança</Button></div>
    <Button variant="secondary" disabled={ocupado || !cobranca?.id || !conversaId} onClick={() => acao('/jornada/cobranca-envio', { versao: o.versao, contratoId: contrato?.id, cobrancaId: cobranca.id, modo: 'ALTAN', conversaId })}>Enviar cobrança ao cliente</Button>
    {cobranca?.id && <><label>Envio realizado por fora<select value={canalExterno} onChange={e => setCanalExterno(e.target.value)}><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">E-mail</option><option value="OUTRO">Outro meio</option></select></label><Button variant="secondary" disabled={ocupado} onClick={() => acao('/jornada/cobranca-envio', { versao: o.versao, contratoId: contrato?.id, cobrancaId: cobranca.id, modo: 'EXTERNO', canal: canalExterno })}>Registrar envio externo</Button></>}
    <p className="onboarding-help">Anexar comprovante ou enviar a cobrança não confirma pagamento.</p>
    {!confirmando ? <Button disabled={ocupado || !valido} onClick={() => setConfirmando(true)}>Confirmar recebimento</Button> : <div className="lead-payment-confirm"><p>Confirmar o recebimento de {(centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} referente a {referencia}? Isso confirma a contratação e libera o início da implantação.</p><div className="lead-form-actions"><Button disabled={ocupado || !valido} onClick={() => acao('/jornada/pagamento', { ...body, confirmado: true })}>Recebimento conferido por mim</Button><Button variant="secondary" disabled={ocupado} onClick={() => setConfirmando(false)}>Cancelar</Button></div></div>}
  </section>;
}

export function ApresentacaoSimples({ api, estado, conversaId, podeEnviar, ocupado, executar }) {
  const [documento, setDocumento] = useState(null), [erro, setErro] = useState('');
  const [previa, setPrevia] = useState(null), [erroPrevia, setErroPrevia] = useState('');
  const [conferindo, setConferindo] = useState(false), [erroConferencia, setErroConferencia] = useState('');
  const id = estado.onboarding.id, diagnosticoId = estado.jornada?.diagnostico?.id;
  const contexto = useRef(null);
  const chave = `${id}:${diagnosticoId}:${estado.onboarding.versao}`;
  contexto.current = chave;
  useEffect(() => {
    let atual = true; setDocumento(null); setErro(''); setErroConferencia(''); setConferindo(false);
    api.comercial(`/onboardings/${id}/apresentacao`).then(r => {
      if (!atual) return;
      if (r?.pdfDisponivel === false) throw new Error('PDF indisponível na demonstração. Nenhum documento foi gerado ou enviado.');
      if (!r?.diagnosticoId || !r?.conteudoHash || r.diagnosticoId !== diagnosticoId) throw new Error('Apresentação desatualizada. Volte ao diagnóstico.');
      setDocumento({ ...r, contextoChave: chave });
    }).catch(e => { if (atual) setErro(e.message); });
    return () => { atual = false; };
  }, [api, id, diagnosticoId, chave]);
  const hash = documento?.contextoChave === chave ? documento.conteudoHash : null;
  useEffect(() => {
    let atual = true, url;
    setPrevia(null); setErroPrevia('');
    if (!hash) return;
    (async () => {
      try {
        if (!api.baixarApresentacaoComercial) throw new Error('Prévia PDF indisponível nesta instalação.');
        const blob = await api.baixarApresentacaoComercial(id, diagnosticoId, hash);
        if (!atual) return;
        if (!(blob instanceof Blob) || !blob.size || blob.type !== 'application/pdf') throw new Error('Não foi possível carregar um PDF válido da apresentação.');
        url = URL.createObjectURL(blob);
        setPrevia({ url, chave, hash });
      } catch (e) { if (atual) setErroPrevia(e.message || 'Não foi possível carregar a prévia PDF.'); }
    })();
    return () => { atual = false; if (url) URL.revokeObjectURL(url); };
  }, [api, id, diagnosticoId, chave, hash]);
  const previaAtual = previa?.chave === chave && previa?.hash === hash ? previa : null;
  const incerto = ['INCERTO', 'INDETERMINADO', 'ENVIANDO'].includes(documento?.envio?.estado?.toUpperCase());
  return <section aria-label="Apresentação da empresa">
    {erro ? <p role="alert">{erro}</p> : !documento ? <p role="status">Carregando apresentação…</p> : <p role="status">{previaAtual ? 'Apresentação pronta · diagnóstico atual' : erroPrevia ? 'Prévia da apresentação indisponível' : 'Carregando prévia PDF…'}</p>}
    {erroPrevia && <p role="alert">{erroPrevia}</p>}
    {previaAtual && <iframe className="lead-apresentacao-preview" title="Prévia PDF da apresentação da empresa" src={previaAtual.url} />}
    {documento?.conferencia ? <p role="status">PDF conferido por {documento.conferencia.atorId} em {new Date(documento.conferencia.createdAt).toLocaleString('pt-BR')}. Envio ao cliente é uma ação separada.</p> : <>
      <p className="onboarding-help">Confira o PDF e confirme abaixo para liberar a proposta. Abrir ou baixar não confirma a conferência.</p>
      {erroConferencia && <p role="alert">{erroConferencia}</p>}
      <Button disabled={ocupado || conferindo || !previaAtual} onClick={() => {
        setConferindo(true); setErroConferencia('');
        executar(async () => {
          try {
            const r = await api.comercial(`/onboardings/${id}/apresentacao/${documento.diagnosticoId}/conferir`, { versao: documento.versao, conteudoHash: documento.conteudoHash, confirmado: true });
            if (!r?.conferencia?.atorId || !r.conferencia.createdAt) throw new Error('Não foi possível confirmar o registro da conferência. Atualize a apresentação.');
            if (contexto.current === chave) setDocumento(v => ({ ...v, conferencia: r.conferencia }));
          } catch (e) { if (contexto.current === chave) setErroConferencia(e.message); throw e; }
          finally { if (contexto.current === chave) setConferindo(false); }
        }, { avancar: true });
      }}>{conferindo ? 'Registrando conferência…' : 'Conferi o PDF e quero preparar a proposta'}</Button>
    </>}
    {incerto && <p role="alert">Envio sem confirmação. Confira a tentativa antes de enviar novamente.</p>}
    <div className="lead-form-actions"><Button variant="secondary" disabled={ocupado || !documento || !podeEnviar || incerto} onClick={() => executar(async () => {
      try {
        const r = await api.comercial(`/onboardings/${id}/apresentacao/${documento.diagnosticoId}/enviar`, { conteudoHash: documento.conteudoHash, conversaId });
        if (contexto.current === chave) setDocumento(v => ({ ...v, envio: r.envio || r }));
      } catch (e) {
        if (contexto.current === chave && (!e.status || e.status >= 500)) setDocumento(v => ({ ...v, envio: { estado: 'INCERTO' } }));
        throw e;
      }
    })}>Enviar ao cliente</Button><Button variant="secondary" disabled={ocupado || !documento || !api.baixarApresentacaoComercial} onClick={() => executar(async () => {
      const blob = await api.baixarApresentacaoComercial(id, documento.diagnosticoId, documento.conteudoHash);
      if (contexto.current === chave) abrirDocumento(blob, 'apresentacao-empresa.pdf', true);
    })}>Baixar PDF</Button></div>
  </section>;
}
