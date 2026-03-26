import { ADMIN_SESSION_KEY, getIdentityToken, hasAdminRole } from './auth.js';
import { isArchivedEvent } from './event-status.mjs';
import { normalizeEventLanguage } from './language.mjs';
import { resolveAdminSession } from './admin-session.mjs';
import { fileToOptimizedDataUrl } from './image-optimizer.mjs';
import {
  buildLocalEventId,
  fetchMergedLocalEvents,
  findMergedEventById,
  getLocalEvents,
  upsertLocalEvent
} from './local-events.js';

export const initEventForm = ({ formatMessage, getVerificationState, publishState }) => {
  const multiStepForm = document.querySelector('.multi-step');
  if (!multiStepForm) return;

  const previewTitle = document.querySelector('#preview-title');
  const previewOrganizer = document.querySelector('#preview-organizer');
  const previewDescription = document.querySelector('#preview-description');
  const previewTags = document.querySelector('#preview-tags');
  const previewTime = document.querySelector('#preview-time');
  const previewLocation = document.querySelector('#preview-location');
  const previewTickets = document.querySelector('#preview-tickets');
  const previewFormat = document.querySelector('#preview-format');
  const previewLanguage = document.querySelector('#preview-language');
  const previewImage = document.querySelector('#preview-image');
  const formatSelect = multiStepForm.querySelector('select[name="format"]');
  const imageInput = multiStepForm.querySelector('input[name="image"]');
  const imageAltInput = multiStepForm.querySelector('input[name="image-alt"]');
  const contactNameField = multiStepForm.querySelector('input[name="contact-name"]');
  const descriptionField = multiStepForm.querySelector('textarea[name="description"]');
  const cityField = multiStepForm.querySelector('input[name="city"]');
  const tagsInput = multiStepForm.querySelector('.tags-input__field');
  const tagsList = multiStepForm.querySelector('.tags-input__list');
  const tagsHidden = multiStepForm.querySelector('input[name="tags"]');
  const tagsSuggestions = multiStepForm.querySelector('[data-tag-suggestions]');
  const statusField = multiStepForm.querySelector('input[name="status"]');
  const verificationBanner = multiStepForm.querySelector('[data-verification-banner]');
  const verificationBannerButton = multiStepForm.querySelector('[data-action="open-verification"]');
  const honeypotField = multiStepForm.querySelector('input[name="website"]');
  const pendingTags = new Set();
  const knownTagsByKey = new Map();
  const publishButton = multiStepForm.querySelector('button[type="submit"]');
  const verificationWarning = multiStepForm.querySelector('[data-verification-warning]');
  const submitStatus = multiStepForm.querySelector('[data-submit-status]');
  const organizerId = multiStepForm.dataset.organizerId || 'org-001';
  let previewImageUrl = null;
  let imageOptimizationInFlight = false;
  let imageSelectionVersion = 0;
  let identityUser = null;
  let editingEventId = null;
  let editingEventData = null;

  const isAdminBypass = () => {
    if (identityUser && hasAdminRole(identityUser)) return true;
    const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    if (!isLocalHost) return false;
    try {
      return localStorage.getItem(ADMIN_SESSION_KEY) === '1';
    } catch (error) {
      return false;
    }
  };

  const getTagsRequiredMessage = () =>
    formatMessage('form_tags_required', {}) || 'Add at least one tag.';

  const normalizeTagLabel = (value) => String(value || '').trim().replace(/\s+/g, ' ');
  const normalizeTagKey = (value) => normalizeTagLabel(value).toLocaleLowerCase('uk-UA');

  const getTagLabel = (tag) =>
    normalizeTagLabel(typeof tag === 'string' ? tag : tag?.label || '');

  const hasPendingTagKey = (key) =>
    Array.from(pendingTags).some((tag) => normalizeTagKey(tag) === key);

  const rememberTag = (rawValue) => {
    const label = normalizeTagLabel(rawValue);
    if (!label) return;
    const key = normalizeTagKey(label);
    if (!knownTagsByKey.has(key)) {
      knownTagsByKey.set(key, label);
    }
  };

  const addPendingTag = (rawValue) => {
    const label = normalizeTagLabel(rawValue);
    if (!label) return;
    rememberTag(label);
    const key = normalizeTagKey(label);
    if (hasPendingTagKey(key)) return;
    pendingTags.add(knownTagsByKey.get(key) || label);
  };

  const renderTagSuggestions = (inputValue = '') => {
    if (!(tagsSuggestions instanceof HTMLDataListElement)) return;
    const term = normalizeTagKey(inputValue);
    if (term.length < 2) {
      tagsSuggestions.innerHTML = '';
      return;
    }
    const options = Array.from(knownTagsByKey.values())
      .filter((label) => !hasPendingTagKey(normalizeTagKey(label)))
      .filter((label) => normalizeTagKey(label).includes(term))
      .sort((a, b) => {
        const aKey = normalizeTagKey(a);
        const bKey = normalizeTagKey(b);
        const aStarts = aKey.startsWith(term) ? 0 : 1;
        const bStarts = bKey.startsWith(term) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.localeCompare(b, 'uk');
      })
      .slice(0, 12);
    tagsSuggestions.innerHTML = options
      .map((label) => `<option value="${label.replace(/"/g, '&quot;')}"></option>`)
      .join('');
  };

  const loadKnownTags = async () => {
    try {
      const events = await fetchMergedLocalEvents();
      if (!Array.isArray(events)) return;
      events.forEach((event) => {
        (event?.tags || []).forEach((tag) => {
          rememberTag(getTagLabel(tag));
        });
      });
    } catch (error) {
      // Ignore: tag suggestions are a progressive enhancement.
    }
  };

  const ensureTagsSelected = (report = false) => {
    const hasTags = pendingTags.size > 0;
    if (!tagsInput) return hasTags;
    if (!hasTags) {
      if (report) {
        tagsInput.setCustomValidity(getTagsRequiredMessage());
        tagsInput.reportValidity();
        tagsInput.focus();
      }
      return false;
    }
    tagsInput.setCustomValidity('');
    return true;
  };

  const parseDateTime = (value) => {
    if (!value) return null;
    const direct = new Date(value);
    if (!Number.isNaN(direct.getTime())) return direct;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!match) return null;
    const [, year, month, day, hour, minute] = match;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute)
    );
  };

  const formatDateTime = (value) => {
    const date = parseDateTime(value);
    if (!date) return value;
    const parts = new Intl.DateTimeFormat('uk-UA', {
      timeZone: 'Europe/Copenhagen',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.day}.${map.month}.${map.year} · ${map.hour}:${map.minute}`;
  };

  const formatTime = (value) => {
    const date = parseDateTime(value);
    if (!date) return value;
    const parts = new Intl.DateTimeFormat('uk-UA', {
      timeZone: 'Europe/Copenhagen',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.hour}:${map.minute}`;
  };

  const formatDateRange = (start, end) => {
    if (!start) return '';
    const startLabel = formatDateTime(start);
    if (!end) return startLabel;
    const startDate = parseDateTime(start);
    const endDate = parseDateTime(end);
    if (!startDate || !endDate) return startLabel;
    if (
      startDate.getFullYear() === endDate.getFullYear() &&
      startDate.getMonth() === endDate.getMonth() &&
      startDate.getDate() === endDate.getDate()
    ) {
      return `${startLabel}–${formatTime(end)}`;
    }
    return `${startLabel} – ${formatDateTime(end)}`;
  };

  const parsePriceInput = (value) => {
    const raw = String(value || '').replace(/,/g, '.');
    const matches = raw.match(/\d+(?:\.\d+)?/g) || [];
    const numbers = matches.map((item) => Number(item)).filter((item) => Number.isFinite(item));
    if (!numbers.length) {
      return { min: null, max: null };
    }
    if (numbers.length === 1) {
      return { min: numbers[0], max: null };
    }
    const min = numbers[0];
    const max = numbers[1];
    if (Number.isFinite(min) && Number.isFinite(max) && max < min) {
      return { min: max, max: min };
    }
    return { min, max };
  };

  const formatPriceInput = (min, max) => {
    const minValue = Number.isFinite(min) ? min : null;
    const maxValue = Number.isFinite(max) ? max : null;
    if (minValue !== null && maxValue !== null) {
      return minValue === maxValue ? `${minValue}` : `${minValue}–${maxValue}`;
    }
    if (minValue !== null) return `${minValue}`;
    if (maxValue !== null) return `${maxValue}`;
    return '';
  };

  const formatInputDateTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}`;
  };

  const toOffsetISO = (value) => {
    const date = parseDateTime(value);
    if (!date) return '';
    const pad = (num) => String(num).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    const offsetHour = pad(Math.floor(abs / 60));
    const offsetMinute = pad(abs % 60);
    return `${year}-${month}-${day}T${hour}:${minute}:00${sign}${offsetHour}:${offsetMinute}`;
  };

  const guessCity = (address) => {
    const normalized = String(address || '').toLowerCase();
    const map = [
      { keys: ['copenhagen', 'копенгаген'], value: 'Copenhagen' },
      { keys: ['aarhus', 'орхус'], value: 'Aarhus' },
      { keys: ['odense', 'оденсе'], value: 'Odense' },
      { keys: ['aalborg', 'ольборг'], value: 'Aalborg' },
      { keys: ['esbjerg', "есб'єрг", 'есбʼєрг'], value: 'Esbjerg' }
    ];
    const match = map.find((entry) => entry.keys.some((key) => normalized.includes(key)));
    return match ? match.value : '';
  };

  const formImagePreview = multiStepForm.querySelector('[data-image-preview]');

  const applyPreviewImage = (value, altText) => {
    const hasValue = Boolean(value);
    if (previewImage) {
      if (!hasValue) {
        previewImage.hidden = true;
        previewImage.removeAttribute('src');
        previewImage.removeAttribute('alt');
      } else {
        previewImage.hidden = false;
        previewImage.src = value;
        previewImage.alt = altText || '';
      }
    }
    if (formImagePreview) {
      if (!hasValue) {
        formImagePreview.hidden = true;
        formImagePreview.removeAttribute('src');
        formImagePreview.removeAttribute('alt');
      } else {
        formImagePreview.hidden = false;
        formImagePreview.src = value;
        formImagePreview.alt = altText || '';
      }
    }
    previewImageUrl = hasValue ? value : null;
  };

  const populateFormFromEvent = (eventData) => {
    if (!eventData) return;
    const setValue = (name, value) => {
      const field = multiStepForm.elements[name];
      if (!field) return;
      if (field instanceof RadioNodeList) {
        field.value = value ?? '';
      } else if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement
      ) {
        field.value = value ?? '';
      }
    };
    setValue('title', eventData.title || '');
    setValue('description', eventData.description || '');
    setValue('start', formatInputDateTime(eventData.start));
    setValue('end', formatInputDateTime(eventData.end));
    setValue('format', eventData.format || '');
    setValue('language', normalizeEventLanguage(eventData.language || ''));
    setValue('city', eventData.city || '');
    setValue('address', eventData.address || eventData.venue || '');
    setValue('ticket-type', eventData.priceType || '');
    setValue('price', formatPriceInput(eventData.priceMin, eventData.priceMax));
    setValue('ticket-url', eventData.ticketUrl || '');
    setValue('contact-name', eventData.contactPerson?.name || '');
    setValue('contact-email', eventData.contactPerson?.email || '');
    setValue('contact-phone', eventData.contactPerson?.phone || '');
    setValue('contact-website', eventData.contactPerson?.website || '');
    setValue('contact-instagram', eventData.contactPerson?.instagram || '');
    setValue('contact-facebook', eventData.contactPerson?.facebook || '');
    setValue('contact-telegram', eventData.contactPerson?.telegram || '');
    pendingTags.clear();
    (eventData.tags || []).forEach((tag) => {
      addPendingTag(getTagLabel(tag));
    });
    if (tagsHidden) {
      tagsHidden.value = Array.from(pendingTags).join(', ');
    }
    const existingImage = eventData.images?.[0] || '';
    applyPreviewImage(existingImage, eventData.imageAlt || '');
    if (imageInput && existingImage) {
      imageInput.required = false;
    }
    if (formatSelect) {
      formatSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    renderTagChips();
    updatePreview();
  };

  const initIdentitySession = () => {
    if (!window.netlifyIdentity) {
      if (!document.querySelector('[data-identity-widget]')) {
        const identityScript = document.createElement('script');
        identityScript.src = 'https://identity.netlify.com/v1/netlify-identity-widget.js';
        identityScript.async = true;
        identityScript.defer = true;
        identityScript.dataset.identityWidget = 'true';
        identityScript.onload = () => {
          initIdentitySession();
        };
        document.body.appendChild(identityScript);
      }
      return;
    }
    window.netlifyIdentity.on('init', (user) => {
      identityUser = user;
      publishState.update();
    });
    window.netlifyIdentity.on('login', (user) => {
      identityUser = user;
      publishState.update();
    });
    window.netlifyIdentity.on('logout', () => {
      identityUser = null;
      publishState.update();
    });
    window.netlifyIdentity.init();
  };

  const getValidatableFields = () =>
    Array.from(multiStepForm.querySelectorAll('input, select, textarea')).filter((field) => {
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) {
        return false;
      }
      if (field.type === 'hidden' || field.disabled) return false;
      return true;
    });

  const getFieldValue = (name) => {
    const field = multiStepForm.elements[name];
    if (!field) return '';
    if (field instanceof RadioNodeList) {
      return field.value;
    }
    return field.value;
  };

  const getSelectLabel = (select, fallback) => {
    if (!select) return fallback;
    const option = Array.from(select.options).find((item) => item.value === fallback);
    return option?.textContent?.trim() || fallback;
  };

  const updatePreviewImage = () => {
    const file = imageInput?.files?.[0];
    const altText = imageAltInput?.value?.trim() || '';
    if (!file && !previewImageUrl) {
      applyPreviewImage('', '');
      return;
    }
    applyPreviewImage(previewImageUrl, altText);
  };

  const optimizeSelectedImage = async () => {
    const file = imageInput?.files?.[0];
    const altText = imageAltInput?.value?.trim() || '';
    if (!file) {
      imageOptimizationInFlight = false;
      updatePreviewImage();
      return;
    }
    const version = ++imageSelectionVersion;
    imageOptimizationInFlight = true;
    if (submitStatus) {
      submitStatus.textContent = 'Оптимізуємо зображення...';
    }
    try {
      const optimized = await fileToOptimizedDataUrl(file, {
        maxDimension: 1600,
        targetBytes: 320 * 1024,
        initialQuality: 0.84,
        minQuality: 0.58,
        preferredMimeType: 'image/webp'
      });
      if (version !== imageSelectionVersion) return;
      previewImageUrl = optimized.dataUrl || previewImageUrl;
      applyPreviewImage(previewImageUrl, altText);
      if (imageInput) {
        imageInput.required = false;
      }
    } catch (error) {
      if (version !== imageSelectionVersion) return;
      updatePreviewImage();
    } finally {
      if (version !== imageSelectionVersion) return;
      imageOptimizationInFlight = false;
      if (submitStatus?.textContent === 'Оптимізуємо зображення...') {
        submitStatus.textContent = '';
      }
    }
  };

  const updatePreview = () => {
    if (previewTitle) previewTitle.textContent = getFieldValue('title');
    if (previewOrganizer) {
      const organizerValue = getFieldValue('organizer') || getFieldValue('contact-name');
      previewOrganizer.textContent = organizerValue;
    }
    if (previewDescription) previewDescription.textContent = getFieldValue('description');
    if (previewTags) {
      const tags = Array.from(pendingTags);
      if (previewTags.classList.contains('event-tags')) {
        previewTags.innerHTML = tags
          .map((tag) => `<span class="event-tag" data-tag-label="${tag}">${tag}</span>`)
          .join('');
      } else {
        previewTags.textContent = tags.join(', ');
      }
    }
    if (previewTime) {
      const start = getFieldValue('start');
      const end = getFieldValue('end');
      previewTime.textContent = formatDateRange(start, end);
    }
    if (previewLocation) {
      const city = getFieldValue('city');
      const address = getFieldValue('address');
      previewLocation.textContent = [city, address].filter(Boolean).join(', ');
    }
    if (previewTickets) {
      const type = getFieldValue('ticket-type');
      const { min, max } = parsePriceInput(getFieldValue('price'));
      if (type === 'free') {
        previewTickets.textContent = formatMessage('form_ticket_free', {});
      } else if (type === 'paid') {
        const priceRange = [min, max].filter((value) => value !== null && value !== undefined).join('–');
        const paidLabel = formatMessage('form_ticket_paid', {});
        previewTickets.textContent = priceRange ? `${paidLabel} · ${priceRange}` : paidLabel;
      } else {
        previewTickets.textContent = [min, max].filter((value) => value !== null && value !== undefined).join('–');
      }
    }
    if (previewFormat) {
      previewFormat.textContent = getSelectLabel(formatSelect, getFieldValue('format'));
    }
    if (previewLanguage) {
      const languageSelect = multiStepForm.querySelector('select[name="language"]');
      previewLanguage.textContent = getSelectLabel(languageSelect, getFieldValue('language'));
    }
    updatePreviewImage();
  };

  const flushTagInput = () => {
    if (!tagsInput) return;
    const value = tagsInput.value.trim();
    if (!value) return;
    value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .forEach((tag) => addPendingTag(tag));
    tagsInput.value = '';
    renderTagSuggestions('');
    renderTagChips();
  };

  const renderTagChips = () => {
    if (!tagsList) return;
    tagsList.innerHTML = '';
    pendingTags.forEach((tag) => {
      const li = document.createElement('li');
      li.className = 'tags-input__chip pending';
      li.textContent = tag;
      li.title = formatMessage('pending_tooltip', {}) || 'Pending approval';
      li.dataset.i18nTitle = 'pending_tooltip';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tags-input__remove';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        pendingTags.delete(tag);
        renderTagChips();
        publishState.update();
      });
      li.appendChild(remove);
      tagsList.appendChild(li);
    });
    const value = Array.from(pendingTags).join(', ');
    if (tagsHidden) tagsHidden.value = value;
    ensureTagsSelected();
    publishState.update();
  };

  if (formatSelect) {
    const syncCityRequirement = () => {
      if (!(cityField instanceof HTMLInputElement)) return;
      const formatValue = String(getFieldValue('format') || '').trim().toLowerCase();
      const cityRequired = formatValue !== 'online';
      cityField.required = cityRequired;
      if (!cityRequired) {
        cityField.setCustomValidity('');
      }
    };
    syncCityRequirement();
    formatSelect.addEventListener('change', () => {
      syncCityRequirement();
      updatePreview();
    });
  }

  if (tagsInput) {
    tagsInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        flushTagInput();
      }
    });
    tagsInput.addEventListener('input', () => {
      renderTagSuggestions(tagsInput.value);
    });
    tagsInput.addEventListener('focus', () => {
      renderTagSuggestions(tagsInput.value);
    });
    tagsInput.addEventListener('blur', () => {
      flushTagInput();
    });
  }

  if (contactNameField) {
    contactNameField.addEventListener('input', () => {
      updatePreview();
    });
  }

  if (imageInput) {
    imageInput.addEventListener('change', () => {
      optimizeSelectedImage();
    });
  }

  if (imageAltInput) {
    imageAltInput.addEventListener('input', () => {
      updatePreview();
    });
  }

  const validateForm = () => {
    ensureTagsSelected(false);
    const descriptionValue = String(descriptionField?.value || '').trim();
    if (!descriptionValue) {
      const message = formatMessage('form_description_required', {}) || 'Опис події обовʼязковий.';
      if (descriptionField) {
        descriptionField.setCustomValidity(message);
        descriptionField.reportValidity();
        descriptionField.focus();
      }
      if (submitStatus) {
        submitStatus.textContent = message;
      }
      return false;
    }
    if (descriptionField) {
      descriptionField.setCustomValidity('');
    }

    if (cityField instanceof HTMLInputElement) {
      const formatValue = String(getFieldValue('format') || '').trim().toLowerCase();
      const cityRequired = formatValue !== 'online';
      const cityValue = String(cityField.value || '').trim();
      if (cityRequired && !cityValue) {
        const message = formatMessage('form_city_required', {}) || 'Місто обовʼязкове.';
        cityField.setCustomValidity(message);
        cityField.reportValidity();
        cityField.focus();
        if (submitStatus) {
          submitStatus.textContent = message;
        }
        return false;
      }
      cityField.setCustomValidity('');
    }

    const fields = getValidatableFields();
    for (const field of fields) {
      if (field === descriptionField || field === cityField) continue;
      if (!field.checkValidity()) {
        field.reportValidity();
        return false;
      }
    }
    if (submitStatus) {
      submitStatus.textContent = '';
    }
    return true;
  };

  const getEffectiveOrganizerStatus = () => {
    const verification = getVerificationState();
    if (isAdminBypass()) return 'admin';
    if (verification.websiteApproved) return 'verified';
    if (verification.websitePending) return 'pending_manual';
    return 'none';
  };

  updatePreview();
  renderTagChips();
  loadKnownTags().then(() => {
    renderTagSuggestions(tagsInput?.value || '');
  });
  publishState.update = () => {
    const isAdmin = isAdminBypass();
    const verified = getEffectiveOrganizerStatus() !== 'none';
    const hasTags = pendingTags.size > 0;
    if (publishButton) {
      publishButton.disabled = isAdmin ? false : !verified || !hasTags;
    }
    if (verificationWarning) {
      verificationWarning.hidden = isAdmin || verified;
    }
    if (verificationBanner) {
      verificationBanner.hidden = isAdmin || verified;
    }
  };
  publishState.update();
  initIdentitySession();
  multiStepForm.dataset.ready = 'true';

  const params = new URLSearchParams(window.location.search);
  const eventIdParam = params.get('id');
  if (eventIdParam) {
    const loadEditableEvent = async () => {
      const forceServerless = new URLSearchParams(window.location.search).get('serverless') === '1';
      const isLocalHost =
        !forceServerless && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
      if (!isLocalHost) {
        const localAdmin = isAdminBypass();
        const isAdmin = localAdmin || (await resolveAdminSession({
          hasLocalSession: localAdmin,
          getIdentity: async () => window.netlifyIdentity || null,
          timeoutMs: 900
        }));
        if (isAdmin) {
          const headers = {};
          const token = await getIdentityToken();
          if (token) headers.Authorization = `Bearer ${token}`;
          const response = await fetch(
            `/.netlify/functions/admin-event?id=${encodeURIComponent(eventIdParam)}`,
            { headers }
          );
          if (response.ok) {
            const payload = await response.json().catch(() => ({}));
            if (payload?.ok && payload?.event) {
              return payload.event;
            }
          }
        }
      }
      return findMergedEventById(eventIdParam);
    };

    loadEditableEvent()
      .then((eventData) => {
        if (!eventData) return;
        editingEventId = eventData.id;
        editingEventData = eventData;
        populateFormFromEvent(eventData);
      })
      .catch(() => {});
  }

  if (verificationBannerButton) {
    verificationBannerButton.addEventListener('click', () => {
      window.location.href = './#settings';
    });
  }

  multiStepForm.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return;
    }
    if (target === descriptionField || target === cityField) {
      target.setCustomValidity('');
    }
    if (target === tagsInput) return;
    updatePreview();
  });

  multiStepForm.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return;
    }
    if (target === imageInput || target === formatSelect || target === tagsInput) return;
    updatePreview();
  });

  multiStepForm.addEventListener('submit', async (event) => {
    flushTagInput();
    if (!ensureTagsSelected(true)) {
      event.preventDefault();
      return;
    }
    const verified = getEffectiveOrganizerStatus() !== 'none';
    if (!verified) {
      event.preventDefault();
      if (verificationWarning) {
        verificationWarning.hidden = false;
      }
      return;
    }
    event.preventDefault();
    if (imageOptimizationInFlight) {
      if (submitStatus) {
        submitStatus.textContent = 'Зачекайте, зображення ще обробляється.';
      }
      return;
    }
    if (honeypotField && honeypotField.value.trim()) {
      if (submitStatus) {
        submitStatus.textContent = formatMessage('spam_blocked', {});
      }
      return;
    }
    if (statusField) {
      statusField.value = isAdminBypass() ? 'approved' : 'pending';
    }
    if (!validateForm()) {
      return;
    }
    if (submitStatus) {
      submitStatus.textContent = '';
    }
    try {
      const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
      const formData = new FormData(multiStepForm);
      const payload = Object.fromEntries(formData.entries());
      payload.language = normalizeEventLanguage(payload.language);
      payload.description = String(payload.description || '').trim();
      if (!payload.description) {
        const message = formatMessage('form_description_required', {}) || 'Опис події обовʼязковий.';
        if (descriptionField) {
          descriptionField.setCustomValidity(message);
          descriptionField.reportValidity();
          descriptionField.focus();
        }
        if (submitStatus) {
          submitStatus.textContent = message;
        }
        return;
      }
      const formatValue = String(payload.format || '').trim().toLowerCase();
      const rawCity = String(payload.city || '').trim().replace(/\s+/g, ' ');
      payload.city = rawCity;
      const requiresCity = formatValue !== 'online';
      if (requiresCity && !payload.city) {
        const message = formatMessage('form_city_required', {}) || 'Місто обовʼязкове.';
        if (cityField) {
          cityField.setCustomValidity(message);
          cityField.reportValidity();
          cityField.focus();
        }
        if (submitStatus) {
          submitStatus.textContent = message;
        }
        return;
      }
      if (cityField) {
        cityField.setCustomValidity('');
      }
      if (descriptionField) {
        descriptionField.setCustomValidity('');
      }
      const tagsForPayload = Array.from(pendingTags);
      const tagsPayload = tagsForPayload.join(', ');
      payload.tags = tagsPayload;
      if (tagsHidden) {
        tagsHidden.value = tagsPayload;
      }
      const derivedCity =
        formatValue === 'online'
          ? payload.city || ''
          : payload.city || editingEventData?.city || '';
      const eventId = editingEventId;
      const priceInput = payload.price ? String(payload.price).trim() : '';
      const { min: priceMin, max: priceMax } = parsePriceInput(priceInput);
      payload.start = toOffsetISO(payload.start);
      payload.end = toOffsetISO(payload.end);
      if (isLocalHost) {
        const localId = eventId || buildLocalEventId();
        const storedEvent =
          eventId && Array.isArray(getLocalEvents())
            ? getLocalEvents().find((item) => item?.id === eventId) || null
            : null;
        const keepArchived = Boolean(
          eventId && (isArchivedEvent(editingEventData) || isArchivedEvent(storedEvent))
        );
        const nextEvent = {
          id: localId,
          title: payload.title || editingEventData?.title || '—',
          slug: editingEventData?.slug || localId,
          description: payload.description || editingEventData?.description || '',
          tags: tagsForPayload.map((label) => ({ label, status: 'approved' })),
          start: payload.start || '',
          end: payload.end || '',
          format: payload.format || '',
          language: payload.language || '',
          venue: payload.address || '',
          address: payload.address || '',
          city: derivedCity || '',
          priceType: payload['ticket-type'] || '',
          priceMin: Number.isFinite(priceMin) ? priceMin : null,
          priceMax: Number.isFinite(priceMax) ? priceMax : null,
          ticketUrl: payload['ticket-url'] || '',
          organizerId,
          images: previewImageUrl ? [previewImageUrl] : editingEventData?.images || [],
          imageAlt: imageAltInput?.value?.trim() || editingEventData?.imageAlt || '',
          contactPerson: {
            name: payload['contact-name'] || '',
            email: payload['contact-email'] || '',
            phone: payload['contact-phone'] || '',
            website: payload['contact-website'] || '',
            instagram: payload['contact-instagram'] || '',
            facebook: payload['contact-facebook'] || '',
            telegram: payload['contact-telegram'] || ''
          },
          status: keepArchived ? 'archived' : 'published',
          archived: keepArchived,
          forUkrainians: editingEventData?.forUkrainians ?? true,
          familyFriendly: editingEventData?.familyFriendly ?? false,
          volunteer: editingEventData?.volunteer ?? false
        };
        const saved = upsertLocalEvent(nextEvent, identityUser?.email || 'admin');
        if (submitStatus) {
          submitStatus.textContent = formatMessage('submit_success', {});
        }
        if (saved?.id) {
          window.location.href = `./event-card.html?id=${encodeURIComponent(saved.id)}`;
        }
        return;
      }
      payload.city = derivedCity || '';
      payload.imageUrl = previewImageUrl || editingEventData?.images?.[0] || '';
      if (priceInput) {
        payload['price-min'] = Number.isFinite(priceMin) ? String(priceMin) : '';
        payload['price-max'] = Number.isFinite(priceMax) ? String(priceMax) : '';
      }
      if (eventId) {
        payload.tags = tagsForPayload;
        const headers = { 'Content-Type': 'application/json' };
        const token = await getIdentityToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
        const response = await fetch('/.netlify/functions/update-event', {
          method: 'PUT',
          headers,
          body: JSON.stringify({ id: eventId, payload, lastModifiedByAdmin: new Date().toISOString() })
        });
        if (!response.ok) throw new Error('update failed');
        const result = await response.json();
        if (!result?.ok) throw new Error('update failed');
        if (submitStatus) {
          submitStatus.textContent = formatMessage('submit_success', {});
        }
        window.location.href = `./event-card.html?id=${encodeURIComponent(eventId)}`;
      } else {
        payload.tags = tagsPayload;
        const headers = { 'Content-Type': 'application/json' };
        const token = await getIdentityToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
        const response = await fetch('/.netlify/functions/submit-event', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('submit failed');
        const result = await response.json();
        if (!result?.ok) throw new Error('submit failed');
        if (submitStatus) {
          submitStatus.textContent = formatMessage('submit_success', {});
        }
        if (result?.id) {
          window.location.href = `./event-card.html?id=${encodeURIComponent(result.id)}`;
        }
      }
    } catch (error) {
      if (submitStatus) {
        submitStatus.textContent = formatMessage('submit_error', {});
      }
    }
  });
};
