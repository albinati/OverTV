/* ============================================================
   services/jogos.js
   Agenda de jogos do dia (futebol) com o canal que transmite.

   - A URL do feed vem da linha "# jogos: URL" do hesaplar.txt
     (fora do repositório). Sem a linha, a tela avisa que não está configurada.
   - Formato do feed (o mesmo do app do provedor):
       [{ time1, time2, competicao, horario, status, placar_time1, placar_time2,
          data_jogo, canais:[{nome, img_url}], img_time1_url, img_time2_url }]
   - O casamento jogo -> canal é feito aqui, contra a lista de canais do
     usuário (já agrupada por qualidade), pelo nome do canal do feed.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Jogos');
    var feedUrl = '';
    var cache = { at: 0, list: null };
    var TTL = 2 * 60 * 1000;

    (function loadFeedFromFile() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', 'hesaplar.txt', true);
            xhr.onload = function () {
                if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) { return; }
                var m = /^\s*#\s*jogos\s*[:|]\s*(\S+)/im.exec(xhr.responseText || '');
                if (m) { feedUrl = m[1]; log.info('feed de jogos configurado pelo hesaplar.txt'); }
            };
            xhr.send();
        } catch (e) { /* sem arquivo */ }
    })();

    function norm(s) {
        return String(s || '').toLowerCase()
            .replace(/[áàâã]/g, 'a').replace(/[éê]/g, 'e').replace(/[íî]/g, 'i').replace(/[óôõ]/g, 'o').replace(/[úû]/g, 'u').replace(/ç/g, 'c')
            .replace(/premium/g, 'premiere').replace(/sporv/g, 'sportv')
            .replace(/[^a-z0-9]+/g, ' ').trim();
    }

    var USELESS = { canal: 1, tv: 1, hd: 1, fhd: 1, uhd: 1, sd: 1, 4: 1, k: 1, 'ao': 1, vivo: 1, brasil: 1, br: 1, h264: 1, hevc: 1 };

    function statusInfo(st) {
        var s = String(st || '').toUpperCase().trim();
        if (/^(FIM DE JOGO|ENCERRADO|FINALIZADO|FINAL|FT|TERMINOU)$/.test(s)) { return { text: 'FINAL', order: 3, done: true }; }
        if (s === 'INT' || s === 'INTERVALO') { return { text: 'INTERVALO', order: 1, live: true }; }
        if (/^\d+'/.test(s)) { return { text: s, order: 1, live: true }; }
        return { text: s || 'AGENDADO', order: 2 };
    }

    function normalizeGame(j) {
        var t1 = j.time1 || (j.times && j.times.time1 && j.times.time1.nome) || '';
        var t2 = j.time2 || (j.times && j.times.time2 && j.times.time2.nome) || '';
        var st = statusInfo(j.status);
        var canais = [];
        var raw = j.canais || [];
        for (var i = 0; i < raw.length; i++) {
            var n = raw[i] && (raw[i].nome || raw[i].name || raw[i].title);
            if (n) { canais.push(String(n)); }
        }
        return {
            time1: t1, time2: t2, competicao: j.competicao || j.liga || '', horario: j.horario || j.hora || '',
            placar: (j.placar_time1 !== '' && j.placar_time1 !== undefined && j.placar_time1 !== null) ? (j.placar_time1 + ' x ' + j.placar_time2) : '',
            status: st, canais: canais, logo1: j.img_time1_url || '', logo2: j.img_time2_url || '',
            name: t1 + ' x ' + t2
        };
    }

    /** Índice nome normalizado -> canal (lista agrupada do usuário). */
    function buildIndex(channels) {
        var byKey = {}, list = [];
        for (var i = 0; i < channels.length; i++) {
            var c = channels[i];
            var base = App.Quality ? App.Quality.parse(c.name).base : c.name;
            var k = norm(base);
            if (!k) { continue; }
            if (!byKey[k]) { byKey[k] = c; }
            list.push({ k: k, c: c });
        }
        return { byKey: byKey, list: list };
    }

    function findChannel(idx, name) {
        var k = norm(name);
        if (!k) { return null; }
        if (idx.byKey[k]) { return idx.byKey[k]; }
        /* começa com / contém o nome inteiro */
        var i, best = null;
        for (i = 0; i < idx.list.length; i++) {
            if (idx.list[i].k.indexOf(k) === 0) { return idx.list[i].c; }
            if (!best && idx.list[i].k.indexOf(' ' + k) >= 0) { best = idx.list[i].c; }
        }
        if (best) { return best; }
        /* por palavra significativa (ex.: "PREMIERE 2" -> "premiere") */
        var parts = k.split(' ');
        for (var p = 0; p < parts.length; p++) {
            var t = parts[p];
            if (t.length < 3 || USELESS[t]) { continue; }
            for (i = 0; i < idx.list.length; i++) {
                if (idx.list[i].k === t || idx.list[i].k.indexOf(t + ' ') === 0) { return idx.list[i].c; }
            }
        }
        return null;
    }

    App.Jogos = {
        isConfigured: function () { return !!feedUrl; },

        /** @returns {Promise<Array>} jogos normalizados, ordenados por status e horário */
        list: function (force) {
            if (!feedUrl) { return Promise.reject(new App.AppError(App.ERR.UNSUPPORTED, 'feed de jogos não configurado')); }
            if (!force && cache.list && Date.now() - cache.at < TTL) { return Promise.resolve(cache.list); }
            return App.Http.getJson(feedUrl + (feedUrl.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now(), { timeout: 15000 })
                .then(function (d) {
                    var arr = (d && (d.jogos || d.games || d.data || d.results || d.matches)) || d || [];
                    if (!arr.length && typeof arr === 'object') { arr = []; }
                    var out = [];
                    for (var i = 0; i < arr.length; i++) { if (arr[i]) { out.push(normalizeGame(arr[i])); } }
                    out.sort(function (a, b) {
                        if (a.status.order !== b.status.order) { return a.status.order - b.status.order; }
                        return String(a.horario).localeCompare(String(b.horario));
                    });
                    cache = { at: Date.now(), list: out };
                    return out;
                });
        },

        /**
         * Resolve os canais de cada jogo contra a lista do usuário.
         * @returns {Promise<Array>} jogos com .channel (ou null) e .channelName
         */
        resolve: function (games) {
            return App.Content.getLiveChannels(App.Content.ALL_ID).then(function (channels) {
                var idx = buildIndex(channels || []);
                for (var g = 0; g < games.length; g++) {
                    var j = games[g];
                    j.channel = null; j.channelName = '';
                    for (var c = 0; c < j.canais.length && !j.channel; c++) {
                        var ch = findChannel(idx, j.canais[c]);
                        if (ch) { j.channel = ch; j.channelName = j.canais[c]; }
                    }
                    j.channels = channels || [];
                }
                return games;
            });
        }
    };
})(window.App = window.App || {});
