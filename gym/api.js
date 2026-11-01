const TOKEN_KEY = 'thinMuscleAuthToken';

export const token = () => localStorage.getItem(TOKEN_KEY) || '';

export async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (options.method === 'POST' && /\/complete$/.test(url)) window.dispatchEvent(new Event('training-records-changed'));
  return data;
}

export async function privateImageUrl(url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!response.ok) throw new Error('image_unavailable');
  return URL.createObjectURL(await response.blob());
}

export const jsonBody = (value) => JSON.stringify(value);

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[ch]);

export const formatDate = (value, includeTime = false) => value
  ? new Date(value).toLocaleString('zh-CN', includeTime ? {} : { dateStyle: 'medium' })
  : '—';

export function revokeRenderedImages(container, state) {
  for (const image of container.querySelectorAll('img[data-object-url]')) URL.revokeObjectURL(image.dataset.objectUrl);
  state.objectUrls ||= new Set();
  for (const objectUrl of state.objectUrls) URL.revokeObjectURL(objectUrl);
  state.objectUrls.clear();
}

export async function attachPrivateImages(container, state) {
  state.objectUrls ||= new Set();
  const images = [...container.querySelectorAll('img[data-private-src]')];
  await Promise.all(images.map(async (image) => {
    try {
      const objectUrl = await privateImageUrl(image.dataset.privateSrc);
      state.objectUrls.add(objectUrl);
      image.src = objectUrl;
      image.dataset.objectUrl = objectUrl;
      image.classList.add('image-ready');
    } catch {
      image.alt = '图片暂不可见';
      image.classList.add('image-error');
    }
  }));
}
