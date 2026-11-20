const installButton = document.querySelector('#install-web');
const installMessage = document.querySelector('#install-message');
let pendingInstall;

const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const apple = /iPhone|iPad/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (!standalone && (apple || /Android/i.test(navigator.userAgent))) installButton.hidden = false;

window.addEventListener('beforeinstallprompt', event => {
  if (standalone) return;
  event.preventDefault();
  pendingInstall = event;
  installButton.hidden = false;
});

window.addEventListener('appinstalled', () => {
  pendingInstall = null;
  installButton.hidden = true;
  installMessage.hidden = true;
});

installButton.addEventListener('click', async () => {
  if (pendingInstall) {
    const prompt = pendingInstall;
    pendingInstall = null;
    await prompt.prompt();
    return;
  }
  installMessage.textContent = apple
    ? 'In Safari, tap Share, then Add to Home Screen.'
    : 'Open the browser menu and choose Install app or Add to Home screen.';
  installMessage.hidden = false;
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
