const button = document.querySelector(".menu-button");
const sidebar = document.querySelector(".sidebar");

button?.addEventListener("click", () => {
  const open = document.body.classList.toggle("nav-open");
  button.setAttribute("aria-expanded", String(open));
  button.setAttribute("aria-label", open ? "Close documentation navigation" : "Open documentation navigation");
});

sidebar?.addEventListener("click", (event) => {
  if (!(event.target instanceof HTMLAnchorElement)) return;
  document.body.classList.remove("nav-open");
  button?.setAttribute("aria-expanded", "false");
});