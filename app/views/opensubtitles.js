/* ============================================================
   views/opensubtitles.js
   ALTYAZI SERVISI AYARLARI (OpenSubtitles)

   Kullanicidan API anahtari ve hesap bilgilerini alir.
   Anahtar UYGULAMAYA GOMULU DEGILDIR: servisin kullanim sartlari
   her uygulamanin kendi anahtarini kullanmasini gerektirir ve
   indirme kotasi anahtarin sahibine yazilir.

   Bilgiler yalnizca bu televizyonda saklanir; sifre
   App.Storage.setSecret() ile gizlenir.
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    var log = App.Logger.get('OpenSubsView');

    App.Views = App.Views || {};

    var LANGS = [
        { code: 'tr', label: 'Turco' },
        { code: 'en', label: 'Inglês' },
        { code: 'de', label: 'Alemão' },
        { code: 'fr', label: 'Francês' },
        { code: 'es', label: 'Espanhol' },
        { code: 'ar', label: 'Árabe' },
        { code: 'ru', label: 'Russo' }
    ];

    App.Views.opensubtitles = function () {
        var root, f = {}, langRow = null, langIndex = 0;

        function currentLang() { return LANGS[langIndex].code; }

        function setLangFromCode(code) {
            for (var i = 0; i < LANGS.length; i++) {
                if (LANGS[i].code === code) { langIndex = i; return; }
            }
            langIndex = 0;
        }

        function paintLang() {
            if (langRow) {
                langRow.childNodes[1].textContent = LANGS[langIndex].label;
            }
        }

        function cycleLang() {
            langIndex = (langIndex + 1) % LANGS.length;
            paintLang();
        }

        function save() {
            if (!f.apiKey.getValue()) {
                App.UI.Modal.alert('Chave de API necessária',
                    'Para buscar legendas, a chave de API do OpenSubtitles é obrigatória.\n\n' +
                    'Como obter:\n' +
                    '1. Crie uma conta gratuita em opensubtitles.com\n' +
                    '2. Faça login e acesse Minha conta > API Consumers\n' +
                    '3. Crie uma chave com "New Consumer"\n' +
                    '4. Cole aqui a chave gerada');
                return;
            }

            App.OpenSubtitles.saveConfig({
                apiKey: f.apiKey.getValue(),
                username: f.username.getValue(),
                password: f.password.getValue(),
                language: currentLang()
            });

            /* Hesap girilmediyse de calisir; yalnizca kota daha dusuktur. */
            if (!App.OpenSubtitles.hasAccount()) {
                App.UI.Toast.success(
                    'Salvo. Agora você pode baixar legendas no player com a tecla AMARELA. ' +
                    '(Se informar usuário/senha, sua cota diária aumenta.)', 7000);
                App.Router.back();
                return;
            }

            App.UI.Loading.show('Verificando conta...', { delay: 0 });
            App.OpenSubtitles.login(true).then(function () {
                App.UI.Loading.hide(true);
                App.UI.Toast.success('Conta do OpenSubtitles verificada');
                App.Router.back();
            }, function (err) {
                App.UI.Loading.hide(true);
                var e = App.AppError.wrap(err);
                App.UI.Modal.alert('Não foi possível verificar',
                    e.message + '\n\n' +
                    'Verifique a chave de API, o usuário e a senha.' +
                    (e.detail ? '\n\n(' + e.detail + ')' : ''));
            });
        }

        function clearAll() {
            App.UI.Modal.confirm('Excluir dados?',
                'A chave de API, o usuário e a senha serão excluídos.',
                { danger: true, okText: 'Excluir' }).then(function (yes) {
                    if (!yes) { return; }
                    App.OpenSubtitles.clearConfig();
                    App.UI.Toast.info('Dados do serviço de legendas excluídos');
                    App.Router.back();
                });
        }

        return {
            id: 'opensubtitles',
            title: 'Serviço de legendas',

            mount: function (container) {
                root = container;

                var bar = U.el('div', 'topbar');
                bar.appendChild(U.el('div', 'topbar__title', '💬 Serviço de legendas'));
                bar.appendChild(U.el('div', 'topbar__spacer'));
                root.appendChild(bar);

                /* Iki kolonlu kart (giris ekraniyla ayni duzen): solda
                   aciklama, sagda form. Tek kolonda kart ekrana sigmiyordu. */
                var wrap = U.el('div', 'login');
                var card = U.el('div', 'login__card login__card--split');
                var aside = U.el('div', 'login__aside');
                var main = U.el('div', 'login__main');

                aside.appendChild(U.el('div', 't-h1', 'OpenSubtitles'));
                aside.appendChild(U.el('div', 'login__sub',
                    'Usado para baixar legendas da internet quando a legenda da fonte ' +
                    'estiver corrompida ou ausente. Apenas a CHAVE DE API é suficiente; ' +
                    'ela é informada uma única vez e os dados ficam armazenados nesta TV.'));

                aside.appendChild(U.el('div', 'login__tip',
                    'Como obter a chave (uma única vez, gratuito): crie uma conta em opensubtitles.com ' +
                    '> Minha conta > API Consumers > "New Consumer" > copie a API Key gerada e ' +
                    'cole aqui. Usuário e senha NÃO são obrigatórios; se informá-los, ' +
                    'sua cota diária de downloads aumenta.'));
                card.appendChild(aside);

                f.apiKey = App.UI.Field.create({
                    label: 'Chave de API',
                    placeholder: 'Chave de API do OpenSubtitles',
                    isDefault: true
                });
                f.username = App.UI.Field.create({
                    label: 'Usuário  -  opcional',
                    placeholder: 'Seu usuário do opensubtitles.com',
                    hint: 'Pode deixar em branco. Se informar, sua cota diária de downloads aumenta.'
                });
                f.password = App.UI.Field.create({
                    label: 'Senha  -  opcional',
                    placeholder: 'Sua senha',
                    type: 'password',
                    onSubmit: save
                });

                main.appendChild(f.apiKey.root);
                main.appendChild(f.username.root);
                main.appendChild(f.password.root);

                /* Sifreyi goster/gizle */
                var eyeRow = U.el('div', 'btn btn--ghost btn--block login__toggle');
                var eyeLbl = U.el('span', '', '👁  Mostrar senha');
                eyeRow.appendChild(eyeLbl);
                App.Nav.bind(eyeRow, function () {
                    var secret = !f.password.isSecret();
                    f.password.setSecret(secret);
                    eyeLbl.textContent = secret ? '👁  Mostrar senha' : '🙈  Ocultar senha';
                });
                main.appendChild(eyeRow);

                /* Arama dili (OK ile siradaki dile gecer) */
                langRow = U.el('div', 'srow');
                var langText = U.el('div', 'srow__text');
                langText.appendChild(U.el('div', 'srow__title', 'Idioma da legenda'));
                langText.appendChild(U.el('div', 'srow__desc', 'Pressione OK para alterar'));
                langRow.appendChild(langText);
                langRow.appendChild(U.el('div', 'srow__value', ''));
                App.Nav.bind(langRow, cycleLang);
                main.appendChild(langRow);

                /* Dugmeler */
                var actions = U.el('div', 'login__actions');
                var btnSave = U.el('button', 'btn btn--primary', 'Salvar e verificar');
                App.Nav.bind(btnSave, save);
                var btnClear = U.el('button', 'btn btn--danger', 'Excluir dados');
                App.Nav.bind(btnClear, clearAll);
                actions.appendChild(btnSave);
                actions.appendChild(btnClear);
                main.appendChild(actions);

                card.appendChild(main);
                wrap.appendChild(card);
                root.appendChild(wrap);

                var hints = U.el('div', 'hintbar');
                hints.innerHTML =
                    '<span class="hint"><span class="hint__key">OK</span> Editar texto</span>' +
                    '<span class="hint"><span class="hint__key">RETURN</span> Voltar</span>';
                root.appendChild(hints);

                /* Kayitli degerleri doldur */
                var cfg = App.OpenSubtitles.getConfig();
                f.apiKey.setValue(cfg.apiKey);
                f.username.setValue(cfg.username);
                f.password.setValue(cfg.password);
                setLangFromCode(cfg.language);
                paintLang();

                App.Nav.focus(f.apiKey.box);
            },

            onKey: function () { return false; },

            unmount: function () { f = {}; langRow = null; }
        };
    };
})(window.App = window.App || {});
