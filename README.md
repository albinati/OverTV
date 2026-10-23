# OverTV

Player IPTV (Xtream Codes + M3U) para **Samsung Smart TV (Tizen)**, em português, construído e instalado
**sem Tizen Studio**: assinatura em Node, certificados Samsung obtidos pela API oficial e deploy via `sdb` num
container Docker. Inclui o diagnóstico de um problema comum em que o login funciona e o vídeo não.

Base: [muratcode/iptv-player-tizen](https://github.com/muratcode/iptv-player-tizen) (player gratuito, sem anúncios,
sem telemetria), com a interface traduzida do turco para pt-BR, tela de abertura própria e ajustes de latência.

> Este app não fornece conteúdo. Ele reproduz as listas às quais o usuário tem direito de acesso.

## Estrutura
- `app/` — o app (HTML/CSS/JS ES5, sem frameworks). `app/hesaplar.txt` (não versionado; veja `hesaplar.example.txt`)
  guarda a conta, que o app importa no primeiro uso.
- `certs/` — CAs públicas da Samsung; `certs/samsung/` (não versionado) recebe os certificados da sua TV.
- `tools/tizen-cli/` — assinador/empacotador em Node ([Twilight0/tizen-cli](https://github.com/Twilight0/tizen-cli)).
- `tools/tizen-docker/` — imagem x86 com o Tizen CLI oficial (`sdb`), para hosts ARM64 como WSL2 em Snapdragon.
- `tools/permit_direct.py` — pede à API da Samsung o `device-profile.xml` e o certificado de distribuidor.
- `tools/tvserver.py` — diagnóstico: recebe logs do app via HTTP e serve uma playlist de teste com proxy.
- `deploy.sh` — empacota, assina e instala na TV.

## Instalação (resumo)
1. **TV em Developer Mode**: *Apps → digite 12345 → Developer mode ON → IP do PC*. Reinicie a TV.
2. **DUID da TV**: `sdb connect IP_DA_TV:26101 && sdb shell 0 getduid`.
3. **Certificados Samsung** (precisa de conta Samsung):
   - gere chaves/CSRs como em [andreas-mausch/gist](https://gist.github.com/andreas-mausch/026413d908ba61cda15981bb4fbcd276)
     ou use [sreyemnayr/tizencertificates](https://github.com/sreyemnayr/tizencertificates) (faz o login OAuth e cria `author.p12`/`distributor.p12`);
   - com o `access_token` e `userId` do login, rode `tools/permit_direct.py distributor.csr <pasta> <token> <userId>`:
     a API **v1** devolve o `device-profile.xml` (o que o Tizen Studio envia à TV em "permitir instalação") e a **v3** o certificado;
   - monte o `distributor.p12` com o certificado que está dentro do `device-profile.xml` (mesma chave) + `vd_tizen_dev_public2.crt`.
4. `cp app/hesaplar.example.txt app/hesaplar.txt` e preencha; crie `.env` com `TV_IP=...` e `CERT_PASS=...`.
5. `./deploy.sh`.

Detalhes que custaram tempo: o Tizen CLI 6.x no Linux rejeita a senha dos `.p12` ("Invalid password", bug do
`.pwd` cifrado) — por isso o assinador em Node; os `.p12` para o node-forge precisam de `openssl pkcs12 -export -legacy`;
a TV responde `install failed[118,-12] Invalid certificate chain` se o pacote não vier assinado com certificado Samsung
**ou** se o `device-profile.xml` não tiver sido enviado para `/home/owner/share/tmp/sdk_tools/`.

## "Login funciona, vídeo não" (PLAYER_ERROR_CONNECTION_FAILED)
Caso real resolvido aqui: o navegador da TV alcançava o servidor (lista e login OK), mas o player nativo (AVPlay)
falhava após 30 s em **qualquer hostname**, até num proxy na LAN acessado por nome — por IP funcionava. Causa: a TV
estava com **DNS manual**; o resolvedor usado pelo AVPlay não funcionava com essa configuração, enquanto o navegador
recorria a outro servidor. Correção: *Rede → Configurações de IP → IP e DNS em Automático*. O mesmo padrão aparece em
[NuvioTVSmart #1106](https://github.com/NuvioMedia/NuvioTVSmart/issues/1106).

Como diagnosticar: `tools/tvserver.py` recebe os logs do app (trecho temporário no `js/core/logger.js` que faz
`POST http://PC:8766/log`) e serve `/test.m3u` com canais via proxy, por IP e por hostname, o que isola rede, DNS e
formato. Em WSL2 (modo mirrored) é preciso liberar a porta no firewall do Windows (`New-NetFirewallRule` e
`New-NetFirewallHyperVRule`).

## Latência
Padrão em **TS** (o HLS do painel testado ficava ~12 s atrás, por `EXT-X-START`), buffer inicial de 2 s ao vivo.
O resto do atraso é a rajada inicial que o servidor envia e não se controla no cliente.

## Créditos
- [muratcode/iptv-player-tizen](https://github.com/muratcode/iptv-player-tizen) — o player (licença em `LICENSE.upstream`).
- [Twilight0/tizen-cli](https://github.com/Twilight0/tizen-cli) — assinatura e empacotamento sem Tizen Studio.
- [sreyemnayr/tizencertificates](https://github.com/sreyemnayr/tizencertificates) e o
  [gist de andreas-mausch](https://gist.github.com/andreas-mausch/026413d908ba61cda15981bb4fbcd276) — fluxo dos certificados Samsung.
- [NuvioMedia/NuvioTVSmart](https://github.com/NuvioMedia/NuvioTVSmart) — a discussão que apontou o DNS do AVPlay.

## Licenças
O app (`app/`) deriva do iptv-player-tizen, MIT (`LICENSE.upstream`); as alterações deste repositório seguem a mesma
licença. `tools/tizen-cli/` é GPL-3.0 (licença própria na pasta) e é usado apenas como ferramenta de build.
