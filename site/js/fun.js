(function () {
    'use strict';

    var FACTS = [
        { title: 'Болт начал праздновать за двадцать метров до финиша.', text: 'Пекин, 2008. Он уже вёл с большим отрывом, опустил руки и фактически не бежал последние метры. Время всё равно получилось 9,69.' },
        { title: 'Сотню в 9,58 он пробежал примерно за 41 шаг.', text: 'Обычный человек на этой дистанции делает заметно больше. Длина шага у Болта около двух с половиной метров, и именно она решает.' },
        { title: 'Пиковая скорость Болта: 44,72 км/ч.', text: 'Это средняя скорость на отрезке между шестидесятым и восьмидесятым метром в берлинском забеге 2009 года.' },
        { title: 'Нажал раньше выстрела, и тебя снимают.', text: 'В большом спорте реакция быстрее 0,1 секунды считается фальстартом, потому что так быстро человек не успевает услышать сигнал. В игре штраф помягче: за ранний тап теряешь 0,2 секунды.' },
        { title: 'Рекорд на 150 метров поставили на городской улице.', text: 'Манчестер, 2009. Дистанцию бежали по прямой на временной дорожке прямо между домами. Болт показал 14,35.' },
        { title: 'Четыре дня между двумя мировыми рекордами.', text: 'В Берлине в августе 2009-го Болт пробежал сотню за 9,58, а через четыре дня двести за 19,19. Оба рекорда стоят до сих пор.' },
        { title: 'Рекорд на 60 метров бежали в зале.', text: 'Шестьдесят метров бегают зимой под крышей. Кристиан Коулман в 2018-м показал 6,34, это около 34 км/ч в среднем с места.' },
        { title: 'Дыхание в игре записано вручную.', text: 'Первая версия звука была синтезированной и звучала как щелчок хлыста. Пришлось записать настоящее дыхание после нагрузки, подогнать высоту, и только тогда стало похоже на человека.' },
        { title: 'Чёрный экран в APK объяснялся двумя потерянными блоками.', text: 'Первая сборка под Android открывалась с чёрным окном, потому что при сборке разметки пропали два элемента. Нашлось по скриншоту с телефона.' }
    ];

    var RECORDS = { 60: 6.34, 100: 9.58, 150: 14.35, 200: 19.19 };

    var toastEl = document.querySelector('.toast');
    var toastTimer = 0;
    var hideTimer = 0;

    function toast(text, ms) {
        if (!toastEl) return;
        clearTimeout(toastTimer);
        clearTimeout(hideTimer);
        toastEl.textContent = text;
        toastEl.hidden = false;
        requestAnimationFrame(function () { toastEl.classList.add('show'); });
        toastTimer = setTimeout(function () {
            toastEl.classList.remove('show');
            hideTimer = setTimeout(function () { toastEl.hidden = true; }, 400);
        }, ms || 2800);
    }

    function fmt(n, digits) {
        return n.toLocaleString('ru-RU', { maximumFractionDigits: digits === undefined ? 1 : digits });
    }

    function pad(n) { return n < 10 ? '0' + n : String(n); }

    function setupStations() {
        var rows = document.querySelectorAll('.station');
        rows.forEach(function (row) {
            row.setAttribute('tabindex', '0');
            row.setAttribute('role', 'button');
            row.setAttribute('aria-expanded', 'false');

            function toggle() {
                var willOpen = !row.classList.contains('open');
                rows.forEach(function (other) {
                    other.classList.remove('open');
                    other.setAttribute('aria-expanded', 'false');
                });
                if (willOpen) {
                    row.classList.add('open');
                    row.setAttribute('aria-expanded', 'true');
                }
            }

            row.addEventListener('click', toggle);
            row.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                }
            });
        });
    }

    function setupFacts() {
        var box = document.querySelector('.fact');
        var button = document.querySelector('.js-next-fact');
        if (!box || !button) return;

        var countEl = box.querySelector('.fact-count');
        var titleEl = box.querySelector('.fact-title');
        var textEl = box.querySelector('.fact-text');

        var rest = [];
        for (var i = 1; i < FACTS.length; i++) rest.push(i);
        for (var j = rest.length - 1; j > 0; j--) {
            var k = Math.floor(Math.random() * (j + 1));
            var t = rest[j];
            rest[j] = rest[k];
            rest[k] = t;
        }
        var order = [0].concat(rest);
        var position = 0;

        function render() {
            var fact = FACTS[order[position]];
            countEl.innerHTML = pad(position + 1) + ' <em>/ ' + pad(FACTS.length) + '</em>';
            titleEl.textContent = fact.title;
            textEl.textContent = fact.text;
        }

        button.addEventListener('click', function () {
            box.classList.add('swapping');
            setTimeout(function () {
                position = (position + 1) % order.length;
                render();
                box.classList.remove('swapping');
            }, 250);
        });

        render();
    }

    function verdictFor(ratio, dist) {
        if (ratio <= 1) return 'Ты быстрее мирового рекорда. Присылай видео, мы подождём.';
        if (ratio < 1.08) return 'Это уровень сборной. До рекорда рукой подать.';
        if (ratio < 1.25) return 'Очень сильно. Такое время показывают на серьёзных соревнованиях.';
        if (ratio < 1.5) return 'Хороший результат. Спортивный разряд уже не за горами.';
        if (ratio < 1.9) return 'Нормальный уровень для человека, который иногда бегает. В игре на ' + dist + ' м ты бы справился с первой жизнью.';
        return 'Начало положено. Все великие тоже когда-то стояли на старте в первый раз.';
    }

    function setupCalc() {
        var distSel = document.querySelector('.js-calc-dist');
        var timeInput = document.querySelector('.js-calc-time');
        var maxEl = document.querySelector('.js-calc-max');
        var labelEl = document.querySelector('.js-calc-label');
        var verdictEl = document.querySelector('.js-calc-verdict');
        if (!distSel || !timeInput) return;

        function update() {
            var dist = parseInt(distSel.value, 10);
            var time = parseFloat(String(timeInput.value).replace(',', '.'));

            if (!(time > 0)) {
                maxEl.textContent = '—';
                labelEl.textContent = 'Введи время в секундах.';
                verdictEl.textContent = '';
                return;
            }

            var speed = dist / time * 3.6;
            var record = RECORDS[dist];
            var ratio = time / record;
            var gap = time - record;

            maxEl.textContent = fmt(speed) + ' км/ч';
            labelEl.textContent = gap > 0
                ? 'Средняя скорость. До рекорда в ' + fmt(record, 2) + ' с не хватает ' + fmt(gap, 2) + ' с.'
                : 'Средняя скорость. Рекорд в ' + fmt(record, 2) + ' с побит на ' + fmt(-gap, 2) + ' с.';
            verdictEl.textContent = verdictFor(ratio, dist);
        }

        [distSel, timeInput].forEach(function (el) {
            el.addEventListener('input', update);
            el.addEventListener('change', update);
        });
        update();
    }

    function rain() {
        var count = 26;
        for (var i = 0; i < count; i++) {
            var el = document.createElement('span');
            el.className = 'rain';
            el.textContent = '🏃';
            el.style.setProperty('--x', Math.round(Math.random() * 96) + 'vw');
            el.style.setProperty('--s', (20 + Math.round(Math.random() * 26)) + 'px');
            el.style.setProperty('--d', (2.4 + Math.random() * 2.6).toFixed(2) + 's');
            el.style.setProperty('--r', (Math.round(Math.random() * 720) - 360) + 'deg');
            el.style.animationDelay = (Math.random() * 1.2).toFixed(2) + 's';
            document.body.appendChild(el);
            (function (node) { setTimeout(function () { node.remove(); }, 7000); })(el);
        }
    }

    function toggleLegend() {
        var on = document.documentElement.classList.toggle('legend');
        toast(on ? 'Золотой режим. Бежим как Болт.' : 'Золото сдано. Всё вернулось на место.');
        if (on) rain();
    }

    function setupKeys() {
        var konami = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
        var konamiPos = 0;
        var typed = '';
        var words = {
            bolt: function () { toast('Молния! 44,72 км/ч.'); },
            '958': function () { toast('9,58. Магическое число, которое пока никто не побил.'); },
            run: function () { toast('Беги, Форрест, беги.'); }
        };

        document.addEventListener('keydown', function (e) {
            var tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

            var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

            if (key === konami[konamiPos]) {
                konamiPos++;
                if (konamiPos === konami.length) {
                    konamiPos = 0;
                    toggleLegend();
                }
            } else {
                konamiPos = key === konami[0] ? 1 : 0;
            }

            if (e.key.length === 1) {
                typed = (typed + key).slice(-12);
                Object.keys(words).forEach(function (word) {
                    if (typed.slice(-word.length) === word) {
                        typed = '';
                        words[word]();
                    }
                });
            }
        });
    }

    function setupTaps() {
        var logo = document.querySelector('.logo');
        var logoClicks = 0;
        var logoTimer = 0;
        if (logo) {
            logo.addEventListener('click', function () {
                logoClicks++;
                clearTimeout(logoTimer);
                logoTimer = setTimeout(function () { logoClicks = 0; }, 2500);
                if (logoClicks >= 7) {
                    logoClicks = 0;
                    logo.classList.remove('spin');
                    void logo.offsetWidth;
                    logo.classList.add('spin');
                    toast('Крутишься на месте, а должен бежать.');
                }
            });
        }

        var title = document.querySelector('.line-outline');
        var titleClicks = 0;
        var titleTimer = 0;
        if (title) {
            title.addEventListener('click', function () {
                titleClicks++;
                clearTimeout(titleTimer);
                titleTimer = setTimeout(function () { titleClicks = 0; }, 3000);
                if (titleClicks >= 5) {
                    titleClicks = 0;
                    toggleLegend();
                }
            });
        }

        var pager = document.querySelector('.js-pager');
        if (pager) {
            pager.parentElement.style.pointerEvents = 'auto';
            pager.addEventListener('click', function () { toast('Тут могла быть реклама кроссовок.'); });
        }

        var heart = document.querySelector('.js-heart');
        if (heart) heart.addEventListener('click', function () { toast('Пульс 190. После двухсот метров нормально.'); });

        var coffee = document.querySelector('.js-coffee');
        if (coffee) coffee.addEventListener('click', function () { toast('Кофе закончился. Силы на нуле, бегун падает.'); });
    }

    function setupTitle() {
        var original = document.title;
        document.addEventListener('visibilitychange', function () {
            document.title = document.hidden ? 'Вернись, ты не добежал' : original;
        });
    }

    function greet() {
        if (!window.console || !console.log) return;
        console.log('%cСПРИНТ', 'font:900 18px/1.4 system-ui;letter-spacing:.1em');
        console.log('Привет, разработчик. Исходники на гитхабе.');
        console.log('Подсказка: ↑ ↑ ↓ ↓ ← → ← → B A');
    }

    setupStations();
    setupFacts();
    setupCalc();
    setupKeys();
    setupTaps();
    setupTitle();
    greet();
})();
