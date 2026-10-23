/* ============================================================
   js/core/parental.js
   Controle parental: oculta categorias/itens adultos e libera com PIN.

   - Ajuste 'adultHidden' (padrão: true) e 'adultPinHash' em Settings.
   - A liberação por PIN vale só até o app fechar (memória).
   - O filtro é aplicado em services/content.js, logo vale para
     TV ao vivo, Filmes, Séries e Busca, em contas Xtream e listas M3U.
   ============================================================ */
(function (App) {
    'use strict';

    var log = App.Logger.get('Parental');
    var RX = /\b(adult\w*|xxx|porn\w*|er[oó]tic\w*|onlyfans|privacy|brasileirinhas|sexy?|hentai)\b|\+ ?18|18 ?\+/i;

    var unlocked = false;          /* liberado nesta sessão */
    var ids = {};                  /* type -> { categoryId: true } */

    function hash(s) {
        /* djb2 com sal fixo: suficiente para um PIN de TV */
        var h = 5381, str = 'overtv|' + s;
        for (var i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; }
        return 'h' + (h >>> 0).toString(16);
    }

    function isAdultName(name) { return RX.test(String(name || '')); }

    function isHidden() {
        return App.Settings.get('adultHidden') !== false && !unlocked;
    }

    function hasPin() { return !!App.Settings.get('adultPinHash'); }

    function askNewPin() {
        return App.UI.Pin.ask('Crie um PIN de 4 dígitos', 'Ele será pedido para mostrar conteúdo adulto.')
            .then(function (p1) {
                if (!p1) { return null; }
                return App.UI.Pin.ask('Repita o PIN', '').then(function (p2) {
                    if (!p2) { return null; }
                    if (p1 !== p2) {
                        App.UI.Toast.error('Os PINs não conferem.');
                        return null;
                    }
                    App.Settings.set('adultPinHash', hash(p1));
                    App.UI.Toast.success('PIN definido.');
                    return p1;
                });
            });
    }

    function verifyPin(title) {
        if (!hasPin()) { return askNewPin().then(function (p) { return !!p; }); }
        return App.UI.Pin.ask(title || 'Digite o PIN', '').then(function (p) {
            if (!p) { return false; }
            var ok = hash(p) === App.Settings.get('adultPinHash');
            if (!ok) { App.UI.Toast.error('PIN incorreto.'); }
            return ok;
        });
    }

    App.Parental = {
        isAdultName: isAdultName,
        isHidden: isHidden,
        isUnlocked: function () { return unlocked; },
        hasPin: hasPin,

        /** Guarda quais categorias de um tipo são adultas (chamado pelo content.js). */
        registerCategories: function (type, cats) {
            var map = {};
            for (var i = 0; i < (cats || []).length; i++) {
                var c = cats[i];
                if (c && isAdultName(c.name)) { map[String(c.id)] = true; }
            }
            ids[type] = map;
        },

        filterCategories: function (cats) {
            if (!isHidden()) { return cats; }
            var out = [];
            for (var i = 0; i < (cats || []).length; i++) {
                if (!isAdultName(cats[i].name)) { out.push(cats[i]); }
            }
            return out;
        },

        /**
         * @param {string} type 'live' | 'movie' | 'series'
         * @param {Array} list
         * @param {function(): Promise<Array>} loadCats  carrega as categorias se ainda não conhecidas
         * @returns {Promise<Array>}
         */
        filterItems: function (type, list, loadCats) {
            if (!isHidden()) { return Promise.resolve(list); }
            var ready = ids[type] ? Promise.resolve() :
                Promise.resolve().then(loadCats).then(function (cats) {
                    App.Parental.registerCategories(type, cats);
                }, function () { ids[type] = {}; });
            return ready.then(function () {
                var map = ids[type] || {};
                var out = [];
                for (var i = 0; i < (list || []).length; i++) {
                    var it = list[i];
                    if (map[String(it.categoryId)] || isAdultName(it.name)) { continue; }
                    out.push(it);
                }
                if (out.length !== (list || []).length) {
                    log.info(type + ': ' + (list.length - out.length) + ' itens adultos ocultos');
                }
                return out;
            });
        },

        /** Mostra o conteúdo adulto nesta sessão (pede PIN). @returns {Promise<boolean>} */
        unlock: function () {
            return verifyPin('Digite o PIN para mostrar conteúdo adulto').then(function (ok) {
                if (ok) { unlocked = true; App.Bus.emit('parental:changed'); }
                return ok;
            });
        },

        lock: function () {
            unlocked = false;
            App.Bus.emit('parental:changed');
        },

        /** Liga/desliga o filtro de forma permanente (desligar pede PIN). */
        setFilterEnabled: function (enabled) {
            if (enabled) {
                App.Settings.set('adultHidden', true);
                unlocked = false;
                App.Bus.emit('parental:changed');
                return Promise.resolve(true);
            }
            return verifyPin('Digite o PIN para desativar o filtro').then(function (ok) {
                if (ok) { App.Settings.set('adultHidden', false); App.Bus.emit('parental:changed'); }
                return ok;
            });
        },

        changePin: function () {
            var step = hasPin() ? verifyPin('Digite o PIN atual') : Promise.resolve(true);
            return step.then(function (ok) {
                if (!ok) { return false; }
                return askNewPin().then(function (p) { return !!p; });
            });
        }
    };
})(window.App = window.App || {});
