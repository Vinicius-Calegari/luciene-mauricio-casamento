# Investigação de desempenho — 25/09/2026

## Resultado e limite da conclusão

O banco é **Postgres no Supabase**, região São Paulo (`sa-east-1`). O frontend é React/TypeScript/Vite, publicado no GitHub Pages. A confirmação usa a Edge Function `public-rsvp` e funções SQL; não há ORM.

**A execução SQL não explica a espera de minutos relatada no celular.** Os SELECTs executam abaixo de 1 ms. Há variação mensurável na comunicação navegador → gateway → Edge → API REST → Postgres. Nenhuma chamada de minutos foi reproduzida no computador. O usuário não tem conexão móvel disponível para comparar com o Wi-Fi; a causa específica nesse celular permanece sem confirmação.

Foram aplicadas otimizações conservadoras, testes e medições por etapa. Não se atribui ao SQL a redução observada de latência HTTP, nem se considera o problema do celular encerrado com base nestas amostras.

## Descoberta e diagnóstico

- Configuração pública: `.env.local` e variáveis GitHub `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. A chave administrativa permanece apenas no servidor.
- Caminho público: um POST para `functions/v1/public-rsvp`, uma RPC `rsvp_request`, validação da palavra, limite de tentativas e busca na mesma transação.
- Na captura inicial: **1 convidado ativo**, 0 na lixeira, 20 registros de auditoria; tabela de convidados com heap de 8 KiB e índices de 80 KiB. Volume sem justificativa para particionamento ou cache de convidados.
- Índices existentes: `guests_name_active(full_name_key)` e `guests_alt_active(alt_name_key)`, ambos parciais para convidados ativos; além dos índices por proprietário/data e lixeira.
- Primeiros planos usaram `guests_name_active`: contagem em 0,067 ms e leitura em 0,044 ms, dois blocos em cache por consulta e zero leitura de disco.
- Em uma comparação posterior com uma linha estimada, o planejador escolheu `Seq Scan` de **um único bloco** para ambas as versões. É um plano adequado ao tamanho atual; não se forçou índice nem se criou índice duplicado.
- Snapshot de capacidade: 11 conexões de um máximo de 60; cinco conexões PostgREST ociosas. Zero espera por lock, zero deadlocks e zero spill temporário. Isso não mede filas externas ou outras horas.
- `pg_stat_statements` na captura inicial: RPC completa `rsvp_request`, 3 chamadas, média 30,447 ms, máximo 60,715 ms. As chamadas REST correspondentes registraram 65 / 614 / 1.466 ms. O custo observado está principalmente fora da execução SQL.
- Não há N+1. O painel faz quatro consultas independentes, com lotes de 500 linhas e paginação visual. Ainda reúne todas as páginas para totais, exportações e filtros; a paginação integral no servidor fica indicada se o volume crescer. Isso não participa da busca pública.

## Mudanças aplicadas

### SQL: uma leitura limitada em vez de contagem e releitura

Migration: [`20260925150312_rsvp_bounded_lookup.sql`](../supabase/migrations/20260925150312_rsvp_bounded_lookup.sql).

- Remove `COUNT(*)` seguido de `SELECT *` no caminho normal.
- Lê apenas `id`, `full_name`, `status`, com `LIMIT 2`: basta distinguir nenhum, um ou vários convidados.
- Havendo homônimos, busca novamente no conjunto completo pelo sufixo do telefone, também limitado a duas correspondências. O terceiro homônimo continua localizável.
- Preserva normalização, apelidos, lixeira, sessão de uma hora e permissões exclusivas de `service_role`.
- Não foram adicionados índices: os existentes atendem ao caso. A otimização reduz trabalho redundante, mas é pequena no volume atual.
- Os nomes dos arquivos de migrations foram alinhados às versões realmente registradas no Supabase. Isso evita tentar reaplicar migrations existentes em um futuro `db push`; o conteúdo das quatro anteriores foi preservado.

### Painel

- Eventos de foco e atualizações periódicas não iniciam outro carregamento enquanto há um em andamento.
- Atualização após salvar continua prioritária; respostas antigas não sobrescrevem os dados mais recentes.
- Mutações retornam somente `id` ou `singleton`, em vez do registro completo.

### Servidor e observabilidade

- RPC de busca/resposta com prazo de 8 segundos, cobrindo também a leitura do corpo. É proteção contra espera indefinida, não ganho de velocidade nem repetição automática.
- `Server-Timing` separa duração da aplicação (`app`) e ida/volta à API do banco (`db`). **`db` inclui HTTP/gateway/PostgREST; não é tempo SQL puro.**
- `X-Request-Id` correlaciona a resposta com logs de operação, status e duração. Logs não registram nome, IP, telefone, recado, palavra-chave ou token.
- Falha de comunicação após enviar presença orienta consultar novamente antes de reenviar, pois uma escrita pode ter sido concluída.
- Conexão direta Postgres foi experimentada e retirada: três buscas válidas tiveram mediana de 991,6 ms, contra 353,4 ms no controle REST próximo. Não justificou a dependência adicional.

As otimizações anteriores permanecem: POST público sem preflight, RPC única, `preconnect` e painel/Auth carregados sob demanda. A separação anterior reduziu o JavaScript inicial comprimido de 132,40 kB para 57,30 kB; essa redução de download não comprova a resolução da espera no celular.

## Antes e depois

### SELECTs, mesma transação de diagnóstico

| Medida | Antes: COUNT + SELECT * | Depois: SELECT limitado |
|---|---:|---:|
| Consultas para um nome único | 2 | 1 |
| Execução dos SELECTs | 0,076 + 0,023 = **0,099 ms** | **0,027 ms** |
| Blocos em cache | 1 + 1 | 1 |
| Largura estimada da linha do convidado | 382 bytes | 80 bytes |
| Blocos lidos de disco | 0 | 0 |

Esses tempos excluem PL/pgSQL, criação da sessão, limite de tentativas e rede. São uma captura de microtempos, sujeitos a variação; não uma distribuição estável nem prova de aceleração perceptível no celular.

### Requisição HTTP completa no computador

Mesmo convidado e palavra, três processos `curl` por etapa, sem enviar presença ou recado. Inclui DNS, TCP, TLS e download da resposta. Todas as seis buscas encontraram o convite com HTTP 200.

| Amostra | Antes | Depois |
|---|---:|---:|
| 1 | 1.035,5 ms | 1.266,6 ms |
| 2 | 523,6 ms | 292,5 ms |
| 3 | 308,6 ms | 248,4 ms |
| **Mediana** | **523,6 ms** | **292,5 ms** |
| **Máximo observado** | **1.035,5 ms** | **1.266,6 ms** |

A mediana observada foi 44% menor, mas o máximo aumentou. Com apenas três amostras por etapa e variação de rede, não há base para prometer esse ganho ou atribuí-lo à migration.

Na etapa posterior, a função mediu 251,7 / 111,7 / 55,5 ms; a comunicação interna com a API do banco respondeu por 249,5 / 110,5 / 54,3 ms. A diferença entre esses tempos e o total evidencia também o custo fora da função.

## Validação e reprodução

- **47 testes automatizados aprovados**: 16 do transporte público e 31 da Edge. Executam os arquivos TypeScript reais com rede simulada; não acessam dados reais.
- **24 cenários SQL aprovados antes e depois**: nome exato, acentos, espaços, apelidos, homônimos, terceiro homônimo, telefone, lixeira, campos retornados, sessões e permissões. Fixtures, auditoria e sessões desses testes foram revertidas por `ROLLBACK`.
- `npm run build` aprovado (TypeScript e Vite).
- GitHub Actions passa a executar `npm test` antes do build e publicação.

```sh
npm test
npm run build -- --base=/luciene-mauricio-casamento/
```

No SQL Editor, executar o arquivo inteiro:

- [`scripts/diagnose-rsvp.sql`](../scripts/diagnose-rsvp.sql): somente leitura, planos antes/depois, índices, volumes, estatísticas e conexões. Não retorna nomes nem cria sessões.
- [`tests/rsvp-lookup-contract.sql`](../tests/rsvp-lookup-contract.sql): fixtures isoladas em transação com rollback. Não executar trechos separados.

Para repetir a medição HTTP, usar [`scripts/measure-rsvp.mjs`](../scripts/measure-rsvp.mjs), conforme README. Os dados de entrada ficam em `private/`, fora do Git. As buscas reais criam sessões temporárias e contam para o limite de tentativas; não repetir em loop.

## Revisão dos advisors

Nenhum aviso de performance identifica a busca como lenta. Há uma [FK sem índice](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) em `private.admin_invites.user_id`, tabela com apenas dois convites administrativos e fora da busca pública; não justifica índice para este problema. O índice alternativo aparece como [ainda não usado](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) neste pequeno volume e foi preservado para busca por apelidos.

Permanecem três informações de [RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) nas tabelas privadas, intencionalmente inacessíveis ao cliente, e o aviso existente de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Esses avisos não explicam a latência observada.
