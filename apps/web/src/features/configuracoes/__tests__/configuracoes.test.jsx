import { pathToPageName } from "../../../app/hooks/useManageAuthSession";
import React from 'react';
import { render,screen,fireEvent,within } from '@testing-library/react';
import { ConfiguracoesLayout,Engrenagem,ConfiguracoesGeraisPage } from '../Configuracoes';
import { CONFIG_EMPRESA,CONFIG_GERAIS,buscarConfiguracoes } from '../catalogo';
import { companyTabPath, SEGMENT_TO_TAB } from '../../companies/detail/lib/rotasDaEmpresa';
it('configurações de cada empresa têm rota reversível e mesma empresa',()=>{
 for(const item of CONFIG_EMPRESA){const path=companyTabPath('empresa-a',item.tab);expect(path).toMatch(/^\/companies\/empresa-a\//);expect(SEGMENT_TO_TAB[path.split('/')[3]]).toBe(item.tab);}
});
it('busca por sinônimos encontra campo fiscal e contato sem misturar escopo',()=>{expect(buscarConfiguracoes(CONFIG_EMPRESA,'destinatarios').map(i=>i.id)).toEqual(['comunicacao']);expect(buscarConfiguracoes(CONFIG_EMPRESA,'NBS').map(i=>i.id)).toEqual(['emissaoNfse']);});
it('busca filtra navegação e cartões; vazio oferece feedback',()=>{render(<ConfiguracoesLayout titulo="Configurações da empresa" itens={CONFIG_EMPRESA.map(i=>({...i,href:companyTabPath('a',i.tab)}))}/>);fireEvent.change(screen.getByRole('searchbox'),{target:{value:'NBS'}});expect(within(screen.getByRole('navigation')).getAllByRole('link')).toHaveLength(1);fireEvent.change(screen.getByRole('searchbox'),{target:{value:'zzzz'}});expect(screen.getByRole('status')).toHaveTextContent('Nenhuma configuração');});
it('engrenagem preserva ctrl clique e navega SPA no clique simples',()=>{const fn=jest.fn();render(<Engrenagem href="/configuracoes" label="Configurações" onClick={fn}/>);fireEvent.click(screen.getByRole('link'),{ctrlKey:true});expect(fn).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('link'));expect(fn).toHaveBeenCalledTimes(1);});
it('central geral oferece entradas implementadas sem ações fiscais de transmissão',()=>{render(<ConfiguracoesGeraisPage/>);for(const item of CONFIG_GERAIS)expect(screen.getAllByRole('link').some(l=>l.getAttribute('href')===item.href)).toBe(true);expect(screen.queryByRole('button',{name:/emitir|transmitir/i})).toBeNull();});

it('deep links gerais e da empresa são reconhecidos pela sessão',()=>{
 expect(pathToPageName('/configuracoes')).toBe('configuracoesGerais');expect(pathToPageName('/configuracoes/atendimento')).toBe('configuracoesGerais');
 for(const item of CONFIG_GERAIS)expect(pathToPageName(item.href)).not.toBe('companies');
 for(const item of CONFIG_EMPRESA)expect(pathToPageName(companyTabPath('empresa-a',item.tab))).toBe('companyDetail');
});
it('acesso ao portal fica em contatos e credenciais externas no cofre',()=>{
 expect(buscarConfiguracoes(CONFIG_EMPRESA,'portal').map(i=>i.id)).toEqual(['comunicacao']);
 expect(buscarConfiguracoes(CONFIG_EMPRESA,'cofre').map(i=>i.id)).toEqual(['credenciais']);
});
