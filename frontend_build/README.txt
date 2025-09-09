KomiBot - Static frontend (no build)

O pacote contém um frontend estático pronto para ser colocado na pasta `frontend_build` do seu projeto Render.
Ele não precisa de build. Instruções:

1. Baixe e extraia o conteúdo deste zip **dentro** da pasta `frontend_build` no seu repositório Render.
   - Após extrair, a URL raiz do site (/) servirá este painel.
   - Ex: `frontend_build/index.html`, `frontend_build/style.css`, `frontend_build/app.js`, `frontend_build/privacy.html`

2. Certifique-se de que o backend do Render está servindo as rotas API em `/api/*` (mesmo domínio).
   - O frontend faz requisição para `/api/members` (relative URL), então o backend deve estar no mesmo domínio.
   - Se o backend exigir `x-api-key`, ajuste o backend ou remova a checagem (recomendado durante testes).

3. Funcionalidades:
   - Dark / Light theme (salvo no localStorage)
   - Intervalo de atualização (1s, 2s, 5s, 10s, 30s, 1min) ou desligar
   - Busca instantânea por nome ou id
   - Estatísticas de alto nível
   - Página de Política de Privacidade (`/privacy`)

4. Problemas comuns:
   - Se `/api/members` retornar `401`, desative temporariamente a checagem do header `x-api-key` no backend.
   - Se não aparecer nada, abra o console do navegador (F12) e veja erros de rede.

Se quiser, posso customizar cores, logo, tipografia ou gerar uma versão com assets (logo SVG, ícones) e instruções específicas para CI/CD com Render.
