/* ============================================================
   js/core/quality.js
   Agrupa as variantes de qualidade de um mesmo canal ao vivo
   ("SPORTV 3 UHD", "SPORTV 3 FHD H264", "SPORTV 3 HD"...) em UM canal,
   com a lista de variantes para troca manual (AMARELO no player) ou
   automática quando a escolhida falha.

   - Agrupamento por categoria + nome sem os marcadores de qualidade.
   - Representante = variante preferida (Ajustes > Qualidade preferida).
   - A chave do canal agrupado é estável (não muda com a preferência),
     para favoritos e histórico continuarem valendo.
   ============================================================ */
(function (App) {
    'use strict';

    var TOK = /(^|[\s\-_:.|\[(])(FULL ?HD|FHD|UHD|4K|2K|HD|SD|HEVC|H\.?265|H\.?264|HDR|1080[PI]?|720P?|480P?|LOW|ALT|BACKUP)(?=$|[\s\-_:.|\])])/gi;
    var AUTO_ORDER = ['FHD', 'HD', '4K', 'SD', '?'];

    function parse(name) {
        var u = ' ' + String(name || '').toUpperCase().replace(/\s+/g, ' ') + ' ';
        var q = null, codec = null, hdr = false;
        if (/\s(4K|UHD|2160P?)\s/.test(u)) { q = '4K'; }
        else if (/\s(FHD|FULL ?HD|1080[PI]?)\s/.test(u)) { q = 'FHD'; }
        else if (/\s(HD|720P?)\s/.test(u)) { q = 'HD'; }
        else if (/\s(SD|480P?|LOW)\s/.test(u)) { q = 'SD'; }
        if (/\s(HEVC|H\.?265)\s/.test(u)) { codec = 'HEVC'; }
        else if (/\sH\.?264\s/.test(u)) { codec = 'H264'; }
        if (/\sHDR\s/.test(u)) { hdr = true; }
        var base = String(name || '').replace(TOK, '$1 ').replace(/[\s\-_:.|]+$/g, '').replace(/\s{2,}/g, ' ').trim();
        var label = (q || 'Padrão') + (codec === 'HEVC' ? ' HEVC' : (codec === 'H264' ? ' H264' : '')) + (hdr ? ' HDR' : '');
        return { base: base || String(name || ''), q: q || '?', codec: codec, hdr: hdr, label: label };
    }

    function norm(s) {
        return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    }

    /** Menor = melhor, segundo a preferência do usuário. */
    function rank(v) {
        var pref = App.Settings.get('preferredQuality') || 'auto';
        var order = AUTO_ORDER.slice();
        if (pref !== 'auto') { order = [pref].concat(order.filter(function (x) { return x !== pref; })); }
        var i = order.indexOf(v.q);
        if (i < 0) { i = order.length; }
        /* dentro da mesma qualidade: H264 primeiro (decodificação mais leve e
           estável no AVPlay), depois sem marca, HEVC por último */
        var c = v.codec === 'H264' ? 0 : (v.codec ? 2 : 1);
        return i * 10 + c;
    }

    function makeVariant(it) {
        var p = parse(it.name);
        return { id: it.id, name: it.name, label: p.label, q: p.q, codec: p.codec, num: it.num, logo: it.logo,
                 epgChannelId: it.epgChannelId, tvArchive: it.tvArchive, archiveDuration: it.archiveDuration };
    }

    App.Quality = {
        parse: parse,
        enabled: function () { return App.Settings.get('groupQualities') !== false; },

        /** @param {Array} list canais normalizados (type 'live') */
        group: function (list) {
            if (!list || !list.length) { return list; }
            var groups = {}, order = [], i, it, p, k;
            for (i = 0; i < list.length; i++) {
                it = list[i];
                if (!it || it.type !== 'live' || it.url) { order.push({ single: it }); continue; }   /* M3U mantém */
                p = parse(it.name);
                k = String(it.categoryId || '') + '|' + norm(p.base);
                if (!groups[k]) { groups[k] = { base: p.base, items: [] }; order.push({ key: k }); }
                groups[k].items.push(it);
            }
            var out = [];
            for (i = 0; i < order.length; i++) {
                if (order[i].single) { out.push(order[i].single); continue; }
                var g = groups[order[i].key];
                if (!g) { continue; }
                if (g.items.length < 2) { out.push(g.items[0]); continue; }
                var vars = g.items.map(makeVariant);
                /* mesma etiqueta repetida (ex.: dois "HD"): numera ² ³ */
                var seen = {};
                for (var j = 0; j < vars.length; j++) {
                    var l = vars[j].label;
                    seen[l] = (seen[l] || 0) + 1;
                    if (seen[l] > 1) { vars[j].label = l + ' ' + seen[l]; }
                }
                vars.sort(function (a, b) { return rank(a) - rank(b); });
                var best = vars[0];
                var rep = {};
                for (var f in g.items[0]) { if (Object.prototype.hasOwnProperty.call(g.items[0], f)) { rep[f] = g.items[0][f]; } }
                rep.id = best.id;
                rep.name = g.base;
                rep.logo = best.logo || rep.logo;
                rep.epgChannelId = best.epgChannelId || rep.epgChannelId;
                rep.num = Math.min.apply(null, g.items.map(function (x) { return x.num || 1e9; }));
                rep.key = 'liveg:' + order[i].key;
                rep.variants = vars;
                rep.quality = best.label;
                out.push(rep);
            }
            return out;
        },

        /** Cópia do canal agrupado apontando para outra variante. */
        withVariant: function (item, variantId) {
            if (!item || !item.variants) { return item; }
            var v = null;
            for (var i = 0; i < item.variants.length; i++) { if (String(item.variants[i].id) === String(variantId)) { v = item.variants[i]; } }
            if (!v) { return item; }
            var copy = {};
            for (var f in item) { if (Object.prototype.hasOwnProperty.call(item, f)) { copy[f] = item[f]; } }
            copy.id = v.id;
            copy.quality = v.label;
            copy.epgChannelId = v.epgChannelId || item.epgChannelId;
            return copy;
        },

        /** Etiqueta curta para a lista: "FHD +2" */
        chip: function (item) {
            if (!item || !item.variants || item.variants.length < 2) { return ''; }
            return (item.quality || '').split(' ')[0] + ' +' + (item.variants.length - 1);
        }
    };
})(window.App = window.App || {});
