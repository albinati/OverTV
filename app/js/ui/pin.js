/* ============================================================
   js/ui/pin.js
   Caixa de PIN numérico (4 dígitos) digitado com as teclas do controle.
   Fica à frente de tudo; app.js chama Pin.onKey() antes do Modal.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    App.UI = App.UI || {};

    var LEN = 4;
    var state = null;   /* { root, dots, value, resolve } */

    function render() {
        for (var i = 0; i < LEN; i++) {
            state.dots[i].className = 'pin__dot' + (i < state.value.length ? ' is-on' : '');
        }
    }

    function close(result) {
        if (!state) { return; }
        var s = state;
        state = null;
        if (s.root.parentNode) { s.root.parentNode.removeChild(s.root); }
        s.resolve(result);
    }

    App.UI.Pin = {
        isOpen: function () { return !!state; },

        /**
         * @param {string} title
         * @param {string} [hint]
         * @returns {Promise<string|null>} PIN digitado ou null se cancelado
         */
        ask: function (title, hint) {
            if (state) { close(null); }
            return new Promise(function (resolve) {
                var root = U.el('div', 'pin');
                var box = U.el('div', 'pin__box');
                box.appendChild(U.el('div', 'pin__title', title || 'Digite o PIN'));
                var dotsEl = U.el('div', 'pin__dots');
                var dots = [];
                for (var i = 0; i < LEN; i++) {
                    var d = U.el('span', 'pin__dot');
                    dots.push(d);
                    dotsEl.appendChild(d);
                }
                box.appendChild(dotsEl);
                box.appendChild(U.el('div', 'pin__hint',
                    (hint ? hint + '\n' : '') + 'Use os números do controle · Voltar apaga / cancela'));
                root.appendChild(box);
                document.body.appendChild(root);
                state = { root: root, dots: dots, value: '', resolve: resolve };
                render();
            });
        },

        /** @returns {boolean} tecla consumida */
        onKey: function (code) {
            if (!state) { return false; }
            if (code >= KEY.N0 && code <= KEY.N9) {
                if (state.value.length < LEN) {
                    state.value += String(code - KEY.N0);
                    render();
                    if (state.value.length === LEN) {
                        var v = state.value;
                        setTimeout(function () { close(v); }, 120);
                    }
                }
                return true;
            }
            if (code === KEY.BACK || code === KEY.EXIT) {
                if (state.value.length) {
                    state.value = state.value.slice(0, -1);
                    render();
                } else {
                    close(null);
                }
                return true;
            }
            if (code === KEY.ENTER && state.value.length === LEN) {
                close(state.value);
                return true;
            }
            return true;   /* outras teclas são ignoradas enquanto o PIN está aberto */
        },

        close: function () { close(null); }
    };
})(window.App = window.App || {});
