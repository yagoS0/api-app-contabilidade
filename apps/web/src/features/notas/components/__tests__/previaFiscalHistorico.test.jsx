import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PreviaFiscal } from '../PreviaFiscal';

test.each([true, false])('histórico da própria empresa com permissão de edição %s', canEditCompany => {
  const tentar = jest.fn();
  const previa = { habilitada: true, bloqueada: true, tentar,
    dados: { competencia: '2026-11-12', pendencias: [{ codigo: 'NFSE_IBSCBS_OPCAO_INVALIDA', mensagem: 'Confira a vigência.' }] } };
  render(<PreviaFiscal previa={previa} companyId="empresa-A" canEditCompany={canEditCompany} />);
  const link = screen.queryByRole('link', { name: /histórico de regime da empresa/ });
  if (canEditCompany) {
    expect(link).toHaveAttribute('href', '/companies/empresa-A/edit#secao-historico-de-regime');
    expect(link).toHaveAttribute('target', '_blank');
  } else expect(link).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Rever prévia/ }));
  expect(tentar).toHaveBeenCalledTimes(1);
});
