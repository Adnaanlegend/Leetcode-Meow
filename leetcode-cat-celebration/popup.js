const enabledEl = document.getElementById('enabled');
const soundEl = document.getElementById('sound');

chrome.storage.sync.get({ enabled: true, sound: true }, (settings) => {
  enabledEl.checked = settings.enabled;
  soundEl.checked = settings.sound;
});

enabledEl.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: enabledEl.checked });
});

soundEl.addEventListener('change', () => {
  chrome.storage.sync.set({ sound: soundEl.checked });
});
