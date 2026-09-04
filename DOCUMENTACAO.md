# UATU — Documentação Completa do Código

## Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Fluxo de Dados](#fluxo-de-dados)
4. [Variáveis de Ambiente](#variáveis-de-ambiente)
5. [Servidor (`server/`)](#servidor-server)
6. [Cliente — Viewer (`client/src/main.js`)](#cliente--viewer-clientsrcmainjs)
7. [Cliente — Screen Share (`client/src/screenshare.js`)](#cliente--screen-share-clientsrcscreensharejs)
8. [Cliente — Presenter (`client/src/presenter.js`)](#cliente--presenter-clientsrcpresenterjs)
9. [HTML e CSS](#html-e-css)
10. [Configuração do Vite](#configuração-do-vite)
11. [Dependências](#dependências)
12. [Diagrama de Sequência](#diagrama-de-sequência)

---

## Visão Geral

**UATU** é uma Discord Activity (aplicação embutida no Discord) que permite a um ou mais **apresentadores** compartilharem suas telas com todos os membros de um canal de voz do Discord, em tempo real, utilizando o serviço [LiveKit](https://livekit.io/) como infraestrutura de WebRTC.

O nome "UATU" faz referência ao Vigia (The Watcher) da Marvel — a ideia central é **assistir/observar** o que os apresentadores transmitem.

### Papéis

| Papel | Descrição |
|---|---|
| **Viewer (espectador)** | Usuário do Discord que abre a Activity dentro de um canal de voz. Autenticado via OAuth2 do Discord. Vê cards de todos os participantes e assiste streams com controles de volume e tela cheia. |
| **Presenter (apresentador)** | Pessoa que abre a página `presenter.html` (via botão "Transmitir" ou diretamente). Captura a tela e publica o stream na sala LiveKit. Múltiplos apresentadores podem transmitir ao mesmo tempo. |

### Stack Tecnológica

- **Frontend**: Vanilla JS + Vite (sem framework)
- **Backend**: Node.js + Express
- **Streaming**: LiveKit (WebRTC)
- **Autenticação**: Discord OAuth2 + Discord Embedded App SDK
- **Proxy de desenvolvimento**: Vite dev server com proxy para `/api`

---

## Arquitetura

```
┌──────────────────────────────────────────────────────┐
│                    DISCORD                            │
│  ┌─────────────────────────────────────────────────┐  │
│  │  Discord Activity (iframe)                      │  │
│  │  index.html + main.js + screenshare.js          │  │
│  │  Viewer: grid de participantes + streams        │  │
│  └───────────────────┬─────────────────────────────┘  │
│                      │ /.proxy/api/*                   │
│                      │ (Discord Activity Proxy)        │
└──────────────────────┼────────────────────────────────┘
                       │
                       ▼
            ┌─────────────────────┐
            │  Express Server     │
            │  server/server.js   │
            │  porta 3001         │
            │                     │
            │  POST /api/token    │
            │  POST /api/lk-token │
            │  POST /api/pres-tkn │
            └────────┬────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
  Discord API   LiveKit Cloud   Presenter(s)
  (OAuth2)      (WebRTC SFU)    (presenter.html)
                     ▲
                     │ publica vídeo/áudio
                     │
            ┌────────┴──────────┐
            │  Presenter Page   │
            │  presenter.html   │
            │  + presenter.js   │
            │  (1 ou mais)      │
            └───────────────────┘
```

---

## Fluxo de Dados

### 1. Fluxo do Viewer (espectador no Discord)

```
1.  Usuário abre a Activity no Discord
2.  main.js: discordSdk.ready()               → aguarda SDK inicializar
3.  main.js: discordSdk.commands.authorize()   → obtém OAuth2 "code"
4.  main.js: POST /.proxy/api/token {code}     → envia code ao servidor
5.  server.js: troca code por access_token     → chama Discord API
6.  main.js: discordSdk.commands.authenticate()→ autentica no SDK
7.  main.js: POST /.proxy/api/livekit-token    → pede token LiveKit
8.  server.js: gera JWT do LiveKit             → retorna token
9.  main.js: initFullscreenControls()          → configura overlay de tela cheia
10. screenshare.js: connectRoom(token)         → conecta na sala LiveKit
11. Para cada participante remoto              → cria card no grid
12. Para cada track de vídeo recebida          → exibe no card correspondente
13. Controles de volume e tela cheia           → disponíveis em cards com stream
14. Botão "Transmitir"                         → abre presenter.html em nova aba
```

### 2. Fluxo do Presenter (apresentador)

```
1. Apresentador abre presenter.html (via botão ou diretamente)
2. Clica em "Compartilhar tela"
3. presenter.js: POST /api/presenter-token    → pede token LiveKit
4. server.js: gera JWT do LiveKit             → retorna token + URL
5. presenter.js: room.connect(url, token)     → conecta na sala LiveKit
6. presenter.js: getDisplayMedia()            → captura tela + áudio
7. presenter.js: publishTrack()               → publica tracks na sala
8. Viewers recebem automaticamente via LiveKit → vídeo aparece no card do presenter
```

---

## Variáveis de Ambiente

Arquivo: `.env` (raiz do projeto)

| Variável | Uso | Onde é lida |
|---|---|---|
| `VITE_DISCORD_CLIENT_ID` | Client ID do app Discord. Prefixo `VITE_` expõe ao frontend via Vite. | `main.js`, `screenshare.js`, `server.js` |
| `DISCORD_CLIENT_ID` | Mesmo ID, usado pelo servidor (sem prefixo VITE). | `server.js` |
| `DISCORD_CLIENT_SECRET` | Secret do app Discord para OAuth2. **Nunca exposto ao frontend.** | `server.js` |
| `LIVEKIT_URL` | URL WebSocket do servidor LiveKit Cloud. | `server.js` |
| `LIVEKIT_API_KEY` | Chave da API LiveKit para gerar tokens JWT. | `server.js` |
| `LIVEKIT_API_SECRET` | Secret da API LiveKit para assinar tokens JWT. | `server.js` |
| `PORT` | Porta do Express (padrão: `3001`). | `server.js` |

---

## Servidor (`server/`)

### Arquivo: `server/server.js`

Servidor Express com 3 endpoints REST. Não serve arquivos estáticos — o Vite cuida disso em desenvolvimento.

---

### `POST /api/token`

**Propósito**: Troca o authorization code do Discord OAuth2 por um access_token real. Essa troca acontece no servidor para que o `client_secret` nunca seja exposto no frontend.

**Parâmetros do body (JSON)**:
| Campo | Tipo | Descrição |
|---|---|---|
| `code` | `string` | Authorization code retornado pelo `discordSdk.commands.authorize()` |

**Funcionamento interno**:
1. Recebe o `code` do body da requisição via destructuring.
2. Faz `POST` para `https://discord.com/api/oauth2/token` com:
   - `client_id`: ID do app Discord (variável de ambiente).
   - `client_secret`: Secret do app Discord (variável de ambiente).
   - `grant_type`: `"authorization_code"`.
   - `code`: O código recebido do frontend.
   - Content-Type: `application/x-www-form-urlencoded` (exigido pela API do Discord).
3. Parseia a resposta JSON do Discord.
4. Verifica se `data.access_token` existe:
   - **Sim**: Retorna `{ access_token }` com status 200.
   - **Não**: Loga o erro e retorna a resposta completa do Discord com status 400.
5. Em caso de exceção: retorna `{ error: "internal_error" }` com status 500.

---

### `POST /api/livekit-token`

**Propósito**: Gera um token JWT do LiveKit para um viewer (espectador do Discord) entrar na sala de streaming.

**Parâmetros do body (JSON)**: Nenhum é utilizado efetivamente (o body é ignorado).

**Funcionamento interno**:
1. Cria um `AccessToken` do LiveKit com:
   - `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` do `.env`.
   - `identity`: String única `discord-user-${Date.now()}` — garante identidade única por conexão.
2. Adiciona permissões (grant):
   - `room`: `"minha-activity-room"` — nome fixo da sala (hardcoded).
   - `roomJoin`: `true` — pode entrar na sala.
   - `canPublish`: `true` — pode publicar tracks.
   - `canSubscribe`: `true` — pode receber/assinar tracks de outros participantes.
3. Converte o token para JWT com `at.toJwt()` (async).
4. Retorna `{ livekitUrl, token }`.
5. Em caso de erro: retorna status 500 com `{ error: "internal_error" }`.

---

### `POST /api/presenter-token`

**Propósito**: Gera um token JWT do LiveKit para o apresentador. Idêntico ao endpoint de livekit-token, porém sem autenticação Discord prévia.

**Parâmetros do body (JSON)**: Nenhum.

**Funcionamento interno**:
1. Cria um `AccessToken` com identity `presenter-${Date.now()}`.
2. Mesmo grant do endpoint anterior:
   - Sala fixa `"minha-activity-room"`, `roomJoin`, `canPublish`, `canSubscribe` — todos `true`.
3. Retorna `{ livekitUrl, token }`.

**Diferença do `/api/livekit-token`**: Apenas o prefixo da identity (`presenter-` vs `discord-user-`). A sala é a mesma, garantindo que viewers e presenters estejam na mesma room do LiveKit.

---

### Inicialização do Servidor

```javascript
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => { ... });
```

Ouve na porta definida pela variável `PORT` ou `3001` por padrão. Middlewares: apenas `express.json()` para parsear bodies JSON.

---

## Cliente — Viewer (`client/src/main.js`)

### Arquivo: `client/src/main.js`

Ponto de entrada da Activity do Discord (carregado por `index.html`). Responsável por autenticar o usuário, conectar à sala LiveKit, e configurar a interface.

---

### Constante: `discordSdk`

```javascript
const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);
```

Instância do Discord Embedded App SDK. O `VITE_DISCORD_CLIENT_ID` é injetado pelo Vite em build time.

---

### Função: `setup()`

**Tipo**: `async function`
**Retorno**: Objeto `auth` retornado por `discordSdk.commands.authenticate()`.

**Funcionamento passo a passo**:

1. **`await discordSdk.ready()`** — Aguarda o SDK do Discord estar completamente inicializado.

2. **`await discordSdk.commands.authorize({...})`** — Inicia o fluxo OAuth2 do Discord dentro da Activity.
   - Parâmetros: `client_id`, `response_type: 'code'`, `state: ''`, `prompt: 'none'`, `scope: ['identify', 'guilds', 'applications.commands']`.
   - Retorna `{ code }`.

3. **`fetch('/.proxy/api/token', ...)`** — Envia o `code` ao servidor para troca por `access_token`. O prefixo `/.proxy/` é usado porque a Activity roda dentro de um iframe do Discord que roteia requisições via proxy.

4. **`await discordSdk.commands.authenticate({ access_token })`** — Autentica a sessão do SDK e retorna o objeto `auth`.

---

### Fluxo de execução após `setup()`

```javascript
setup()
  .then(async (auth) => { ... })
  .catch((err) => { ... });
```

1. Faz `POST /.proxy/api/livekit-token` para obter o token JWT do LiveKit.
2. Chama `initFullscreenControls()` para configurar o overlay de tela cheia.
3. Chama `connectRoom(token)` para conectar na sala e inicializar o grid de participantes.
4. Configura o botão "Transmitir" (`#broadcast-btn`) para abrir `presenter.html` em nova aba.
5. Em caso de erro: loga no console.

---

## Cliente — Screen Share (`client/src/screenshare.js`)

### Arquivo: `client/src/screenshare.js`

Módulo central que gerencia a conexão com a sala LiveKit, o grid de participantes, a exibição de streams remotos com controles de volume/tela cheia. Suporta múltiplos streams simultâneos.

---

### Variáveis de módulo

| Variável | Tipo | Descrição |
|---|---|---|
| `room` | `Room \| null` | Instância da sala LiveKit conectada. |
| `participants` | `Map<string, ParticipantData>` | Mapa de identidades para dados do participante (card, videoEl, audioEls). |
| `fullscreenIdentity` | `string \| null` | Identity do participante atualmente em tela cheia. |

### Tipo `ParticipantData` (implícito)

```
{
  card: HTMLDivElement,          // O card DOM do participante
  videoEl: HTMLVideoElement|null, // Elemento de vídeo (se transmitindo)
  audioEls: HTMLAudioElement[]   // Elementos de áudio associados
}
```

---

### Função: `getInitial(identity)`

**Tipo**: Função local
**Parâmetros**: `identity` (`string`) — identidade do participante no LiveKit.
**Retorno**: `string` — Primeira letra maiúscula do nome limpo.

Remove prefixos `presenter-` e `discord-user-` e retorna a primeira letra. Retorna `'?'` se vazio.

---

### Função: `getDisplayName(identity)`

**Tipo**: Função local
**Parâmetros**: `identity` (`string`).
**Retorno**: `string` — Nome legível para exibir na UI.

- `presenter-*` → `"Apresentador"`
- `discord-user-*` → `"Usuário {sufixo}"`
- Identidade vazia → `"Desconhecido"`

---

### Função: `createParticipantCard(identity)`

**Tipo**: Função local
**Retorno**: `HTMLDivElement` — O card criado.

**Propósito**: Cria um card de participante no grid.

**Estrutura do card**:
```
div.participant-card#card-{identity}
  └── div.avatar-placeholder
       ├── div.avatar-circle  (inicial do nome)
       └── div.participant-name (nome legível)
```

**Funcionamento**:
1. Cria o elemento `div.participant-card` com ID único.
2. Cria o placeholder de avatar (círculo com inicial + nome).
3. Anexa ao `#participants-grid`.
4. Registra no `Map participants` com `{ card, videoEl: null, audioEls: [] }`.

---

### Função: `removeParticipantCard(identity)`

**Tipo**: Função local
**Retorno**: `void`

Remove o card do DOM, limpa elementos de áudio e deleta do Map.

---

### Função: `createCardControls(identity)`

**Tipo**: Função local
**Retorno**: `HTMLDivElement` — Barra de controles.

**Propósito**: Cria os controles de volume e tela cheia que aparecem ao passar o mouse sobre um card com stream ativo.

**Estrutura**:
```
div.card-controls
  ├── span.stream-label     (nome do participante)
  ├── div.volume-control
  │    ├── SVG ícone volume
  │    └── input[range].volume-slider
  └── button (tela cheia)
```

**Lógica do slider de volume**:
- Altera `volume` do `videoEl` e de todos os `audioEls` do participante.
- Range: 0-100, convertido para 0.0-1.0.

**Botão tela cheia**: Chama `openFullscreen(identity)`.

---

### Função: `attachVideoToCard(identity, track)`

**Tipo**: Função local
**Parâmetros**: `identity` (`string`), `track` (LiveKit Track).
**Retorno**: `void`

**Propósito**: Anexa uma track de vídeo ao card do participante.

**Funcionamento**:
1. Remove vídeo anterior se existir.
2. Oculta o avatar placeholder.
3. Cria elemento `<video>` via `track.attach()` com `autoplay` e `playsInline`.
4. Anexa ao card.
5. Marca o card como `.streaming` (borda roxa).
6. Cria controles de volume/tela cheia se ainda não existirem.
7. Força `play()` para contornar políticas de autoplay.

---

### Função: `attachAudioToCard(identity, track)`

**Tipo**: Função local
**Parâmetros**: `identity` (`string`), `track` (LiveKit Track).
**Retorno**: `void`

Cria um `<audio>` via `track.attach()`, esconde e anexa ao `document.body`. Adiciona ao array `audioEls` do participante.

---

### Função: `detachTrackFromCard(identity, track)`

**Tipo**: Função local
**Parâmetros**: `identity` (`string`), `track` (LiveKit Track).
**Retorno**: `void`

**Propósito**: Remove uma track específica do card.

**Funcionamento**:
1. Chama `track.detach()` para obter os elementos DOM.
2. Se o elemento era o `videoEl`, seta para `null` e chama `card_check_streaming`.
3. Se era um áudio, remove do array `audioEls`.
4. Remove cada elemento do DOM.

---

### Função: `card_check_streaming(identity)`

**Tipo**: Função local
**Retorno**: `void`

**Propósito**: Verifica se o card ainda tem um stream ativo. Se não tem mais vídeo:
1. Remove classe `.streaming`.
2. Remove os controles.
3. Reexibe o avatar placeholder.
4. Fecha tela cheia se o participante estava em fullscreen.

---

### Função: `openFullscreen(identity)`

**Tipo**: Função local
**Retorno**: `void`

**Propósito**: Abre a transmissão de um participante em tela cheia.

**Funcionamento**:
1. Obtém o `videoEl` do participante.
2. Clona o `srcObject` do vídeo para o `#fullscreen-video`.
3. Sincroniza o volume.
4. Configura o slider de volume do overlay para alterar tanto o vídeo fullscreen quanto o card original.
5. Remove a classe `.hidden` do overlay.

---

### Função: `closeFullscreen()`

**Tipo**: Função local
**Retorno**: `void`

Esconde o overlay, limpa o `srcObject` do vídeo fullscreen e reseta `fullscreenIdentity`.

---

### Função: `closeFullscreenIfMatches(identity)`

**Tipo**: Função local
**Retorno**: `void`

Fecha tela cheia apenas se o participante em fullscreen for o mesmo da identity informada. Chamada quando um participante desconecta ou para de transmitir.

---

### Função: `initFullscreenControls()` (exportada)

**Tipo**: Função síncrona
**Retorno**: `void`

Configura os event listeners do overlay de tela cheia:
- Botão de sair (`#fullscreen-exit-btn`) → `closeFullscreen()`.
- Tecla `Escape` → `closeFullscreen()`.

---

### Função: `connectRoom(token)` (exportada)

**Tipo**: `async function`
**Parâmetros**: `token` (`string`) — JWT do LiveKit.
**Retorno**: `Room` — instância da sala conectada.

**Funcionamento detalhado**:

1. **Cria a sala**: `room = new Room()`.

2. **Registra listener `RoomEvent.ParticipantConnected`**:
   - Cria card para novos participantes que entram na sala.

3. **Registra listener `RoomEvent.ParticipantDisconnected`**:
   - Fecha fullscreen se necessário e remove o card do participante.

4. **Registra listener `RoomEvent.TrackSubscribed`**:
   - Se o participante não tem card ainda, cria um.
   - Para vídeo: chama `attachVideoToCard()`.
   - Para áudio: chama `attachAudioToCard()`.

5. **Registra listener `RoomEvent.TrackUnsubscribed`**:
   - Chama `detachTrackFromCard()`.

6. **Conecta na sala**: Constrói URL `wss://{CLIENT_ID}.discordsays.com/.proxy/livekit`.

7. **Sincroniza participantes existentes**: Após conectar, itera sobre `room.remoteParticipants` para criar cards e anexar tracks de quem já estava na sala.

---

## Cliente — Presenter (`client/src/presenter.js`)

### Arquivo: `client/src/presenter.js`

Módulo do painel do apresentador. Gerencia a captura de tela, seleção de fonte de áudio e publicação de tracks na sala LiveKit. Executado fora do Discord, em um navegador comum. **Este arquivo não foi alterado.**

---

### Variáveis de módulo

| Variável | Tipo | Descrição |
|---|---|---|
| `room` | `Room \| null` | Instância da sala LiveKit. |
| `videoStream` | `MediaStream \| null` | Stream da captura de tela. |
| `audioStream` | `MediaStream \| null` | Stream da fonte de áudio externa. |

---

### Função: `log(msg)`

Exibe mensagens de debug no painel do apresentador inserindo `<div>` no `#debug-log`.

---

### Função: `listAudioDevices()`

**Tipo**: `async function` (local)

Enumera dispositivos de entrada de áudio e popula o `<select id="audio-source">`:
1. Solicita permissão de áudio ao browser (pré-autorização).
2. Enumera dispositivos e filtra `audioinput`.
3. Preenche o select com opção "Nenhum" + dispositivos encontrados.

Chamada imediatamente ao carregar o módulo.

---

### Função: `connect()`

**Tipo**: `async function` (local)

Obtém token do LiveKit via `POST /api/presenter-token` e conecta na sala. Usa a URL do LiveKit diretamente (sem proxy do Discord).

---

### Event Listener: `#share-btn` click

Inicia o compartilhamento de tela com áudio:
1. Conecta se necessário.
2. Captura tela (1920×1080, 30fps) com `contentHint = 'motion'`.
3. Publica vídeo com `maxBitrate: 3 Mbps`, sem simulcast.
4. Publica áudio do screen share (128 kbps, sem DTX) se disponível.
5. Publica áudio externo do dispositivo selecionado se escolhido.
6. Registra cleanup automático quando o usuário para o compartilhamento.

---

### Função: `stop()`

**Tipo**: `async function` (local)

Encerra completamente o compartilhamento:
1. Para os streams de mídia locais.
2. Remove tracks publicadas com `unpublishAllTracks()`.
3. Desconecta da sala LiveKit.

---

## HTML e CSS

### `client/index.html` — Página do Viewer

Página da Activity do Discord com a nova interface em três camadas:
- **`#participants-grid`**: Grid responsivo (`auto-fill`, mínimo 220px por coluna) que exibe os cards de todos os participantes. Quando ninguém está transmitindo, mostra apenas os avatares.
- **`#bottom-bar`**: Barra inferior fixa (56px) com o botão "Transmitir tela".
- **`#broadcast-btn`**: Botão que abre `presenter.html` em nova aba.
- **`#fullscreen-overlay`**: Overlay de tela cheia (position fixed, z-index 100) com vídeo em tela cheia, label do transmissor, slider de volume e botão "Sair". Inicialmente oculto (`.hidden`).

### `client/presenter.html` — Página do Apresentador

**Não alterada.** Painel de controle do apresentador com seleção de áudio, botões compartilhar/parar e log de debug.

### `client/src/style.css` — Estilos do Viewer (redesenhado)

Design dark theme com cores roxas de destaque:
- **Fundo**: `#111118` (quase preto).
- **Cards**: `#1c1c2a`, borda `#2a2a3e`, `border-radius: 10px`, `aspect-ratio: 16/9`.
- **Card streaming**: Borda roxa (`#7c3aed`).
- **Avatar**: Círculo roxo de 52px com inicial do nome + label do nome abaixo.
- **Controles do card**: `.card-controls` — gradiente transparente→preto, visíveis ao hover (volume + botão tela cheia). Ocultos quando sem stream.
- **Volume slider**: 64px, thumb roxo (`#7c3aed`).
- **Botão Transmitir**: Roxo (`#7c3aed`), ícone SVG de antena, hover mais escuro.
- **Fullscreen overlay**: Fundo preto, vídeo `object-fit: contain`, controles com gradiente, visíveis ao hover. Volume slider de 100px.
- **Grid responsivo**: `auto-fill` com mínimo de 220px por card, `align-content: start`.
- **Scrollbar estilizada**: 5px, cinza sobre transparente.

### `client/style.css` — Estilos do Presenter

**Não alterado.** Reset e tema genérico com suporte a dark/light mode.

---

## Configuração do Vite

### Arquivo: `client/vite.config.js`

```javascript
export default defineConfig({
  envDir: '../',
  server: {
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
    hmr: {
      clientPort: 443,
    },
  },
});
```

- `envDir: '../'` — Lê `.env` da raiz do projeto.
- **Proxy `/api`**: Redireciona para `http://localhost:3001` em desenvolvimento.
- `allowedHosts`: Suporte a Cloudflare Tunnel.
- `hmr.clientPort: 443`: HMR via HTTPS.

---

## Dependências

### Client (`client/package.json`)

| Pacote | Versão | Propósito |
|---|---|---|
| `@discord/embedded-app-sdk` | `^2.5.0` | SDK oficial para Discord Activities |
| `livekit-client` | `^2.22.1` | Cliente WebRTC do LiveKit |
| `vite` | `^5.0.8` | Bundler e dev server (devDependency) |

### Server (`server/package.json`)

| Pacote | Versão | Propósito |
|---|---|---|
| `express` | `^4.22.2` | Framework HTTP |
| `dotenv` | `^17.4.2` | Carrega variáveis do `.env` |
| `livekit-server-sdk` | `^2.18.0` | Geração de tokens JWT do LiveKit |

---

## Diagrama de Sequência

```
Viewer (Discord)          Server (:3001)         Discord API        LiveKit Cloud        Presenter (Browser)
      │                        │                      │                   │                      │
      │── discordSdk.ready() ──│                      │                   │                      │
      │── authorize({code}) ───│                      │                   │                      │
      │                        │                      │                   │                      │
      │── POST /api/token ────►│                      │                   │                      │
      │                        │── POST oauth2/token ►│                   │                      │
      │                        │◄─ {access_token} ────│                   │                      │
      │◄─ {access_token} ──────│                      │                   │                      │
      │                        │                      │                   │                      │
      │── authenticate(token) ─│                      │                   │                      │
      │                        │                      │                   │                      │
      │── POST /api/lk-token ─►│                      │                   │                      │
      │                        │── gera JWT ──────────┼──────────────────►│                      │
      │◄─ {token, url} ────────│                      │                   │                      │
      │                        │                      │                   │                      │
      │── room.connect() ─────┼──────────────────────┼──────────────────►│                      │
      │── cria grid cards ─────│                      │                   │                      │
      │                        │                      │                   │                      │
      │                        │                      │                   │      POST /api/pres  │
      │                        │◄─────────────────────┼───────────────────┼──────────────────────│
      │                        │── gera JWT ──────────┼──────────────────►│                      │
      │                        │──────────────────────┼───────────────────┼─── {token, url} ────►│
      │                        │                      │                   │                      │
      │                        │                      │                   │◄── room.connect() ───│
      │                        │                      │                   │◄── publishTrack() ───│
      │                        │                      │                   │                      │
      │◄─ TrackSubscribed ─────┼──────────────────────┼───────────────────│                      │
      │── vídeo no card ───────│                      │                   │                      │
      │── controles visíveis ──│                      │                   │                      │
      │                        │                      │                   │                      │
      │ [usuário clica          │                      │                   │                      │
      │  tela cheia]            │                      │                   │                      │
      │── abre overlay ────────│                      │                   │                      │
```

---

## Observações e Possíveis Melhorias

1. **Segurança do token do viewer**: O endpoint `/api/livekit-token` concede `canPublish: true` ao viewer. Como o viewer só precisa assistir, seria mais seguro usar `canPublish: false`.

2. **Autenticação do presenter**: O endpoint `/api/presenter-token` não tem autenticação. Qualquer pessoa que conheça a URL pode gerar um token e publicar na sala.

3. **Nome da sala hardcoded**: A sala `"minha-activity-room"` é fixa. Para múltiplas instâncias simultâneas, o nome deveria ser dinâmico.

4. **Identity do participante**: Usa `Date.now()` como sufixo — funcional mas não vincula ao usuário real do Discord. Poderia usar o ID/username do Discord para exibir nomes reais nos cards.

5. **Múltiplos streams**: O design atual suporta múltiplos apresentadores simultâneos. Cada um aparece em seu próprio card com controles independentes.

6. **Sem persistência**: Não há banco de dados. Tudo é in-memory e efêmero.

7. **Sem tratamento de reconexão**: Se a conexão LiveKit cair, não há lógica de retry automático.
