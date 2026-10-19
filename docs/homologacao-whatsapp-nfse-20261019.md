# Homologação isolada WhatsApp / NFS-e — 19/10/2026

## Escopo e estado

Base: `0fde3bb7a5cab8fa180d932cdc2d18fe592f3fba`; branch `codex/homologacao-whatsapp-nfse-20261019`.
O usuário pediu emissão de R$ 1, DANFSe e cancelamento sem afetar produção. Após não conseguir acessar o Meta, pediu testar de outra forma. A execução desta etapa é **local, com PostgreSQL descartável e provedores fiscais/Meta simulados**. Não comprova homologação externa, assinatura aceita, recibo Meta nem recebimento no celular. Não houve publicação, alteração de canais/webhooks operacionais, leitura de certificados ou ato fiscal externo.

Referência canônica e cópia versionada conferidas: SHA256 `c1f80393382c5cc2d6ef1cbfe6b5841e0def479d57d4721dc3c99f83ab73bc94`. Adequação às regras R19/R20/R22/R29; nenhuma nova regra fiscal. Decisões de negócio pendentes permanecem pendentes.

## Correções e isolamento

- A guarda NFS-e exige HTTPS e hostname Sefin exato do ambiente; recusa credenciais, portas alternativas, query/fragmento e caminhos que substituam a origem. Redirects desabilitados. A conferência antecede certificado, reserva de numeração, claim e gravações, preservando autorização e titularidade.
- A proteção de cancelamento é por empresa/chave fiscal, compartilhada entre conversas. Reserva persistente e exclusão concorrente impedem repetir evento após interrupção ou resultado incerto. Uma recusa comprovadamente anterior ao envio pode ser corrigida; incerteza não é prova de recusa. Reserva aceita/incerta não deve ser apagada para liberar repetição.
- Preflight exige ambiente `homolog` explícito, transporte `fake`, confirmação de banco descartável, PostgreSQL em IP literal `127.0.0.1` e nome terminado em `_governance_test`, sem parâmetros alternativos. O banco é conferido depois da conexão.
- Subprocessos recebem somente ambiente permitido, sem tokens, proxies, certificados ou preload herdado; não carregam `.env` operacional. Rede JavaScript bloqueada antes dos imports. O engine nativo Prisma acessa exclusivamente a URL local validada. Isso não é firewall de sistema nem homologação de módulos nativos arbitrários.
- Não usar `TesteIaWhatsapp` para liberar atos fiscais: R29 continua exigindo ferramentas sem efeitos operacionais nessa sessão.

## Ensaio reproduzível

Entrada: `apps/api/scripts/verify-homologacao-whatsapp-nfse-postgres.mjs --execute`.
O Principal prepara o banco e fornece `HOMOLOGACAO_DATABASE_URL`, `HOMOLOGACAO_CONFIRMACAO=BANCO_DESCARTAVEL_SEM_REDE_EXTERNA`, `NFSE_ENV=homolog` e `NFSE_BASE_URL` homologada. `--preflight` só verifica configuração; não prova conexão ou ciclo.

O wrapper executa testes fiscais com transporte/assinatura simulados, regressões PostgreSQL da emissão e DANFSe, e o ciclo único em `verify-homologacao-whatsapp-nfse-ciclo-postgres.mjs`:

1. Confirmação e executor reais persistem uma nota sintética de R$ 1 por fronteira fiscal falsa.
2. O DANFSe é gerado do mesmo XML/nota, com conferência de valor, chave, hash e persistência do arquivo.
3. Cliente Cloud real usa transporte falso; reserva, correlação e replay são verificados.
4. Cancelamento confirmado percorre o executor real e atualiza a mesma nota; evento fiscal permanece simulado.
5. Resultados incertos, repetição, mudança de conversa e concorrência são exercitados sem repetir atos.

Entrada pelo webhook é validada separadamente: Express, raw body e HMAC reais, parsing, vínculo empresarial e reentrega. Menu/coleta/resumo/confirmação são cobertos pelas suítes de emissão e confirmação guiadas. Esta composição não é uma única conversa externa ponta a ponta. Não houve chamada a um modelo de IA real nesta etapa.

## Evidências e revisão

O runtime iniciou `2026-10-19T09-09-51-899Z-a52dcec2`. Seu executor foi impedido de iniciar Node pelo sandbox; o Principal executou os testes no ambiente autorizado. A rodada foi interrompida após reprovação independente da guarda tardia; não recebeu `ready_for_human`. Journal, fontes e lock arquivado foram preservados. A continuação usa autores/revisores nativos separados e os gates existentes, sem alteração da governança.

- Primeira bateria: 227 testes aprovados; ensaios PostgreSQL antigos aprovados, sem demonstrar ciclo único.
- Reprovação P1: guarda após certificado/reserva. Corrigida; 322 testes/9 suítes, incluindo 25 sentinelas dos métodos reais. Revisor `audit_isolation_design` confirmou a correção.
- Reprovação R20: novo pedido de cancelamento após resultado incerto. Reproduzida no ciclo local, sem segundo evento. Correção e revisão final registradas no relatório de governança deste incremento.
- Webhook/identidade: 75 testes/4 suítes aprovados. Builds web e portal aprovados; avisos de tamanho dos bundles permanecem.
- Resultados finais, hashes e pendências: `docs/governance/changes/homologacao-whatsapp-nfse-20261019.json`. Evidências detalhadas locais em `.altan-governance/`, não publicar logs brutos.

