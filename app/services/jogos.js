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
    /* Ordem padrão (Brasil 2026: Globo/SporTV têm a F1); ajustável na linha "# f1:" */
    var f1Channels = ['SPORTV 3', 'SPORTV', 'GLOBO', 'BAND SPORTS', 'BAND', 'SKY SPORTS F1', 'F1 TV'];
    var F1_API = 'https://api.jolpi.ca/ergast/f1/current/next.json';   /* calendário público (Ergast/Jolpica) */
    var cache = { at: 0, list: null };
    var f1cache = { at: 0, list: null };
    var TTL = 2 * 60 * 1000;

    (function loadConfigFromFile() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', 'hesaplar.txt', true);
            xhr.onload = function () {
                if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) { return; }
                var t = xhr.responseText || '';
                var m = /^\s*#\s*jogos\s*[:|]\s*(\S+)/im.exec(t);
                if (m) { feedUrl = m[1]; log.info('feed de jogos configurado pelo hesaplar.txt'); }
                var f = /^\s*#\s*f1\s*[:|]\s*(.+)$/im.exec(t);
                if (f) { f1Channels = f[1].split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
            };
            xhr.send();
        } catch (e) { /* sem arquivo */ }
    })();

    /* Competições europeias e internacionais (o resto é "outros") */
    var EUROPE = /ingl|premier|espanh|la liga|italian|alem|bundesliga|franc|ligue|portug|holand|eredivisie|belga|escoc|turco|grego|champions|europa league|conference|liga das na|eurocopa|euro |copa do mundo|mundial|supercopa|uefa/i;
    function region(comp) { return EUROPE.test(String(comp || '')) ? 'europe' : 'other'; }

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
            kind: 'futebol', region: region(j.competicao || j.liga || ''),
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

        /**
         * Próximo fim de semana de Fórmula 1 (calendário público), como itens
         * no mesmo formato dos jogos: {kind:'f1', name, competicao, when(Date),
         * horario, status, canais}. Sessões já encerradas há mais de 3 h saem.
         */
        f1: function (force) {
            if (!force && f1cache.list && Date.now() - f1cache.at < 30 * 60 * 1000) { return Promise.resolve(f1cache.list); }
            return App.Http.getJson(F1_API, { timeout: 15000 }).then(function (d) {
                var races = (d && d.MRData && d.MRData.RaceTable && d.MRData.RaceTable.Races) || [];
                var out = [];
                if (!races.length) { f1cache = { at: Date.now(), list: out }; return out; }
                var r = races[0];
                var gp = String(r.raceName || '').replace(/Grand Prix/i, 'GP');
                var sessions = [
                    ['FirstPractice', 'Treino livre 1'], ['SecondPractice', 'Treino livre 2'], ['ThirdPractice', 'Treino livre 3'],
                    ['SprintQualifying', 'Classificação sprint'], ['Sprint', 'Sprint'], ['Qualifying', 'Classificação']
                ];
                function add(label, dateStr, timeStr, isRace) {
                    if (!dateStr) { return; }
                    var when = new Date(dateStr + 'T' + (timeStr || '12:00:00Z'));
                    if (isNaN(when.getTime())) { return; }
                    var now = Date.now();
                    if (when.getTime() + 3 * 3600 * 1000 < now) { return; }           /* já acabou */
                    var live = now >= when.getTime() && now < when.getTime() + 2 * 3600 * 1000;
                    var dd = when.getDate(), mm = when.getMonth() + 1;
                    var days = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
                    var sameDay = new Date().toDateString() === when.toDateString();
                    var hh = ('0' + when.getHours()).slice(-2) + ':' + ('0' + when.getMinutes()).slice(-2);
                    out.push({
                        kind: 'f1', region: 'europe', when: when,
                        time1: 'F1 · ' + gp, time2: label, name: 'F1 ' + gp + ' - ' + label,
                        competicao: r.Circuit && r.Circuit.circuitName ? r.Circuit.circuitName : 'Fórmula 1',
                        horario: (sameDay ? 'hoje ' : (days[when.getDay()] + ' ' + dd + '/' + mm + ' ')) + hh,
                        placar: '', canais: f1Channels.slice(),
                        status: live ? { text: 'AO VIVO', order: 1, live: true } : { text: isRace ? 'CORRIDA' : 'AGENDADO', order: 2 }
                    });
                }
                for (var i = 0; i < sessions.length; i++) {
                    var s = r[sessions[i][0]];
                    if (s) { add(sessions[i][1], s.date, s.time, false); }
                }
                add('Corrida', r.date, r.time, true);
                out.sort(function (a, b) { return a.when - b.when; });
                f1cache = { at: Date.now(), list: out };
                return out;
            });
        },

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
                    var cands = (j.kind === 'f1') ? f1Channels : j.canais;
                    for (var c = 0; c < cands.length && !j.channel; c++) {
                        var ch = findChannel(idx, cands[c]);
                        if (ch) { j.channel = ch; j.channelName = cands[c]; }
                    }
                    j.channels = channels || [];
                }
                return games;
            });
        }
    };
})(window.App = window.App || {});
