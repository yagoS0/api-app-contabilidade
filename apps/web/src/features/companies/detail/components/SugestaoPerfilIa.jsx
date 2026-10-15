import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../components/ui/Button';

export function SugestaoPerfilIa({ onSugerir, onAplicar }) {
  const [descricao, setDescricao] = useState('');
  const [sugestao, setSugestao] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const versao = useRef(0);
  useEffect(() => () => { versao.current += 1; }, []);
  async function sugerir() {
    const pedido = ++versao.current;
    setOcupado(true); setErro(''); setSugestao(null);
    try {
      const r = await onSugerir(descricao.trim());
      if (pedido !== versao.current) return;
      if (!r?.ok || !r.campos) throw new Error(r?.message || 'Não foi possível preparar a sugestão.');
      setSugestao(r);
    } catch (e) { if (pedido === versao.current) setErro(e.message || 'A sugestão está indisponível. Preencha manualmente.'); }
    finally { if (pedido === versao.current) setOcupado(false); }
  }
  if (!onSugerir) return null;
  return <details className="nfse-section nfse-suggestion">
    <summary>Pré-preencher um novo perfil com IA</summary>
    <div className="nfse-suggestion-content">
    <label htmlFor="descricao-perfil-ia">Descreva o serviço prestado</label>
    <textarea id="descricao-perfil-ia" rows={3} maxLength={2000} value={descricao} disabled={ocupado}
      onChange={e => { setDescricao(e.target.value); setSugestao(null); setErro(''); }} />
    <p>Descreva a atividade e o que será faturado, sem dados pessoais. A IA sugere entre os serviços já habilitados. Revise o enquadramento antes de salvar.</p>
    <Button type="button" variant="secondary" disabled={ocupado || !descricao.trim()} onClick={sugerir}>{ocupado ? 'Preparando sugestão…' : 'Sugerir preenchimento com IA'}</Button>
    {erro && <p role="alert">{erro}</p>}
    {sugestao && <div role="status">
      <p><strong>{sugestao.campos.nome}</strong> · Serviço {sugestao.campos.codigoServicoNacional}{sugestao.campos.codigoNbs ? ` · NBS ${sugestao.campos.codigoNbs}` : ' · NBS a conferir'}</p>
      <p>{sugestao.justificativa}</p>
      <p>{sugestao.fonte}. A sugestão ainda não foi salva.</p>
      <Button type="button" variant="secondary" onClick={() => onAplicar(sugestao.campos)}>Usar no rascunho e revisar</Button>
    </div>}
    </div>
  </details>;
}
