// Included by every admin tool page. Redirects to login.html if there's
// no session, and wraps fetch so 401s (expired/invalid session) also
// bounce back to login instead of showing a confusing raw error.
window.ADMIN_SESSION_KEY = 'asrs_super_admin_session';

window.requireAdminSession = function () {
  const token = localStorage.getItem(window.ADMIN_SESSION_KEY);
  if (!token) {
    window.location.href = '/admin/login.html';
    return null;
  }
  return token;
};

window.adminFetch = async function (path, options) {
  options = options || {};
  const token = localStorage.getItem(window.ADMIN_SESSION_KEY);
  const headers = Object.assign({}, options.headers || {}, { Authorization: 'Bearer ' + token });
  const res = await fetch(path, Object.assign({}, options, { headers: headers }));
  if (res.status === 401) {
    localStorage.removeItem(window.ADMIN_SESSION_KEY);
    window.location.href = '/admin/login.html';
    throw new Error('Session expired.');
  }
  return res;
};
