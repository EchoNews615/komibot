# KomiSite (VM2) — API + UI Jeovany Dev
- Endpoints: /api/members, /api/history/:month, /api/logs, /api/punish/{warn|mute|ban}, /api/ticket, /api/export/monthly, /api/memberSync*, /api/clear/*
- UI estática pronta em `frontend_build/` com Tailwind (CDN). Você pode evoluir com React em `frontend/` e publicar com `npm run build:frontend`.

## Rodar
```
npm install
cp .env.example .env
node server.js
```
