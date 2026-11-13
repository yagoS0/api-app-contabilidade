import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { createRealApi } from '../../../../../api/real/realApi';
import { mapCompanyToEditForm } from '../../hooks/useManageCompanyForm';
import { RegimeHistoricoEditor } from '../renderCompanyForm';
import { linhasDaPreviaFiscal } from '../../../../notas/components/PreviaFiscal.shared.js';
test('editor permite escolher híbrido no período e solicita referência', () => {
 const onChange = jest.fn();
 const linha = { regime: 'SIMPLES', vigenciaInicio: '2027-01-01', vigenciaFim: '', impostos: '', apuracaoIbsCbs: '' };
 const { rerender } = render(<RegimeHistoricoEditor historico={[linha]} onChange={onChange} />);
 fireEvent.change(screen.getByLabelText('Apuração de IBS/CBS do período 1'), { target: { value: 'REGULAR' } });
 expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ regime: 'SIMPLES', apuracaoIbsCbs: 'REGULAR' })]);
 rerender(<RegimeHistoricoEditor historico={[{ ...linha, apuracaoIbsCbs: 'REGULAR' }]} onChange={onChange} />);
 expect(screen.getByLabelText('Referência do comprovante de IBS/CBS do período 1')).toBeRequired();
});
test('prévia mostra opção e vigência sem confundir o regime', () => {
 expect(linhasDaPreviaFiscal({ regimeVigente: { regime: 'SIMPLES' }, opcaoIbsCbs: { hibrido: true, apuracao: 'REGULAR', vigenciaInicio: '2027-01-01', vigenciaFim: '2027-06-30' } }).join(' ')).toContain('Simples híbrido — regime regular, fora do DAS · vigência: 2027-01-01 até 2027-06-30');
});

const periodoComOpcao = { regime: 'SIMPLES', vigenciaInicio: '2027-01-01', vigenciaFim: '', impostos: '',
  apuracaoIbsCbs: 'REGULAR', comprovanteOpcaoIbsCbs: 'Protocolo de teste', observacao: 'Conferido no cadastro' };

test.each(['', '2026-12-31'])('período com início %j não oferece uma nova opção de IBS/CBS', inicio => {
  render(<RegimeHistoricoEditor historico={[{ ...periodoComOpcao, vigenciaInicio: inicio, apuracaoIbsCbs: '' }]} onChange={jest.fn()} />);
  expect(screen.getByLabelText('Apuração de IBS/CBS do período 1')).toBeDisabled();
  expect(screen.getByText(/Período 1:.*01\/01\/2027/)).toBeVisible();
});

test.each([['Início da vigência', '2026-12-31'], ['Regime', 'LUCRO_PRESUMIDO']])(
  'alterar %s conserva a opção e a referência até uma correção explícita', (campo, valor) => {
    const salvar = jest.fn();
    function Formulario() {
      const [linhas, setLinhas] = useState([periodoComOpcao]);
      return <form onSubmit={e => { e.preventDefault(); salvar(linhas); }}>
        <label>Inscrição municipal<input defaultValue="00042" /></label>
        <RegimeHistoricoEditor historico={linhas} onChange={setLinhas} /><button>Salvar</button>
      </form>;
    }
    render(<Formulario />);
    fireEvent.change(screen.getByLabelText(`${campo} do período 1`), { target: { value: valor } });
    const opcao = screen.getByLabelText('Apuração de IBS/CBS do período 1');
    expect(opcao).toHaveValue('REGULAR');
    expect(opcao).toBeInvalid();
    expect(screen.getByLabelText('Referência do comprovante de IBS/CBS do período 1')).toHaveValue('Protocolo de teste');
    fireEvent.click(screen.getByText('Salvar'));
    expect(salvar).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Inscrição municipal')).toHaveValue('00042');
    fireEvent.change(opcao, { target: { value: '' } });
    fireEvent.click(screen.getByText('Salvar'));
    expect(salvar).toHaveBeenCalledWith([expect.objectContaining({ apuracaoIbsCbs: '', comprovanteOpcaoIbsCbs: '', observacao: periodoComOpcao.observacao })]);
  });

test('leitura e PATCH do cadastro preservam a observação, a vigência e a inscrição com zeros iniciais', async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  try {
    const form = mapCompanyToEditForm({ inscricaoMunicipal: '00042', legacyCompany: { regimeHistorico: [periodoComOpcao] } });
    await createRealApi().updateCompany('empresa-teste', form);
    const cadastro = JSON.parse(global.fetch.mock.calls[0][1].body).company;
    expect(cadastro.inscricaoMunicipal).toBe('00042');
    expect(cadastro.regimeHistorico).toEqual([expect.objectContaining({ observacao: periodoComOpcao.observacao,
      vigenciaInicio: '2027-01-01', apuracaoIbsCbs: 'REGULAR', comprovanteOpcaoIbsCbs: 'Protocolo de teste' })]);
  } finally {
    global.fetch = originalFetch;
  }
});
