for (const link of document.querySelectorAll('a[href]')) {
  if (
    (link.protocol === 'https:' || link.protocol === 'http:') &&
    link.origin !== window.location.origin
  ) {
    link.target = '_blank';
    link.relList.add('noopener');
  }
}

const sections = [...document.querySelectorAll('.documentation h2[id]')];
const mobileContents = document.querySelector('.mobile-contents');

function populateContents(list) {
  return sections.map((section) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = '#' + encodeURIComponent(section.id);
    link.textContent = section.textContent.trim();
    item.append(link);
    list.append(item);
    return link;
  });
}

const desktopLinks = populateContents(document.querySelector('.sidebar .contents ul'));
populateContents(mobileContents.querySelector('.contents ul'));

function updateCurrentSection() {
  if (!sections.length) return;
  const offset = Number.parseFloat(getComputedStyle(sections[0]).scrollMarginTop);
  let currentIndex = 0;
  for (const [index, section] of sections.entries()) {
    if (section.getBoundingClientRect().top > offset + 12) break;
    currentIndex = index;
  }
  if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1) {
    currentIndex = desktopLinks.length - 1;
  }
  for (const [index, link] of desktopLinks.entries()) {
    if (index === currentIndex) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

let frame;
window.addEventListener(
  'scroll',
  () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      updateCurrentSection();
    });
  },
  { passive: true },
);
window.addEventListener('resize', updateCurrentSection);
updateCurrentSection();

mobileContents.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  mobileContents.open = false;
  const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
});

mobileContents.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !mobileContents.open) return;
  mobileContents.open = false;
  mobileContents.querySelector('summary').focus();
});

const transcriptLink = document.querySelector('.hero-transcript-link');
const transcriptDialog = document.getElementById('video-transcript');

transcriptLink.addEventListener('click', () => {
  transcriptLink.focus({ preventScroll: true });
  transcriptDialog.showModal();
});

transcriptDialog.addEventListener('click', (event) => {
  if (event.target.closest('a[href^="#"]')) transcriptDialog.close();
});

const githubWidget = document.querySelector('.github-widget');
async function loadGitHubCounts(apiUrl) {
  const response = await fetch(apiUrl);
  if (!response.ok) return;
  const { stargazers_count: stars, forks_count: forks } = await response.json();
  if (!Number.isSafeInteger(stars) || !Number.isSafeInteger(forks)) return;
  const format = new Intl.NumberFormat(document.documentElement.lang || undefined);
  for (const [name, count] of [['star', stars], ['fork', forks]]) {
    const value = githubWidget.querySelector(`[data-github-${name}s]`);
    const label = document.createElement('span');
    label.className = 'github-widget-stat-label';
    label.textContent = ' ' + (count === 1 ? value.dataset.singular : value.dataset.plural);
    value.replaceChildren(format.format(count), label);
  }
}

async function loadGitHubRelease(apiUrl) {
  const response = await fetch(apiUrl + '/releases/latest');
  if (!response.ok) return;
  const { tag_name: tag } = await response.json();
  if (typeof tag === 'string' && tag.trim())
    githubWidget.querySelector('[data-github-release]').textContent = tag;
}

// Keep the repository link and known release visible when the API is unavailable.
if (githubWidget) {
  const apiUrl = 'https://api.github.com/repos' + new URL(githubWidget.href).pathname;
  loadGitHubCounts(apiUrl).catch(() => {});
  loadGitHubRelease(apiUrl).catch(() => {});
}
