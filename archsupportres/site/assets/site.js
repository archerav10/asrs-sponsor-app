// archsupportres.com — shared behavior: mobile menu, photo lightbox,
// "I'm Interested" popup, and Netlify Form submission for every
// <form data-netlify> on the page (each submission is emailed to Anthony).
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) toggle.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // Lightbox for gallery photos
  var box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = '<img alt="">';
  document.body.appendChild(box);
  document.querySelectorAll('.gallery img').forEach(function (img) {
    img.addEventListener('click', function () { box.querySelector('img').src = img.src; box.querySelector('img').alt = img.alt; box.classList.add('open'); });
  });
  box.addEventListener('click', function () { box.classList.remove('open'); });

  // Popup forms
  document.querySelectorAll('[data-open-modal]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      var m = document.getElementById(el.getAttribute('data-open-modal'));
      if (!m) return;
      e.preventDefault(); m.classList.add('open');
      var first = m.querySelector('input:not([type=hidden]):not([name=bot-field])'); if (first) first.focus();
    });
  });
  document.querySelectorAll('.modal').forEach(function (m) {
    m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('open'); });
    var c = m.querySelector('.modal-close'); if (c) c.addEventListener('click', function () { m.classList.remove('open'); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { document.querySelectorAll('.modal.open, .lightbox.open').forEach(function (m) { m.classList.remove('open'); }); }
  });

  // Netlify Forms
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  document.querySelectorAll('form[data-netlify]').forEach(function (form) {
    var status = form.querySelector('.form-status');
    var btn = form.querySelector('button[type=submit]');
    var label = btn ? btn.textContent : '';
    function fail(msg, el) { status.textContent = msg; status.className = 'form-status err'; if (el) el.focus(); }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      status.textContent = ''; status.className = 'form-status';
      var req = form.querySelectorAll('[data-required]');
      for (var i = 0; i < req.length; i++) {
        var el = req[i];
        if (el.type === 'radio') {
          if (!form.querySelector('input[name="' + el.name + '"]:checked')) return fail('Please answer: ' + el.getAttribute('data-required'));
        } else if (el.type === 'checkbox') {
          if (!el.checked) return fail(el.getAttribute('data-required'), el);
        } else if (!el.value.trim()) {
          return fail('Please fill in: ' + el.getAttribute('data-required'), el);
        }
      }
      var email = form.querySelector('input[type=email]');
      var phone = form.querySelector('input[type=tel]');
      if (form.hasAttribute('data-email-or-phone') && !(email && email.value.trim()) && !(phone && phone.value.trim()))
        return fail('Please enter an email address or a phone number so we can reach you.');
      if (email && email.value.trim() && !EMAIL.test(email.value.trim())) return fail('That email address doesn’t look right.', email);
      if (phone && phone.value.trim() && phone.value.replace(/\D/g, '').length < 10) return fail('Please enter a 10-digit phone number.', phone);
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)).toString()
      }).then(function (res) {
        if (!res.ok) throw new Error('bad status');
        form.style.display = 'none';
        var thanks = form.parentNode.querySelector('.form-thanks');
        if (thanks) thanks.style.display = 'block';
      }).catch(function () {
        fail('Something went wrong. Please call or text (804) 399-9709 instead.');
        if (btn) { btn.disabled = false; btn.textContent = label; }
      });
    });
  });
})();
