import { IA_SUPORTE_OPENAI, IA_SUPORTE_TELEFONES_PILOTO, IA_SUPORTE_CANAIS_PILOTO } from '../../config.js';

export function suporteNoPiloto(conversa, { enabled = IA_SUPORTE_OPENAI, telefones = IA_SUPORTE_TELEFONES_PILOTO, canais = IA_SUPORTE_CANAIS_PILOTO } = {}) {
  if (!enabled) return true; // Preserva o piloto anterior enquanto a migração estiver desligada.
  return telefones.includes(String(conversa?.telefoneE164 || '').replace(/\D/g, ''))
    && canais.includes(conversa?.canalId || 'principal');
}
