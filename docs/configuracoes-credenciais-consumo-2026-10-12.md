# Configuração de credenciais CBS e IBS

Entrada: Configurações → CBS e IBS (`/configuracoes/cbs-ibs`). Seleção explícita da empresa, cadastro e substituição de Client ID / Client Secret separados por serviço. Reutiliza as rotas do cofre da empresa, suas permissões e criptografia; não requer migração.

Os rótulos fixos organizam registros do cofre; não constituem vínculo ou autorização do runtime. Duplicados exigem seleção explícita. Credenciais legadas com outros rótulos continuam acessíveis em Senhas externas. Nenhum segredo é revelado, persistido no navegador ou colocado em observações. Salvar não chama Receita/CGIBS nem altera habilitação, agenda ou regime tributário. A tela informa cadastro e não atesta validade externa.

O formulário limpa segredos após salvar e ao trocar empresa, descarta respostas tardias, protege edições pendentes e não envia PATCH sem alteração. Troca de Client ID exige novo Secret. O logger do cofre foi corrigido para não registrar mensagens de exceções que possam conter payloads.

Testes: cadastro CBS/IBS, substituição, espaços, no-op, duplicados, edição simultânea, confirmação de saída, resposta tardia, erro de autorização/carga e sanitização do logger. Build web e regressões de configurações/navegação. Testes usam valores fictícios, sem consultas fiscais ou gravação de credenciais de produção.
