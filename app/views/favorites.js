/* ============================================================
   views/favorites.js
   FAVORILER
     Sol : tur filtresi (Tumu / Kanallar / Filmler / Diziler / Bolumler)
     Sag : favori listesi

   OK   -> ac (kanal/film -> oynatici, dizi -> detay)
   SARI -> favorilerden cikar
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;

    App.Views = App.Views || {};

    App.Views.favorites = function () {
        var root, filterHost, listHost, headEl;
        var filterList = null, list = null;
        var items = [];
        var destroyed = false;

        var FILTERS = [
            { id: '', name: 'Todos', glyph: '★' },
            { id: 'live', name: 'Canais', glyph: '📡' },
            { id: 'movie', name: 'Filmes', glyph: '🎬' },
            { id: 'series', name: 'Séries', glyph: '📺' },
            { id: 'episode', name: 'Episódios', glyph: '🎞' }
        ];

        function renderFilter(node, item) {
            U.empty(node);
            node.style.height = U.rem(4.5) + 'px';
            node.appendChild(U.el('span', '', item.glyph));
            node.appendChild(U.el('span', 'cat__name', item.name));
            var n = App.Favorites.count(item.id || undefined);
            node.appendChild(U.el('span', 'cat__count', n));
        }

        function renderItem(node, item) {
            U.empty(node);
            node.style.height = U.rem(5.5) + 'px';

            node.appendChild(U.el('span', 'ch__num', App.Actions.typeGlyph(item.type)));

            var logo = U.el('div', 'ch__logo');
            node.appendChild(logo);
            App.UI.ImageLoader.into(logo, item.logo, U.initials(item.name));

            var texts = U.el('div', 'ch__texts');
            texts.appendChild(U.el('div', 'ch__name', item.name));
            var sub = [App.Actions.typeName(item.type)];
            if (item.categoryName) { sub.push(item.categoryName); }
            if (item.num) { sub.push('Canal ' + item.num); }
            texts.appendChild(U.el('div', 'ch__epg', sub.join('  •  ')));
            node.appendChild(texts);

            node.appendChild(U.el('span', 'ch__fav', '★'));
        }

        /**
         * @param {object} f tur filtresi
         * @param {boolean} [keep] secili sira ve kaydirma korunsun mu
         *        (bir oge silindiginde odak listenin basina ziplamasin)
         */
        function applyFilter(f, keep) {
            var oldIdx = keep && list ? list.getIndex() : 0;
            items = App.Favorites.list(f && f.id ? f.id : undefined);
            headEl.textContent = 'FAVORITOS  —  ' + (f ? f.name : 'Todos') + '  (' + items.length + ')';
            App.UI.ImageLoader.flush();
            list.setItems(items, {
                index: Math.min(oldIdx, Math.max(0, items.length - 1)),
                keepScroll: !!keep,
                emptyText: 'Nenhum favorito neste tipo',
                emptyIcon: '⭐'
            });
        }

        function removeCurrent() {
            var item = list && list.getItem();
            if (!item) { return; }
            App.Favorites.remove(item.key);
            App.UI.Toast.info(item.name + ' removido dos favoritos');
            applyFilter(filterList.getItem(), true);
            filterList.refresh();
        }

        function openCurrent(item, index) {
            /* Ayni turdeki favoriler oynatici baglami olur (kanal degistirme) */
            var sameType = items.filter(function (x) { return x.type === item.type; });
            var idx = 0;
            for (var i = 0; i < sameType.length; i++) {
                if (sameType[i].key === item.key) { idx = i; break; }
            }
            App.Actions.open(item, { items: sameType, index: idx, returnTo: 'favorites' });
        }

        return {
            id: 'favorites',
            title: 'Favoritos',

            mount: function (container) {
                root = container;
                destroyed = false;

                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '⭐ Favoritos'));
                bar.appendChild(U.el('div', 'topbar__spacer'));
                root.appendChild(bar);

                var body = U.el('div', 'body');
                var cols = U.el('div', 'cols');

                var colF = U.el('div', 'col col--cats');
                colF.appendChild(U.el('div', 'col__head', 'TUR'));
                filterHost = U.el('div', 'col__body');
                colF.appendChild(filterHost);
                cols.appendChild(colF);

                var colL = U.el('div', 'col fill');
                headEl = U.el('div', 'col__head', 'FAVORILER');
                colL.appendChild(headEl);
                listHost = U.el('div', 'col__body');
                colL.appendChild(listHost);
                cols.appendChild(colL);

                body.appendChild(cols);
                root.appendChild(body);

                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Abrir</span>' +
                    '<span class="hint"><span class="hint__key">AMARELO</span> Remover dos favoritos</span>' +
                    '<span class="hint"><span class="hint__key">AZUL</span> Limpar tudo</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Voltar</span>';
                root.appendChild(hints);

                filterList = App.UI.VirtualList.create({
                    container: filterHost,
                    itemHeight: U.rem(4.5),
                    render: renderFilter,
                    onFocusChange: function (f) { applyFilter(f); },
                    onSelect: function () { App.Nav.focus(listHost); },
                    onEdge: function (dir) {
                        if (dir === 'right') { App.Nav.focus(listHost); return true; }
                        return false;
                    }
                });

                list = App.UI.VirtualList.create({
                    container: listHost,
                    itemHeight: U.rem(5.5),
                    render: renderItem,
                    onSelect: openCurrent,
                    onEdge: function (dir) {
                        if (dir === 'left') { App.Nav.focus(filterHost); return true; }
                        return true;
                    }
                });

                App.Nav.bind(filterHost, function () { filterList.select(); }, {
                    onFocus: function () { filterList.setActive(true); },
                    onBlur: function () { filterList.setActive(false); }
                });
                App.Nav.bind(listHost, function () { list.select(); }, {
                    onFocus: function () { list.setActive(true); },
                    onBlur: function () { list.setActive(false); },
                    isDefault: true
                });

                filterList.setItems(FILTERS, { silent: true });
                applyFilter(FILTERS[0]);
                App.Nav.focus(listHost);
                list.setActive(true);
            },

            onResume: function () {
                if (filterList) { filterList.refresh(); }
                applyFilter(filterList.getItem(), true);
            },

            onKey: function (code) {
                if (code === KEY.YELLOW) { removeCurrent(); return true; }
                if (code === KEY.BLUE) {
                    App.UI.Modal.confirm('Excluir todos os favoritos?',
                        'Esta ação não pode ser desfeita.', { danger: true, okText: 'Excluir' })
                        .then(function (yes) {
                            if (!yes) { return; }
                            App.Favorites.clear();
                            filterList.refresh();
                            applyFilter(filterList.getItem());
                            App.UI.Toast.success('Favoritos limpos');
                        });
                    return true;
                }
                return false;
            },

            onBack: function () {
                if (App.Nav.get() === listHost) {
                    App.Nav.focus(filterHost);
                    return true;
                }
                return false;
            },

            unmount: function () {
                destroyed = true;
                App.UI.ImageLoader.flush();
                if (filterList) { filterList.destroy(); }
                if (list) { list.destroy(); }
                filterList = list = null;
            }
        };
    };
})(window.App = window.App || {});
