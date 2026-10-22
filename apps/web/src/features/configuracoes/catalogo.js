export const CONFIG_EMPRESA = [
  { id: 'automacao', grupo: 'Fiscal', titulo: 'Automação', descricao: 'Lembretes de guias no WhatsApp e consultas automáticas desta empresa.', tab: 'automacao', termos: 'serpro consultas rotinas das inss extrato lembretes whatsapp acompanhamento' },
  { id: 'implantacao', grupo: 'Empresa', titulo: 'Implantação', descricao: 'Checklist, responsáveis, prazos e pendências após a entrada na carteira.', tab: 'implantacao', termos: 'onboarding acompanhamento implantação tarefas' },
  { id: 'cadastro', grupo: 'Empresa', titulo: 'Dados cadastrais', descricao: 'Identificação, endereço, responsáveis e regime.', tab: 'cadastro', tabs: ['cadastro','edit'], termos: 'cnpj socios razão social' },
  { id: 'perfilFiscal', grupo: 'Fiscal', titulo: 'Atividades e tributação', descricao: 'Atividades permitidas, anexos e parâmetros de ISS.', tab: 'perfilFiscal', termos: 'cnae fator r simples' },
  { id: 'emissaoNfse', grupo: 'Fiscal', titulo: 'Emissão de notas', descricao: 'Perfis por serviço, NBS, códigos tributários e liberação de emissão.', tab: 'emissaoNfse', termos: 'nfse ibs cbs aliquota ctrib' },
  { id: 'comunicacao', grupo: 'Atendimento', titulo: 'Contatos, acessos e envios', descricao: 'Contatos, acesso ao portal do cliente, guias, e-mail, WhatsApp e permissões do assistente.', tab: 'comunicacao', termos: 'email telefone ia guias destinatarios usuarios membros acesso portal cliente' },
  { id: 'certificado', grupo: 'Acessos', titulo: 'Certificado A1', descricao: 'Certificado digital da própria empresa e sua validade.', tab: 'certificado', termos: 'certificado digital a1 pfx' },
  { id: 'planoContas', grupo: 'Contabilidade', titulo: 'Plano de contas', descricao: 'Contas contábeis usadas nesta empresa.', tab: 'planoContas', termos: 'debito credito contabil' },
];
export const CONFIG_GERAIS = [
  { id: 'consumo', grupo: 'Integrações', titulo: 'CBS e IBS', descricao: 'Credenciais da apuração por empresa e orientações de habilitação.', href: '/configuracoes/cbs-ibs', termos: 'client id secret receita integra reforma tributaria' },
  { id: 'biblioteca', grupo: 'Atendimento', titulo: 'Biblioteca compartilhada', descricao: 'Mensagens rápidas, orientações, honorários e modelos de contratos.', href: '/biblioteca', termos: 'whatsapp procuracao gov assinatura mensagens textos propostas' },
  { id: 'integracoes', grupo: 'Integrações', titulo: 'SERPRO e certificados', descricao: 'Credenciais e certificado do procurador.', href: '/firm-settings/guides', termos: 'api receita procuração certificado a1 conexão parâmetros integração escritório' },
  { id: 'contabilidade', grupo: 'Contabilidade', titulo: 'Plano de contas global', descricao: '', href: '/firm-settings/chart', termos: 'contabil debito credito estrutura padrão escritório' },
  { id: 'obrigacoes', grupo: 'Rotinas', titulo: 'Calendário e recorrências', descricao: 'Tarefas e obrigações.', href: '/obrigacoes', termos: 'calendario prazos tarefas obrigacoes modelos regras repetições' },
  { id: 'rotinas', grupo: 'Rotinas', titulo: 'Rotinas fiscais', descricao: 'Agendas de consultas automáticas.', href: '/rotinas', termos: 'automacao recorrencia configuração acompanhamento' },
  { id: 'atendimento', grupo: 'Atendimento', titulo: 'WhatsApp e IA', descricao: 'Expediente e permissões.', href: '/configuracoes/atendimento', termos: 'horario feriados templates menu ia política atalhos' },
];
export function buscarConfiguracoes(itens, busca) {
  const normal = v => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const q=normal(busca).trim();return itens.filter(i=>normal([i.titulo,i.descricao,i.termos,i.grupo].join(' ')).includes(q));
}
export function secaoEmpresa(tab) { return CONFIG_EMPRESA.find(i=>i.tab===tab || i.tabs?.includes(tab)) || null; }
