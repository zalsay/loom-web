const $ = (selector) => document.querySelector(selector);
const features = {
  launcher: {
    caption: '常用的应用，都在这里。',
    html: `<p class="device-greeting">想用哪个小工具？</p><p class="device-subtitle">打开首页，就能找到。</p><div class="app-grid"><div><span class="app-icon reader">▤</span>网页阅读器</div><div><span class="app-icon diagnostics">⌘</span>检查设备</div><div><span class="app-icon farm">♧</span>种植助手</div><div><span class="app-icon settings">⚙</span>系统设置</div></div><p class="device-bottom-note">应用首页示意</p>`,
  },
  apis: {
    caption: '保存自己的内容，用上设备支持的功能。',
    html: `<p class="device-greeting">小应用能做什么？</p><p class="device-subtitle">按需要，使用设备功能。</p><div class="api-rows"><div><span>▣ &nbsp; 保存内容</span><small>各自存放</small></div><div><span>◷ &nbsp; 定时任务</span><small>到时间再执行</small></div><div><span>⌘ &nbsp; 读取传感器</span><small>需要设备支持</small></div><div><span>↗ &nbsp; 联网与智能功能</span><small>先查看使用说明</small></div></div><p class="device-bottom-note">功能示意</p>`,
  },
  updates: {
    caption: '更新后如果无法启动，可以恢复到更新前。',
    html: `<p class="device-greeting">更新应用</p><p class="device-subtitle">启动顺利就继续，遇到问题可恢复。</p><div class="update-flow"><div><i>01</i><span>先检查<small>检查更新文件</small></span><b>✓</b></div><div><i>02</i><span>打开应用<small>启动更新后的应用</small></span><b>↓</b></div><div><i>03</i><span>继续用，或恢复<small>启动失败时恢复到更新前</small></span><b>↗</b></div></div><p class="device-bottom-note">更新过程示意</p>`,
  },
};
function activateFeature(key) {
  document.querySelectorAll('[data-feature]').forEach((button) => {
    const selected = button.dataset.feature === key;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', selected);
    button.tabIndex = selected ? 0 : -1;
  });
  $('#device-content').innerHTML = features[key].html;
  $('#feature-caption').textContent = features[key].caption;
  $('#feature-display').setAttribute('aria-labelledby', `tab-${key}`);
}
document
  .querySelectorAll('[data-feature]')
  .forEach((button) =>
    button.addEventListener('click', () => activateFeature(button.dataset.feature)),
  );
activateFeature('launcher');
const examples = {
  lua: `return {\n  on_create = function(ctx, args)\n    local lv, root = ctx.ui.lv, ctx.ui.root\n\n    root:set_style({\n      bg_color = "#101820",\n      bg_opa = 255, pad = 18\n    })\n\n    lv.label(root, {\n      text = "你好，Loom OS",\n      w = 420, text_color = "#ffffff"\n    })\n  end\n}`,
  manifest: JSON.stringify(
    {
      schema: 1,
      api: '0.1',
      id: 'org.loom-os.hello',
      name: 'Hello Loom',
      version: '0.1.0',
      entry: 'main.lua',
      min_loom_os: '0.1.0',
      permissions: {},
    },
    null,
    2,
  ),
};
let currentCode = 'lua';
function activateCode(key) {
  currentCode = key;
  document.querySelectorAll('[data-code]').forEach((button) => {
    const selected = button.dataset.code === key;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', selected);
    button.tabIndex = selected ? 0 : -1;
  });
  $('#example-code').textContent = examples[key];
  $('#code-panel').setAttribute('aria-labelledby', `code-${key}`);
}
document
  .querySelectorAll('[data-code]')
  .forEach((button) => button.addEventListener('click', () => activateCode(button.dataset.code)));
activateCode('lua');
// Standard roving tab focus for both tab sets.
document.querySelectorAll('[role="tablist"]').forEach((list) =>
  list.addEventListener('keydown', (event) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  }),
);
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 2700);
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const success = document.execCommand('copy');
    area.remove();
    if (!success) {
      toast('请选中文本后复制');
      return;
    }
  }
  toast('复制好了');
}
$('#copy-example').addEventListener('click', () => copy(examples[currentCode]));
$('#copy-clone').addEventListener('click', () =>
  copy('git clone https://github.com/zalsay/loom-os.git'),
);
const menu = $('.menu-button'),
  mobileNav = $('#mobile-nav');
