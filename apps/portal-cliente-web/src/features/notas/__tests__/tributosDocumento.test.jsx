import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TributosDocumento } from '../TributosDocumento';
it('mostra zero do documento e ausência com textos distintos',()=>{
  render(<TributosDocumento ibscbs={{valores:{baseCalculo:'980.00',ibsUf:{valor:'0.98'},ibsMunicipio:{valor:'0.00'},ibsTotal:'0.98',cbs:{valor:null}}}} />);
  expect(screen.getByText('CBS').nextElementSibling).toHaveTextContent('Não informado');
  expect(screen.getByText('IBS municipal').nextElementSibling).toHaveTextContent('0,00');
  expect(screen.getByText(/não confirma direito a crédito/)).toBeInTheDocument();
});
it('não interpreta ausência do grupo como isenção',()=>{
  render(<TributosDocumento ibscbs={{situacao:'GRUPO_AUSENTE'}} />);
  expect(screen.getByText('O documento não informa IBS/CBS.')).toBeInTheDocument();
});
