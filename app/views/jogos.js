/* ============================================================
   views/jogos.js
   AGENDA: Fórmula 1 (próximo fim de semana) + futebol (Europa por padrão)
     Cada item mostra horário local, status (🔴 ao vivo / FINAL), competição
     e o canal da lista do usuário que transmite.
   OK       -> abre o canal no player (RETURN volta para a agenda)
   AZUL     -> alterna futebol: Europa / Todos os jogos
   VERMELHO -> atualizar
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    App.Views = App.Views || {};

    App.Views.jogos = function () {
        var root, listHost, headEl, list = null;
        var rows = [];
        var all = { f1: [], futebol: [] };
        var onlyEurope = true;
        var destroyed = false;

        function renderRow(node, j) {
            U.empty(node);
            node.style.height = U.rem(6) + 'px';
            node.style.opacity = '';
            if (j.header) {
                node.appendChild(U.el('span', 'ch__num', j.glyph));
                var t = U.el('div', 'ch__texts');
                t.appendChild(U.el('div', 'ch__name', j.title));
                t.appendChild(U.el('div', 'ch__epg', j.sub || ''));
                node.appendChild(t);
                return;
            }
            node.appendChild(U.el('span', 'ch__num', j.horario || ''));
            var texts = U.el('div', 'ch__texts');
            var title = (j.kind === 'f1') ? (j.time1 + '  ·  ' + j.time2)
                                          : (j.time1 + '  x  ' + j.time2 + (j.placar ? ('   ' + j.placar) : ''));
            texts.appendChild(U.el('div', 'ch__name', title));
            var sub = [];
            if (j.status.live) { sub.push('● ' + j.status.text); }
            else if (j.status.done) { sub.push('FINAL'); }
            if (j.competicao) { sub.push(j.competicao); }
            sub.push(j.channel ? ('📡 ' + j.channel.name)
                               : (j.canais.length ? ('canal não encontrado: ' + j.canais.slice(0, 3).join(', ')) : 'sem canal informado'));
            texts.appendChild(U.el('div', 'ch__epg', sub.join('  •  ')));
            node.appendChild(texts);
            node.appendChild(U.el('span', 'ch__fav', j.status.live ? '🔴' : (j.channel ? '▶' : '')));
            if (!j.channel) { node.style.opacity = '.55'; }
        }

        function openRow(j) {
            if (!j || j.header) { return; }
            if (!j.channel) { App.UI.Toast.warn('Nenhum canal da sua lista transmite isto.'); return; }
            var ctx = j.channels || [];
            var idx = 0;
            for (var i = 0; i < ctx.length; i++) { if (ctx[i].key === j.channel.key) { idx = i; break; } }
            App.Router.go('player', { item: j.channel, context: { items: ctx, index: idx }, returnTo: 'jogos' });
        }

        function build() {
            rows = [];
            var fut = all.futebol.filter(function (j) { return !onlyEurope || j.region === 'europe'; });
            if (all.f1.length) {
                rows.push({ header: true, glyph: '🏎', title: 'Fórmula 1', sub: all.f1[0].time1.replace(/^F1 · /, '') + '  •  horários no fuso da TV' });
                rows = rows.concat(all.f1);
            }
            rows.push({ header: true, glyph: '⚽', title: onlyEurope ? 'Futebol — Europa' : 'Futebol — todos os jogos',
                        sub: fut.length + ' jogos hoje' + (onlyEurope ? '  •  AZUL mostra todos' : '  •  AZUL volta para Europa') });
            rows = rows.concat(fut);
            var live = 0, withCh = 0;
            for (var i = 0; i < rows.length; i++) { if (!rows[i].header && rows[i].status.live) { live++; } if (!rows[i].header && rows[i].channel) { withCh++; } }
            headEl.textContent = 'AGENDA' + (live ? ('  •  ' + live + ' ao vivo agora') : '') + '  •  ' + withCh + ' com canal na sua lista';
            list.setItems(rows, { emptyText: 'Nada na agenda', emptyIcon: '⚽', index: rows.length > 1 ? 1 : 0 });
        }

        function load(force) {
            App.UI.Loading.show('Carregando a agenda...');
            var pFut = (App.Jogos && App.Jogos.isConfigured())
                ? App.Jogos.list(force).then(function (g) { return App.Jogos.resolve(g); }, function (e) { return []; })
                : Promise.resolve([]);
            var pF1 = App.Jogos.f1(force).then(function (g) { return App.Jogos.resolve(g); }, function (e) { return []; });
            Promise.all([pF1, pFut]).then(function (res) {
                App.UI.Loading.hide();
                if (destroyed) { return; }
                all.f1 = res[0]; all.futebol = res[1];
                if (!all.f1.length && !all.futebol.length) {
                    headEl.textContent = 'AGENDA';
                    list.setItems([], { emptyText: App.Jogos.isConfigured() ? 'Não foi possível carregar a agenda' : 'Agenda de futebol não configurada (linha "# jogos: URL" no hesaplar.txt)', emptyIcon: '⚽' });
                    return;
                }
                build();
            });
        }

        return {
            id: 'jogos',
            title: 'Agenda',
            mount: function (container) {
                root = container;
                destroyed = false;
                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '🏎 Fórmula 1  ·  ⚽ Futebol'));
                bar.appendChild(U.el('div', 'topbar__spacer'));
                root.appendChild(bar);

                var body = U.el('div', 'body');
                var cols = U.el('div', 'cols');
                var col = U.el('div', 'col fill');
                headEl = U.el('div', 'col__head', 'AGENDA');
                col.appendChild(headEl);
                listHost = U.el('div', 'col__body');
                col.appendChild(listHost);
                cols.appendChild(col);
                body.appendChild(cols);
                root.appendChild(body);

                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Assistir</span>' +
                    '<span class="hint"><span class="hint__key">AZUL</span> Europa / Todos</span>' +
                    '<span class="hint"><span class="hint__key">VERMELHO</span> Atualizar</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Voltar</span>';
                root.appendChild(hints);

                list = App.UI.VirtualList.create({
                    container: listHost,
                    itemHeight: U.rem(6),
                    render: renderRow,
                    onSelect: openRow,
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
                if (code === KEY.BLUE) { onlyEurope = !onlyEurope; build(); return true; }
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
