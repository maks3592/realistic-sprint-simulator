(function () {
    'use strict';

    var APK = {
        url: 'apk/Sprint.apk',
        fallback: 'https://github.com/maks3592/sprint/releases/latest/download/Sprint.apk',
        name: 'Sprint.apk',
        size: 4261728,
        type: 'application/vnd.android.package-archive',
    };

    var STATS_API = 'https://abacus.jasoncameron.dev';
    var STATS_NS = 'maks3592-sprint';

    function plural(n) {
        var m10 = n % 10, m100 = n % 100;
        if (m10 === 1 && m100 !== 11) return 'скачивание с сайта';
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'скачивания с сайта';
        return 'скачиваний с сайта';
    }

    function showCount(value) {
        if (typeof value !== 'number') return;
        document.querySelectorAll('.js-count').forEach(function (el) { el.textContent = value.toLocaleString('ru-RU'); });
        document.querySelectorAll('.js-count-label').forEach(function (el) { el.textContent = plural(value); });
    }

    function stat(action) {
        return fetch(STATS_API + '/' + action + '/' + STATS_NS + '/downloads')
            .then(function (r) { return r.json(); })
            .then(function (d) { showCount(d.value); })
            .catch(function () {
                document.querySelectorAll('.js-count').forEach(function (el) { el.textContent = ''; });
                document.querySelectorAll('.js-count-label').forEach(function (el) { el.textContent = 'бесплатно'; });
            });
    }

    function ensurePanel() {
        var existing = document.querySelector('.dl-panel');
        if (existing) return existing;
        var el = document.createElement('div');
        el.className = 'dl-panel';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.hidden = true;
        el.innerHTML =
            '<div class="dl-head"><span class="dl-title">Скачиваем APK</span>' +
            '<button class="dl-close" type="button" aria-label="Закрыть">×</button></div>' +
            '<div class="dl-bar"><div class="dl-fill"></div></div>' +
            '<div class="dl-meta"><span class="dl-percent">0%</span><span class="dl-bytes"></span></div>' +
            '<p class="dl-done">Готово! Откройте <b>' + APK.name + '</b> в загрузках и разрешите установку, если телефон спросит.</p>' +
            '<p class="dl-error">Не получилось скачать здесь. <a class="dl-direct" href="' + APK.fallback + '" download>Скачать напрямую</a></p>';
        document.body.appendChild(el);
        return el;
    }

    var panel = ensurePanel();
    var fill = panel.querySelector('.dl-fill');
    var percentEl = panel.querySelector('.dl-percent');
    var bytesEl = panel.querySelector('.dl-bytes');
    var titleEl = panel.querySelector('.dl-title');
    var downloading = false;

    function mb(bytes) { return (bytes / 1048576).toFixed(1).replace('.', ','); }

    function setState(state) {
        panel.hidden = false;
        panel.dataset.state = state;
        titleEl.textContent = state === 'done' ? 'APK скачан' : state === 'error' ? 'Ошибка загрузки' : 'Скачиваем APK';
        requestAnimationFrame(function () { panel.classList.add('open'); });
    }

    function setProgress(loaded, total) {
        var p = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;
        fill.style.transform = 'scaleX(' + (p / 100) + ')';
        percentEl.textContent = Math.floor(p) + '%';
        bytesEl.textContent = mb(loaded) + ' / ' + mb(total) + ' МБ';
    }

    function save(blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = APK.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }

    function finish() {
        setProgress(APK.size, APK.size);
        setState('done');
        downloading = false;
        document.body.classList.remove('is-downloading');
        stat('hit');
    }

    function fail() {
        setState('error');
        downloading = false;
        document.body.classList.remove('is-downloading');
    }

    function download(event) {
        event.preventDefault();
        if (downloading) return;
        downloading = true;
        document.body.classList.add('is-downloading');
        setProgress(0, APK.size);
        setState('loading');

        var canStream = window.fetch && window.ReadableStream && window.Blob && window.URL && URL.createObjectURL;
        if (!canStream) {
            window.location.href = APK.url;
            finish();
            return;
        }

        fetch(APK.url, { cache: 'no-cache' })
            .then(function (response) {
                if (!response.ok || !response.body) throw new Error('HTTP ' + response.status);
                var total = parseInt(response.headers.get('Content-Length'), 10) || APK.size;
                var reader = response.body.getReader();
                var chunks = [];
                var loaded = 0;
                var frame = 0;

                function pump() {
                    return reader.read().then(function (step) {
                        if (step.done) return;
                        chunks.push(step.value);
                        loaded += step.value.length;
                        if (!frame) {
                            frame = requestAnimationFrame(function () { frame = 0; setProgress(loaded, total); });
                        }
                        return pump();
                    });
                }

                return pump().then(function () {
                    save(new Blob(chunks, { type: APK.type }));
                    finish();
                });
            })
            .catch(fail);
    }

    document.querySelectorAll('.js-download').forEach(function (a) { a.addEventListener('click', download); });
    panel.querySelector('.dl-close').addEventListener('click', function () {
        if (downloading) return;
        panel.classList.remove('open');
        setTimeout(function () { panel.hidden = true; }, 400);
    });
    panel.querySelector('.dl-direct').addEventListener('click', function () { stat('hit'); });

    function setupReveal() {
        document.querySelectorAll('.hero .reveal').forEach(function (el, i) {
            setTimeout(function () { el.classList.add('in-view'); }, 120 + i * 110);
        });

        var items = Array.prototype.filter.call(document.querySelectorAll('.reveal, .phone'), function (el) {
            return !el.closest('.hero');
        });
        if (!('IntersectionObserver' in window)) {
            items.forEach(function (el) { el.classList.add('in-view'); });
            return;
        }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) {
                    e.target.classList.add('in-view');
                    if (!e.target.classList.contains('phone')) io.unobserve(e.target);
                } else if (e.target.classList.contains('phone')) {
                    e.target.classList.remove('in-view');
                }
            });
        }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
        items.forEach(function (el) { io.observe(el); });
    }

    function setupScroll() {
        var nav = document.querySelector('.nav');
        var bar = document.querySelector('.mobile-bar');
        var hero = document.querySelector('.hero');
        var final = document.querySelector('.final');
        var ticking = false;

        function update() {
            ticking = false;
            var y = window.scrollY;
            nav.classList.toggle('scrolled', y > 40);
            var pastHero = y > hero.offsetHeight * 0.7;
            var finalTop = final.getBoundingClientRect().top;
            var show = pastHero && finalTop > window.innerHeight * 0.6;
            bar.classList.toggle('show', show);
            bar.setAttribute('aria-hidden', show ? 'false' : 'true');
            bar.querySelector('a').tabIndex = show ? 0 : -1;
        }

        window.addEventListener('scroll', function () {
            if (!ticking) { ticking = true; requestAnimationFrame(update); }
        }, { passive: true });
        update();
    }

    stat('get');
    setupReveal();
    setupScroll();
})();
