/* ============================================================
   services/hub.js
   Integração com o painel do provedor (api.php). O endereço do painel
   vem da linha "# painel: URL" do hesaplar.txt (fora do repositório);
   sem essa linha o recurso fica desligado.
     action=login            -> qual servidor (DNS) a conta deve usar
     action=mig&step=start   -> abre sessão de migração (mig_token)
     action=mig&step=servers -> servidores disponíveis + atual
     action=mig&step=migrate -> move a conta para outro servidor
     action=mig&step=sync    -> resultado de uma migração pendente

   Protocolo copiado do web player oficial (painel/web/assets/js/app.js).
   Usuário e senha da conta ativa são enviados ao painel nessas chamadas.
   Nada aqui roda sozinho: tudo parte de Configurações > Servidor.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Hub');
    var token = '';            /* mig_token da sessão atual (memória) */
    var filePanel = '';        /* lido do hesaplar.txt ("# painel: URL") */

    function panelUrl() {
        return String(App.Settings.get('hubPanel') || filePanel || '').replace(/\/+$/, '');
    }

    /* Lê "# painel: URL" do hesaplar.txt empacotado (linha de comentário
       para o presets.js). Em Tizen, arquivo do pacote responde status 0. */
    (function loadPanelFromFile() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', 'hesaplar.txt', true);
            xhr.onload = function () {
                if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) { return; }
                var m = /^\s*#\s*painel\s*[:|]\s*(\S+)/im.exec(xhr.responseText || '');
                if (m) { filePanel = m[1]; log.info('painel do provedor configurado pelo hesaplar.txt'); }
            };
            xhr.send();
        } catch (e) { /* sem arquivo: recurso desligado */ }
    })();

    /** XHR com JSON; resolve {status, json} mesmo em erro HTTP. */
    function call(query, body, extraHeaders, timeout) {
        return new Promise(function (resolve, reject) {
            var base = panelUrl();
            if (!base) { return reject(new App.AppError(App.ERR.UNSUPPORTED, 'painel não configurado')); }
            var xhr = new XMLHttpRequest();
            xhr.open(body === undefined ? 'GET' : 'POST', base + '?' + query, true);
            xhr.timeout = timeout || 90000;
            xhr.setRequestHeader('Accept', 'application/json');
            if (body !== undefined) { xhr.setRequestHeader('Content-Type', 'application/json'); }
            for (var h in (extraHeaders || {})) {
                if (Object.prototype.hasOwnProperty.call(extraHeaders, h)) { xhr.setRequestHeader(h, extraHeaders[h]); }
            }
            xhr.onload = function () {
                var j = null;
                try { j = JSON.parse(xhr.responseText); } catch (e) { j = null; }
                resolve({ status: xhr.status, json: j || {}, retryAfter: xhr.getResponseHeader('Retry-After') });
            };
            xhr.onerror = function () { reject(new App.AppError(App.ERR.NETWORK, 'painel inacessível')); };
            xhr.ontimeout = function () { reject(new App.AppError(App.ERR.TIMEOUT, 'painel não respondeu')); };
            xhr.send(body === undefined ? null : JSON.stringify(body));
        });
    }

    function creds() {
        var p = App.Profile.get();
        if (!p || p.type !== 'xtream' || !p.username) {
            throw new App.AppError(App.ERR.UNSUPPORTED, 'a conta ativa não é Xtream');
        }
        return p;
    }

    function migRequest(step, body, retried) {
        var hdr = token ? { 'X-Mig-Token': token } : {};
        var isGet = (step === 'servers');
        return call('action=mig&step=' + step, isGet ? undefined : (body || {}), hdr, isGet ? 90000 : 120000)
            .then(function (r) {
                var j = r.json;
                if (j.mig_token) { token = j.mig_token; }
                /* sessão expirada: refaz o start uma vez e repete */
                if (r.status === 401 && j.restart && step !== 'start' && !retried) {
                    var p = creds();
                    return migRequest('start', { username: p.username, password: p.password }, true).then(function () {
                        return migRequest(step, body, true);
                    });
                }
                if (r.status >= 400 || (r.status === 202 && !j.success) || j.success === false) {
                    var e = new App.AppError(App.ERR.NETWORK, j.message || ('painel respondeu HTTP ' + r.status));
                    e.httpStatus = r.status;
                    e.wait = Number(j.retry_after || r.retryAfter || 0);
                    throw e;
                }
                return j;
            });
    }

    App.Hub = {
        isConfigured: function () { return !!panelUrl() && !!App.Settings.get('hubEnabled'); },

        /**
         * Pergunta ao painel qual servidor a conta deve usar.
         * @returns {Promise<{id:number,name:string,url:string}>}
         */
        identify: function () {
            var p = creds();
            return call('action=login', { username: p.username, password: p.password }, null, 90000)
                .then(function (r) {
                    var j = r.json;
                    if (r.status === 200 && j.success && j.dns && j.dns.url) {
                        log.info('painel indica servidor', j.dns.name, j.dns.url);
                        return { id: Number(j.dns.id || 0), name: j.dns.name || '', url: String(j.dns.url).replace(/\/+$/, '') };
                    }
                    if (r.status === 401 || r.status === 422) { throw new App.AppError(App.ERR.AUTH, 'usuário ou senha inválidos no painel'); }
                    if (r.status === 429) { throw new App.AppError(App.ERR.NETWORK, 'muitas tentativas; aguarde um minuto'); }
                    throw new App.AppError(App.ERR.NETWORK, j.message || ('painel respondeu HTTP ' + r.status));
                });
        },

        /** Abre a sessão de migração e devolve a lista de servidores. */
        servers: function () {
            var p = creds();
            token = '';
            return migRequest('start', { username: p.username, password: p.password }).then(function () {
                return migRequest('servers');
            }).then(function (j) {
                var cur = String(j.current_server_id || '');
                var list = (j.servers || []).map(function (s) {
                    return { id: String(s.id), name: s.name || ('Servidor ' + s.id), online: s.online, active: s.status === 'ACTIVE' };
                });
                return { currentId: cur, currentName: j.current_server_name || '', currentOnline: j.current_online, servers: list };
            });
        },

        /**
         * Migra a conta. Resolve com {host, username, password, name} do novo servidor.
         * Em migração pendente (202), consulta sync até concluir (máx. ~2 min).
         */
        migrate: function (serverId) {
            var p = creds();
            function finish(j) {
                var pl = j.playlist || j.customer || {};
                var url = pl.server_url || (j.web_dns && j.web_dns.url) || '';
                if (!url) { throw new App.AppError(App.ERR.NETWORK, 'o painel não informou o novo servidor'); }
                return {
                    host: String(url).replace(/\/+$/, ''),
                    name: pl.server_name || (j.web_dns && j.web_dns.name) || '',
                    username: pl.username || p.username,
                    password: pl.password || p.password
                };
            }
            function waitSync(tries) {
                return new Promise(function (r) { setTimeout(r, 5000); }).then(function () {
                    return migRequest('sync', {});
                }).then(function (j) {
                    if (j.playlist || j.customer) { return finish(j); }
                    if (tries <= 0) { throw new App.AppError(App.ERR.TIMEOUT, 'migração ainda pendente; tente "Verificar servidor" mais tarde'); }
                    return waitSync(tries - 1);
                });
            }
            return migRequest('migrate', { server_id: String(serverId) }).then(function (j) {
                if (j.playlist || j.customer) { return finish(j); }
                return waitSync(24);
            }, function (e) {
                if (e && e.httpStatus === 202) { return waitSync(24); }
                throw e;
            });
        },

        /** Aplica um novo servidor/credenciais à conta ativa e recarrega o conteúdo. */
        applyServer: function (srv, onStatus) {
            var p = creds();
            var changed = (srv.host && srv.host !== p.host) || (srv.username && srv.username !== p.username) ||
                          (srv.password && srv.password !== p.password);
            if (!changed) { return Promise.resolve(false); }
            App.Profile.save({
                id: p.id, name: p.name, type: 'xtream',
                host: srv.host || p.host, username: srv.username || p.username, password: srv.password || p.password,
                epgUrl: p.epgUrl
            });
            App.Cache.clear();
            App.BigStore.clear();
            App.EPG.clear();
            return App.Content.init({ onStatus: onStatus || function () {} }).then(function () {
                return App.Xtream.login().then(function (res) { App.Profile.setUserInfo(res.userInfo); return true; });
            });
        }
    };
})(window.App = window.App || {});