function setMobileMenu(open, { restoreFocus = false } = {}) {
  menu.setAttribute('aria-expanded', open);
  menu.setAttribute('aria-label', open ? '收起导航' : '展开导航');
  mobileNav.hidden = !open;
  menu.textContent = open ? '✕' : '☰';
  if (restoreFocus) menu.focus({ preventScroll: true });
}
menu.addEventListener('click', () => {
  setMobileMenu(menu.getAttribute('aria-expanded') !== 'true');
});
mobileNav.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  setMobileMenu(false);
  if (link.hash && new URL(link.href).pathname === location.pathname) {
    const destination = document.querySelector(link.hash);
    if (destination) {
      destination.tabIndex = -1;
      destination.focus({ preventScroll: true });
    }
  }
});
document.addEventListener('pointerdown', (event) => {
  if (
    menu.getAttribute('aria-expanded') === 'true' &&
    !menu.contains(event.target) &&
    !mobileNav.contains(event.target)
  ) {
    setMobileMenu(false);
  }
});
const mobileMenuBreakpoint = window.matchMedia('(max-width: 900px)');
mobileMenuBreakpoint.addEventListener('change', (event) => {
  if (!event.matches) setMobileMenu(false);
});
const stage = $('#world-stage'),
  enter = $('#world-enter'),
  close = $('#world-close');
const sceneFrames = [...stage.querySelectorAll('iframe[data-scene]')];
const sceneLoading = $('#world-loading');
const sceneLoadingMarkup = sceneLoading.innerHTML;
let frame = sceneFrames[0];
let stageVisible = true;

function syncSceneFrames() {
  sceneFrames.forEach((sceneFrame) => {
    const active = sceneFrame === frame;
    sceneFrame.setAttribute('aria-hidden', String(!active));
    sceneFrame.inert = !active;
    sceneFrame.tabIndex = active && isWorldOpen ? 0 : -1;
    sceneFrame.contentWindow?.postMessage(
      { type: 'loom-world-mode', interactive: active && isWorldOpen },
      location.origin,
    );
    sceneFrame.contentWindow?.postMessage(
      {
        type: 'loom-world-visibility',
        visible: active && !document.hidden && (isWorldOpen || stageVisible),
      },
      location.origin,
    );
  });
}
function loadScene(sceneFrame) {
  if (!sceneFrame.hasAttribute('src') && sceneFrame.dataset.src)
    sceneFrame.src = sceneFrame.dataset.src;
}
function updateSceneLoading() {
  sceneLoading.classList.toggle('loaded', frame.dataset.ready === 'true');
  if (frame.dataset.ready === 'error') {
    const link = document.createElement('a');
    link.className = 'text-link';
    link.href = new URL(frame.src).pathname;
    link.textContent = '暂时没打开，点击重新打开 ↗';
    sceneLoading.replaceChildren(link);
  } else if (frame.dataset.ready !== 'true') {
    sceneLoading.innerHTML = sceneLoadingMarkup;
  }
}

let isWorldOpen = false,
  previousFocus,
  previousScrollY = 0;
