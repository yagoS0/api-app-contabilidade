import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompanyDetailPage } from '../pages/renderCompanyDetailPage';

jest.mock('../../../accounting/parcelamento/pages/renderParcelamentoTab', () => ({
  ParcelamentoTab: ({ onIrParaGuias, abrirWizardAoMontar }) => <><button onClick={() => onIrParaGuias({ guideId: 'guia-antiga' })}>Conferir guia da parcela</button>{abrirWizardAoMontar && <p>Wizard solicitado</p>}</>,
}));
jest.mock('../../../guides/list/components/renderCompanyGuidesTable', () => ({
  CompanyGuidesTable: props => <p>Guia selecionada: {props.guiaDeOrigem?.id || 'nenhuma'}</p>,
}));

function Tela() {
  const [aba, setAba] = useState('parcelamento');
  return <CompanyDetailPage company={{ selectedCompany: { companyId: 'c1', razao: 'Empresa teste', legacyCompany: { regimeTributario: 'SIMPLES' } }, companyDetailTab: aba, setCompanyDetailTab: setAba }} accountingPanel={{ accounts: [], parcelamentos: {}, onLoadAccounts: jest.fn() }} circularPanel={{ competencia: '2026-09' }} guidesPanel={{ guides: [], loading: false }} feedback={{}}/>;
}
test('trocar de Parcelamento para Guias conserva a guia de origem', async () => {
  render(<Tela/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir guia da parcela' }));
  expect(await screen.findByText('Guia selecionada: guia-antiga')).toBeVisible();
});
