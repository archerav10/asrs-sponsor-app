// Shared behavior for /vacancy/<street>/ pages: the "I'm Interested" /
// "Email Us" popup (a Netlify Form — each submission is emailed to
// Anthony), and on laptops the flyer opens the popup instead of texting.
(function () {
  var modal = document.getElementById('interestModal');
  var form = document.getElementById('interestForm');
  if (!modal || !form) return;
  var statusEl = document.getElementById('formStatus');
  var submitBtn = document.getElementById('formSubmit');
  var isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)');

  function openModal() { modal.classList.add('open'); document.getElementById('fName').focus(); }
  function closeModal() { modal.classList.remove('open'); }

  document.querySelectorAll('[data-open-interest]').forEach(function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); openModal(); });
  });
  var flyerLink = document.querySelector('.flyer a');
  if (flyerLink) flyerLink.addEventListener('click', function (e) {
    if (isDesktop.matches) { e.preventDefault(); openModal(); }
  });
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  function fail(msg, focusId) {
    statusEl.textContent = msg; statusEl.className = 'status err';
    if (focusId) document.getElementById(focusId).focus();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    statusEl.textContent = ''; statusEl.className = 'status';
    var name = document.getElementById('fName').value.trim();
    var email = document.getElementById('fEmail').value.trim();
    var phone = document.getElementById('fPhone').value.trim();
    if (!name) return fail('Please enter your name.', 'fName');
    if (!email && !phone) return fail('Please enter an email address or a phone number (at least one) so we can reach you.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That email address doesn’t look right.', 'fEmail');
    if (phone && phone.replace(/\D/g, '').length < 10) return fail('Please enter a 10-digit phone number.', 'fPhone');
    submitBtn.disabled = true; submitBtn.textContent = 'Sending…';
    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)).toString()
    }).then(function (res) {
      if (!res.ok) throw new Error('bad status');
      document.getElementById('formWrap').style.display = 'none';
      document.getElementById('formThanks').style.display = 'block';
    }).catch(function () {
      fail('Something went wrong. Please call or text (804) 399-9709 instead.');
      submitBtn.disabled = false; submitBtn.textContent = 'Send';
    });
  });
})();