const backgroundElements = [
  ...document.querySelectorAll(
    'body > :not(main):not(script):not(#toast), main > :not(.hero), .hero > :not(#world-stage)',
  ),
];
function setWorld(open) {
  if (open === isWorldOpen) return;
  isWorldOpen = open;
  if (open) {
    if (menu.getAttribute('aria-expanded') === 'true') setMobileMenu(false);
    previousFocus = enter;
    previousScrollY = window.scrollY;
    document.body.style.top = `-${previousScrollY}px`;
    document.body.classList.add('world-open');
    document.documentElement.classList.add('world-open');
  } else {
    document.body.classList.remove('world-open');
    document.documentElement.classList.remove('world-open');
    document.body.style.removeProperty('top');
    window.scrollTo({ top: previousScrollY, behavior: 'instant' });
  }
  stage.classList.toggle('is-open', open);
  $('.world-overlay-controls').hidden = !open;
  frame.tabIndex = open ? 0 : -1;
  backgroundElements.forEach((element) => {
    element.inert = open;
  });
  syncSceneFrames();
  if (open) stopHeroCarousel();
  else startHeroCarousel();
  if (open) {
    stage.setAttribute('role', 'dialog');
    stage.setAttribute('aria-modal', 'true');
    stage.setAttribute('aria-label', '织界空间');
    close.focus();
  } else {
    stage.removeAttribute('role');
    stage.removeAttribute('aria-modal');
    stage.removeAttribute('aria-label');
    previousFocus?.focus({ preventScroll: true });
  }
}
enter.addEventListener('click', () => {
  if (currentHeroSlide === 1) {
    location.href = './farm.html';
  } else {
    setWorld(true);
  }
});
close.addEventListener('click', () => setWorld(false));
frame.tabIndex = -1;
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin) return;
  const sourceFrame = sceneFrames.find((item) => item.contentWindow === event.source);
  if (!sourceFrame) return;
  if (event.data?.type === 'loom-world-ready') {
    sourceFrame.dataset.ready = 'true';
    // Preload the other scene after the first render, without reloading either document.
    sceneFrames.forEach(loadScene);
    syncSceneFrames();
    updateSceneLoading();
    startHeroCarousel();
  }
  if (event.data?.type === 'loom-world-close' && sourceFrame === frame) setWorld(false);
  if (event.data?.type === 'loom-world-error') {
    sourceFrame.dataset.ready = 'error';
    stopHeroCarousel();
    if (sourceFrame === frame) updateSceneLoading();
  }
});
document.addEventListener('keydown', (event) => {
  if (isWorldOpen) {
    if (event.key === 'Escape') setWorld(false);
    if (event.key === 'Tab' && document.activeElement === close) {
      event.preventDefault();
      frame.focus();
    }
    return;
  }
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
    event.preventDefault();
    setMobileMenu(false, { restoreFocus: true });
  }
});
sceneFrames.forEach((sceneFrame) => {
  sceneFrame.addEventListener('load', syncSceneFrames);
});
new IntersectionObserver(
  (entries) => {
    stageVisible = entries[0].isIntersecting;
    syncSceneFrames();
    if (stageVisible) startHeroCarousel();
    else stopHeroCarousel();
  },
  { rootMargin: '200px' },
).observe(stage);
document.addEventListener('visibilitychange', () => {
  syncSceneFrames();
  if (document.hidden) stopHeroCarousel();
  else startHeroCarousel();
});

// 首页主题介绍轮播：0 = 织界·AiLab，1 = 织界·农场
const heroSlides = [
  {
    pillText: '认识 Loom OS',
    pillHref: '#progress',
    eyebrow: '给小设备准备的一套应用系统 · AILAB',
    title: '让小设备，<br />有自己的<span class="serif-accent">应用。</span>',
    description:
      'Loom OS 让 Mosaico 这样的小设备，<br />也能像手机一样，点图标打开小工具。<br />从阅读文字、调整设置开始。',
    primaryText: '看看能做什么',
    primaryHref: '#possibilities',
    secondaryText: '了解怎么使用',
    secondaryHref: '#start',
    footnote: '读一页文字，调一下设置。<br /><span>从身边用得上的小工具开始。</span>',
    topline: '织界 · AiLab',
    worldCoord: '来织界空间逛一逛。',
    worldSublinkText: '创建我的空间，按喜欢的样子布置 ↗',
    worldSublinkHref: './create.html',
  },
  {
    pillText: '走进织界农场',
    pillHref: './farm.html',
    eyebrow: '给孩子的想法找一块真实的土地 · FARM',
    title: '找一块土地，<br />做真正有用的<span class="serif-accent">装置。</span>',
    description:
      '在这里逛逛孩子们的 3m×3m 种植区，看看共用控制室和 G 老师大屏。<br />跟着田间小车，发现种植中的问题与动手尝试。',
    primaryText: '进入农场',
    primaryHref: './farm.html',
    secondaryText: '逛逛织界实验室',
    secondaryHref: './world.html',
    footnote:
      '现场遇到问题 → G 老师分析 → 孩子动手尝试。<br /><span>同一个地块与作品，记录整整一季的变化。</span>',
    topline: '织界 · 农场',
    worldCoord: '来织界农场看一看。',
    worldSublinkText: '看看种植区与共用控制室 ↗',
    worldSublinkHref: './farm.html',
  },
];

