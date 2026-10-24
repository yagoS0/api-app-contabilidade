import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConversaoModal } from "../ConversaoModal";

const ficha = { conversao: { contratoConferido: true }, razaoSocial: "Exemplo LTDA", cnpj: "11222333000181", responsavelNome: "Ana", responsavelEmail: "ana@example.invalid", emailJaCadastrado: true, dados: { capitalSocialPretendido: "25.000,50", responsavelTelefone: "11900000001", socios: [{ nome: "Ana", cpf: "52998224725", participacao: "100" }] } };
test("contador revisa sócios, capital e endereço antes de enviar a ficha completa", async () => {
  const converter = jest.fn().mockResolvedValue({});
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  render(<ConversaoModal onboarding={ficha} onConverter={converter} onFechar={() => {}} />);
  expect(screen.getByLabelText("Nome do sócio 1")).toHaveValue("Ana");
  expect(screen.getByLabelText("Capital social (R$)")).toHaveValue("25.000,50");
  expect(screen.getByRole("button", { name: "Criar empresa" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Regime tributário"), { target: { value: "SIMPLES" } });
  fireEvent.change(screen.getByLabelText("CNAE principal"), { target: { value: "7020400" } });
  fireEvent.change(screen.getByLabelText("CNAEs secundários"), { target: { value: "8599604" } });
  for (const [campo, valor] of [["Rua", "Rua de Teste"], ["Número", "100"], ["Bairro", "Centro"], ["Cidade", "São Paulo"], ["UF", "SP"], ["CEP", "01001000"]]) fireEvent.change(screen.getByLabelText(new RegExp(`^${campo}`)), { target: { value: valor } });
  fireEvent.change(screen.getByLabelText(/Há pró-labore/), { target: { value: "false" } });
  fireEvent.change(screen.getByRole("combobox", { name: "A empresa possui funcionários na implantação?" }), { target: { value: "true" } });
  const revisao = screen.getByRole("checkbox", { name: /Conferi os dados definitivos/ });
  expect(screen.getByRole("button", { name: "Criar empresa" })).toBeDisabled();
  fireEvent.click(revisao);
  fireEvent.change(screen.getByLabelText("Capital social (R$)"), { target: { value: "30.000,75" } });
  expect(revisao).not.toBeChecked();
  fireEvent.click(revisao); fireEvent.click(screen.getByRole("button", { name: "Criar empresa" }));
  await waitFor(() => expect(converter).toHaveBeenCalledTimes(1));
  expect(converter.mock.calls[0][0]).toMatchObject({ ownerEmail: ficha.responsavelEmail, contato: { telefone: "11900000001", whatsappAutorizado: false }, company: { cnpj: "11222333000181", capitalSocial: "30.000,75", socios: ficha.dados.socios, cnaesSecundarios: ["8599604"], endereco: { numero: "100" } } });
  expect(converter.mock.calls[0][0].ownerPassword).toBeUndefined();
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("CNPJ 11222333000181")); confirm.mockRestore();
});

test.each([
  { message: 'A versão mudou. Confira a ficha antes de tentar novamente.' },
  { code: 'cnpj_ja_na_carteira', payload: { portalClientId: 'empresa', razao: 'Empresa existente' } },
])('R22: recusa após envio recebe foco e rolagem, anuncia erro e preserva o formulário ($code)', async erro => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  const scrollOriginal = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  const scroll = jest.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  const converter = jest.fn();
  const vincular = jest.fn().mockResolvedValue(undefined);
  function Cenario() {
    const [falha, setFalha] = useState(null);
    return <ConversaoModal onboarding={ficha} erro={falha} onFechar={() => {}} onVincular={vincular} onConverter={async payload => {
      converter(payload);
      await Promise.resolve();
      setFalha(erro);
    }} />;
  }
  try {
    render(<Cenario />);
    fireEvent.change(screen.getByLabelText('Regime tributário'), { target: { value: 'SIMPLES' } });
    fireEvent.change(screen.getByLabelText('CNAE principal'), { target: { value: '7020400' } });
    for (const [campo, valor] of [['Rua', 'Rua de Teste'], ['Número', '100'], ['Bairro', 'Centro'], ['Cidade', 'São Paulo'], ['UF', 'SP'], ['CEP', '01001000']]) {
      fireEvent.change(screen.getByLabelText(new RegExp(`^${campo}`)), { target: { value: valor } });
    }
    fireEvent.change(screen.getByLabelText(/Há pró-labore/), { target: { value: 'false' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'A empresa possui funcionários na implantação?' }), { target: { value: 'true' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Conferi os dados definitivos/ }));
    const enviar = screen.getByRole('button', { name: 'Criar empresa' });
    enviar.focus();
    fireEvent.click(enviar);
    const alerta = await screen.findByRole('alert');
    await waitFor(() => expect(alerta).toHaveFocus());
    expect(alerta).toHaveAttribute('aria-atomic', 'true');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'instant' });
    expect(scroll.mock.instances).toContain(alerta);
    expect(screen.getByLabelText(/^Rua/)).toHaveValue('Rua de Teste');
    expect(screen.getByLabelText('Nome do sócio 1')).toHaveValue('Ana');
    expect(screen.getByRole('checkbox', { name: /Conferi os dados definitivos/ })).toBeChecked();
    expect(converter).toHaveBeenCalledTimes(1);
    if (erro.code) {
      fireEvent.click(screen.getByRole('button', { name: 'Vincular ao existente' }));
      await waitFor(() => expect(vincular).toHaveBeenCalledWith('empresa', ficha.cnpj, {}));
      await waitFor(() => expect(alerta).toHaveFocus());
    } else {
      expect(alerta).toHaveTextContent(erro.message);
      // Mesmo objeto/recusa em nova tentativa precisa voltar a ser perceptível.
      enviar.focus();
      fireEvent.click(enviar);
      await waitFor(() => expect(converter).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(alerta).toHaveFocus());
    }
  } finally {
    confirm.mockRestore();
    if (scrollOriginal) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollOriginal);
    else delete Element.prototype.scrollIntoView;
  }
});

