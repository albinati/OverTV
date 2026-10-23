/* ============================================================
   views/settings.js
   AYARLAR
     Sol : ayar satirlari
     Sag : secili satirin aciklamasi + hesap / sistem bilgisi

   KULLANILAN TIZEN API'LERI (bilgi paneli icin)
     webapis.productinfo.getModel()        -> TV model adi
     webapis.productinfo.getFirmware()     -> firmware surumu
     webapis.productinfo.isUdPanelSupported() -> 4K panel mi
     tizen.systeminfo.getCapability(
        'http://tizen.org/feature/platform.version') -> Tizen surumu
   Hepsi try/catch icindedir; PC tarayicisinda "-" gosterilir.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    var log = App.Logger.get('Settings');

    App.Views = App.Views || {};

    var DISPLAY_MODES = [
        { value: 'PLAYER_DISPLAY_MODE_LETTER_BOX', label: 'Manter proporção (Letterbox)' },
        { value: 'PLAYER_DISPLAY_MODE_FULL_SCREEN', label: 'Preencher a tela' },
        { value: 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO', label: 'Automático' }
    ];
    var FORMATS = [
        { value: 'm3u8', label: 'HLS (.m3u8)' },
        { value: 'ts', label: 'MPEG-TS (.ts)' }
    ];
    var VOD_PLAYERS = [
        { value: 'auto', label: 'Automático (recomendado)' },
        { value: 'mse', label: 'Player do app' }
    ];
    var OSD_TIMES = [
        { value: 4, label: '4 segundos' },
        { value: 6, label: '6 segundos' },
        { value: 10, label: '10 segundos' },
        { value: 15, label: '15 segundos' }
    ];
    var COUNTDOWNS = [
        { value: 5, label: '5 segundos' },
        { value: 10, label: '10 segundos' },
        { value: 15, label: '15 segundos' },
        { value: 20, label: '20 segundos' }
    ];
    var INTRO_LENGTHS = [
        { value: 60, label: '60 segundos' },
        { value: 90, label: '90 segundos' },
        { value: 120, label: '2 minutos' },
        { value: 150, label: '2,5 minutos' }
    ];
    var SEEK_STEPS = [
        { value: 10, label: '10 segundos' },
        { value: 15, label: '15 segundos' },
        { value: 30, label: '30 segundos' }
    ];
    var SPLASH_TIMES = [
        { value: 0, label: 'Desligado' },
        { value: 2, label: '2 segundos' },
        { value: 3, label: '3 segundos' },
        { value: 5, label: '5 segundos' },
        { value: 8, label: '8 segundos' },
        { value: 10, label: '10 segundos' }
    ];
    var LOG_LEVELS = [
        { value: 'info', label: 'Normal' },
        { value: 'debug', label: 'Detalhado' },
        { value: 'warn', label: 'Somente avisos' },
        { value: 'none', label: 'Desligado' }
    ];

    App.Views.settings = function () {
        var root, listHost, sideEl;
        var list = null;
        var rows = [];

        /* ---------------- Sistem bilgisi ---------------- */
        function systemInfo() {
            var info = {};

            try {
                if (window.webapis && webapis.productinfo) {
                    info['Modelo da TV'] = webapis.productinfo.getRealModel
                        ? webapis.productinfo.getRealModel() : webapis.productinfo.getModel();
                    info['Código do modelo'] = webapis.productinfo.getModelCode();
                    info['Firmware'] = webapis.productinfo.getFirmware();
                    info['Painel 4K'] = webapis.productinfo.isUdPanelSupported() ? 'Sim' : 'Não';
                }
            } catch (e) { log.debug('productinfo yok'); }

            try {
                if (window.tizen && tizen.systeminfo) {
                    info['Versão do Tizen'] = tizen.systeminfo.getCapability(
                        'http://tizen.org/feature/platform.version');
                }
            } catch (e2) { /* yoksay */ }

            info['Motor do player'] = App.Player.engineName() === 'avplay'
                ? 'Samsung AVPlay' : 'Vídeo HTML5 (modo de teste)';
            info['Tela'] = (document.documentElement.clientWidth || 0) + ' x ' +
                            (document.documentElement.clientHeight || 0);

            var ks = App.Keys.status();
            info['Teclas registradas'] = ks.registered.length + ' teclas';

            var cs = App.Cache.stats();
            info['Cache'] = cs.disk + ' registros  /  ' + cs.kb + ' KB';
            info['Armazenamento'] = App.Storage.isPersistent() ? 'Permanente (localStorage)' : 'Temporário (memória)';
            info['Armazenamento de dados grandes'] = App.BigStore.backend();

            return info;
        }

        function accountInfo() {
            var p = App.Profile.get();
            var out = {};
            if (!p) { return out; }

            out['Tipo de fonte'] = p.type === 'xtream' ? 'Xtream Codes' : 'M3U Playlist';

            if (p.type === 'xtream') {
                out['Servidor'] = p.host;
                out['Usuário'] = p.username;
                var ui = App.Profile.getUserInfo();
                if (ui) {
                    out['Status'] = ui.status;
                    out['Data de expiração'] = ui.expiresText;
                    if (ui.daysLeft !== null) { out['Tempo restante'] = ui.daysLeft + ' dia(s)'; }
                    out['Conexões'] = ui.activeConnections + ' / ' + ui.maxConnections;
                    if (ui.isTrial) { out['Tipo de conta'] = 'Teste'; }
                }
            } else {
                out['Playlist'] = U.truncate(p.m3uUrl, 60);
                if (p.epgUrl) { out['EPG'] = U.truncate(p.epgUrl, 60); }
                var st = App.Content.stats();
                if (st) {
                    out['Quantidade de itens'] = st.items;
                    out['Quantidade de grupos'] = st.groups;
                }
            }

            out['Favoritos'] = App.Favorites.count() + ' itens';
            out['Histórico'] = App.History.count() + ' registros';

            if (App.EPG.hasIndex()) {
                var m = App.EPG.meta();
                out['Dados do EPG'] = m.channels + ' canais / ' + m.programmes + ' programas';
            }
            return out;
        }

        /* ---------------- Satirlar ---------------- */

        function buildRows() {
            var s = App.Settings.get();

            function labelOf(opts, value) {
                for (var i = 0; i < opts.length; i++) {
                    if (opts[i].value === value) { return opts[i].label; }
                }
                return String(value);
            }

            return [
                { id: 'refresh', glyph: '🔄', title: 'Atualizar conteúdo',
                  desc: 'Baixa novamente do servidor as listas de categorias, canais e filmes.',
                  help: 'Use se novos canais foram adicionados ou se a lista parecer incompleta.\n' +
                        'O cache é limpo e tudo é baixado de novo.' },

                { id: 'epg', glyph: '📅', title: 'Atualizar EPG (guia de programação)',
                  desc: 'Baixa o guia XMLTV.',
                  value: App.EPG.hasIndex() ? 'Carregado' : 'Não carregado',
                  help: 'Atenção: o arquivo XMLTV pode ter 10-80 MB e o download\n' +
                        'pode levar alguns minutos. Em contas Xtream, o guia de cada\n' +
                        'canal já é obtido automaticamente; esta opção carrega o guia\n' +
                        'de todos os canais de uma vez e o exibe rapidamente na lista.' },

                { id: 'displayMode', glyph: '🖼', title: 'Proporção da imagem',
                  desc: 'Como o vídeo se ajusta à tela.',
                  value: labelOf(DISPLAY_MODES, s.displayMode),
                  help: 'Manter proporção: a imagem não é distorcida, pode haver faixas pretas nas bordas.\n' +
                        'Preencher a tela: a imagem é esticada, sem faixas.\n' +
                        'Corresponde à chamada de API setDisplayMethod() do AVPlay.' },

                { id: 'preferredFormat', glyph: '📶', title: 'Formato de transmissão preferido',
                  desc: 'Formato tentado primeiro nas transmissões ao vivo.',
                  value: labelOf(FORMATS, s.preferredFormat),
                  help: 'HLS (.m3u8): mais compatível, um pouco mais de atraso.\n' +
                        'MPEG-TS (.ts): menos atraso, mais estável em alguns servidores.\n' +
                        'Se o formato escolhido não abrir, o app tenta o outro automaticamente.' },

                { id: 'vodPlayer', glyph: '🎬', title: 'Player de filmes/séries',
                  desc: 'Player usado em filmes e séries MKV.',
                  value: labelOf(VOD_PLAYERS, s.vodPlayer),
                  help: 'Automático: player da Samsung (AVPlay). Somente em arquivos MKV que a TV não consegue avançar/retroceder, ' +
                        'o player do app entra em ação sozinho.\n\n' +
                        'Player do app: o próprio app lê todos os filmes e séries MKV. ' +
                        'Avançar/retroceder vai exatamente ao segundo desejado; saltos curtos, como 10 s, ' +
                        'são instantâneos.\n\n' +
                        'TV ao vivo e arquivos que não sejam MKV sempre abrem com o player da Samsung. ' +
                        'Se o player do app não conseguir abrir um arquivo, ele é aberto com o player da Samsung. ' +
                        'A alteração vale a partir da próxima abertura.' },

                { id: 'mode4K', glyph: '🎞', title: 'Modo 4K',
                  desc: 'Aceleração por hardware para transmissões UHD.',
                  value: s.mode4K ? 'Ligado' : 'Desligado',
                  help: 'Executa a chamada AVPlay setStreamingProperty("SET_MODE_4K").\n' +
                        'Se houver travamentos em transmissões 4K, tente desligar.' },

                { id: 'seekStep', glyph: '⏩', title: 'Passo de avançar/retroceder',
                  desc: 'Tempo saltado no primeiro toque da seta.',
                  value: labelOf(SEEK_STEPS, s.seekStep),
                  help: 'Ao pressionar repetidamente, o passo AUMENTA automaticamente:\n' +
                        '  1º-2º toque  -> passo base\n' +
                        '  3º-4º toque  -> 3x\n' +
                        '  5º-7º toque  -> 6x\n' +
                        '  8º-10º toque -> 12x\n' +
                        '  11+ toques   -> 30x (minutos)\n' +
                        'Ao soltar, o salto é feito de uma só vez; isso é muito mais\n' +
                        'rápido do que avançar passo a passo.' },

                { id: 'autoNextEpisode', glyph: '⏭', title: 'Próximo episódio automático',
                  desc: 'Passar ao próximo quando o episódio terminar.',
                  value: s.autoNextEpisode ? 'Ligado' : 'Desligado',
                  help: 'Nos últimos segundos do episódio aparece um cartão com contagem regressiva.\n' +
                        'OK: iniciar agora, RETURN: cancelar.\n' +
                        'SE MUDAR DE TEMPORADA, não avança sozinho: pergunta antes.' },

                { id: 'nextEpisodeCountdown', glyph: '⏳', title: 'Contagem regressiva do próximo episódio',
                  desc: 'Quantos segundos antes o cartão aparece.',
                  value: labelOf(COUNTDOWNS, s.nextEpisodeCountdown),
                  help: 'Quando faltar esse tempo para o fim do episódio, o cartão "próximo episódio"\n' +
                        'aparece e a contagem regressiva começa.' },

                { id: 'subtitleService', glyph: '💬', title: 'Serviço de legendas (OpenSubtitles)',
                  desc: App.OpenSubtitles.isConfigured()
                        ? ('Configurado' + (App.OpenSubtitles.hasAccount() ? '' : ' (sem conta)'))
                        : 'Não configurado',
                  help: 'Se a legenda da fonte estiver corrompida, ausente ou baseada em imagem,\n' +
                        'você pode baixar legendas da internet no player com a tecla AMARELA.\n\n' +
                        'É GRATUITO. Só é preciso UMA chave de API, uma única vez:\n' +
                        'opensubtitles.com > Minha conta > API Consumers > New Consumer\n\n' +
                        'Usuário/senha NÃO são obrigatórios - se informados, sua\n' +
                        'cota diária de downloads aumenta.\n\n' +
                        'A chave não vem embutida no app porque a cota é debitada\n' +
                        'do dono da chave. Os dados ficam armazenados apenas nesta TV.' },

                { id: 'showIntroSkip', glyph: '⏭', title: 'Sugestão de pular abertura',
                  desc: 'Mostrar "Pular abertura" no início do episódio.',
                  value: s.showIntroSkip ? 'Ligado' : 'Desligado',
                  help: 'ATENÇÃO: fontes Xtream e M3U NÃO informam o início/fim\n' +
                        'da abertura. Por isso o tempo pulado não é uma estimativa,\n' +
                        'e sim o valor FIXO escolhido abaixo.' },

                { id: 'introSkipSeconds', glyph: '⏱', title: 'Duração da abertura',
                  desc: 'Quanto avançar ao pular.',
                  value: labelOf(INTRO_LENGTHS, s.introSkipSeconds),
                  help: 'Na maioria das séries a abertura dura de 60 a 120 segundos.\n' +
                        'Ajuste conforme a série que você assiste.' },

                { id: 'osdTimeout', glyph: '⏱', title: 'Duração da barra de informações',
                  desc: 'Tempo que a barra de informações superior fica na tela do player.',
                  value: labelOf(OSD_TIMES, s.osdTimeout),
                  help: 'Em quantos segundos as informações de canal/programa, exibidas\n' +
                        'ao pressionar OK no player, desaparecem.' },

                { id: 'splashSeconds', glyph: '🖼', title: 'Imagem de abertura',
                  desc: 'Imagem de boas-vindas exibida ao abrir o aplicativo.',
                  value: labelOf(SPLASH_TIMES, s.splashSeconds),
                  help: 'Arquivo da imagem: assets/splash.jpg\n' +
                        'Para usar sua própria foto, substitua este arquivo\n' +
                        '(recomendado: 1920x1080).\n\n' +
                        'Você também pode pular pressionando qualquer tecla antes do fim do tempo.' },

                { id: 'showChannelNumbers', glyph: '🔢', title: 'Mostrar números dos canais',
                  desc: 'Coluna com o número do canal na lista.',
                  value: s.showChannelNumbers ? 'Ligado' : 'Desligado',
                  help: 'Se desligar, sobra mais espaço para os nomes dos canais.' },

                { id: 'autoResume', glyph: '⏯', title: 'Continuar de onde parou',
                  desc: 'Lembrar a posição de reprodução em filmes e episódios.',
                  value: s.autoResume ? 'Ligado' : 'Desligado',
                  help: 'Quando ligado, ao abrir um filme/episódio a reprodução continua do segundo em que você parou.' },

                { id: 'logLevel', glyph: '🐞', title: 'Nível de detalhe do registro',
                  desc: 'Registros para diagnóstico de problemas.',
                  value: labelOf(LOG_LEVELS, s.logLevel),
                  help: 'Se "Detalhado" for escolhido, todas as requisições de rede\n' +
                        'e eventos do player aparecem na aba Log do Tizen Studio.' },

                { id: 'clearFav', glyph: '⭐', title: 'Limpar favoritos',
                  desc: App.Favorites.count() + ' favoritos salvos.',
                  help: 'Exclui todos os canais, filmes e séries favoritos. Não pode ser desfeito.' },

                { id: 'clearHistory', glyph: '🕒', title: 'Limpar histórico de reprodução',
                  desc: App.History.count() + ' registros.',
                  help: 'Exclui a lista de recentes e as posições salvas.' },

                { id: 'backup', glyph: '💾', title: 'Fazer backup no USB',
                  desc: 'Playlists, favoritos e histórico.',
                  value: App.Backup.isAvailable() ? '' : 'Indisponível',
                  help: 'IMPORTANTE: ao reinstalar o aplicativo (novo .wgt),\n' +
                        'o Tizen apaga TODOS os dados salvos. Por isso, faça um backup\n' +
                        'ANTES de instalar uma nova versão.\n\n' +
                        'O backup é gravado como "' + App.Backup.FILE_NAME + '" primeiro no USB\n' +
                        'conectado ou, sem USB, na pasta Downloads da TV.\n' +
                        'Essas pastas não são apagadas mesmo se o app for desinstalado.\n\n' +
                        '⚠ O arquivo de backup contém suas senhas em texto simples.' },

                { id: 'restore', glyph: '📥', title: 'Restaurar backup',
                  desc: App.Backup.FILE_NAME + ' do arquivo.',
                  value: App.Backup.isAvailable() ? '' : 'Indisponível',
                  help: 'Lê o arquivo de backup encontrado no USB ou na pasta Downloads.\n' +
                        'Playlists já salvas não são\n' +
                        'adicionadas de novo; apenas as que faltam são incluídas.' },

                { id: 'clearSubs', glyph: '💬', title: 'Limpar cache de legendas',
                  desc: (function () {
                      var st = App.SubtitleCache.stats();
                      return st.count ? (st.count + ' legendas, ' + st.kb + ' KB') : 'Nenhuma legenda salva';
                  })(),
                  help: 'As legendas baixadas da internet ficam salvas no dispositivo; ao abrir\n' +
                        'o mesmo episódio de novo, NÃO SÃO BAIXADAS NOVAMENTE e sua cota\n' +
                        'diária do OpenSubtitles não é consumida.\n\n' +
                        'Se uma legenda estiver corrompida, use a tecla AMARELA no player > "Baixar novamente";\n' +
                        'aqui você exclui todas de uma vez.' },

                { id: 'clearCache', glyph: '🧹', title: 'Limpar cache',
                  desc: App.Cache.stats().kb + ' KB em uso.',
                  help: 'Exclui as listas de canais/filmes baixadas. Os dados da conta e\n' +
                        'os favoritos são MANTIDOS. Use se o app ficar lento ou se a lista\n' +
                        'estiver desatualizada.' },

                { id: 'playlists', glyph: '📄', title: 'Playlists salvas',
                  desc: App.Profiles.count() + ' playlists salvas.',
                  help: 'Salve várias contas Xtream ou listas M3U e\n' +
                        'alterne entre elas com um só toque.\n' +
                        'O QR code para enviar cada playlist ao celular também fica nesta tela.' },

                { id: 'logout', glyph: '🚪', title: 'Sair da conta ativa',
                  desc: 'Voltar à tela de login.',
                  help: 'Apenas a seleção ATIVA é removida; suas playlists salvas\n' +
                        'NÃO são excluídas. Favoritos e histórico também são mantidos.\n' +
                        'Para excluir playlists, use a tela "Playlists salvas".' },

                { id: 'wipe', glyph: '⚠', title: 'Redefinir dados do aplicativo',
                  desc: 'Restaurar tudo às configurações de fábrica.',
                  help: 'TODOS os dados, incluindo contas, favoritos, histórico, configurações e cache,\n' +
                        'são excluídos. Esta ação não pode ser desfeita.' },

                { id: 'about', glyph: 'ℹ', title: 'Informações do sistema',
                  desc: 'Modelo da TV, versão do Tizen, motor do player.',
                  help: 'As informações técnicas são exibidas no painel à direita.\n' +
                        'Compartilhe-as ao pedir suporte.' }
            ];
        }

        function renderRow(node, item) {
            U.empty(node);
            node.className = 'srow';
            /* .srow CSS'inde position yok (normal akista da kullaniliyor);
               sanal listede mutlak konumlandirma gerektigi icin burada veriyoruz.
               Satir yuksegi 5.25rem, satir araligi 5.75rem -> 0.5rem bosluk. */
            node.style.position = 'absolute';
            node.style.left = '0';
            node.style.right = '0';
            node.style.marginBottom = '0';
            node.style.height = U.rem(5.25) + 'px';

            node.appendChild(U.el('div', 'srow__glyph', item.glyph));

            var t = U.el('div', 'srow__text');
            t.appendChild(U.el('div', 'srow__title', item.title));
            t.appendChild(U.el('div', 'srow__desc ellipsis', item.desc || ''));
            node.appendChild(t);

            if (item.value !== undefined) {
                node.appendChild(U.el('div', 'srow__value', item.value));
            }
        }

        /* ---------------- Sag panel ---------------- */

        function showSide(item) {
            U.empty(sideEl);
            if (!item) { return; }

            sideEl.appendChild(U.el('div', 'col__head', item.title));
            if (item.help) {
                sideEl.appendChild(U.el('div', 'settings__help', item.help));
            }

            var data = (item.id === 'about') ? systemInfo() : accountInfo();
            var title = (item.id === 'about') ? 'SISTEM' : 'HESAP';
            sideEl.appendChild(U.el('div', 'side__sec', title));

            for (var k in data) {
                if (!Object.prototype.hasOwnProperty.call(data, k)) { continue; }
                var row = U.el('div', 'info-row');
                row.appendChild(U.el('span', 'info-row__k', k));
                row.appendChild(U.el('span', 'info-row__v', String(data[k])));
                sideEl.appendChild(row);
            }
        }

        function refreshRows(keepIndex) {
            var idx = keepIndex ? list.getIndex() : 0;
            rows = buildRows();
            /* keepScroll: bir ayari degistirince liste yerinde kalsin
               (onceden her OK'ta odakli satir ortaya zipliyordu) */
            list.setItems(rows, { index: idx, silent: true, keepScroll: !!keepIndex });
            showSide(rows[idx]);
        }

        /* ---------------- Eylemler ---------------- */

        function activate(item) {
            switch (item.id) {

                case 'refresh':
                    App.UI.Loading.show('Atualizando conteúdo...', { delay: 0 });
                    App.Content.refresh(function (t) { App.UI.Loading.setProgress(t); })
                        .then(function () {
                            App.UI.Loading.hide(true);
                            App.UI.Toast.success('Conteúdo atualizado');
                            refreshRows(true);
                        }, function (err) {
                            App.UI.Loading.hide(true);
                            App.UI.Modal.alert('Falha ao atualizar', App.AppError.wrap(err).message);
                        });
                    return;

                case 'epg':
                    loadEpg();
                    return;

                case 'displayMode':
                    var dm = App.Settings.cycle('displayMode', DISPLAY_MODES);
                    App.Player.setDisplayMode(dm.value);
                    App.UI.Toast.info('Proporção da imagem: ' + dm.label);
                    refreshRows(true);
                    return;

                case 'preferredFormat':
                    var fm = App.Settings.cycle('preferredFormat', FORMATS);
                    App.UI.Toast.info('Formato de transmissão: ' + fm.label);
                    refreshRows(true);
                    return;

                case 'vodPlayer':
                    var vp = App.Settings.cycle('vodPlayer', VOD_PLAYERS);
                    App.UI.Toast.info('Player de filmes/séries: ' + vp.label);
                    refreshRows(true);
                    return;

                case 'osdTimeout':
                    var ot = App.Settings.cycle('osdTimeout', OSD_TIMES);
                    App.UI.Toast.info('Barra de informações: ' + ot.label);
                    refreshRows(true);
                    return;

                case 'logLevel':
                    var lv = App.Settings.cycle('logLevel', LOG_LEVELS);
                    App.UI.Toast.info('Registro: ' + lv.label);
                    refreshRows(true);
                    return;

                case 'nextEpisodeCountdown':
                    var nc = App.Settings.cycle('nextEpisodeCountdown', COUNTDOWNS);
                    App.UI.Toast.info('Contagem regressiva: ' + nc.label);
                    refreshRows(true);
                    return;

                case 'introSkipSeconds':
                    var il = App.Settings.cycle('introSkipSeconds', INTRO_LENGTHS);
                    App.UI.Toast.info('Duração da abertura: ' + il.label);
                    refreshRows(true);
                    return;

                case 'splashSeconds':
                    var sp = App.Settings.cycle('splashSeconds', SPLASH_TIMES);
                    App.UI.Toast.info('Imagem de abertura: ' + sp.label);
                    refreshRows(true);
                    return;

                case 'seekStep':
                    var ss = App.Settings.cycle('seekStep', SEEK_STEPS);
                    App.UI.Toast.info('Passo de avanço: ' + ss.label);
                    refreshRows(true);
                    return;

                case 'subtitleService':
                    App.Router.go('opensubtitles');
                    return;

                case 'backup':
                    doBackup();
                    return;

                case 'restore':
                    doRestore();
                    return;

                case 'mode4K':
                case 'showChannelNumbers':
                case 'autoResume':
                case 'autoNextEpisode':
                case 'showIntroSkip':
                    var on = App.Settings.toggle(item.id);
                    App.UI.Toast.info(item.title + ': ' + (on ? 'Ligado' : 'Desligado'));
                    refreshRows(true);
                    return;

                case 'clearFav':
                    App.UI.Modal.confirm('Excluir favoritos?',
                        App.Favorites.count() + ' registros serão excluídos. Esta ação não pode ser desfeita.',
                        { danger: true, okText: 'Excluir' })
                        .then(function (yes) {
                            if (!yes) { return; }
                            App.Favorites.clear();
                            App.UI.Toast.success('Favoritos limpos');
                            refreshRows(true);
                        });
                    return;

                case 'clearHistory':
                    App.UI.Modal.confirm('Excluir histórico de reprodução?',
                        'As posições salvas também serão excluídas.',
                        { danger: true, okText: 'Excluir' })
                        .then(function (yes) {
                            if (!yes) { return; }
                            App.History.clear();
                            App.UI.Toast.success('Histórico limpo');
                            refreshRows(true);
                        });
                    return;

                case 'clearSubs':
                    var subSt = App.SubtitleCache.stats();
                    if (!subSt.count) {
                        App.UI.Toast.info('Nenhuma legenda salva');
                        return;
                    }
                    App.UI.Modal.confirm('Excluir cache de legendas?',
                        subSt.count + ' legendas (' + subSt.kb + ' KB) serão excluídas.\n' +
                        'Se precisar delas de novo, será preciso baixá-las outra vez\n' +
                        'e isso consome sua cota diária.',
                        { danger: true, okText: 'Excluir' })
                        .then(function (yes) {
                            if (!yes) { return; }
                            App.SubtitleCache.clear().then(function () {
                                App.UI.Toast.success('Cache de legendas limpo');
                                refreshRows(true);
                            });
                        });
                    return;

                case 'clearCache':
                    App.UI.Modal.confirm('Limpar o cache?',
                        'As listas de canais e filmes serão baixadas novamente na próxima abertura.\n' +
                        'Os dados da sua conta e seus favoritos são MANTIDOS.',
                        { okText: 'Limpar' })
                        .then(function (yes) {
                            if (!yes) { return; }
                            var n = App.Cache.clear();
                            App.EPG.clear();
                            App.BigStore.clear();     /* buyuk playlist deposu */
                            App.UI.Toast.success(n + ' registros de cache excluídos');
                            refreshRows(true);
                        });
                    return;

                case 'logout':
                    App.UI.Modal.confirm('Sair da conta ativa?',
                        'Suas playlists salvas NÃO são excluídas, apenas a seleção ativa é removida.\n' +
                        'Seus favoritos e histórico são mantidos.',
                        { danger: true, okText: 'Sair' })
                        .then(function (yes) {
                            if (!yes) { return; }
                            App.Profile.logout();
                            App.EPG.clear();
                            App.UI.Toast.info('Sessão encerrada');
                            App.Router.reset('login');
                        });
                    return;

                case 'wipe':
                    App.UI.Modal.confirm('EXCLUIR TODOS OS DADOS?',
                        'Tudo será excluído, incluindo contas, favoritos, histórico, configurações e\n' +
                        'cache.\n\nEsta ação NÃO PODE ser desfeita.',
                        { danger: true, okText: 'Excluir tudo', defaultIndex: 1 })
                        .then(function (yes) {
                            if (!yes) { return; }
                            App.Profile.wipe();
                            App.Favorites.invalidate();
                            App.History.invalidate();
                            App.Settings.reset();
                            App.EPG.clear();
                            App.UI.Toast.success('Aplicativo redefinido');
                            App.Router.reset('login');
                        });
                    return;

                case 'playlists':
                    App.Router.go('playlists');
                    return;

                case 'about':
                    showSide(item);
                    return;
            }
        }

        /* ---------------- Yedekleme ---------------- */

        function doBackup() {
            if (!App.Backup.isAvailable()) {
                App.UI.Modal.alert('Backup indisponível',
                    'Este recurso só funciona na TV (tizen.filesystem).\n' +
                    'Se você está testando no navegador do PC, isso é esperado.');
                return;
            }

            App.UI.Modal.confirm('Fazer backup?',
                'Playlists salvas, favoritos, histórico de reprodução e configurações\n' +
                '"' + App.Backup.FILE_NAME + '" serão gravados no arquivo.\n\n' +
                'Primeiro no USB conectado ou, sem USB, na pasta Downloads.\n\n' +
                '⚠ O arquivo contém suas senhas em texto simples.',
                { okText: 'Fazer backup' })
                .then(function (yes) {
                    if (!yes) { return; }
                    App.UI.Loading.show('Gravando backup...', { delay: 0 });
                    App.Backup.save().then(function (res) {
                        App.UI.Loading.hide(true);
                        App.UI.Modal.alert('Backup concluído',
                            'Local: ' + res.label + '\n' +
                            'Arquivo: ' + App.Backup.FILE_NAME + '\n' +
                            'Tamanho: ' + Math.round(res.bytes / 1024) + ' KB');
                        refreshRows(true);
                    }, function (err) {
                        App.UI.Loading.hide(true);
                        var e = App.AppError.wrap(err);
                        App.UI.Modal.alert('Não foi possível fazer o backup',
                            e.message + '\n\n' +
                            'O USB está conectado? Em alguns modelos de TV, a gravação\n' +
                            'só é permitida no USB.' +
                            (e.detail ? '\n\n(' + e.detail + ')' : ''));
                    });
                });
        }

        function doRestore() {
            if (!App.Backup.isAvailable()) {
                App.UI.Modal.alert('Restauração indisponível',
                    'Este recurso só funciona na TV (tizen.filesystem).');
                return;
            }

            App.UI.Modal.confirm('Restaurar o backup?',
                'Será lido o arquivo encontrado no USB ou na pasta Downloads:\n' +
                '"' + App.Backup.FILE_NAME + '"\n\n' +
                'Playlists já salvas NÃO são adicionadas novamente.',
                { okText: 'Restaurar' })
                .then(function (yes) {
                    if (!yes) { return; }
                    App.UI.Loading.show('Lendo backup...', { delay: 0 });
                    App.Backup.restore().then(function (sum) {
                        App.UI.Loading.hide(true);
                        App.UI.Modal.alert('Restauração concluída',
                            'Origem: ' + sum.label + '\n' +
                            (sum.createdAt ? ('Data do backup: ' + U.ddmmyyyy(new Date(sum.createdAt)) + '\n') : '') +
                            '\n' +
                            'Playlists adicionadas: ' + sum.profiles + '\n' +
                            'Favoritos adicionados: ' + sum.favorites + '\n' +
                            'Registros de histórico: ' + sum.history);
                        refreshRows(true);
                    }, function (err) {
                        App.UI.Loading.hide(true);
                        var e = App.AppError.wrap(err);
                        App.UI.Modal.alert('Não foi possível restaurar',
                            e.message + (e.detail ? '\n\n(' + e.detail + ')' : ''));
                    });
                });
        }

        function loadEpg() {
            var url = App.Content.epgUrl();
            if (!url) {
                App.UI.Modal.alert('Sem endereço de EPG',
                    'Nenhum endereço de guia XMLTV foi encontrado para esta fonte.\n' +
                    'Se você usa M3U, pode informar o endereço do EPG na tela de login.');
                return;
            }

            App.UI.Modal.confirm('Baixar o EPG?',
                'O arquivo XMLTV pode ser grande (10-80 MB) e o download\n' +
                'pode levar alguns minutos. Continuar?',
                { okText: 'Baixar' })
                .then(function (yes) {
                    if (!yes) { return; }
                    App.UI.Loading.show('Preparando EPG...', { delay: 0 });

                    App.Content.allEpgChannelIds().then(function (ids) {
                        return App.EPG.loadXmltv(url, {
                            channelIds: ids,
                            onStatus: function (t) { App.UI.Loading.setProgress(t); }
                        });
                    }).then(function (meta) {
                        App.UI.Loading.hide(true);
                        App.UI.Toast.success('EPG carregado: ' + meta.channels + ' canais, ' +
                                             meta.programmes + ' programas');
                        refreshRows(true);
                    }, function (err) {
                        App.UI.Loading.hide(true);
                        var e = App.AppError.wrap(err);
                        App.UI.Modal.alert('Falha ao carregar o EPG',
                            e.message + (e.detail ? '\n\n(' + e.detail + ')' : ''));
                    });
                });
        }

        return {
            id: 'settings',
            title: 'Configurações',

            mount: function (container) {
                root = container;

                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '⚙ Configurações'));
                bar.appendChild(U.el('div', 'topbar__spacer'));
                root.appendChild(bar);

                var body = U.el('div', 'body');
                var wrap = U.el('div', 'settings');

                listHost = U.el('div', 'settings__list');
                wrap.appendChild(listHost);

                sideEl = U.el('div', 'settings__side');
                wrap.appendChild(sideEl);

                body.appendChild(wrap);
                root.appendChild(body);

                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Selecionar / Alterar</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Voltar</span>';
                root.appendChild(hints);

                list = App.UI.VirtualList.create({
                    container: listHost,
                    itemHeight: U.rem(5.75),
                    gapY: 0,
                    itemClass: 'srow',
                    render: renderRow,
                    onFocusChange: showSide,
                    onSelect: activate
                });

                App.Nav.bind(listHost, function () { list.select(); }, {
                    onFocus: function () { list.setActive(true); },
                    onBlur: function () { list.setActive(false); },
                    isDefault: true
                });

                rows = buildRows();
                list.setItems(rows);
                showSide(rows[0]);
                App.Nav.focus(listHost);
                list.setActive(true);
            },

            onResume: function () { refreshRows(true); },

            onKey: function () { return false; },

            unmount: function () {
                if (list) { list.destroy(); }
                list = null;
            }
        };
    };
})(window.App = window.App || {});
