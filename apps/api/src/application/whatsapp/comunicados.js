import { createHash } from 'node:crypto';
import { normalizarE164 } from './telefone.js';

export const erroComunicado = (message, status = 400) => Object.assign(new Error(message), { status });
export function validarAviso(input) {
  if (typeof input.titulo !== 'string' || typeof input.corpo !== 'string') throw erroComunicado('Informe o título e a mensagem do aviso.');
  const titulo = String(input.titulo || '').trim(), corpo = String(input.corpo || '').trim();
  const categoria = input.categoria || 'MARKETING';
  if (!titulo || titulo.length > 100) throw erroComunicado('Informe um título de até 100 caracteres.');
  if (!corpo || corpo.length > 900 || /[{}]/.test(corpo)) throw erroComunicado('Escreva o aviso completo, com até 900 caracteres e sem campos variáveis.');
  if (!['UTILITY', 'MARKETING'].includes(categoria)) throw erroComunicado('Escolha o tipo do comunicado.');
  return { titulo, corpo, categoria };
}
export function agruparDestinatarios(contatos) {
  const grupos = new Map(), excluidos = [];
  for (const c of contatos) {
    const telefone = c.telefoneE164 && normalizarE164(`+${c.telefoneE164}`);
    const motivo = !c.ativo ? 'Contato inativo' : !telefone ? 'Sem WhatsApp válido' : !c.optInEm ? 'Sem autorização para receber WhatsApp' : null;
    if (motivo) { excluidos.push({ contatoId: c.id, nome: c.nome, empresa: c.portalClient?.razao, motivo }); continue; }
    // Identidade estrita: não inventa nono dígito, não exige conta nem associação ao portal.
    const grupo = grupos.get(telefone) || { telefone, nome: c.nome, contatosIds: [], empresasIds: [], empresas: [] };
    grupo.contatosIds.push(c.id);
    if (!grupo.empresasIds.includes(c.portalClientId)) {
      grupo.empresasIds.push(c.portalClientId);
      grupo.empresas.push({ id: c.portalClientId, razao: c.portalClient?.razao || '', cnpj: c.portalClient?.cnpj || '' });
    }
    grupos.set(telefone, grupo);
  }
  return { destinatarios: [...grupos.values()].sort((a, b) => a.telefone.localeCompare(b.telefone)), excluidos };
}
export function modeloDoComunicado(c) {
  return { name: c.nomeMeta, language: 'pt_BR', category: c.categoria,
    components: [{ type: 'BODY', text: c.corpo }, { type: 'FOOTER', text: 'Altan Contabilidade' }] };
}
export function conferirModelo(c, modelo) {
  const componentes = modelo?.components || [];
  return modelo?.name === c.nomeMeta && modelo.language === 'pt_BR'
    && componentes.length === 2 && componentes.filter(p => p.type === 'BODY' && p.text === c.corpo).length === 1
    && componentes.filter(p => p.type === 'FOOTER' && p.text === 'Altan Contabilidade').length === 1;
}
export function hashPrevia(c, destinatarios) {
  return createHash('sha256').update(JSON.stringify([c.id, c.corpo, c.categoria, c.metaId, c.statusMeta,
    destinatarios.filter(d => d.status === 'PENDENTE').map(d => [d.id, d.telefone, [...d.contatosIds].sort(), d.elegivel !== false]).sort((a, b) => a[0].localeCompare(b[0]))])).digest('hex');
}