test('opções de endereço preservam valores e revisão explícita até envio', async () => {
  const converter=jest.fn().mockResolvedValue({});const confirm=jest.spyOn(window,'confirm').mockReturnValue(true);
  try {
    render(<ConversaoModal onboarding={ficha} onConverter={converter} onFechar={()=>{}} />);
    fireEvent.change(screen.getByLabelText('Regime tributário'),{target:{value:'SIMPLES'}});
    fireEvent.change(screen.getByLabelText('CNAE principal'),{target:{value:'7020400'}});
    for(const [campo,valor] of [['Rua','Rua Teste'],['Número','123'],['Bairro','Centro'],['Cidade','Recife'],['UF','PE'],['CEP','50000000'],['Inscrição imobiliária','000AB']])fireEvent.change(screen.getByLabelText(new RegExp('^'+campo)),{target:{value:valor}});
    fireEvent.change(screen.getByLabelText(/Há pró-labore/),{target:{value:'false'}});
    fireEvent.change(screen.getByRole('combobox',{name:'A empresa possui funcionários na implantação?'}),{target:{value:'false'}});
    const revisao=screen.getByRole('checkbox',{name:/Conferi os dados definitivos/});fireEvent.click(revisao);
    fireEvent.click(screen.getByRole('checkbox',{name:'Sem número'}));expect(screen.getByLabelText(/^Número/)).toBeDisabled();expect(revisao).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox',{name:'Sem número'}));expect(screen.getByLabelText(/^Número/)).toHaveValue('123');
    fireEvent.click(screen.getByRole('checkbox',{name:'IPTU não informado — conferir'}));expect(screen.getByLabelText(/^Inscrição imobiliária/)).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox',{name:'IPTU não informado — conferir'}));expect(screen.getByLabelText(/^Inscrição imobiliária/)).toHaveValue('000AB');
    expect(converter).not.toHaveBeenCalled();fireEvent.click(revisao);fireEvent.click(screen.getByRole('button',{name:'Criar empresa'}));
    await waitFor(()=>expect(converter).toHaveBeenCalledTimes(1));expect(converter.mock.calls[0][0].company.endereco).toMatchObject({numero:'123',semNumero:false,inscricaoImobiliaria:'000AB',iptuDesconhecido:false});
  } finally {confirm.mockRestore();}
});
