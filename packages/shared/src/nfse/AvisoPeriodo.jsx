import React from 'react';
export function AvisoPeriodo({ periodo }) {
  if (!periodo?.exigeRevisao) return null;
  return <aside role="status" aria-label="Revisão da competência" style={{ padding: 14, margin: '12px 0', border: '1px solid var(--state-warn, #d99a35)', borderRadius: 8, gridColumn: '1 / -1', background: 'var(--state-warn-surface, transparent)', color: 'inherit', overflowWrap: 'anywhere' }}>
    <strong>Confira a competência {periodo.competencia}</strong>
    <p style={{ margin: '6px 0 0' }}>{periodo.mensagem}</p>
    <p style={{ margin: '6px 0 0' }}>Uma operação nova neste período ficará pendente de revisão pelo contador. Nenhuma declaração será retificada automaticamente.</p>
  </aside>;
}