let currentHeroSlide = 0;
let heroCarouselTimer = null;
let heroTransitionTimer = null;
const carouselHolds = new Set();
const heroContent = $('#hero-carousel-content');
const heroTabs = document.querySelectorAll('.hero-carousel-tab');

function switchHeroSlide(index) {
  if (!heroContent || isWorldOpen || !heroSlides[index]) return;
  stopHeroCarousel();
  if (heroTransitionTimer !== null) clearTimeout(heroTransitionTimer);
  currentHeroSlide = index;
  frame = sceneFrames[index];
  loadScene(frame);
  syncSceneFrames();
  updateSceneLoading();

  heroTabs.forEach((tab, i) => {
    const active = i === index;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  heroContent.classList.add('switching');
  heroTransitionTimer = setTimeout(() => {
    heroTransitionTimer = null;
    const data = heroSlides[index];
    const pillText = $('#hero-pill-text');
    const pill = $('#hero-pill');
    const eyebrow = $('#hero-eyebrow');
    const title = $('#hero-title');
    const desc = $('.hero-description');
    const primary = $('#hero-action-primary');
    const secondary = $('#hero-action-secondary');
    const footnoteText = $('#hero-footnote-text');

    if (pillText) pillText.textContent = data.pillText;
    if (pill) pill.href = data.pillHref;
    if (eyebrow) eyebrow.textContent = data.eyebrow;
    if (title) title.innerHTML = data.title;
    if (desc) desc.innerHTML = data.description;
    if (primary) {
      primary.href = data.primaryHref;
      const sp = primary.querySelector('span');
      if (sp) sp.textContent = data.primaryText;
    }
    if (secondary) {
      secondary.href = data.secondaryHref;
      const sp = secondary.querySelector('span');
      if (sp) sp.textContent = data.secondaryText;
    }
    if (footnoteText) footnoteText.innerHTML = data.footnote;

    const toplineLabel = $('.world-topline span:first-child');
    if (toplineLabel) toplineLabel.innerHTML = `<i></i>${data.topline}`;

    const worldCoord = $('#world-coordinate');
    const worldSublink = $('#world-sublink');
    const enterText = $('#world-enter-text');
    if (worldCoord) worldCoord.textContent = data.worldCoord;
    if (worldSublink) {
      worldSublink.textContent = data.worldSublinkText;
      worldSublink.href = data.worldSublinkHref;
    }
    if (enterText) enterText.textContent = `进入 ${data.topline}`;
    if (enter) enter.setAttribute('aria-label', `进入 ${data.topline}`);

    heroContent.dataset.active = String(index);
    heroContent.classList.remove('switching');
    startHeroCarousel();
  }, 160);
}

function startHeroCarousel() {
  stopHeroCarousel();
  if (
    isWorldOpen ||
    document.hidden ||
    !stageVisible ||
    carouselHolds.size ||
    heroTransitionTimer !== null ||
    stage.contains(document.activeElement) ||
    $('.hero-copy')?.contains(document.activeElement) ||
    sceneFrames.some((item) => item.dataset.ready !== 'true')
  )
    return;
  heroCarouselTimer = setTimeout(() => {
    heroCarouselTimer = null;
    switchHeroSlide((currentHeroSlide + 1) % heroSlides.length);
  }, 6500);
}

function stopHeroCarousel() {
  if (heroCarouselTimer !== null) {
    clearTimeout(heroCarouselTimer);
    heroCarouselTimer = null;
  }
}

heroTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const idx = Number(tab.dataset.heroSlide);
    switchHeroSlide(idx);
  });
});

for (const element of [$('.hero-copy'), stage]) {
  if (!element) continue;
  element.addEventListener('pointerenter', () => {
    carouselHolds.add(element);
    stopHeroCarousel();
  });
  element.addEventListener('pointerleave', () => {
    carouselHolds.delete(element);
    startHeroCarousel();
  });
  element.addEventListener('focusin', stopHeroCarousel);
  element.addEventListener('focusout', () => {
    // Wait for the next focus target before deciding whether to resume.
    queueMicrotask(() => {
      if (!element.contains(document.activeElement)) startHeroCarousel();
    });
  });
}

startHeroCarousel();
