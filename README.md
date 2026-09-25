# Luciene & Mauricio

Convite de casamento com confirmação de presença e painel privado dos noivos.

- [Site público](https://vinicius-calegari.github.io/luciene-mauricio-casamento/)
- [Painel dos noivos](https://vinicius-calegari.github.io/luciene-mauricio-casamento/?painel=1)

## Usar o painel

1. Abra o painel e clique em **Primeiro acesso? Ativar minha conta**.
2. Informe o código privado correspondente a Luciene ou Mauricio, seu e-mail e uma senha com pelo menos 12 caracteres. Cada código funciona uma única vez.
3. Depois da ativação, entre com o e-mail e a senha escolhidos.
4. Em **Configurações**, preencha a data, o horário e o prazo de confirmação. Em **Informações**, edite a programação, os locais e os avisos; salve um rascunho ou publique para atualizar o convite.
5. Cadastre os convidados individualmente ou importe um CSV com as colunas `Nome`, `WhatsApp` e `Nome alternativo`.

Os códigos iniciais foram entregues em um arquivo local privado. Eles não fazem parte deste repositório. As informações reais do evento e a lista de convidados devem ser preenchidas pelos noivos.

Cada pessoa gerencia sua própria lista de convidados. Os noivos compartilham informações do evento, recados e histórico de atividades. O painel inclui filtros, exportação CSV/PDF, favoritos, lixeira com restauração por até 30 dias e mensagens prontas para abrir no WhatsApp. O envio pelo WhatsApp é manual.

No convite público, o convidado informa a palavra-chave recebida no convite e busca seu nome completo ou nome alternativo cadastrado. A busca ignora acentos, maiúsculas e espaços extras; a grafia precisa corresponder ao cadastro. Depois, confirma ou recusa a presença e pode deixar um recado privado. Quando há nomes iguais, são solicitados os quatro últimos dígitos do telefone cadastrado. As respostas podem ser alteradas até o prazo configurado.

Os cadastros são salvos no Supabase e consultados por todos os aparelhos. Convidados na lixeira ficam fora da busca pública; use **Lixeira → Restaurar** para recuperá-los. Se um nome não for encontrado, confira primeiro o cadastro ativo e a grafia do nome completo ou alternativo.

A palavra-chave é validada no servidor na busca e no envio da resposta, com limite de tentativas. O valor esperado não é enviado no JavaScript do site nem exibido no formulário. Para trocar a palavra, aplique uma migração atualizando o SHA-256 esperado na função SQL `rsvp_request`. Espaços no início/fim e diferenças entre maiúsculas e minúsculas são ignorados.

O convite e a confirmação usam requisições públicas independentes da sessão do painel. A busca usa um POST sem preflight e uma chamada ao banco para validar o limite de tentativas, a palavra-chave e localizar o convidado. O painel e o Supabase Auth são carregados apenas ao abrir a área privada. O limite de 15 segundos é uma proteção para falhas de conexão; não há espera artificial. Respostas e ativações não são reenviadas automaticamente.

## Desenvolvimento

Requer Node.js 22 e npm.

```sh
npm ci
```

Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com a URL e a chave pública do projeto Supabase. A chave `service_role` nunca deve ser colocada em variáveis `VITE_*`.

```sh
npm run dev
npm run build -- --base=/luciene-mauricio-casamento/
```

O aplicativo usa React, TypeScript e Vite. O Supabase fornece Postgres, autenticação e a Edge Function `public-rsvp`. As migrações ficam em `supabase/migrations/`; as políticas RLS protegem os dados e a função pública aplica limites de uso e tokens de confirmação com validade.

## Publicação

O site é publicado pelo GitHub Pages. Cada push em `main` executa `.github/workflows/deploy-pages.yml`, instala as dependências, compila e publica `dist/`. O workflow também pode ser acionado manualmente em **Actions**.

As variáveis de repositório `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` fornecem a configuração pública ao build. Alterações no banco ou na Edge Function devem ser aplicadas separadamente ao projeto Supabase antes de publicar código que dependa delas.

Não versionar `.env.local`, `private/`, senhas, códigos de ativação ou chaves administrativas. O arquivo `netlify.toml` contém uma configuração alternativa de hospedagem; a publicação principal usa GitHub Pages.
