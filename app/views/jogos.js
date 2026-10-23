/* ============================================================
   views/jogos.js
   JOGOS DE HOJE
     Lista dos jogos do dia (feed do provedor) com horário, placar/status,
     competição e o canal que transmite, já casado com a lista do usuário.
   OK       -> abre o canal no player (volta para esta tela com RETURN)
   VERMELHO -> atualizar a agenda
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    App.Views = App.Views || {};

    App.Views.jogos = function () {
        var root, listHost, headEl, list = null;
        var games = [];
        var destroyed = false;

        function renderGame(node, j) {
            U.empty(node);
            node.style.height = U.rem(6) + 'px';
            var when = U.el('span', 'ch__num', j.horario || '');
            node.appendChild(when);

            var texts = U.el('div', 'ch__texts');
            var title = U.el('div', 'ch__name', j.time1 + '  x  ' + j.time2 + (j.placar ? ('   ' + j.placar) : ''));
            texts.appendChild(title);
            var sub = [];
            if (j.status.live) { sub.push('● ' + j.status.text); }
            else if (j.status.done) { sub.push('FINAL'); }
            if (j.competicao) { sub.push(j.competicao); }
            sub.push(j.channel ? ('📡 ' + j.channel.name) : (j.canais.length ? ('canal não encontrado: ' + j.canais.join(', ')) : 'sem canal informado'));
            texts.appendChild(U.el('div', 'ch__epg', sub.join('  •  ')));
            node.appendChild(texts);

            var tag = U.el('span', 'ch__fav', j.status.live ? '🔴' : (j.channel ? '▶' : ''));
            node.appendChild(tag);
            if (!j.channel) { node.style.opacity = '.55'; }
        }

        function openGame(j) {
            if (!j) { return; }
            if (!j.channel) {
                App.UI.Toast.warn('Nenhum canal da sua lista transmite este jogo.');
                return;
            }
            var ctx = j.channels || [];
            var idx = 0;
            for (var i = 0; i < ctx.length; i++) { if (ctx[i].key === j.channel.key) { idx = i; break; } }
            App.Router.go('player', { item: j.channel, context: { items: ctx, index: idx }, returnTo: 'jogos' });
        }

        function load(force) {
            if (!App.Jogos || !App.Jogos.isConfigured()) {
                headEl.textContent = 'JOGOS DE HOJE';
                list.setItems([], { emptyText: 'Agenda não configurada (linha "# jogos: URL" no hesaplar.txt).', emptyIcon: '⚽' });
                return;
            }
            App.UI.Loading.show('Carregando a agenda...');
            App.Jogos.list(force).then(function (g) {
                return App.Jogos.resolve(g);
            }).then(function (g) {
                App.UI.Loading.hide();
                if (destroyed) { return; }
                games = g;
                var live = 0, withCh = 0;
                for (var i = 0; i < games.length; i++) { if (games[i].status.live) { live++; } if (games[i].channel) { withCh++; } }
                headEl.textContent = 'JOGOS DE HOJE  —  ' + games.length + ' jogos' + (live ? ('  •  ' + live + ' ao vivo agora') : '') +
                    '  •  ' + withCh + ' com canal na sua lista';
                list.setItems(games, { emptyText: 'Nenhum jogo na agenda de hoje', emptyIcon: '⚽' });
            }, function (err) {
                App.UI.Loading.hide();
                if (destroyed) { return; }
                var e = App.AppError.wrap(err);
                list.setItems([], { emptyText: 'Não foi possível carregar a agenda (' + (e.detail || e.code) + ')', emptyIcon: '⚽' });
            });
        }

        return {
            id: 'jogos',
            title: 'Jogos de hoje',
            mount: function (container) {
                root = container;
                destroyed = false;
                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '⚽ Jogos de hoje'));
                bar.appendChild(U.el('div', 'topbar__spacer'));
                root.appendChild(bar);

                var body = U.el('div', 'body');
                var cols = U.el('div', 'cols');
                var col = U.el('div', 'col fill');
                headEl = U.el('div', 'col__head', 'JOGOS DE HOJE');
                col.appendChild(headEl);
                listHost = U.el('div', 'col__body');
                col.appendChild(listHost);
                cols.appendChild(col);
                body.appendChild(cols);
                root.appendChild(body);

                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Assistir</span>' +
                    '<span class="hint"><span class="hint__key">VERMELHO</span> Atualizar agenda</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Voltar</span>';
                root.appendChild(hints);

                list = App.UI.VirtualList.create({
                    container: listHost,
                    itemHeight: U.rem(6),
                    render: renderGame,
                    onSelect: openGame,
                    onEdge: function () { return true; }
                });
                App.Nav.bind(listHost, function () { list.select(); }, {
                    onFocus: function () { list.setActive(true); },
                    onBlur: function () { list.setActive(false); },
                    isDefault: true
                });
                App.Nav.focus(listHost);
                list.setActive(true);
                load(false);
            },
            onResume: function () { load(false); },
            onKey: function (code) {
                if (code === KEY.RED) { load(true); return true; }
                return false;
            },
            unmount: function () {
                destroyed = true;
                if (list) { list.destroy(); }
                list = null;
            }
        };
    };
})(window.App = window.App || {});
