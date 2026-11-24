/* Contact links on the policy pages: go back to the site and open the feedback panel. */
document.querySelectorAll('[data-contact]').forEach((a) => {
  a.addEventListener('click', (e) => { e.preventDefault(); location.href = '/?contact=1'; });
});

document.querySelectorAll('[data-view-link]').forEach((a) => {
  a.addEventListener('click', (e) => { e.preventDefault(); location.href = '/?view=' + a.dataset.viewLink; });
});
