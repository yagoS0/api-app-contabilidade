# Consultas no emissor do contador — 13/10/2026

O campo CEP do assistente não tinha consulta. O CNPJ consultava diretamente a BrasilAPI pelo navegador, sem a alternativa pública já disponível no servidor. A recarga da prévia também invalidava o percentual manual do Simples, mesmo sem troca da competência ou do serviço.

O contador passa a usar `POST /firm/companies/:companyId/consulta-tomador`, protegido pelo acesso ACCOUNTANT à empresa. CNPJ reaproveita BrasilAPI/Minha Receita e CEP reaproveita ViaCEP e a conferência do município na tabela IBGE. As consultas são auxiliares, sem cadastro, reserva de DPS, assinatura ou emissão. Não representam comprovação histórica da Receita. Falha permite retentativa ou preenchimento manual.

O botão Consultar CEP preenche campos vazios, preservando número, complemento e edições. Respostas de documento/CEP antigo são descartadas. O percentual manual permanece durante a recarga da prévia; troca de competência ou atividade invalida sua aplicação. A demonstração local identifica que as consultas estão desativadas e oferece acesso ao portal real.

Na validação de produção, o ViaCEP apresentou falha de conexão do servidor. A rota do contador usa OpenCEP como alternativa em falha de rede, timeout ou indisponibilidade, dentro de oito segundos totais. As duas fontes passam pelas mesmas verificações de CEP retornado e município/UF/IBGE; nenhum número ou complemento é inventado. Documentação do provedor: https://opencep.com/.

Verificação: testes de consulta, retentativa, concorrência, autorização e ausência de gravação; testes do assistente e build do contador. Em produção, a verificação termina na conferência, sem acionar emissão. O bloqueio de 2027 permanece no resolvedor fiscal existente.
