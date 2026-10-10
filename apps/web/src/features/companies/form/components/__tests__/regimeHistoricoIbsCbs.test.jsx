import { render, screen, fireEvent } from '@testing-library/react';
import { RegimeHistoricoEditor } from '../renderCompanyForm';
import { linhasDaPreviaFiscal } from '../../../../notas/components/PreviaFiscal';
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
