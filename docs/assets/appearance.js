(() => {
  const key = 'thingsmd-appearance';
  const root = document.documentElement;
  const themeColors = document.querySelectorAll('meta[data-appearance-color]');

  function appearanceMedia(appearance, scheme) {
    if (appearance === 'system') return `(prefers-color-scheme: ${scheme})`;
    return appearance === scheme ? 'all' : 'not all';
  }

  function applyAppearance(appearance) {
    if (appearance === 'system') delete root.dataset.appearance;
    else root.dataset.appearance = appearance;

    for (const meta of themeColors) {
      meta.media = appearanceMedia(appearance, meta.dataset.appearanceColor);
    }
  }

  let appearance = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') appearance = saved;
  } catch {
    // The system setting also works when storage is unavailable.
  }
  applyAppearance(appearance);

  document.addEventListener('DOMContentLoaded', () => {
    const switcher = document.querySelector('.appearance-switcher');
    const prefersDark = matchMedia('(prefers-color-scheme: dark)');
    const video = document.querySelector('video[data-light-poster]');
    const sources = Array.from(video.querySelectorAll('source'), source => ({
      element: source,
      dark: source.getAttribute('src'),
      light: source.dataset.lightSrc,
    }));
    let videoAppearance = 'dark';

    function updateVideo() {
      const systemTheme = prefersDark.matches ? 'dark' : 'light';
      const theme = appearance === 'system' ? systemTheme : appearance;
      if (theme === videoAppearance) {
        if (!video.hasAttribute('poster')) video.poster = video.dataset.darkPoster;
        return;
      }

      const position = video.currentTime;
      const wasPlaying = !video.paused;
      videoAppearance = theme;
      video.poster = video.dataset[theme + 'Poster'];
      for (const source of sources) source.element.src = source[theme];
      video.load();
      if (position > 0) video.currentTime = position;
      if (wasPlaying) video.play().catch(() => {});
    }

    const lightScreenshots = document.querySelectorAll('[data-light-screenshot]');
    function updateScreenshots() {
      const media = appearanceMedia(appearance, 'light');
      for (const source of lightScreenshots) source.media = media;
    }

    function nextAppearance() {
      const systemTheme = prefersDark.matches ? 'dark' : 'light';
      if (appearance === systemTheme) return 'system';
      if (appearance === 'system') return prefersDark.matches ? 'light' : 'dark';
      return systemTheme;
    }

    function updateSwitcher() {
      const next = nextAppearance();
      const label = switcher.dataset[next];
      switcher.setAttribute('aria-label', label);
      switcher.title = label;
      for (const icon of switcher.querySelectorAll('[data-appearance-icon]'))
        icon.toggleAttribute('hidden', icon.dataset.appearanceIcon !== next);
    }

    updateSwitcher();
    updateScreenshots();
    updateVideo();
    switcher.hidden = false;
    prefersDark.addEventListener('change', () => {
      updateSwitcher();
      updateVideo();
    });
    switcher.addEventListener('click', () => {
      appearance = nextAppearance();
      applyAppearance(appearance);
      updateScreenshots();
      updateSwitcher();
      updateVideo();
      try {
        if (appearance === 'system') localStorage.removeItem(key);
        else localStorage.setItem(key, appearance);
      } catch {
        // The choice still applies to the current page.
      }
    });
  });
})();
