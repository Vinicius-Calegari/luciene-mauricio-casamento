# Verificação antes da publicação

Verificado em 24/09/2026 contra o projeto Supabase e em navegador Edge isolado.

- Ativação por convite privado e login dos dois perfis.
- Isolamento de convidados por lado no banco, incluindo bloqueio de escrita no outro lado.
- Tabelas privadas e RPCs privilegiadas inacessíveis à chave pública.
- Busca com acentos, caixa e espaços normalizados; homônimos com confirmação adicional.
- Confirmação e recado privados persistidos; alteração da resposta preserva o recado existente.
- Prazo validado no servidor; limite de 20 tentativas por IP e janela de 15 minutos.
- Recados compartilhados somente entre os noivos; favoritos e leitura persistidos.
- Rascunho invisível ao público, publicação e versões anteriores.
- Avisos ocultos e expirados removidos da resposta pública pelo servidor.
- Exclusão lógica, desfazer, restauração e tarefa diária para exclusão após 30 dias.
- Histórico imutável pelos usuários, sem texto de recados ou telefones nos valores auditados.
- PDF contendo somente confirmados; download validado no navegador.
- Cadastro, edição, RSVP, recados e publicação executados pela interface.
- Páginas públicas e painel sem rolagem horizontal a 360 px; 14 capturas de revisão visual.
- Build TypeScript/Vite concluído e auditoria npm sem vulnerabilidades conhecidas.

Os usuários e convidados temporários foram removidos após os testes. O projeto de produção começa sem convidados, com dois convites privados de ativação disponíveis.

O advisor do Supabase apresenta apenas três informações `RLS Enabled No Policy` nas tabelas internas de convites, tentativas e sessões. É intencional: os clientes não recebem políticas de acesso a essas tabelas, utilizadas exclusivamente pelo serviço no servidor. [Referência do advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Dados do evento ainda não fornecidos (data, local e programação) são preenchidos no painel. Nenhuma data ou endereço fictício é publicado.
