/* ============================================================
   views/player.js
   TAM EKRAN OYNATICI

   Bu ekranin arka plani SEFFAFTIR; goruntu AVPlay'in donanim video
   duzleminden gelir (body.player-active sinifi sayfa arka planlarini
   kaldirir).

   OZELLIKLER
     - Hizlanan ileri/geri sarma: ard arda basildikca adim buyur
       (10sn -> 30sn -> 60sn -> 5dk). Tek tek seekTo cagirmak yerine
       hedef birikir ve 450 ms sonra TEK seek yapilir; bu hem cok daha
       hizli hissettirir hem de AVPlay'i yormaz.
     - Sonraki bolum: bolumun son saniyelerinde geri sayimli oneri.
       Ayni sezondaysa otomatik gecer, SEZON DEGISIYORSA sorar.
     - Intro atlama: bolumun basinda "Intro'yu Atla" onerisi.
       (Xtream/M3U intro zaman damgasi vermez; bu yuzden atlama suresi
        Ayarlar'dan belirlenen sabit degerdir - varsayilan 90 sn.)
     - Ses ve altyazi parcasi secimi; SECILI olan menude isaretlenir.

   Kumanda:
     OK             sirasiyla: sonraki bolum -> intro atla -> DURDUR/DEVAM
     INFO           bilgi seridini ac/kapat
     ▲ ▼ / CH+ CH-  kanal degistir (canli yayin)
     ◀ ▶            geri / ileri sar (basili tutunca hizlanir)
     ⏪ ⏩           1 dakika geri / ileri
     PLAY/PAUSE     duraklat / devam
     KIRMIZI        favorilere ekle/cikar
     YESIL          ses parcasi sec
     SARI           altyazi sec
     MAVI           yayini yeniden baslat (donma durumunda)
     0-9            kanal numarasi ile gecis
     RETURN         listeye don
   ============================================================ */
