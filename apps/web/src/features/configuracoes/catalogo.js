export const CONFIG_EMPRESA = [
  { id: 'cadastro', grupo: 'Empresa', titulo: 'Dados cadastrais', descricao: 'Identificação, endereço, responsáveis e regime.', tab: 'cadastro', tabs: ['cadastro','edit'], termos: 'cnpj socios razão social' },
  { id: 'perfilFiscal', grupo: 'Fiscal', titulo: 'Atividades e tributação', descricao: 'Atividades permitidas, anexos e parâmetros de ISS.', tab: 'perfilFiscal', termos: 'cnae fator r simples' },
  { id: 'emissaoNfse', grupo: 'Fiscal', titulo: 'Emissão de notas', descricao: 'Perfis por serviço, NBS, códigos tributários e liberação de emissão.', tab: 'emissaoNfse', termos: 'nfse ibs cbs aliquota ctrib' },
  { id: 'comunicacao', grupo: 'Atendimento', titulo: 'Contatos, acessos e envios', descricao: 'Contatos, acesso ao portal do cliente, guias, e-mail, WhatsApp e permissões do assistente.', tab: 'comunicacao', termos: 'email telefone ia guias destinatarios usuarios membros acesso portal cliente' },
  { id: 'credenciais', grupo: 'Acessos', titulo: 'Senhas e acessos externos', descricao: 'Cofre de credenciais dos sistemas usados pela empresa.', tab: 'credenciais', termos: 'senhas usuarios cofre credenciais sistemas serpro procuracao' },
  { id: 'certificado', grupo: 'Acessos', titulo: 'Certificado A1', descricao: 'Certificado digital da própria empresa e sua validade.', tab: 'certificado', termos: 'certificado digital a1 pfx' },
  { id: 'planoContas', grupo: 'Contabilidade', titulo: 'Plano de contas', descricao: 'Contas contábeis usadas nesta empresa.', tab: 'planoContas', termos: 'debito credito contabil' },
];
export const CONFIG_GERAIS = [
  { id: 'integracoes', grupo: 'Integrações', titulo: 'SERPRO e certificados', descricao: 'Conexão, certificado do escritório e parâmetros da integração.', href: '/firm-settings/guides', termos: 'api receita procuração certificado a1' },
  { id: 'contabilidade', grupo: 'Contabilidade', titulo: 'Plano de contas global', descricao: 'Estrutura e contas padrão do escritório.', href: '/firm-settings/chart', termos: 'contabil debito credito' },
  { id: 'obrigacoes', grupo: 'Rotinas', titulo: 'Calendário e recorrências', descricao: 'Abre o calendário para organizar tarefas, obrigações e repetições por modal.', href: '/obrigacoes', termos: 'calendario prazos tarefas obrigacoes modelos regras' },
  { id: 'rotinas', grupo: 'Rotinas', titulo: 'Rotinas fiscais', descricao: 'Configuração e acompanhamento das rotinas automáticas.', href: '/rotinas', termos: 'automacao recorrencia' },
  { id: 'atendimento', grupo: 'Atendimento', titulo: 'WhatsApp e IA', descricao: 'Política de atendimento, atalhos e expediente.', href: '/configuracoes/atendimento', termos: 'horario feriados templates menu ia' },
];
export function buscarConfiguracoes(itens, busca) {
  const normal = v => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const q=normal(busca).trim();return itens.filter(i=>normal([i.titulo,i.descricao,i.termos,i.grupo].join(' ')).includes(q));
}
export function secaoEmpresa(tab) { return CONFIG_EMPRESA.find(i=>i.tab===tab || i.tabs?.includes(tab)) || null; }
