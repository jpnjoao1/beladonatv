# TV Beladona — sinalização digital das unidades

Software para controlar os vídeos que passam nas TVs das lojas. Você envia os vídeos pelo
**painel** (do computador) e cada TV, via **Fire TV Stick**, baixa e reproduz em loop —
**continua tocando mesmo se a internet da loja cair** (offline-first).

```
┌─────────────┐        ┌──────────────────────┐        ┌──────────────────────┐
│  Você (PC)  │  HTTP  │   Servidor (Fly.io)  │  HTTP  │  Fire TV Stick (loja) │
│   Painel    ├───────►│  painel + API + CDN  │◄───────┤  APK WebView + cache  │
└─────────────┘        │  vídeos no volume    │        │  toca do arquivo local│
                       └──────────────────────┘        └──────────────────────┘
```

## Estrutura

| Pasta | O que é |
|---|---|
| `server.js`, `lib/`, `public/` | Servidor Node (painel + API + streaming). Banco = `data/db.json`. |
| `public/panel.html` | Painel: upload de vídeos, telas, playlists, status ao vivo. |
| `public/player.html` | Player. Roda no navegador (teste) **e** dentro do APK (produção). Fonte única. |
| `android/` | APK do Fire TV (WebView que empacota o `player.html`). |

> **Fonte única do player:** ao editar `public/player.html`, rode `sync-player.ps1` para copiar
> a nova versão para `android/app/src/main/assets/web/` antes de gerar o APK.

---

## 1. Rodar o servidor localmente (teste)

```bash
npm install
set PANEL_PASSWORD=suasenha  &&  npm start      # Windows: use "set"; Linux/Mac: PANEL_PASSWORD=... npm start
```

Abra <http://localhost:3000> (senha padrão `beladona` se não definir `PANEL_PASSWORD`).
Para testar o player no navegador: <http://localhost:3000/player> (teclado simula o controle:
letras/números digitam o código, **Enter** confirma, **Backspace** apaga, **-** hífen, **←/→** troca de vídeo).

## 2. Publicar no Fly.io

```bash
fly launch --no-deploy          # aceite reusar o fly.toml; escolha um nome único (edite app = "...")
fly volumes create tv_data --size 10 --region gru
fly secrets set PANEL_PASSWORD=umaSenhaForte
fly deploy
```

Anote a URL final (ex.: `https://beladonatv.fly.dev`). O painel fica nessa URL.

## 3. Gerar o APK do Fire TV

1. Edite `android/app/src/main/res/values/strings.xml` → `server_url` com a URL do Fly (sem barra final).
2. Rode `sync-player.ps1` (copia o player para os assets).
3. Gere o APK:
   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   cd android
   .\gradlew.bat assembleDebug
   ```
   APK em `android/app/build/outputs/apk/debug/app-debug.apk`.

## 4. Instalar no Fire TV Stick

1. No Fire TV: **Configurações → Meu Fire TV → Opções do desenvolvedor → Apps de fontes desconhecidas: ON**.
2. Instale o **Downloader** (loja da Amazon) ou use `adb install app-debug.apk` pelo PC.
3. Pelo Downloader, hospede o APK (ex.: link direto) ou use um pendrive + gerenciador de arquivos.
4. Abra o app **TV Beladona**. Na 1ª vez, **digite o código da tela** (o mesmo cadastrado no painel,
   ex.: `CENTRO-01`) e confirme com OK. Pronto — ele passa a baixar e tocar a playlist.

> **Auto-start:** o app tenta iniciar sozinho quando a TV liga. Em alguns Fire OS o auto-start
> é limitado; se precisar, use um app tipo "Launch on Boot" ou deixe o Fire TV sempre ligado.

---

## Como usar no dia a dia

1. Abra o painel (URL do Fly), faça login.
2. **Biblioteca de vídeos:** envie os `.mp4`. Recomendado H.264/AAC, 1080p, bitrate moderado.
3. **Telas / Unidades:** cadastre cada tela com um código (ex.: `CENTRO-01`, `SHOPPING-01`).
4. Clique numa tela → marque os vídeos e ordene → **Salvar playlist**.
5. A TV pega a mudança na próxima sincronização (até 5 min). O ponto 🟢/🔴 mostra se está online.

## Limites e cuidados

- **Espaço no Fire Stick:** ~5 GB livres. O painel mostra o espaço livre reportado por cada TV.
  Mantenha a playlist dentro disso (aprox. 30–40 min de vídeo 1080p).
- **Formato:** use `.mp4` (H.264 + AAC). É o que toca sem dor de cabeça no WebView do Fire OS.
- **Senha:** troque `PANEL_PASSWORD` em produção (`fly secrets set ...`).
- **Backup:** os vídeos e o `db.json` vivem no volume do Fly. Baixe cópias de vez em quando.

## Roadmap (próximas fases)

- Agendamento por horário/dia da semana.
- Atualização remota do `player.html` sem regerar o APK (mecanismo `version.json`, como no acuidade-visual).
- Sobreposição de preço/banner sobre o vídeo.
- Alerta automático (e-mail/WhatsApp) quando uma tela fica offline.
