# Desempenho da confirmação

Este documento registra as primeiras otimizações. A investigação posterior, com EXPLAIN ANALYZE, correções, comparação antes/depois e testes, está no [relatório completo](performance-investigation.md).

## Diagnóstico de 25/09/2026

Estatísticas de chamadas já existentes no Supabase, sem alterar respostas de convidados:

| Operação | Amostra | Duração |
| --- | --- | --- |
| Busca SQL | 35 chamadas | média 8,8 ms; máximo 57,8 ms |
| Limite de tentativas SQL | 43 chamadas | média 4,3 ms |
| Edge Function v2, POST | 9 chamadas | mediana 297 ms; máximo 962 ms |
| Preflight OPTIONS | 9 chamadas | média 132 ms |

Banco e função estavam em São Paulo. Os índices parciais para nome completo e alternativo já atendiam à consulta. Esses dados medem o trabalho observado no servidor; não incluem todo o tempo percebido no celular.

## Alterações

- O formulário envia uma requisição POST com `Content-Type: text/plain;charset=UTF-8`. A chave pública segue no corpo e continua sendo validada no servidor. Nome, palavra-chave e tokens nunca são enviados na URL.
- A origem continua restrita. Clientes anteriores com cabeçalho `apikey` permanecem compatíveis e podem reaproveitar o preflight por até um dia, conforme o limite do navegador.
- `rsvp_request` reúne limite de tentativas, validação da palavra e consulta/escrita em uma única transação. Somente `service_role` pode executar essa função.
- A página abre a conexão com o Supabase antecipadamente usando `preconnect`.
- O código administrativo e o cliente Auth são carregados sob demanda, fora do pacote inicial do convite.
- O build reduziu o JavaScript inicial de 467,97 kB (132,40 kB gzip) para 178,38 kB (57,30 kB gzip): cerca de 57% menos transferência comprimida. O código administrativo agora tem um arquivo separado, carregado apenas no painel.
- A atualização do prazo só renderiza o formulário quando o estado do prazo muda. A contagem regressiva tem seu próprio componente e continua atualizando os segundos.
- Não há cache de convidados nem reenvio automático de confirmações. Dados continuam vindo do servidor.
- A resposta da Edge Function inclui `Server-Timing` para futuras investigações sem registrar nomes, palavras-chave ou tokens.

O prazo máximo de requisição evita esperas indefinidas em falhas de rede. Ele não acrescenta atraso às respostas normais.

## Revisão de permissões

O catálogo do banco confirma que `rsvp_request` usa `security invoker`, não permite execução por `anon` ou `authenticated` e permite execução por `service_role`. O advisor preserva as três informações sobre RLS sem políticas nas tabelas internas, que não têm acesso público. Também aponta a [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) na configuração Auth existente.
