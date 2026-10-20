/* =============================================================================
   The lobby TV (/lobby/). Photographs of Rochester and the building, three
   upcoming events at a time, the time and weather, and a ticker of building
   notices and local headlines.

   It runs unattended: /api/lobby is read every ten minutes, the last good copy
   is kept in case the network drops, and the page reloads itself every six
   hours to pick up any change to this file.

   Written in plain ES5 on purpose. A TV's own browser can be years old, and
   one that met an arrow function or async would stop here and show nothing,
   so: no let/const, arrows, template strings, promises, fetch or Intl. The
   time is worked out here for Rochester, from the site's clock rather than
   the TV's, so a TV set to the wrong time or zone still shows the right one.
   ============================================================================= */
(function () {
  'use strict';
  var PHOTO_MS = 11000;
  var EVENTS_MS = 16000;
  var REFRESH_MS = 10 * 60 * 1000;
  var RELOAD_MS = 6 * 60 * 60 * 1000;

  // Rochester, from Wikimedia Commons; the licences ask for the credit on screen.
  var CITY = [
    ['high-falls-sunset', 'High Falls from the Pont de Rennes Bridge', 'Blbrett', 'CC BY-SA 4.0'],
    ['downtown-dawn', 'Downtown Rochester at dawn', 'DanielPenfield', 'CC BY-SA 4.0'],
    ['lilac-festival', 'The Lilac Festival in Highland Park', 'Matthew D. Wilson', 'CC BY-SA 2.5'],
    ['genesee-river', 'Downtown from the Genesee River', 'Dominic Sherony', 'CC BY-SA 2.0'],
    ['eastman-theatre-night', 'The Eastman Theatre, before the show', 'DanielPenfield', 'CC BY-SA 4.0'],
    ['high-falls-park', 'High Falls', 'Lew from Campbell, CA', 'CC BY 2.0'],
    ['durand-eastman-fall', 'Autumn in Durand Eastman Park', 'DanielPenfield', 'CC BY-SA 4.0'],
    ['rochester-night', 'Rochester at night', 'Maximilian Kapitonoff', 'CC BY 2.0'],
    ['lilacs', 'Lilacs in Highland Park', 'LtPowers', 'CC BY-SA 3.0'],
    ['high-falls-day', 'High Falls and the city', 'Evilarry', 'Public domain'],
    ['memorial-art-gallery', 'The Memorial Art Gallery', 'DanielPenfield', 'CC BY-SA 3.0'],
    ['charlotte-lighthouse', 'The Charlotte-Genesee Lighthouse', 'Matthew D. Wilson', 'CC BY-SA 3.0'],
    ['genesee-skyline', 'The Genesee River downtown', 'Evilarry', 'Public domain'],
    ['eastman-theatre', 'The Eastman Theatre', 'Matthew D. Wilson', 'CC BY-SA 2.5'],
    ['durand-eastman-spring', 'Spring in Durand Eastman Park', 'DanielPenfield', 'CC BY-SA 4.0'],
    ['high-falls-night', 'High Falls at night', 'Evilarry', 'Public domain']
  ];
  var HOME = [
    ['hero-aerial', 'Charlotte Square and the East End'],
    ['hero-terrace', 'The shared terrace'],
    ['pocket-park-summer', 'The pocket park on Charlotte Street'],
    ['hero-exterior', '50 Charlotte Square']
  ];
  var i;
  for (i = 0; i < CITY.length; i++) {
    var c = CITY[i];
    CITY[i] = { src: '../assets/img/lobby/' + c[0] + '.jpg', caption: c[1],
      credit: 'Photo: ' + c[2] + ' · ' + c[3] + (c[3] === 'Public domain' ? '' : ' · Wikimedia Commons') };
  }
  for (i = 0; i < HOME.length; i++) HOME[i] = { src: '../assets/img/' + HOME[i][0] + '.jpg', caption: HOME[i][1], credit: '' };

  function $(q) { return document.querySelector(q); }
  var slidesEl = $('[data-slides]');
  var timeEl = $('[data-time]');
  var dateEl = $('[data-date]');
  var weatherEl = $('[data-weather]');
  var tickerEl = $('[data-ticker]');

  function hasClass(n, c) { return (' ' + n.className + ' ').indexOf(' ' + c + ' ') >= 0; }
  function addClass(n, c) { if (!hasClass(n, c)) n.className += ' ' + c; }
  function removeClass(n, c) { n.className = (' ' + n.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, ''); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.appendChild(document.createTextNode(text));
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame || function (f) { return setTimeout(f, 16); };
  function on(n, names, f) { for (var k = 0; k < names.length; k++) n.addEventListener(names[k], f, false); }

  /* ---- Size: one rem is a hundredth of the largest 16:9 area that fits ---- */
  function scale() {
    var w = window.innerWidth || document.documentElement.clientWidth;
    var h = window.innerHeight || document.documentElement.clientHeight;
    if (w && h) document.documentElement.style.fontSize = Math.min(w, h * 16 / 9) / 100 + 'px';
  }
  scale();
  on(window, ['resize', 'orientationchange'], scale);

  /* ---- Time: Rochester's, from the site's clock ----------------------------- */
  var skew = 0;   // the site's clock less the TV's, in ms
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function nthSunday(y, m, n) { return (7 - new Date(Date.UTC(y, m, 1)).getUTCDay()) % 7 + 1 + (n - 1) * 7; }
  // A Date whose UTC fields read as the time in Rochester. Daylight time runs
  // from 2am on the second Sunday in March to 2am on the first Sunday in November.
  function rochester() {
    var ms = new Date().getTime() + skew;
    var y = new Date(ms).getUTCFullYear();
    var start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7);
    var end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6);
    return new Date(ms + (ms >= start && ms < end ? -4 : -5) * 3600000);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = rochester(); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function setText(n, t) { clear(n); n.appendChild(document.createTextNode(t)); }
  function tickClock() {
    var d = rochester();
    var h = d.getUTCHours();
    setText(timeEl, ((h + 11) % 12 + 1) + ':' + pad(d.getUTCMinutes()) + ' ' + (h < 12 ? 'AM' : 'PM'));
    setText(dateEl, DAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate());
  }
  tickClock();
  setInterval(tickClock, 10000);

  /* ---- Data ---------------------------------------------------------------- */
  var data = null;
  try { data = JSON.parse(window.localStorage.getItem('lobby') || 'null'); } catch (e) { /* none yet */ }

  function request(method, url, done) {
    var x = new XMLHttpRequest();
    var finished = false;
    function end(ok) { if (!finished) { finished = true; done(ok, x); } }
    x.open(method, url + (url.indexOf('?') < 0 ? '?' : '&') + '_=' + new Date().getTime(), true);
    x.onreadystatechange = function () { if (x.readyState === 4) end(x.status >= 200 && x.status < 300); };
    setTimeout(function () { if (!finished) { try { x.abort(); } catch (e) { /* gone */ } end(false); } }, 20000);
    try { x.send(); } catch (e) { end(false); }
  }

  function load(then) {
    request('GET', '/api/lobby', function (ok, x) {
      if (ok) {
        try {
          var d = JSON.parse(x.responseText);
          data = d;
          if (d.now) skew = d.now * 1000 - new Date().getTime();
          try { window.localStorage.setItem('lobby', x.responseText); } catch (e) { /* storage full or off */ }
          tickClock();
          paintWeather();
          queueTicker();
        } catch (e) { /* keep what is on screen */ }
      }
      if (then) then();
    });
  }

  function paintWeather() {
    var w = data && data.weather;
    clear(weatherEl);
    if (!w) return;
    weatherEl.appendChild(el('b', null, w.temp + '°'));
    weatherEl.appendChild(document.createTextNode(w.summary || ''));
  }

  /* ---- Ticker: notices, then headlines, scrolling forever ------------------ */
  var pendingTicker = false;
  function buildTicker() {
    var items = [];
    var k;
    var notices = (data && data.notices) || [];
    var news = (data && data.news) || [];
    for (k = 0; k < notices.length; k++) items.push(['notice', notices[k]]);
    for (k = 0; k < news.length; k++) items.push(['news', news[k]]);
    removeClass(tickerEl, 'is-moving');
    clear(tickerEl);
    if (!items.length) return;
    // Two copies end to end, so the loop is seamless at -50%.
    for (var copy = 0; copy < 2; copy++) {
      for (k = 0; k < items.length; k++) {
        tickerEl.appendChild(el('span', 'ticker__item' + (items[k][0] === 'notice' ? ' ticker__item--notice' : ''), items[k][1]));
        tickerEl.appendChild(el('span', 'ticker__sep', '◆'));
      }
      if (news.length) {
        tickerEl.appendChild(el('span', 'ticker__credit', 'Headlines: RochesterFirst.com'));
        tickerEl.appendChild(el('span', 'ticker__sep', '◆'));
      }
    }
    var px = tickerEl.scrollWidth / 2;
    var speed = (window.innerWidth || 1920) / 14;   // a screen's width every fourteen seconds
    var secs = Math.max(20, px / speed) + 's';
    tickerEl.style.webkitAnimationDuration = secs;
    tickerEl.style.animationDuration = secs;
    void tickerEl.offsetWidth;
    addClass(tickerEl, 'is-moving');
  }
  // New headlines wait for the end of a loop, so the ticker never jumps.
  function queueTicker() {
    if (!hasClass(tickerEl, 'is-moving')) { buildTicker(); return; }
    pendingTicker = true;
  }
  on(tickerEl, ['animationiteration', 'webkitAnimationIteration'], function () {
    if (pendingTicker) { pendingTicker = false; buildTicker(); }
  });

  /* ---- Slides --------------------------------------------------------------- */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function parts(iso) {
    var p = iso.split('-');
    var y = +p[0], m = +p[1], d = +p[2];
    return { m: m, d: d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
  }
  function when(e) {
    var s = parts(e.start);
    if (!e.end || e.end === e.start) return DOW[s.dow] + ', ' + MON[s.m - 1] + ' ' + s.d;
    var t = parts(e.end);
    if (e.start <= today()) return 'Through ' + MON[t.m - 1] + ' ' + t.d;
    return s.m === t.m ? MON[s.m - 1] + ' ' + s.d + ' – ' + t.d : MON[s.m - 1] + ' ' + s.d + ' – ' + MON[t.m - 1] + ' ' + t.d;
  }

  function shuffle(a) {
    var b = a.slice();
    for (var k = b.length - 1; k > 0; k--) { var j = Math.floor(Math.random() * (k + 1)); var t = b[k]; b[k] = b[j]; b[j] = t; }
    return b;
  }

  // One pass: a welcome, then two photographs to every three events, with the
  // building's own photographs spread through the city's.
  function playlist() {
    var photos = shuffle(CITY);
    var home = shuffle(HOME);
    var k;
    for (k = 0; k < home.length; k++) photos.splice(Math.min(photos.length, 3 + k * 5), 0, home[k]);
    var events = (data && data.events) || [];
    var groups = [];
    for (k = 0; k < events.length && groups.length < 6; k += 3) groups.push(events.slice(k, k + 3));
    var list = [{ type: 'welcome', photo: HOME[0] }];
    var g = 0;
    for (k = 0; k < photos.length; k++) {
      list.push({ type: 'photo', photo: photos[k] });
      if (k % 2 === 1 && g < groups.length) list.push({ type: 'events', events: groups[g++], photo: photos[(k + 5) % photos.length] });
    }
    return list;
  }

  function picture(cls, src) {
    var n = el('div', cls);
    n.style.backgroundImage = 'url("' + src + '")';
    return n;
  }

  function render(item) {
    var s = el('div', 'slide slide--' + item.type);
    s.appendChild(picture('slide__img', item.photo.src));
    var srcs = [item.photo.src];
    if (item.type === 'photo') {
      var c = el('div', 'caption');
      c.appendChild(el('div', 'caption__title', item.photo.caption));
      if (item.photo.credit) c.appendChild(el('div', 'caption__credit', item.photo.credit));
      s.appendChild(c);
    } else if (item.type === 'welcome') {
      var w = el('div', 'welcome');
      w.appendChild(el('div', 'welcome__eyebrow', '50 Charlotte Square · Rochester’s East End'));
      w.appendChild(el('h1', 'welcome__title', 'Welcome home.'));
      s.appendChild(w);
    } else {
      var box = el('div', 'events');
      box.appendChild(el('div', 'events__eyebrow', 'Coming up'));
      var title = el('h2', 'events__title', 'Happening in ');
      title.appendChild(el('i', null, 'Rochester'));
      box.appendChild(title);
      var grid = el('div', 'events__grid');
      for (var k = 0; k < item.events.length; k++) {
        var e = item.events[k];
        var card = el('div', 'event event--' + (k + 1));
        if (e.image) { card.appendChild(picture('event__img', e.image)); srcs.push(e.image); }
        else { var none = el('div', 'event__img event__img--none'); none.appendChild(el('span', null, 'Rochester')); card.appendChild(none); }
        var body = el('div', 'event__body');
        body.appendChild(el('div', 'event__when', when(e)));
        body.appendChild(el('div', 'event__name', e.title));
        if (e.blurb) body.appendChild(el('div', 'event__blurb', e.blurb));
        card.appendChild(body);
        grid.appendChild(card);
      }
      box.appendChild(grid);
      box.appendChild(el('div', 'events__credit', 'Events from VisitRochester.com'));
      s.appendChild(box);
    }
    return { node: s, srcs: srcs };
  }

  // Load a slide's pictures before it is shown, but never wait more than 8s.
  function preload(srcs, done) {
    var left = srcs.length;
    var called = false;
    function one() { left--; if (left <= 0 && !called) { called = true; done(); } }
    setTimeout(function () { if (!called) { called = true; done(); } }, 8000);
    if (!left) { one(); return; }
    for (var k = 0; k < srcs.length; k++) { var im = new Image(); im.onload = one; im.onerror = one; im.src = srcs[k]; }
  }

  var list = [];
  var at = 0;
  function next() {
    if (at >= list.length) { list = playlist(); at = 0; }
    var item = list[at++];
    var dur = item.type === 'events' ? EVENTS_MS : PHOTO_MS;
    var made = render(item);
    var node = made.node;
    var pic = node.firstChild;
    pic.style.webkitAnimationDuration = (dur + 2600) + 'ms';
    pic.style.animationDuration = (dur + 2600) + 'ms';
    preload(made.srcs, function () {
      // The old slide's words fade out first, then the pictures crossfade,
      // then the new words come in (see lobby.css), so two captions never overlap.
      var old = [];
      for (var k = 0; k < slidesEl.childNodes.length; k++) if (slidesEl.childNodes[k].nodeType === 1) old.push(slidesEl.childNodes[k]);
      for (k = 0; k < old.length; k++) addClass(old[k], 'is-leaving');
      slidesEl.appendChild(node);
      void node.offsetWidth;
      setTimeout(function () { raf(function () { addClass(node, 'is-on'); }); }, old.length ? 500 : 0);
      setTimeout(function () { for (var j = 0; j < old.length; j++) if (old[j].parentNode) old[j].parentNode.removeChild(old[j]); }, 2600);
      setTimeout(next, dur);
    });
  }

  paintWeather();
  buildTicker();
  load();
  // The welcome in the page is the first slide; the rest follow it.
  setTimeout(function () { list = playlist(); at = 1; next(); }, PHOTO_MS);
  setInterval(load, REFRESH_MS);
  // Reload only when the site answers, so a dropped connection never leaves a blank screen.
  setInterval(function () {
    request('HEAD', '/lobby/', function (ok) { if (ok) window.location.reload(); });
  }, RELOAD_MS);
}());