(function (App) {
    'use strict';

    var U = App.Utils;
    var KEY = App.Keys.KEY;
    var log = App.Logger.get('PlayerView');

    App.Views = App.Views || {};

    /* ISO 639-2 dil kodlari -> Turkce adlar (menude okunakli olsun) */
    var LANGS = {
        tur: 'Turco', tr: 'Turco', tuk: 'Turco',
        eng: 'Inglês', en: 'Inglês',
        ger: 'Alemão', deu: 'Alemão', de: 'Alemão',
        fre: 'Francês', fra: 'Francês', fr: 'Francês',
        spa: 'Espanhol', es: 'Espanhol',
        ita: 'Italiano', it: 'Italiano',
        rus: 'Russo', ru: 'Russo',
        ara: 'Árabe', ar: 'Árabe',
        kur: 'Curdo', aze: 'Azerbaijano',
        jpn: 'Japonês', kor: 'Coreano', chi: 'Chinês', zho: 'Chinês',
        por: 'Português', nld: 'Holandês', dut: 'Holandês',
        gre: 'Grego', ell: 'Grego', bul: 'Búlgaro', ron: 'Romeno',
        srp: 'Sérvio', hrv: 'Croata', pol: 'Polonês', ukr: 'Ucraniano',
        fas: 'Persa', per: 'Persa', hin: 'Hindi', urd: 'Urdu'
    };

    function langName(code, fallback) {
        if (!code) { return fallback; }
        var k = String(code).toLowerCase().replace(/[^a-z]/g, '');
        return LANGS[k] || code.toUpperCase();
    }

    App.Views.player = function () {
        var root, osd, stateBox, nextUpEl, introEl, seekEl, subEl, subTextEl;
        var subTimer = null;
        var elLogo, elNum, elName, elNow, elNext, elBadges;
        var elBar, elFill, elCur, elDur;
        var osdTimer = null, clockTimer = null;
        var numBuffer = '', numTimer = null, numEl = null;
        var errorButtons = [];
        var destroyed = false;
        var currentItem = null;
        var returnTo = null;

        /* Sarma zinciri: ard arda basislarda adim buyur, tek seek yap */
        var seek = { n: 0, last: 0, target: 0, timer: null, hideTimer: null };

        /* Sonraki bolum onerisi */
        var nextUp = { open: false, timer: null, left: 0, dismissed: false, needsConfirm: false };

        /* Intro atlama onerisi */
        var intro = { visible: false, dismissed: false };

        /* Toplu sezon indirme durumu */
        var batch = { running: false, cancel: false };

        /* Altyazi bekleme gozcusu:
           Bir altyazi parcasi secildikten sonra AVPlay'den metin gelmiyorsa
           bu, parcanin GORUNTU TABANLI (DVB-SUB / PGS / VobSub) olmasindan
           kaynaklanir - AVPlay bu turleri metin olarak vermez. Kullanici
           "altyaziyi actim ama cikmiyor" diye takilmasin diye aciklariz. */
        var subWatch = { timer: null, gotAny: false };

        /* ================= OSD ================= */

        function buildOsd() {
            osd = U.el('div', 'osd');

            var top = U.el('div', 'osd__top');
            elLogo = U.el('div', 'osd__logo');
            var head = U.el('div', 'osd__head');
            elNum = U.el('div', 'osd__num', '');
            elName = U.el('div', 'osd__name', '');
            elNow = U.el('div', 'osd__now', '');
            elNext = U.el('div', 'osd__next', '');
            head.appendChild(elNum);
            head.appendChild(elName);
            head.appendChild(elNow);
            head.appendChild(elNext);
            elBadges = U.el('div', 'osd__badges');
            top.appendChild(elLogo);
            top.appendChild(head);
            top.appendChild(elBadges);
            osd.appendChild(top);

            var bottom = U.el('div', 'osd__bottom');
            elBar = U.el('div', 'pbar');
            elFill = U.el('div', 'pbar__fill');
            elBar.appendChild(elFill);
            bottom.appendChild(elBar);

            var times = U.el('div', 'osd__times');
            elCur = U.el('span', '', '0:00');
            elDur = U.el('span', '', '0:00');
            times.appendChild(elCur);
            times.appendChild(elDur);
            bottom.appendChild(times);

            var hints = U.el('div', 'osd__hints');
            hints.innerHTML =
                '<span class="hint"><span class="hint__key">OK</span> Pausar / Continuar</span>' +
                '<span class="hint"><span class="hint__key">◀ ▶</span> Avançar/Voltar</span>' +
                '<span class="hint"><span class="hint__key">VERMELHO</span> Favorito</span>' +
                '<span class="hint"><span class="hint__key">VERDE</span> Áudio</span>' +
                '<span class="hint"><span class="hint__key">AMARELO</span> Qualidade / Legenda</span>' +
                '<span class="hint"><span class="hint__key">AZUL</span> Reiniciar</span>';
            bottom.appendChild(hints);

            osd.appendChild(bottom);
            return osd;
        }

        function showOsd(sticky) {
            if (!osd) { return; }
            if (!osd.classList.contains('is-visible')) {
                osd.classList.add('is-visible');
                paintProgress();
            }
            if (osdTimer) { clearTimeout(osdTimer); osdTimer = null; }
            if (!sticky) {
                var sec = U.toInt(App.Settings.get('osdTimeout'), 6);
                osdTimer = setTimeout(hideOsd, Math.max(2, sec) * 1000);
            }
        }

        function hideOsd() {
            if (osd) { osd.classList.remove('is-visible'); }
            if (osdTimer) { clearTimeout(osdTimer); osdTimer = null; }
        }

        function osdVisible() { return !!(osd && osd.classList.contains('is-visible')); }

        function toggleOsd() {
            if (osdVisible()) { hideOsd(); } else { showOsd(); }
        }

        /* ================= Bilgi ================= */

        function fillItemInfo(item) {
            currentItem = item;
            if (!item) { return; }

            App.UI.ImageLoader.into(elLogo, item.logo, U.initials(item.name));

            var isLive = item.type === 'live';
            elNum.textContent = isLive && item.num ? ('CANAL ' + item.num) : typeLabel(item);
            elName.textContent = displayName(item);
            elNow.textContent = '';
            elNext.textContent = '';

            U.empty(elBadges);
            if (isLive) { elBadges.appendChild(U.el('span', 'badge badge--live', 'AO VIVO')); }
            if (isLive && item.quality) {
                elBadges.appendChild(U.el('span', 'badge badge--ok', item.quality +
                    (item.variants && item.variants.length > 1 ? '  ·  AMARELO troca' : '')));
            }
            /* Dosya turu (MKV, MP4, AVI...): sarma sorunlarinin cogu
               dosya turune baglidir, ariza bildirirken isimize yarar */
            if (!isLive && item.containerExtension) {
                elBadges.appendChild(U.el('span', 'badge', String(item.containerExtension).toUpperCase()));
            }
            if (App.Favorites.has(item)) { elBadges.appendChild(U.el('span', 'badge', '★')); }

            lastProg = null;
            elFill.style.width = '0%';
            if (isLive) {
                elCur.textContent = '';
                elDur.textContent = '';
                loadEpg(item);
            } else {
                elCur.textContent = '0:00';
                elDur.textContent = '--:--';
            }
        }

        /** Bolumlerde dizi adini da goster */
        function displayName(item) {
            if (item.type === 'episode' && item.seriesName) {
                return item.seriesName + '  —  ' + item.name;
            }
            return item.name;
        }

        function typeLabel(item) {
            if (item.type === 'movie') { return 'FILME'; }
            if (item.type === 'episode') {
                var s = item.season ? ('TEMPORADA ' + item.season) : '';
                var e = item.episodeNum ? ('EPISÓDIO ' + item.episodeNum) : '';
                return (s + (s && e ? '  •  ' : '') + e) || 'EPISÓDIO';
            }
            return '';
        }

        function loadEpg(item) {
            App.EPG.forChannel(item).then(function (nn) {
                if (destroyed || !currentItem || currentItem.key !== item.key) { return; }
                if (nn && nn.now) {
                    elNow.textContent = 'Agora: ' + nn.now.title + '   ' + App.EPG.timeRange(nn.now);
                    var pct = App.EPG.progressOf(nn.now);
                    elFill.style.width = Math.round(pct * 100) + '%';
                    elCur.textContent = U.hhmm(nn.now.start);
                    elDur.textContent = nn.now.stop ? U.hhmm(nn.now.stop) : '';
                } else {
                    elNow.textContent = 'Informações do programa não encontradas';
                    elFill.style.width = '0%';
                }
                elNext.textContent = (nn && nn.next) ? ('A seguir: ' + nn.next.title) : '';
            });
        }

        /* Son bilinen ilerleme. Bilgi seridi KAPALIYKEN DOM guncellenmez
           (oynatici her ~0.5 sn konum bildirir; gorunmeyen seride yazmak
           TV'de bosuna stil/yerlesim hesabi demektir). Serit acilinca
           bu degerle bir kez cizilir. */
        var lastProg = null;

        function updateProgress(position, duration) {
            if (!currentItem || currentItem.type === 'live') { return; }
            lastProg = { p: position, d: duration || 0 };
            if (osdVisible()) { paintProgress(); }
        }

        function paintProgress() {
            if (!lastProg || !currentItem || currentItem.type === 'live') { return; }
            var d = lastProg.d;
            var cur = U.duration(lastProg.p / 1000);
            var dur = d ? U.duration(d / 1000) : '--:--';
            if (elCur.textContent !== cur) { elCur.textContent = cur; }
            if (elDur.textContent !== dur) { elDur.textContent = dur; }
            elFill.style.width = d ? (Math.min(100, lastProg.p * 100 / d) + '%') : '0%';
        }

        /* ================= Hizlanan sarma ================= */

        function seekStepFor(n) {
            var base = Math.max(5, U.toInt(App.Settings.get('seekStep'), 10));
            if (n > 9) { return base * 30; }   /* 5 dk  */
            if (n > 6) { return base * 12; }   /* 2 dk  */
            if (n > 3) { return base * 6; }    /* 1 dk  */
            if (n > 1) { return base * 3; }    /* 30 sn */
            return base;                       /* 10 sn */
        }

        /**
         * @param {number} dir +1 ileri, -1 geri
         * @param {number} [fixedSec] verilirse adim buyumez (⏪ ⏩ tuslari: 1 dk)
         */
        function doSeek(dir, fixedSec) {
            if (App.Player.isLive()) { showOsd(); return; }
            if (!App.Player.canSeek()) {
                noSeekToast();
                showOsd();
                return;
            }

            var dur = App.Player.getDuration();
            if (!dur) { return; }

            var now = Date.now();
            /* 1.2 sn'den uzun aradan sonra zincir sifirlanir.
               Baslangic noktasi oynaticinin konumudur; bir sarma hala
               suruyorsa controller burada o sarmanin HEDEFINI dondurur
               (eski konumdan hesaplayip geri ziplamayiz). */
            if (now - seek.last > 1200) {
                seek.n = 0;
                seek.target = App.Player.getLivePosition();
            }
            seek.last = now;
            seek.n++;

            var stepSec = fixedSec || seekStepFor(seek.n);
            seek.target = U.clamp(seek.target + dir * stepSec * 1000, 0, Math.max(0, dur - 3000));

            showSeekPreview(dir, stepSec);
            showOsd(true);
            updateProgress(seek.target, dur);

            /* Tek tek seekTo cagirmak yerine 450 ms bekleyip TEK atlama yap */
            if (seek.timer) { clearTimeout(seek.timer); }
            seek.timer = setTimeout(function () {
                seek.timer = null;
                App.Player.seekTo(seek.target);
                showOsd();
            }, 450);
        }

        /* Sarma kapaliyken her tus basisinda ayni bildirim ust uste binmesin */
        var noSeekToastAt = 0;
        function noSeekToast() {
            var now = Date.now();
            if (now - noSeekToastAt < 3000) { return; }
            noSeekToastAt = now;
            App.UI.Toast.info(App.Player.noSeekText());
        }

        function showSeekPreview(dir, stepSec) {
            if (!seekEl) {
                seekEl = U.el('div', 'seekpv');
                root.appendChild(seekEl);
            }
            var label = stepSec >= 60
                ? (Math.round(stepSec / 60) + ' dk')
                : (stepSec + ' sn');
            seekEl.textContent = (dir > 0 ? '⏩  +' : '⏪  −') + label +
                                 '   ' + U.duration(seek.target / 1000);
            seekEl.classList.add('is-visible');

            if (seek.hideTimer) { clearTimeout(seek.hideTimer); }
            seek.hideTimer = setTimeout(function () {
                if (seekEl) { seekEl.classList.remove('is-visible'); }
            }, 1100);
        }

        /* ================= Sonraki bolum ================= */

        function nextIsNewSeason() {
            var nx = App.Player.nextItem();
            if (!nx || !currentItem) { return false; }
            return nx.type === 'episode' && currentItem.type === 'episode' &&
                   U.toInt(nx.season, 0) !== U.toInt(currentItem.season, 0);
        }

        function buildNextUp() {
            nextUpEl = U.el('div', 'nextup');
            root.appendChild(nextUpEl);
            return nextUpEl;
        }

        /**
         * @param {number} secondsLeft geri sayim; 0 ise "elle onay" modu
         */
        function showNextUp(secondsLeft) {
            var nx = App.Player.nextItem();
            if (!nx) { return; }

            nextUp.open = true;
            nextUp.left = secondsLeft;
            /* Sezon degisiyorsa VEYA otomatik gecis kapaliysa kullanici
               onaylamadan gecilmez. */
            nextUp.needsConfirm = nextIsNewSeason() ||
                                  !App.Settings.get('autoNextEpisode') ||
                                  secondsLeft <= 0;

            U.empty(nextUpEl);

            var title = nextIsNewSeason()
                ? ('Temporada ' + U.toInt(currentItem.season, 0) + ' concluída')
                : 'Próximo episódio';
            nextUpEl.appendChild(U.el('div', 'nextup__label', title));

            var name = nx.type === 'episode'
                ? ('S' + U.pad2(nx.season) + 'E' + U.pad2(nx.episodeNum) + '  ' + nx.name)
                : nx.name;
            nextUpEl.appendChild(U.el('div', 'nextup__name', name));

            var line;
            if (nextIsNewSeason()) {
                line = 'Iniciar a temporada ' + U.toInt(nx.season, 0) + '?   OK: Sim   RETURN: Não';
            } else if (nextUp.needsConfirm) {
                line = 'OK: Iniciar próximo episódio   •   RETURN: Fechar';
            } else {
                line = secondsLeft + ' segundos para iniciar   •   OK: Iniciar agora   RETURN: Cancelar';
            }
            var cd = U.el('div', 'nextup__cd', line);
            cd.setAttribute('data-cd', '1');
            nextUpEl.appendChild(cd);

            nextUpEl.classList.add('is-visible');
        }

        function updateNextUpCountdown(secondsLeft) {
            if (!nextUp.open || nextUp.needsConfirm) { return; }
            nextUp.left = secondsLeft;
            var cd = nextUpEl.querySelector('[data-cd]');
            if (cd) {
                cd.textContent = secondsLeft +
                    ' segundos para iniciar   •   OK: Iniciar agora   RETURN: Cancelar';
            }
        }

        function hideNextUp() {
            nextUp.open = false;
            if (nextUpEl) {
                nextUpEl.classList.remove('is-visible');
                U.empty(nextUpEl);
            }
        }

        function playNext() {
            hideNextUp();
            hideIntro();
            nextUp.dismissed = false;
            intro.dismissed = false;
            showBuffering('Abrindo próximo episódio...');
            App.Player.playNext();
        }

        /* ================= Altyazi cizimi =================
           AVPlay altyaziyi EKRANA CIZMEZ; yalnizca metni ve gosterim
           suresini onsubtitlechange olayiyla bildirir. Cizim isi burada.  */

        function buildSubtitle() {
            subEl = U.el('div', 'subtitle');
            subTextEl = U.el('span', 'subtitle__text');
            subEl.appendChild(subTextEl);
            root.appendChild(subEl);
            return subEl;
        }

        /**
         * @param {string} text
         * @param {number} durationMs 0 ise otomatik gizleme YAPILMAZ
         *                 (harici altyazida satiri biz yonetiriz)
         * @param {boolean} [persist] true ise zamanlayici kurulmaz
         */
        function showSubtitle(text, durationMs, persist) {
            if (subTimer) { clearTimeout(subTimer); subTimer = null; }

            var clean = String(text || '')
                .replace(/<[^>]+>/g, '')        /* bazi kaynaklar HTML etiketi gonderir */
                .replace(/\\N/g, '\n')           /* ASS/SSA satir sonu */
                .trim();

            if (!clean) { hideSubtitle(); return; }

            /* Ayni metni tekrar yazma: her saniyede DOM guncellemesi olmasin */
            if (subTextEl.textContent !== clean) {
                subTextEl.textContent = clean;
            }
            subEl.classList.add('is-visible');

            if (persist) { return; }

            /* Sure verilmisse o kadar goster; verilmemisse bir sonraki
               olay gelene kadar ekranda kalsin (en fazla 8 sn). */
            var ms = durationMs > 0 ? durationMs : 8000;
            subTimer = setTimeout(hideSubtitle, ms);
        }

        /** Indirilen (harici) altyazi: konuma gore satiri sec ve yaz */
        function renderExternalSubtitle(positionMs) {
            var txt = App.Subtitles.textAt(positionMs);
            if (txt) { showSubtitle(txt, 0, true); }
            else if (subEl && subEl.classList.contains('is-visible')) { hideSubtitle(); }
        }

        function hideSubtitle() {
            if (subTimer) { clearTimeout(subTimer); subTimer = null; }
            if (subEl) {
                subEl.classList.remove('is-visible');
                subTextEl.textContent = '';
            }
        }

        function onSubtitleEvt(d) {
            if (destroyed) { return; }
            subWatch.gotAny = true;
            if (subWatch.timer) { clearTimeout(subWatch.timer); subWatch.timer = null; }
            showSubtitle(d.text, d.duration);
        }

        /** Altyazi acildiktan sonra metin gelmezse aciklayici uyari goster */
        function watchSubtitleArrival() {
            if (subWatch.timer) { clearTimeout(subWatch.timer); }
            subWatch.gotAny = false;
            subWatch.timer = setTimeout(function () {
                subWatch.timer = null;
                if (destroyed || subWatch.gotAny) { return; }
                App.UI.Toast.warn(
                    'Esta legenda pode ser baseada em imagem (DVB/PGS). A TV não fornece este tipo ' +
                    'como texto, por isso ela não pode ser exibida. Se possível, tente outro idioma.',
                    7000);
            }, 12000);
        }

        /* ================= Intro atlama ================= */

        function buildIntro() {
            introEl = U.el('div', 'introskip');
            introEl.appendChild(U.el('span', '', '⏭'));
            introEl.appendChild(U.el('span', '', ' Pular abertura  '));
            introEl.appendChild(U.el('span', 'introskip__key', 'OK'));
            root.appendChild(introEl);
            return introEl;
        }

        function showIntro() {
            if (intro.visible) { return; }
            intro.visible = true;
            introEl.classList.add('is-visible');
        }

        function hideIntro() {
            intro.visible = false;
            if (introEl) { introEl.classList.remove('is-visible'); }
        }

        function skipIntro() {
            var sec = Math.max(10, U.toInt(App.Settings.get('introSkipSeconds'), 90));
            hideIntro();
            intro.dismissed = true;
            if (!App.Player.canSeek()) {
                noSeekToast();
                return;
            }
            App.Player.seekTo(sec * 1000);
            App.UI.Toast.info('Abertura pulada (' + sec + ' s)');
            showOsd();
        }

        /**
         * Intro onerisi yalnizca:
         *   - dizi bolumu ise
         *   - suresi 10 dakikadan uzunsa
         *   - konum 5. saniye ile atlama noktasinin 15 sn oncesi arasindaysa
         * gosterilir.
         */
        function updateIntroPrompt(posSec, durSec) {
            if (!App.Settings.get('showIntroSkip') || intro.dismissed) { return; }
            if (!currentItem || currentItem.type !== 'episode') { return; }
            if (durSec < 600) { return; }

            var target = Math.max(10, U.toInt(App.Settings.get('introSkipSeconds'), 90));
            if (posSec > 5 && posSec < target - 15) { showIntro(); }
            else { hideIntro(); }
        }

        /* ================= Durum kutusu ================= */

        function clearState() {
            U.empty(stateBox);
            stateBox.classList.add('hidden');
            errorButtons = [];
        }

        /**
         * @param {string} text
         * @param {boolean} [compact] sarma sonrasi kisa bekleme: kucuk
         *        gosterge, icerik adi yok (her sarmada ekranin ortasina
         *        buyuk kutu cikmasi "dondu" hissi veriyordu)
         */
        function showBuffering(text, compact) {
            U.empty(stateBox);
            stateBox.classList.remove('hidden');
            errorButtons = [];
            bufCompact = !!compact;
            var box = U.el('div', compact ? 'pstate__wait' : 'pstate__load');
            box.appendChild(U.el('div', compact ? 'spinner spinner--sm' : 'spinner'));
            box.appendChild(U.el('div', 'loading__msg', text || 'Abrindo transmissão...'));
            if (currentItem && !compact) {
                box.appendChild(U.el('div', 'loading__sub', displayName(currentItem)));
            }
            stateBox.appendChild(box);
        }
        var bufCompact = false;

        function showError(info) {
            U.empty(stateBox);
            stateBox.classList.remove('hidden');
            errorButtons = [];

            var box = U.el('div', 'pstate__box');
            box.appendChild(U.el('div', 'pstate__title', 'Não foi possível abrir a transmissão'));

            var msg = info.message || 'Erro desconhecido.';
            if (currentItem) { msg = displayName(currentItem) + '\n\n' + msg; }
            if (info.detail) { msg += '\n\n(' + info.detail + ')'; }
            box.appendChild(U.el('div', 'pstate__msg', msg));

            var btns = U.el('div', 'pstate__btns');

            var retry = U.el('button', 'btn btn--primary', 'Tentar novamente');
            App.Nav.bind(retry, function () {
                showBuffering('Tentando novamente...');
                App.Player.retry();
            }, { isDefault: true });
            btns.appendChild(retry);
            errorButtons.push(retry);

            if (App.Player.getContext().items.length > 1) {
                var next = U.el('button', 'btn', App.Player.isLive() ? 'Próximo canal' : 'Próximo episódio');
                App.Nav.bind(next, function () {
                    showBuffering('Abrindo...');
                    App.Player.zap(1);
                });
                btns.appendChild(next);
                errorButtons.push(next);
            }

            var back = U.el('button', 'btn', 'Voltar à lista');
            App.Nav.bind(back, function () { App.Router.back(); });
            btns.appendChild(back);
            errorButtons.push(back);

            box.appendChild(btns);
            stateBox.appendChild(box);

            App.Nav.focus(retry);
        }

        /* ================= Olay dinleyicileri ================= */

        function onState(d) {
            if (destroyed) { return; }
            switch (d.state) {
                case App.Player.STATE.LOADING:
                    showBuffering('Abrindo transmissão...');
                    showOsd(true);
                    break;
                case App.Player.STATE.BUFFERING:
                    if (App.Player.isSeeking()) { showBuffering('Carregando...', true); }
                    else { showBuffering('Carregando buffer...'); }
                    break;
                case App.Player.STATE.PLAYING:
                    clearState();
                    showOsd();
                    break;
                case App.Player.STATE.PAUSED:
                    U.empty(stateBox);
                    stateBox.classList.remove('hidden');
                    var p = U.el('div', 'pstate__box');
                    p.appendChild(U.el('div', 'pstate__title', '⏸  Pausado'));
                    stateBox.appendChild(p);
                    showOsd(true);
                    break;
                case App.Player.STATE.IDLE:
                    clearState();
                    break;
            }
        }

        function onTime(d) {
            if (destroyed) { return; }
            /* Sarma sirasinda ilerleme cubugunu hedefe gore gosteriyoruz */
            if (!seek.timer) { updateProgress(d.position, d.duration); }

            if (!d.duration || App.Player.isLive()) { return; }
            /* Hata kutusu acikken oneri kartlari (sonraki bolum / intro) cikmasin */
            if (errorButtons.length) { return; }

            /* Indirilen altyazi etkinse satirlari konuma gore biz yonetiriz */
            if (App.Subtitles.isActive()) { renderExternalSubtitle(d.position); }

            var posSec = d.position / 1000;
            var durSec = d.duration / 1000;
            var remain = Math.ceil(durSec - posSec);

            updateIntroPrompt(posSec, durSec);

            /* Sonraki bolum onerisi */
            var cd = Math.max(3, U.toInt(App.Settings.get('nextEpisodeCountdown'), 10));
            if (App.Player.hasNext() && !nextUp.dismissed && remain > 0 && remain <= cd) {
                if (!nextUp.open) { showNextUp(remain); }
                else { updateNextUpCountdown(remain); }
            } else if (nextUp.open && remain > cd) {
                hideNextUp();
            }
        }

        function onItem(d) {
            if (destroyed) { return; }
            /* Ayni icerik kurtarma icin yeniden acildiysa indirilen altyazi
               ve kapatilan oneriler korunur */
            var again = !!(d.retry && currentItem && d.item && currentItem.key === d.item.key);
            /* Yeni icerik -> onerileri sifirla */
            hideNextUp();
            hideIntro();
            hideSubtitle();
            if (!again) {
                /* Indirilen altyazi onceki bolume aitti - yenisinde gecerli degil */
                App.Subtitles.clear();
                nextUp.dismissed = false;
                intro.dismissed = false;
            }
            seek.n = 0;

            fillItemInfo(d.item);
            showOsd();
            if (!again) { autoLoadCachedSubtitle(d.item); }
        }

        /**
         * Bu bolum/film icin daha once altyazi indirilmisse CIHAZDAN yukle.
         * Internete cikilmaz, indirme hakki harcanmaz.
         */
        function autoLoadCachedSubtitle(item) {
            if (!App.Settings.get('autoLoadCachedSubtitle')) { return; }
            if (!item || item.type === 'live') { return; }

            App.SubtitleCache.get(item).then(function (rec) {
                if (destroyed || !rec || !rec.text) { return; }
                var cur = App.Player.getItem();
                if (!cur || cur.key !== item.key) { return; }   /* icerik degismis */

                try {
                    var n = App.Subtitles.load(rec.text, { name: rec.name, language: rec.language });
                    App.Player.setSubtitleHidden(true);   /* gomulu kapali; biz ciziyoruz */
                    App.UI.Toast.info('Legenda salva carregada (' + n + ' linhas)', 4000);
                } catch (e) {
                    App.SubtitleCache.remove(item);       /* bozuksa at */
                }
            });
        }

        function onComplete(d) {
            if (destroyed) { return; }

            if (!d.hasNext) {
                hideNextUp();
                App.UI.Toast.info('Reprodução concluída');
                setTimeout(function () { if (!destroyed) { App.Router.back(); } }, 1500);
                return;
            }

            /* Sezon degisiyorsa kullaniciya sor, ayni sezonda otomatik gec */
            if (!App.Settings.get('autoNextEpisode') || nextUp.dismissed || nextIsNewSeason()) {
                if (!nextUp.open) { showNextUp(0); }
                return;
            }
            playNext();
        }

        function onError(d) {
            if (destroyed) { return; }
            log.error('oynatma hatasi', d.code, d.detail);
            hideNextUp();
            hideIntro();
            showError(d);
        }

        function onRecovering(d) {
            if (destroyed) { return; }
            showBuffering(d.reason === 'format' ? 'Tentando formato alternativo de transmissão...'
                        : d.reason === 'quality' ? ('Trocando para ' + (d.label || 'outra qualidade') + '...')
                        : d.reason === 'seek' ? 'Reabrindo transmissão...'
                        : 'Restabelecendo conexão...');
        }

        /* Oynaticinin kullaniciya soylemesi gerekenler (sarma sorunu vb.).
           Kurtarma adim adim ilerlerken bildirimler ust uste yigilmasin:
           yalnizca son durum gorunur. */
        var noticeEl = null;
        function onNotice(d) {
            if (destroyed || !d || !d.text) { return; }
            App.UI.Toast.remove(noticeEl);
            noticeEl = App.UI.Toast.info(d.text, 6000);
        }

        function onBuffering(d) {
            if (destroyed) { return; }
            var msgEl = stateBox.querySelector('.loading__msg');
            if (msgEl && !bufCompact && d.percent !== undefined && d.percent < 100) {
                msgEl.textContent = 'Carregando buffer... %' + d.percent;
            }
        }

        /* ================= Eylemler ================= */

        function togglePause() {
            var before = App.Player.getState();
            var after = App.Player.togglePause();
            var S = App.Player.STATE;
            if (before === after && App.Player.isLive() &&
                (before === S.PLAYING || before === S.BUFFERING)) {
                App.UI.Toast.info('Não é possível pausar a transmissão ao vivo');
            }
            showOsd();
        }

        function zap(delta) {
            if (!App.Player.getContext().items.length) { return; }
            showBuffering(App.Player.isLive() ? 'Trocando de canal...' : 'Abrindo...');
            showOsd();
            App.Player.zap(delta);
        }

        function toggleFav() {
            var item = App.Player.getItem();
            if (!item) { return; }
            var on = App.Favorites.toggle(item);
            App.UI.Toast.info(on ? '★ Adicionado aos favoritos' : 'Removido dos favoritos');
            fillItemInfo(item);
            showOsd();
        }

        /* Canal agrupado: escolher a variante de qualidade (UHD/FHD/HD/SD) */
        function chooseQuality() {
            var vars = App.Player.getVariants();
            var item = App.Player.getItem();
            if (!vars.length || !item) { return; }
            var opts = [], def = 0;
            for (var i = 0; i < vars.length; i++) {
                var isCur = String(vars[i].id) === String(item.id);
                if (isCur) { def = i; }
                opts.push({ icon: isCur ? '✔' : '📺', label: vars[i].label, hint: isCur ? 'TOCANDO' : '', value: vars[i].id });
            }
            App.UI.Modal.choose('Qualidade', opts, {
                message: 'Variantes deste canal no servidor. Se uma falhar, o app troca sozinho.',
                defaultIndex: def
            }).then(function (id) {
                if (id === undefined || String(id) === String(item.id)) { return; }
                App.UI.Toast.info('Trocando qualidade...');
                showBuffering('Trocando qualidade...');
                App.Player.setVariant(id);
            });
        }

        function chooseAudioTrack() {
            var tracks = App.Player.getTracks('AUDIO');
            if (!tracks.length) {
                App.UI.Toast.warn('Nenhuma faixa de áudio selecionável nesta transmissão');
                return;
            }

            var cur = App.Player.getSelectedTrack('AUDIO');
            /* Hicbir secim yapilmadiysa ilk parca calisiyordur */
            if (cur === null || cur === undefined) { cur = tracks[0].index; }

            var opts = [], defaultIndex = 0;
            for (var i = 0; i < tracks.length; i++) {
                var t = tracks[i];
                var isCur = (t.index === cur);
                if (isCur) { defaultIndex = i; }
                opts.push({
                    icon: isCur ? '✔' : '🔈',
                    label: langName(t.language, 'Áudio ' + (i + 1)) +
                           (t.label ? ('   (' + t.label + ')') : ''),
                    hint: isCur ? 'TOCANDO' : '',
                    current: isCur,
                    value: t.index
                });
            }

            App.UI.Modal.choose('Faixa de áudio', opts, {
                message: 'A faixa em reprodução está marcada com ✔.',
                defaultIndex: defaultIndex
            }).then(function (idx) {
                if (idx === undefined) { return; }
                if (App.Player.selectTrack('AUDIO', idx)) {
                    /* Secilen DILI hatirla: sonraki bolum/filmde otomatik uygulanir.
                       (Indeks degil dil kaydedilir; indeks her dosyada degisir.) */
                    var picked = null;
                    for (var k = 0; k < tracks.length; k++) {
                        if (tracks[k].index === idx) { picked = tracks[k]; }
                    }
                    App.Player.rememberTrackLang('AUDIO', picked && picked.language);
                    App.UI.Toast.success('Áudio: ' +
                        langName(picked && picked.language, 'alterado') +
                        '  (também será usado nos próximos episódios)');
                } else {
                    App.UI.Toast.error('Não foi possível alterar a faixa de áudio');
                }
            });
        }

        function chooseSubtitle() {
            var tracks = App.Player.getTracks('TEXT');
            var external = App.Subtitles.isActive();

            /* Gomulu altyazi olmasa bile menu ACILIR: internetten indirme
               secenegi tam da bu durum icin vardir. */
            var hidden = App.Player.isSubtitleHidden();
            var cur = App.Player.getSelectedTrack('TEXT');

            var offNow = hidden && !external;
            var opts = [{
                icon: offNow ? '✔' : '🚫',
                label: 'Legenda desativada',
                hint: offNow ? 'ATIVA' : '',
                current: offNow,
                value: -1
            }];
            var defaultIndex = 0;

            /* Indirilen altyazi varsa listenin basinda gosterilir */
            if (external) {
                var xi = App.Subtitles.info();
                opts.push({
                    icon: '✔',
                    label: 'Legenda baixada' + (xi && xi.name ? ('  —  ' + U.truncate(xi.name, 40)) : ''),
                    hint: 'ATIVA',
                    current: true,
                    value: 'external'
                });
                defaultIndex = 1;
                opts.push({
                    icon: '⏱',
                    label: 'Ajustar atraso' +
                           (xi && xi.offset ? ('   (' + (xi.offset > 0 ? '+' : '') +
                                               (xi.offset / 1000).toFixed(1) + ' s)') : ''),
                    value: 'offset'
                });
            }

            for (var i = 0; i < tracks.length; i++) {
                var t = tracks[i];
                var isCur = (!hidden && !external && t.index === cur);
                if (isCur) { defaultIndex = opts.length; }
                opts.push({
                    icon: isCur ? '✔' : '💬',
                    label: langName(t.language, 'Legenda ' + (i + 1)),
                    hint: isCur ? 'ATIVA' : '',
                    current: isCur,
                    value: t.index
                });
            }

            /* Internetten indirme - canli yayin disinda anlamli */
            var playing = App.Player.getItem();
            if (playing && playing.type !== 'live') {
                opts.push({
                    icon: '🌐',
                    label: 'Baixar legenda da internet',
                    hint: App.OpenSubtitles.isConfigured() ? '' : 'CONFIGURAÇÃO NECESSÁRIA',
                    value: 'download'
                });
            }
            /* Dizi izleniyorsa sezonun tamamini bir kerede indir */
            if (playing && playing.type === 'episode' && seasonEpisodes().length > 1) {
                opts.push({
                    icon: '📥',
                    label: 'Baixar todas as legendas desta temporada',
                    hint: seasonEpisodes().length + ' episódios',
                    value: 'season'
                });
            }

            var msg = tracks.length
                ? 'A legenda ativa está marcada com ✔.'
                : 'Nenhuma legenda embutida nesta transmissão.\nVocê pode tentar baixar da internet.';

            App.UI.Modal.choose('Legenda', opts, {
                message: msg,
                defaultIndex: defaultIndex
            }).then(function (idx) {
                if (idx === undefined) { return; }

                if (idx === 'download') { downloadSubtitleFlow(); return; }
                if (idx === 'season') { downloadSeasonFlow(); return; }
                if (idx === 'offset') { chooseOffset(); return; }
                if (idx === 'external') { return; }   /* zaten etkin */

                if (idx === -1) {
                    App.Player.setSubtitleHidden(true);
                    App.Player.rememberTrackLang('TEXT', 'off');
                    App.Subtitles.clear();
                    hideSubtitle();
                    if (subWatch.timer) { clearTimeout(subWatch.timer); subWatch.timer = null; }
                    App.UI.Toast.info('Legenda desativada');
                    return;
                }

                /* Gomulu parca secildi -> indirilen altyaziyi birak */
                App.Subtitles.clear();

                var picked = null;
                for (var k = 0; k < tracks.length; k++) {
                    if (tracks[k].index === idx) { picked = tracks[k]; }
                }

                App.Player.setSubtitleHidden(false);
                App.Player.selectTrack('TEXT', idx);
                /* Bazi firmware'ler parca secimi sonrasi sessiz bayragini geri
                   aciyor; guvenlik icin tekrar kapatiyoruz. */
                App.Player.setSubtitleHidden(false);
                App.Player.rememberTrackLang('TEXT', picked && picked.language);
                hideSubtitle();
                watchSubtitleArrival();
                App.UI.Toast.success('Legenda: ' +
                    langName(picked && picked.language, 'ativada') +
                    '  (também será usado nos próximos episódios)');
            });
        }

        /* ================= Internetten altyazi ================= */

        /** Baglamdaki bolumlerden dizi adini bul (kayitta eksikse) */
        function seriesTitleFromContext() {
            var ctx = App.Player.getContext();
            for (var i = 0; i < ctx.items.length; i++) {
                if (ctx.items[i] && ctx.items[i].seriesName) { return ctx.items[i].seriesName; }
            }
            return '';
        }

        function downloadSubtitleFlow() {
            var item = App.Player.getItem();

            if (!App.OpenSubtitles.isConfigured()) {
                App.UI.Modal.alert('Serviço de legendas não configurado',
                    'Este recurso é GRATUITO; basta informar UMA ÚNICA VEZ uma chave de API.\n' +
                    'O serviço (OpenSubtitles) não aceita pedidos sem chave e, como a\n' +
                    'cota é debitada do dono da chave, a chave\n' +
                    'não pode ser embutida no aplicativo.\n\n' +
                    'Como obter (~3 minutos):\n' +
                    '1. Crie uma conta gratuita em opensubtitles.com\n' +
                    '2. Minha conta > API Consumers > New Consumer\n' +
                    '3. Cole a API Key gerada em Configurações > Serviço de legendas\n\n' +
                    'Usuário e senha NÃO são obrigatórios (se informados, a cota aumenta).');
                return;
            }

            /* Ogede dizi adi yoksa oynatma baglamindaki (ayni dizinin
               diger bolumleri) kayitlardan tamamla. */
            var q = App.OpenSubtitles.queryFor(item, seriesTitleFromContext());

            if (!q) {
                App.UI.Toast.warn('Não é possível buscar legendas para este conteúdo');
                return;
            }
            if (!q.query) {
                App.UI.Modal.alert('Nome da série não encontrado',
                    'Este registro de episódio contém apenas o rótulo do episódio ' +
                    '("' + U.truncate(item.name, 40) + '"), sem o nome da série.\n\n' +
                    'Se você abrir o episódio pela seção Séries, o nome da série é levado junto e\n' +
                    'a busca de legendas funciona.');
                return;
            }

            var label = q.query + (q.season ? ('  S' + U.pad2(q.season) + 'E' + U.pad2(q.episode)) : '');

            /* ONBELLEK: daha once indirildiyse internete hic cikma */
            App.SubtitleCache.get(item).then(function (cached) {
                if (cached && cached.text) {
                    App.UI.Modal.choose('A legenda deste episódio está salva no dispositivo', [
                        { icon: '💾', label: 'Usar legenda salva',
                          hint: 'NÃO USA COTA', value: 'cache' },
                        { icon: '🌐', label: 'Baixar novamente (se corrompida)',
                          hint: '1 download', value: 'fresh' }
                    ], { message: cached.name ? U.truncate(cached.name, 60) : label })
                        .then(function (c) {
                            if (c === 'cache') { loadFromCache(item, cached); }
                            else if (c === 'fresh') { runSearch(q, label, item); }
                        });
                    return;
                }
                runSearch(q, label, item);
            });
        }

        function loadFromCache(item, rec) {
            try {
                var n = App.Subtitles.load(rec.text, { name: rec.name, language: rec.language });
                App.Player.setSubtitleHidden(true);
                hideSubtitle();
                renderExternalSubtitle(App.Player.getPosition());
                App.UI.Toast.success('Legenda salva carregada (' + n + ' linhas)');
            } catch (e) {
                App.SubtitleCache.remove(item);
                App.UI.Toast.error('Legenda salva corrompida e excluída. Baixe novamente.');
            }
        }

        function runSearch(q, label, item) {
            App.UI.Loading.show('Buscando legenda: ' + label, { delay: 0 });

            App.OpenSubtitles.search(q).then(function (list) {
                App.UI.Loading.hide(true);

                if (!list.length) {
                    App.UI.Modal.alert('Legenda não encontrada',
                        '"' + label + '": nenhum resultado.\n\n' +
                        'O nome do conteúdo na fonte pode não ser adequado para a busca\n' +
                        'e o idioma é escolhido em Configurações > Serviço de legendas.');
                    return;
                }

                var opts = [];
                for (var i = 0; i < list.length; i++) {
                    var r = list[i];
                    var tags = [];
                    if (r.fromTrusted) { tags.push('confiável'); }
                    if (r.aiTranslated || r.machineTranslated) { tags.push('tradução automática'); }
                    if (r.hearingImpaired) { tags.push('para surdos'); }
                    opts.push({
                        icon: r.fromTrusted ? '⭐' : '💬',
                        label: U.truncate(r.release || r.fileName, 58) +
                               (tags.length ? ('   [' + tags.join(', ') + ']') : ''),
                        hint: r.downloads ? (r.downloads + '↓') : '',
                        value: r.fileId
                    });
                }

                App.UI.Modal.choose('Escolher legenda  (' + list.length + ' resultados)', opts, {
                    message: label + '  •  idioma: ' +
                             (App.Settings.get('subtitleSearchLang') || 'tr').toUpperCase()
                }).then(function (fileId) {
                    if (fileId === undefined) { return; }
                    applyDownloaded(fileId, list);
                });
            }, function (err) {
                App.UI.Loading.hide(true);
                var e = App.AppError.wrap(err);
                App.UI.Modal.alert('Não foi possível buscar legendas',
                    e.message + (e.detail ? '\n\n(' + e.detail + ')' : ''));
            });
        }

        function applyDownloaded(fileId, list) {
            App.UI.Loading.show('Baixando legenda...', { delay: 0 });

            App.OpenSubtitles.download(fileId).then(function (res) {
                App.UI.Loading.hide(true);

                var picked = null;
                for (var i = 0; i < list.length; i++) {
                    if (list[i].fileId === fileId) { picked = list[i]; }
                }

                var n = App.Subtitles.load(res.text, {
                    name: (picked && picked.release) || res.fileName,
                    language: picked && picked.language
                });

                /* Cihaza kaydet: ayni bolum tekrar acildiginda hak harcanmasin */
                App.SubtitleCache.put(App.Player.getItem(), picked && picked.language, {
                    text: res.text,
                    name: (picked && picked.release) || res.fileName,
                    language: picked && picked.language
                });

                /* Gomulu altyazi kapatilir; artik biz ciziyoruz */
                App.Player.setSubtitleHidden(true);
                hideSubtitle();

                var extra = (res.remaining !== null && res.remaining !== undefined)
                    ? ('  •  downloads restantes hoje: ' + res.remaining) : '';
                App.UI.Toast.success('Legenda carregada (' + n + ' linhas)' + extra, 6000);

                if (App.Player.getState() === App.Player.STATE.PLAYING) {
                    renderExternalSubtitle(App.Player.getPosition());
                }
            }, function (err) {
                App.UI.Loading.hide(true);
                var e = App.AppError.wrap(err);
                App.UI.Modal.alert('Não foi possível baixar a legenda',
                    e.message + (e.detail ? '\n\n(' + e.detail + ')' : ''));
            });
        }

        /* ================= Sezonun tamamini indir ================= */

        /** Oynatma baglamindaki AYNI SEZONA ait bolumler */
        function seasonEpisodes() {
            var cur = App.Player.getItem();
            if (!cur || cur.type !== 'episode') { return []; }
            var ctx = App.Player.getContext();
            var out = [];
            for (var i = 0; i < ctx.items.length; i++) {
                var it = ctx.items[i];
                if (it && it.type === 'episode' &&
                    U.toInt(it.season, 0) === U.toInt(cur.season, 0)) {
                    out.push(it);
                }
            }
            return out;
        }

        function downloadSeasonFlow() {
            if (!App.OpenSubtitles.isConfigured()) { downloadSubtitleFlow(); return; }

            var eps = seasonEpisodes();
            if (!eps.length) { App.UI.Toast.warn('Episódios da temporada não encontrados'); return; }

            var lang = App.Settings.get('subtitleSearchLang') || 'tr';

            /* Zaten kayitli olanlari say: onlar icin hak harcanmayacak */
            var checks = [];
            for (var i = 0; i < eps.length; i++) { checks.push(App.SubtitleCache.has(eps[i], lang)); }

            Promise.all(checks).then(function (flags) {
                var todo = [];
                for (var j = 0; j < eps.length; j++) {
                    if (!flags[j]) { todo.push(eps[j]); }
                }
                var already = eps.length - todo.length;

                if (!todo.length) {
                    App.UI.Modal.alert('Já baixadas',
                        'Os ' + eps.length + ' episódios desta temporada já têm legenda salva no dispositivo.\n' +
                        'Ela é carregada automaticamente ao abrir o episódio.');
                    return;
                }

                App.UI.Modal.confirm('Baixar as legendas da temporada?',
                    'Total: ' + eps.length + ' episódios' +
                    (already ? (', ' + already + ' já salvos') : '') + '.\n' +
                    'A baixar: ' + todo.length + ' episódios.\n\n' +
                    'ATENÇÃO: a cota diária do OpenSubtitles é contada POR ARQUIVO;\n' +
                    'esta operação consome ' + todo.length + ' downloads. A vantagem:\n' +
                    'o que for baixado fica salvo no dispositivo e, ao abrir\n' +
                    'o mesmo episódio de novo, nenhuma cota é consumida.\n\n' +
                    'Você pode interromper com a tecla RETURN.',
                    { okText: 'Baixar' })
                    .then(function (yes) {
                        if (yes) { runBatch(todo, lang); }
                    });
            });
        }

        function runBatch(todo, lang) {
            batch.running = true;
            batch.cancel = false;

            var ok = 0, miss = 0, i = 0;
            var stopReason = '';

            App.UI.Loading.show('Baixando legendas da temporada...', { delay: 0 });

            function step() {
                if (destroyed) { finish(); return; }
                if (batch.cancel) { stopReason = 'Operação interrompida.'; finish(); return; }
                if (i >= todo.length) { finish(); return; }

                var ep = todo[i++];
                App.UI.Loading.setProgress(
                    i + ' / ' + todo.length + '   •   S' + U.pad2(ep.season) + 'E' + U.pad2(ep.episodeNum) +
                    '   •   encontradas: ' + ok);

                var q = App.OpenSubtitles.queryFor(ep, seriesTitleFromContext());
                if (!q || !q.query) { miss++; return step(); }

                /* ONEMLI: .then(basarili, hatali) bicimi, "basarili"
                   icindeki indirme hatasini YAKALAMAZ; o durumda dongu
                   sessizce durur ve "Yukleniyor" ekranda kalirdi.
                   Bu yuzden tek bir .catch() ile bitiriyoruz. */
                App.OpenSubtitles.search(q).then(function (list) {
                    if (!list.length) { miss++; return null; }

                    return App.OpenSubtitles.download(list[0].fileId).then(function (res) {
                        return App.SubtitleCache.put(ep, list[0].language, {
                            text: res.text,
                            name: list[0].release || res.fileName,
                            language: list[0].language
                        }).then(function () {
                            ok++;
                            return res;
                        });
                    });
                }).then(function (res) {
                    /* Kota bittiyse devam etmenin anlami yok */
                    if (res && res.remaining !== null && res.remaining !== undefined &&
                        res.remaining <= 0) {
                        stopReason = 'Sua cota diária de downloads acabou.';
                        finish();
                        return;
                    }
                    step();
                })['catch'](function (err) {
                    var e = App.AppError.wrap(err);
                    if (/kota|cota|quota|limit/i.test(String(e.detail || '') + ' ' + String(e.message || ''))) {
                        stopReason = 'Sua cota diária de downloads acabou.';
                        finish();
                        return;
                    }
                    miss++;
                    step();
                });
            }

            function finish() {
                if (!batch.running) { return; }
                batch.running = false;
                App.UI.Loading.hide(true);
                if (destroyed) { return; }

                App.UI.Modal.alert('Legendas da temporada',
                    (stopReason ? (stopReason + '\n\n') : '') +
                    'Baixadas: ' + ok + '\n' +
                    'Não encontradas: ' + miss + '\n\n' +
                    'As legendas salvas são carregadas automaticamente ao abrir o episódio.');

                /* Su an oynayan bolume aitse hemen uygula */
                autoLoadCachedSubtitle(App.Player.getItem());
            }

            step();
        }

        var OFFSETS = [-3000, -2000, -1500, -1000, -500, 0, 500, 1000, 1500, 2000, 3000];

        function chooseOffset() {
            var cur = App.Subtitles.getOffset();
            var opts = [], defaultIndex = 5;

            for (var i = 0; i < OFFSETS.length; i++) {
                var v = OFFSETS[i];
                var isCur = (v === cur);
                if (isCur) { defaultIndex = i; }
                opts.push({
                    icon: isCur ? '✔' : (v < 0 ? '⏪' : (v > 0 ? '⏩' : '⏺')),
                    label: v === 0 ? 'Sem atraso'
                                   : ((v > 0 ? '+' : '') + (v / 1000).toFixed(1) + ' segundos'),
                    hint: isCur ? 'ATIVA' : '',
                    current: isCur,
                    value: v
                });
            }

            App.UI.Modal.choose('Atraso da legenda', opts, {
                message: 'Valor POSITIVO ATRASA a legenda; valor negativo ADIANTA.\n' +
                         'Se a legenda aparece cedo demais, escolha POSITIVO; se tarde demais, NEGATIVO.',
                defaultIndex: defaultIndex
            }).then(function (v) {
                if (v === undefined) { return; }
                App.Subtitles.setOffset(v);
                renderExternalSubtitle(App.Player.getPosition());
                App.UI.Toast.info('Atraso da legenda: ' +
                    (v === 0 ? 'nenhum' : ((v > 0 ? '+' : '') + (v / 1000).toFixed(1) + ' sn')));
            });
        }

        function pushNumber(digit) {
            if (!App.Player.isLive()) { return; }
            numBuffer += String(digit);
            if (numBuffer.length > 4) { numBuffer = numBuffer.substr(-4); }
            if (!numEl) {
                numEl = U.el('div', 'numpad');
                root.appendChild(numEl);
            }
            numEl.textContent = numBuffer;
            numEl.classList.remove('hidden');

            if (numTimer) { clearTimeout(numTimer); }
            numTimer = setTimeout(function () {
                var n = U.toInt(numBuffer, -1);
                numBuffer = '';
                if (numEl) { numEl.classList.add('hidden'); }
                if (n > 0) {
                    showBuffering('Canal ' + n + ' abrindo...');
                    App.Player.zapToNumber(n).then(function (ok) {
                        if (ok === false) {
                            App.UI.Toast.warn(n + ': canal não encontrado');
                            clearState();
                        }
                    });
                }
            }, 1200);
        }

        /* ================= View ================= */

        return {
            id: 'player',
            title: 'Player',

            mount: function (container, params) {
                root = container;
                destroyed = false;
                returnTo = params && params.returnTo;

                root.classList.add('player');
                root.style.background = 'transparent';

                root.appendChild(buildOsd());

                stateBox = U.el('div', 'pstate hidden');
                root.appendChild(stateBox);

                buildNextUp();
                buildIntro();
                buildSubtitle();

                App.Bus.on('player:state', onState);
                App.Bus.on('player:time', onTime);
                App.Bus.on('player:item', onItem);
                App.Bus.on('player:error', onError);
                App.Bus.on('player:recovering', onRecovering);
                App.Bus.on('player:notice', onNotice);
                App.Bus.on('player:buffering', onBuffering);
                App.Bus.on('player:complete', onComplete);
                App.Bus.on('player:subtitle', onSubtitleEvt);

                /* Canli yayinda EPG'yi dakikada bir tazele */
                clockTimer = setInterval(function () {
                    if (currentItem && currentItem.type === 'live') { loadEpg(currentItem); }
                }, 60000);

                var item = params && params.item;
                if (!item) {
                    App.UI.Modal.alert('Erro', 'Nenhum conteúdo para reproduzir foi informado.')
                        .then(function () { App.Router.back(); });
                    return;
                }

                fillItemInfo(item);
                showBuffering('Abrindo transmissão...');
                showOsd(true);

                /* ONEMLI: play() promise'i BILEREK dondurulmuyor.
                   Dondurulseydi router gecisi yayin hazir olana kadar
                   beklerdi ve yayin acilmiyorsa kullanici 30 saniye
                   boyunca RETURN tusuna basamazdi. */
                App.Player.play(item, {
                    context: params.context,
                    startMs: params.startMs,
                    resume: App.Settings.get('autoResume')
                });
            },

            onKey: function (code) {
                /* Hata ekrani acikken butonlar arasi gezinme Nav'a birakilir */
                if (errorButtons.length) {
                    if (code === KEY.LEFT || code === KEY.RIGHT ||
                        code === KEY.UP || code === KEY.DOWN || code === KEY.ENTER) {
                        return false;
                    }
                }

                if (App.Keys.isNumberKey(code)) { pushNumber(App.Keys.numberOf(code)); return true; }

                switch (code) {
                    case KEY.ENTER:
                        /* Oncelik sirasi:
                             1) Sonraki bolum onerisi acikssa -> onu baslat
                             2) Intro atlama onerisi acikssa -> introyu atla
                             3) Aksi halde DURDUR / DEVAM ET
                           (Bilgi seridini acmak icin INFO tusu kullanilir;
                            zaten her tus basiminda serit kendiliginden cikar.) */
                        if (nextUp.open) { playNext(); return true; }
                        if (intro.visible) { skipIntro(); return true; }
                        togglePause();
                        return true;

                    case KEY.INFO:
                        toggleOsd();
                        return true;

                    case KEY.UP:
                    case KEY.CH_UP:
                        if (App.Player.isLive()) { zap(-1); return true; }
                        showOsd();
                        return true;

                    case KEY.DOWN:
                    case KEY.CH_DOWN:
                        if (App.Player.isLive()) { zap(1); return true; }
                        showOsd();
                        return true;

                    case KEY.LEFT:
                        doSeek(-1);
                        return true;

                    case KEY.RIGHT:
                        doSeek(1);
                        return true;

                    /* ⏪ ⏩: 1 dakikalik adimlar. Onceden her basista ayri
                       seekTo gidiyordu; ard arda basinca AVPlay'e ust uste
                       sarma yagiyor ve goruntu donuyordu. Artik ok tuslari
                       gibi birikir ve TEK sarma yapilir. */
                    case KEY.REWIND:
                        doSeek(-1, 60);
                        return true;

                    case KEY.FF:
                        doSeek(1, 60);
                        return true;

                    case KEY.PLAY_PAUSE:
                    case KEY.PLAY:
                    case KEY.PAUSE:
                        togglePause();
                        return true;

                    case KEY.STOP:
                        App.Router.back();
                        return true;

                    case KEY.RED:
                        toggleFav();
                        return true;

                    case KEY.GREEN:
                        chooseAudioTrack();
                        return true;

                    case KEY.YELLOW:
                        if (App.Player.isLive() && App.Player.getVariants().length > 1) { chooseQuality(); }
                        else { chooseSubtitle(); }
                        return true;

                    case KEY.BLUE:
                        App.UI.Toast.info('Reiniciando transmissão...');
                        showBuffering('Reiniciando transmissão...');
                        App.Player.restart();
                        return true;

                    default:
                        return false;
                }
            },

            onBack: function () {
                /* Toplu indirme suruyorsa once onu durdur */
                if (batch.running) {
                    batch.cancel = true;
                    App.UI.Loading.setProgress('Interrompendo...');
                    return true;
                }

                /* Sirasiyla: sonraki bolum onerisi -> intro onerisi -> OSD */
                if (nextUp.open) {
                    nextUp.dismissed = true;
                    hideNextUp();
                    return true;
                }
                if (intro.visible) {
                    intro.dismissed = true;
                    hideIntro();
                    return true;
                }
                if (osdVisible() && !errorButtons.length) {
                    hideOsd();
                    return true;
                }
                return false;   /* Router bir ust ekrana doner */
            },

            unmount: function () {
                destroyed = true;
                App.Bus.off('player:state', onState);
                App.Bus.off('player:time', onTime);
                App.Bus.off('player:item', onItem);
                App.Bus.off('player:error', onError);
                App.Bus.off('player:recovering', onRecovering);
                App.Bus.off('player:notice', onNotice);
                App.Bus.off('player:buffering', onBuffering);
                App.Bus.off('player:complete', onComplete);
                App.Bus.off('player:subtitle', onSubtitleEvt);

                if (osdTimer) { clearTimeout(osdTimer); }
                if (clockTimer) { clearInterval(clockTimer); }
                if (numTimer) { clearTimeout(numTimer); }
                if (seek.timer) { clearTimeout(seek.timer); }
                if (seek.hideTimer) { clearTimeout(seek.hideTimer); }
                if (subTimer) { clearTimeout(subTimer); }
                if (subWatch.timer) { clearTimeout(subWatch.timer); }

                App.Player.stop();
                App.Subtitles.clear();
                document.body.classList.remove('player-active');
                errorButtons = [];
                currentItem = null;
            }
        };
    };
})(window.App = window.App || {});
