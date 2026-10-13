import { render, screen } from '@testing-library/react';
import { getComplianceTags } from '../renderCompanyCard.jsx';
import { GuiaChip } from '../renderGuiaChip.jsx';
import { temPendenciaParcelamento } from '../../lib/pendenciaParcelamento.js';

test('guia do mês presente remove aviso e filtro mesmo com histórico pendente', () => {
  const guideCompliance = { guiasParcelamentoMes: [], hasPendenciasParcelamento: true,
    parcDas: { required: true, atrasada: true, pendencias: 3 } };
  expect(getComplianceTags(guideCompliance)).toEqual([]);
  expect(temPendenciaParcelamento({ guideCompliance })).toBe(false);
});

test('cada tipo mostra somente o mês operacional sem contagem de tarefas', () => {
  const guideCompliance = { guiasParcelamentoMes: ['PARCSN', 'PARCMEI'].map(tipoParcelamento => ({
    tipoParcelamento, referencia: '2026-10', itens: [{ id: tipoParcelamento, estado: 'OBTER_GUIA' }],
  })) };
  const tags = getComplianceTags(guideCompliance);
  expect(new Set(tags.map(t => t.id)).size).toBe(2);
  expect(temPendenciaParcelamento({ guideCompliance })).toBe(true);
  render(<>{tags.map(tag => <GuiaChip key={tag.id} compacto tag={tag} empresa={{ companyId: 'c' }} competencia="2026-09" />)}</>);
  expect(screen.getByRole('button', { name: /PARCSN.*falta guia do mês/ }).textContent).toBe('PARCSN · 10/2026');
  expect(screen.getByRole('button', { name: /PARCMEI.*falta guia do mês/ }).textContent).toBe('PARCMEI · 10/2026');
  expect(screen.queryByText(/tarefas|atraso/)).toBeNull();
});
