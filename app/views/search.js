/* ============================================================
   views/search.js
   ARAMA
   Ust satir : metin kutusu + kapsam secicileri (Tumu/Kanal/Film/Dizi)
   Alt       : sonuc listesi

   Arama, indirilmis listeler uzerinde YEREL olarak yapilir
   (Xtream API'de guvenilir bir arama endpointi yoktur).
   Turkce karakterler normalize edilir: "guclu" ile "güçlü" eslesir.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;

    App.Views = App.Views || {};

    App.Views.search = function () {
        var root, listHost, headEl, field, scopeEl;
        var list = null;
        var results = [];
        var scope = 'all';
        var scopeChips = [];
        var searchTimer = null;
        var destroyed = false;

        var SCOPES = [
            { id: 'all', label: 'Todos' },
            { id: 'live', label: 'Canais' },
            { id: 'movie', label: 'Filmes' },
            { id: 'series', label: 'Séries' }
        ];

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
            if (item.num) { sub.push('Canal ' + item.num); }
            if (item.categoryName) { sub.push(item.categoryName); }
            texts.appendChild(U.el('div', 'ch__epg', sub.join('  •  ')));
            node.appendChild(texts);

            node.appendChild(U.el('span', 'ch__fav', App.Favorites.has(item) ? '★' : ''));
        }

        function setScope(id) {
            scope = id;
            for (var i = 0; i < scopeChips.length; i++) {
                U.toggleClass(scopeChips[i], 'is-selected', SCOPES[i].id === id);
            }
            doSearch();
        }

        function doSearch() {
            var q = field.getValue();
            if (searchTimer) { clearTimeout(searchTimer); }

            if (q.length < 2) {
                results = [];
                headEl.textContent = 'SONUCLAR';
                list.setItems([], {
                    emptyText: 'Digite pelo menos 2 letras para buscar',
                    emptyIcon: '🔍'
                });
                return;
            }

            list.setItems([], { emptyText: 'Buscando...', emptyIcon: '⏳' });

            searchTimer = setTimeout(function () {
                if (destroyed) { return; }
                App.Content.search(q, scope).then(function (r) {
                    if (destroyed) { return; }
                    results = [].concat(r.live, r.movies, r.series);
                    headEl.textContent = 'RESULTADOS  (' + results.length + ')';
                    list.setItems(results, {
                        emptyText: '"' + q + '": nenhum resultado encontrado',
                        emptyIcon: '🔍'
                    });
                }, function (err) {
                    if (destroyed) { return; }
                    var e = App.AppError.wrap(err);
                    list.setItems([], { emptyText: e.message.split('\n')[0], emptyIcon: '⚠' });
                });
            }, 400);
        }

        function openCurrent(item, index) {
            var sameType = results.filter(function (x) { return x.type === item.type; });
            var idx = 0;
            for (var i = 0; i < sameType.length; i++) {
                if (sameType[i].key === item.key) { idx = i; break; }
            }
            App.Actions.open(item, { items: sameType, index: idx, returnTo: 'search' });
        }

        return {
            id: 'search',
            title: 'Buscar',

            mount: function (container, params) {
                root = container;
                destroyed = false;
                if (params && params.scope) { scope = params.scope; }

                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '🔍 Buscar'));
                bar.appendChild(U.el('div', 'topbar__spacer'));
                root.appendChild(bar);

                var body = U.el('div', 'body');

                /* --- Arama cubugu --- */
                var barRow = U.el('div', 'search__bar');
                field = App.UI.Field.create({
                    label: 'Termo de busca',
                    placeholder: 'Nome do canal, filme ou série',
                    isDefault: true,
                    onChange: doSearch,
                    onSubmit: function () {
                        doSearch();
                        setTimeout(function () { App.Nav.focus(listHost); }, 450);
                    }
                });
                barRow.appendChild(field.root);

                scopeEl = U.el('div', 'search__scope');
                scopeChips = [];
                for (var i = 0; i < SCOPES.length; i++) {
                    (function (s) {
                        var chip = U.el('div', 'scope-chip', s.label);
                        App.Nav.bind(chip, function () { setScope(s.id); });
                        scopeEl.appendChild(chip);
                        scopeChips.push(chip);
                    })(SCOPES[i]);
                }
                barRow.appendChild(scopeEl);
                body.appendChild(barRow);

                /* --- Sonuclar --- */
                var col = U.el('div', 'search__results');
                headEl = U.el('div', 'col__head', 'SONUCLAR');
                col.appendChild(headEl);
                listHost = U.el('div', 'col__body');
                col.appendChild(listHost);
                body.appendChild(col);

                root.appendChild(body);

                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Digitar / Abrir</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Voltar</span>';
                root.appendChild(hints);

                list = App.UI.VirtualList.create({
                    container: listHost,
                    itemHeight: U.rem(5.5),
                    render: renderItem,
                    onSelect: openCurrent,
                    onEdge: function (dir) {
                        if (dir === 'up') { field.focusBox(); return true; }
                        return true;
                    }
                });

                App.Nav.bind(listHost, function () { list.select(); }, {
                    onFocus: function () { list.setActive(true); },
                    onBlur: function () { list.setActive(false); }
                });

                setScope(scope);
                field.focusBox();
            },

            onResume: function () { if (list) { list.refresh(); } },

            onKey: function (code) {
                if (code === KEY.YELLOW) {
                    var item = list && list.getItem();
                    if (item && App.Nav.get() === listHost) {
                        var on = App.Favorites.toggle(item);
                        App.UI.Toast.info(on ? '★ Adicionado aos favoritos' : 'Removido dos favoritos');
                        list.refreshIndex(list.getIndex());
                    }
                    return true;
                }
                return false;
            },

            onBack: function () {
                if (App.Nav.get() === listHost) { field.focusBox(); return true; }
                return false;
            },

            unmount: function () {
                destroyed = true;
                if (searchTimer) { clearTimeout(searchTimer); }
                App.UI.ImageLoader.flush();
                if (list) { list.destroy(); }
                list = null;
                scopeChips = [];
            }
        };
    };
})(window.App = window.App || {});