## Limites e próxima etapa externa

Não foi criado canal Meta de teste nem ambiente Railway de homologação; o inventário encontrou somente produção. A aba Meta foi encerrada após a mudança de orientação do usuário. Os dados deste ensaio são sintéticos e não usam a empresa, o tomador ou o telefone operacionais.

Para comprovar o percurso externo, será necessário canal/remetente de teste, webhook HTTPS independente, banco/storage/filas e credenciais separados, identidade fiscal e certificado autorizados, configuração tributária válida e bloqueio de destinos produtivos. Capturar autorização fiscal, XML/ambiente, hash do PDF, recibo Meta e evento de cancelamento. Não substituir indisponibilidade de homologação por emissão fictícia em produção.

O catálogo oficial consultado aponta Sefin restrita em `https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/docs/index` e ADN restrito em `https://adn.producaorestrita.nfse.gov.br/contribuintes/docs/index.html`. O caminho de fixtures locais não comprova disponibilidade desses endpoints.

## Reversão e operação

Sem migration, mudança de audiência ou configuração persistida em produção. Reverter somente código do incremento após revisão, preservando documentos, ações e reservas. A proteção usa registros operacionais de reserva; não apagar um estado incerto/aceito para liberar retry. Conferência de cancelamento externo incerto permanece supervisionada, sem recuperação automática nova neste escopo. Não há publicação autorizada por esta validação local; este pedido exige preservar produção.

## Fechamento da validação local

API integral final: 618 suítes / 10.894 testes aprovados; a única suíte/teste condicional PostgreSQL foi executada separadamente e passou. Total descoberto: 619 suítes / 10.895 testes. Interface: 498 suítes / 5.567 testes. Portal: 99 suítes / 1.580 testes. Builds, 63 testes da governança, diff e registro de impacto aprovados.

A primeira API falhou por fixture antiga sem client no executor de cancelamento. Foi corrigida somente a simulação, preservando as asserções e acrescentando reserva ACEITO; revisão independente e repetição integral aprovadas. A primeira execução web foi interrompida por memória; a segunda, sequencial, passou integralmente. Nenhuma rodada interrompida foi considerada aprovação.

PDF final inspecionado visualmente: legível, uma página, R$ 1, ambiente 2, sem validade jurídica. Valores e estado da fixture foram coerentemente ajustados somente em memória; isso não valida tributação de uma empresa real. SHA256 do PDF persistido: `d8189539dfa49f9082274a642b172b7e29468aca77f346c6dde64c8d4224e242`.

Snapshot final de fontes: `a2d733abf268dbbebb75ee6e2cfa12a6689d4b8298d1e9c77fc9d268e4966cc5`, 3.355 arquivos, conferido sem alterações após os testes. Revisores independentes aprovaram os deltas; não houve publicação. Banco descartável encerrado após conferir ausência de conexões, mantendo provas locais. A validação externa permanece não realizada.

## Integração autorizada — 19/10/2026

Após a validação local, o usuário autorizou PR, integração em main e publicação em produção, condicionadas ao CI e às revisões. A autorização substitui a restrição de publicação da etapa anterior; não permite emitir ou cancelar notas reais como teste, enviar mensagens, trocar ambientes ou alterar enquadramentos fiscais.

O gate adicional IBS/CBS/NBS confere configuração, catálogo terminal, compatibilidade e vigência, uso no XML e invalidação do resumo após mudança. Uma revisão encontrou ausência de aviso no resumo WhatsApp quando o perfil declara IBS/CBS facultativo mas a integração está desligada; o delta de correção preserva a decisão fiscal existente e o bloqueio de obrigação não atendida.

Reversão: não apagar reservas aceitas/incertas. A versão anterior não conhece a nova reserva de cancelamento por empresa/chave; drenar instâncias e avaliar essas reservas antes de qualquer retorno ao executor legado. Preferir correção progressiva preservando as travas. A publicação e seus checks serão registrados pelo Principal após comprovação, sem confundir preparação com deploy concluído.

### Resultado do gate IBS/CBS/NBS

Auditoria dirigida: 182 testes/7 suítes aprovados. O aviso omitido foi corrigido sem mudar exigibilidade, códigos ou XML. A preparação real agora entrega o aviso ao corpo persistido e ao texto de confirmação; 85 testes/2 suítes passaram, incluindo integração ligada/desligada e bloqueio quando obrigatório. Estes totais se sobrepõem às suítes gerais, não são testes únicos adicionais.

Snapshot após esse delta de três arquivos: `33b833395e36075f0e273dd0ef3a4fef9879737aec81deab6e95cc07bcf0b342`. O snapshot anterior permanece como evidência das baterias completas; a nova versão deve passar também no CI do PR. Catálogos RTC são snapshot de 05/10/2026; a conferência técnica não certifica enquadramento individual nem suporte irrestrito a 2027. Não foi alterada configuração fiscal de empresa.
