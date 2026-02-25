import { ADMIN_SESSION_KEY, getIdentityToken, getUserRoles, hasAdminRole, isSuperAdmin } from './auth.js';
import {
  archiveLocalEvent,
  deleteLocalEvent,
  fetchMergedLocalEvents,
  getAuditLog,
  restoreLocalEvent
} from './local-events.js';
import {
  deleteLocalPartner,
  getLocalPartners,
  normalizePartnersOrder,
  normalizePartnersOrderInPlace,
  normalizePartnerSlug,
  sortPartners,
  upsertLocalPartner
} from './partners.mjs';

export const initAdmin = ({ formatMessage }) => {
  const moderationList = document.querySelector('.moderation-list');
  const modal = document.querySelector('.modal');

  const getAdminLoginRedirect = () => {
    const redirect = encodeURIComponent(
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    );
    return `./admin-login.html?redirect=${redirect}`;
  };

  const getUiLocale = () => 'uk-UA';

  const initPartnersPanel = (user) => {
    const partnersContainer = document.querySelector('[data-admin-partners-list]');
    const partnerForm = document.querySelector('[data-admin-partner-form]');
    const partnerResetButton = document.querySelector('[data-admin-partner-reset]');
    const partnerDetailToggle = partnerForm?.elements?.namedItem?.('has_detail_page');
    const partnerAdvancedFields = document.querySelector('[data-partner-advanced-fields]');
    const partnerDetailFields = document.querySelector('[data-partner-detail-fields]');
    if (!partnersContainer && !(partnerForm instanceof HTMLFormElement)) return;
    if (partnersContainer?.dataset.ready === 'true') return;
    if (partnersContainer) {
      partnersContainer.dataset.ready = 'true';
    }

    const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    let useLocalPartners = isLocalHost;
    let partnersById = new Map();
    let activePartnerId = null;
    let partnersErrorShown = false;

    const parsePartnersResponse = async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        const message = String(payload?.error || 'partners_failed');
        throw new Error(message);
      }
      return payload;
    };

    const showPartnersError = (message = 'Не вдалося зберегти партнера. Перевірте налаштування backend.') => {
      if (partnersErrorShown) return;
      partnersErrorShown = true;
      window.alert(message);
      window.setTimeout(() => {
        partnersErrorShown = false;
      }, 1200);
    };

    const getAuthHeaders = async () => {
      const token = user?.token?.access_token || (await getIdentityToken());
      return token ? { Authorization: `Bearer ${token}` } : {};
    };

    const fileToDataUrl = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('file_read_error'));
        reader.readAsDataURL(file);
      });

    const parseFaqRows = (value) =>
      String(value || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [question, answer] = line.split('||').map((item) => item.trim());
          return { question: question || '', answer: answer || '' };
        })
        .filter((entry) => entry.question || entry.answer);

    const hasDetailContent = (detailContent) => {
      if (!detailContent || typeof detailContent !== 'object') return false;
      const description = String(detailContent.description || '').trim();
      const forWhom = Array.isArray(detailContent.forWhom)
        ? detailContent.forWhom.filter(Boolean)
        : [];
      const bonus = String(detailContent.bonus || '').trim();
      const faq = Array.isArray(detailContent.faq)
        ? detailContent.faq.filter((entry) => entry?.question || entry?.answer)
        : [];
      const ctaLabel = String(detailContent.ctaLabel || '').trim();
      const ctaUrl = String(detailContent.ctaUrl || '').trim();
      return Boolean(description || forWhom.length || bonus || faq.length || ctaLabel || ctaUrl);
    };

    const resetPartnerForm = () => {
      if (!(partnerForm instanceof HTMLFormElement)) return;
      partnerForm.reset();
      const idField = partnerForm.elements.namedItem('id');
      if (idField instanceof HTMLInputElement) idField.value = '';
      const activeField = partnerForm.elements.namedItem('is_active');
      if (activeField instanceof HTMLInputElement) activeField.checked = true;
      const detailField = partnerForm.elements.namedItem('has_detail_page');
      if (detailField instanceof HTMLInputElement) detailField.checked = false;
      activePartnerId = null;
      if (partnerAdvancedFields instanceof HTMLFieldSetElement) {
        partnerAdvancedFields.disabled = true;
        partnerAdvancedFields.hidden = true;
      }
      if (partnerDetailFields instanceof HTMLFieldSetElement) {
        partnerDetailFields.disabled = true;
        partnerDetailFields.hidden = true;
      }
    };

    const mapPartnerFromForm = async () => {
      if (!(partnerForm instanceof HTMLFormElement)) return null;
      const formData = new FormData(partnerForm);
      const id = String(formData.get('id') || '').trim();
      const existing = id ? partnersById.get(id) : null;
      const websiteUrlInput = String(formData.get('website_url') || '').trim();
      const deriveNameFromWebsite = (value) => {
        if (!value) return '';
        try {
          const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
          const host = new URL(normalized).hostname.replace(/^www\./i, '').trim();
          return host || '';
        } catch (error) {
          return '';
        }
      };
      const nameInput = String(formData.get('name') || '').trim();
      const derivedWebsiteName = deriveNameFromWebsite(websiteUrlInput);
      const name =
        nameInput || String(existing?.name || '').trim() || derivedWebsiteName || 'Партнер';
      const slugInput = String(formData.get('slug') || '').trim();
      const slug = normalizePartnerSlug(slugInput || name || existing?.slug || derivedWebsiteName || '');
      const websiteUrl = websiteUrlInput || String(existing?.websiteUrl || '').trim();
      const logoUrlInput = String(formData.get('logo_url') || '').trim();
      const logoUrl = logoUrlInput || String(existing?.logoUrl || '').trim();
      const hasDetailPageRaw = formData.get('has_detail_page') === 'on';
      const isActive = formData.get('is_active') === 'on';
      const forWhom = String(formData.get('detail_for_whom') || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const detailContent = hasDetailPageRaw
        ? {
        title: name || String(existing?.name || '').trim(),
        description: String(formData.get('detail_description') || '').trim(),
        forWhom,
        ctaLabel: String(formData.get('detail_cta_label') || '').trim(),
        ctaUrl: String(formData.get('detail_cta_url') || '').trim(),
        bonus: String(formData.get('detail_bonus') || '').trim(),
        faq: parseFaqRows(formData.get('detail_faq') || '')
      }
        : {};
      const hasDetailPage = hasDetailPageRaw && hasDetailContent(detailContent);
      const logoFile = formData.get('logo_file');
      let logoDataUrl = '';
      if (logoFile instanceof File && logoFile.size > 0) {
        logoDataUrl = await fileToDataUrl(logoFile);
      }
      return {
        id,
        name,
        slug,
        websiteUrl,
        logoUrl,
        logoDataUrl,
        sortOrder: getPartnerOrderValue(existing),
        hasDetailPage,
        isActive,
        detailContent
      };
    };

    const getPartnerOrderValue = (partner) => {
      const raw = partner?.sortOrder ?? partner?.sort_order;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const renderPartnersList = (partners) => {
      if (!partnersContainer) return;
      const sorted = sortPartners(Array.isArray(partners) ? partners : []);
      partnersById = new Map(sorted.map((partner) => [partner.id, partner]));
      partnersContainer.innerHTML = sorted
        .map((partner) => {
          const logoUrl = partner.logoUrl || '';
          const isActive = partner.isActive !== false;
          const activeLabel = isActive ? 'Активний' : 'Неактивний';
          const detailLabel = partner.hasDetailPage ? 'Є detail' : 'Без detail';
          return `
            <article class="admin-partner-card" data-admin-partner-id="${partner.id}" data-partner-active="${isActive ? 'true' : 'false'}" draggable="${isActive ? 'true' : 'false'}">
              <div>
                <strong>${partner.name || '—'}</strong>
                <p>${partner.slug || '—'} · ${activeLabel} · ${detailLabel}</p>
                <p>${partner.websiteUrl || ''}</p>
              </div>
              <div>
                ${logoUrl ? `<img class="admin-partner-card__logo" src="${logoUrl}" alt="${partner.name || ''}" />` : ''}
                <div class="admin-partner-card__actions">
                  <button class="btn ghost" type="button" data-action="edit-partner">Редагувати</button>
                  <button class="btn ghost" type="button" data-action="toggle-partner">${partner.isActive ? 'Деактивувати' : 'Активувати'}</button>
                  <button class="btn ghost" type="button" data-action="delete-partner">Видалити</button>
                </div>
              </div>
            </article>
          `;
        })
        .join('');
    };

    const savePartnerPayload = async (payload) => {
      if (useLocalPartners) {
        upsertLocalPartner(payload);
        return payload;
      }
      const authHeaders = await getAuthHeaders();
      let attempts = 0;
      let lastError = null;
      while (attempts < 2) {
        try {
          const response = await fetch('/.netlify/functions/admin-partners', {
            method: payload.id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify(payload)
          });
          const parsed = await parsePartnersResponse(response);
          return parsed?.partner || payload;
        } catch (error) {
          lastError = error;
          attempts += 1;
          if (attempts >= 2) break;
          await new Promise((resolve) => window.setTimeout(resolve, 180));
        }
      }
      throw lastError || new Error('partners_save_failed');
    };

    const persistPartnersOrder = async (orderedPartners) => {
      const normalized = normalizePartnersOrderInPlace(orderedPartners);
      for (const partner of normalized) {
        const current = partnersById.get(partner.id);
        const nextOrder = getPartnerOrderValue(partner);
        const currentOrder = getPartnerOrderValue(current);
        if (current && currentOrder === nextOrder) {
          continue;
        }
        await savePartnerPayload({ ...partner, sortOrder: nextOrder });
      }
      return normalized;
    };

    const getCurrentOrderedPartners = () => sortPartners(Array.from(partnersById.values()));

    const needsOrderNormalization = (partners = []) => {
      const sorted = sortPartners(partners);
      const normalized = normalizePartnersOrder(sorted);
      if (sorted.length !== normalized.length) return true;
      for (let index = 0; index < sorted.length; index += 1) {
        const source = sorted[index];
        const target = normalized[index];
        if (String(source?.id || '') !== String(target?.id || '')) return true;
        if (getPartnerOrderValue(source) !== getPartnerOrderValue(target)) return true;
      }
      return false;
    };

    const persistOrderFromDom = async () => {
      if (!partnersContainer) return;
      const ids = Array.from(
        partnersContainer.querySelectorAll('[data-admin-partner-id]')
      )
        .map((card) => String(card.getAttribute('data-admin-partner-id') || '').trim())
        .filter(Boolean);
      if (ids.length < 2) return;
      const orderedPartners = ids
        .map((partnerId) => partnersById.get(partnerId))
        .filter(Boolean);
      if (orderedPartners.length < 2) return;
      await persistPartnersOrder(orderedPartners);
      await loadPartners();
    };

    const setPartnerFormValues = (partner) => {
      if (!(partnerForm instanceof HTMLFormElement)) return;
      const setValue = (name, value) => {
        const field = partnerForm.elements.namedItem(name);
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
          field.value = value ?? '';
        }
      };
      setValue('id', partner.id || '');
      setValue('name', partner.name || '');
      setValue('slug', partner.slug || '');
      setValue('website_url', partner.websiteUrl || '');
      setValue('logo_url', partner.logoUrl || '');
      const activeField = partnerForm.elements.namedItem('is_active');
      if (activeField instanceof HTMLInputElement) activeField.checked = partner.isActive !== false;
      const detailField = partnerForm.elements.namedItem('has_detail_page');
      if (detailField instanceof HTMLInputElement) detailField.checked = partner.hasDetailPage === true;
      if (partnerAdvancedFields instanceof HTMLFieldSetElement) {
        const enabled = detailField instanceof HTMLInputElement && detailField.checked;
        partnerAdvancedFields.disabled = !enabled;
        partnerAdvancedFields.hidden = !enabled;
      }
      if (partnerDetailFields instanceof HTMLFieldSetElement) {
        const enabled = detailField instanceof HTMLInputElement && detailField.checked;
        partnerDetailFields.disabled = !enabled;
        partnerDetailFields.hidden = !enabled;
      }
      const detail = partner.detailContent || {};
      setValue('detail_description', detail.description || '');
      setValue('detail_for_whom', Array.isArray(detail.forWhom) ? detail.forWhom.join('\n') : '');
      setValue('detail_cta_label', detail.ctaLabel || '');
      setValue('detail_cta_url', detail.ctaUrl || '');
      setValue('detail_bonus', detail.bonus || '');
      setValue(
        'detail_faq',
        Array.isArray(detail.faq)
          ? detail.faq.map((entry) => `${entry.question || ''} || ${entry.answer || ''}`).join('\n')
          : ''
      );
      activePartnerId = partner.id || null;
    };

    const loadPartners = async () => {
      try {
        if (useLocalPartners) {
          const localPartners = getLocalPartners();
          const normalizedLocal = normalizePartnersOrder(localPartners);
          if (needsOrderNormalization(localPartners)) {
            normalizedLocal.forEach((partner) => upsertLocalPartner(partner));
          }
          renderPartnersList(normalizedLocal);
          return;
        }
        const authHeaders = await getAuthHeaders();
        const response = await fetch('/.netlify/functions/admin-partners', {
          headers: { 'Content-Type': 'application/json', ...authHeaders }
        });
        const payload = await parsePartnersResponse(response);
        const partners = Array.isArray(payload?.partners) ? payload.partners : [];
        if (needsOrderNormalization(partners)) {
          const normalized = await persistPartnersOrder(partners);
          renderPartnersList(normalized);
          return;
        }
        renderPartnersList(partners);
      } catch (error) {
        if (isLocalHost) {
          useLocalPartners = true;
          const localPartners = getLocalPartners();
          renderPartnersList(normalizePartnersOrder(localPartners));
          return;
        }
        console.error('load partners failed', error);
        renderPartnersList([]);
        showPartnersError('Не вдалося завантажити партнерів із сервера.');
      }
    };

    if (partnersContainer) {
      partnersContainer.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const card = target.closest('[data-admin-partner-id]');
        if (!card) return;
        const partnerId = card.dataset.adminPartnerId || '';
        const partner = partnersById.get(partnerId);
        if (!partner) return;

        if (target.dataset.action === 'edit-partner') {
          setPartnerFormValues(partner);
          const nameField = partnerForm?.elements?.namedItem('name');
          if (nameField instanceof HTMLElement) nameField.focus();
          return;
        }

        if (target.dataset.action === 'toggle-partner') {
          const payload = { ...partner, isActive: !partner.isActive };
          if (useLocalPartners) {
            upsertLocalPartner(payload);
            await loadPartners();
            return;
          }
          try {
            const authHeaders = await getAuthHeaders();
            const response = await fetch('/.netlify/functions/admin-partners', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...authHeaders },
              body: JSON.stringify(payload)
            });
            await parsePartnersResponse(response);
          } catch (error) {
            console.error('toggle partner failed', error);
            showPartnersError();
          }
          await loadPartners();
          return;
        }

        if (target.dataset.action === 'delete-partner') {
          if (!window.confirm('Видалити партнера?')) return;
          if (useLocalPartners) {
            deleteLocalPartner(partnerId);
            await loadPartners();
            if (activePartnerId === partnerId) resetPartnerForm();
            return;
          }
          try {
            const authHeaders = await getAuthHeaders();
            const response = await fetch(`/.netlify/functions/admin-partners?id=${encodeURIComponent(partnerId)}`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', ...authHeaders }
            });
            await parsePartnersResponse(response);
          } catch (error) {
            console.error('delete partner failed', error);
            showPartnersError('Не вдалося видалити партнера на сервері.');
          }
          await loadPartners();
          if (activePartnerId === partnerId) resetPartnerForm();
        }
      });

      let draggedPartnerId = '';
      partnersContainer.addEventListener('dragstart', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const card = target.closest('[data-admin-partner-id]');
        if (!(card instanceof HTMLElement)) return;
        if (card.dataset.partnerActive !== 'true') {
          event.preventDefault();
          return;
        }
        draggedPartnerId = String(card.dataset.adminPartnerId || '');
        if (!draggedPartnerId) return;
        card.classList.add('is-dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', draggedPartnerId);
        }
      });

      partnersContainer.addEventListener('dragover', (event) => {
        if (!draggedPartnerId) return;
        event.preventDefault();
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const targetCard = target.closest('[data-admin-partner-id][data-partner-active="true"]');
        if (!(targetCard instanceof HTMLElement)) return;
        const draggingCard = partnersContainer.querySelector('.admin-partner-card.is-dragging');
        if (!(draggingCard instanceof HTMLElement) || draggingCard === targetCard) return;
        event.preventDefault();
        const rect = targetCard.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2;
        partnersContainer.insertBefore(draggingCard, before ? targetCard : targetCard.nextSibling);
      });

      partnersContainer.addEventListener('drop', async (event) => {
        if (!draggedPartnerId) return;
        event.preventDefault();
        try {
          await persistOrderFromDom();
        } catch (error) {
          console.error('partner reorder failed', error);
          showPartnersError('Не вдалося зберегти новий порядок партнерів.');
        }
      });

      partnersContainer.addEventListener('dragend', () => {
        draggedPartnerId = '';
        partnersContainer
          .querySelectorAll('.admin-partner-card.is-dragging')
          .forEach((card) => card.classList.remove('is-dragging'));
      });
    }

    if (partnerForm instanceof HTMLFormElement) {
      partnerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = await mapPartnerFromForm();
        if (!payload?.name || !payload?.slug) return;
        try {
          const isCreate = !payload.id;
          const draftPayload =
            useLocalPartners && isCreate
              ? {
                  ...payload,
                  id: `partner-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                }
              : payload;

          const savedPartner = await savePartnerPayload(draftPayload);
          if (isCreate && savedPartner?.id) {
            const current = getCurrentOrderedPartners().filter(
              (partner) => String(partner?.id || '') !== String(savedPartner.id)
            );
            await persistPartnersOrder([
              { ...savedPartner, sortOrder: 1 },
              ...current
            ]);
          }
          resetPartnerForm();
          await loadPartners();
        } catch (error) {
          if (isLocalHost) {
            useLocalPartners = true;
            const localId =
              payload.id || `partner-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const logoUrl = payload.logoDataUrl || payload.logoUrl || '';
            upsertLocalPartner({
              id: localId,
              name: payload.name,
              slug: payload.slug,
              logoUrl,
              websiteUrl: payload.websiteUrl,
              hasDetailPage: payload.hasDetailPage,
              isActive: payload.isActive,
              sortOrder: payload.sortOrder,
              detailContent: payload.detailContent
            });
            resetPartnerForm();
            await loadPartners();
            return;
          }
          console.error('save partner failed', error);
          showPartnersError('Партнер не збережений на сервері. Перевірте slug/доступи та спробуйте ще раз.');
        }
      });
    }

    if (partnerResetButton instanceof HTMLButtonElement) {
      partnerResetButton.addEventListener('click', () => {
        resetPartnerForm();
      });
    }

    if (partnerDetailToggle instanceof HTMLInputElement) {
      const syncDetailFieldsState = () => {
        if (partnerAdvancedFields instanceof HTMLFieldSetElement) {
          partnerAdvancedFields.disabled = !partnerDetailToggle.checked;
          partnerAdvancedFields.hidden = !partnerDetailToggle.checked;
        }
        if (partnerDetailFields instanceof HTMLFieldSetElement) {
          partnerDetailFields.disabled = !partnerDetailToggle.checked;
          partnerDetailFields.hidden = !partnerDetailToggle.checked;
        }
      };
      partnerDetailToggle.addEventListener('change', syncDetailFieldsState);
      syncDetailFieldsState();
    }

    loadPartners();
  };

  const setupAdminAuth = () => {
    const path = window.location.pathname;
    const isAdminPage = path.includes('admin-page');
    const isPartnersPage = path.includes('admin-partners');
    const isAdminWorkspacePage = isAdminPage || isPartnersPage;
    const isLoginPage = path.includes('admin-login');
    if (!isAdminWorkspacePage && !isLoginPage) return;

    const statusEl = document.querySelector('[data-admin-status]');
    const loginButton = document.querySelector('[data-admin-login]');
    const logoutButton = document.querySelector('[data-admin-logout]');
    const userMeta = document.querySelector('[data-admin-user]');
    const roleMeta = document.querySelector('[data-admin-role]');
    const metaContainer = document.querySelector('.admin-auth__meta');
    const superAdminSections = document.querySelectorAll('[data-super-admin-only]');

    const setStatus = (key) => {
      if (statusEl) statusEl.textContent = formatMessage(key, {});
    };

    const setAuthState = (state) => {
      document.body.dataset.adminAuth = state;
    };

    const updateMeta = (user) => {
      if (!userMeta || !roleMeta || !metaContainer) return;
      if (!user) {
        metaContainer.hidden = true;
        return;
      }
      const roles = getUserRoles(user);
      const roleLabel = roles.includes('super_admin')
        ? formatMessage('admin_access_role_super', {})
        : formatMessage('admin_access_role_admin', {});
      userMeta.textContent = `${formatMessage('admin_access_user', {})}: ${user.email || '—'}`;
      roleMeta.textContent = roleLabel;
      metaContainer.hidden = false;
    };

    const setSuperAdminVisibility = (allowed) => {
      superAdminSections.forEach((section) => {
        section.hidden = !allowed;
      });
    };

    const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    const hasLocalAdmin = () => {
      if (!isLocalHost) return false;
      try {
        return localStorage.getItem(ADMIN_SESSION_KEY) === '1';
      } catch (error) {
        return false;
      }
    };

    const openLogin = () => {
      if (window.netlifyIdentity) {
        window.netlifyIdentity.open('login');
      }
    };

    if (loginButton) {
      loginButton.addEventListener('click', openLogin);
    }

    if (logoutButton) {
      logoutButton.addEventListener('click', () => {
        if (window.netlifyIdentity) {
          window.netlifyIdentity.logout();
        }
      });
    }

    if (!window.netlifyIdentity) {
      if (!document.querySelector('[data-identity-widget]')) {
        const identityScript = document.createElement('script');
        identityScript.src = 'https://identity.netlify.com/v1/netlify-identity-widget.js';
        identityScript.async = true;
        identityScript.defer = true;
        identityScript.dataset.identityWidget = 'true';
        identityScript.onload = () => {
          setupAdminAuth();
        };
        document.body.appendChild(identityScript);
      }
      let attempts = 0;
      const retryInit = () => {
        if (window.netlifyIdentity) {
          setupAdminAuth();
          return;
        }
        attempts += 1;
        if (attempts < 20) {
          window.setTimeout(retryInit, 100);
        }
      };
      retryInit();
      setAuthState('checking');
      setStatus('admin_access_checking');
      return;
    }

    setAuthState('checking');

    let initTimer = null;

    const handleUser = (user) => {
      if (initTimer) {
        clearTimeout(initTimer);
        initTimer = null;
      }
      if (!user) {
        if (hasLocalAdmin()) {
          const localUser = { email: 'admin@local', app_metadata: { roles: ['admin'] } };
          setAuthState('granted');
          setStatus('admin_access_granted');
          if (loginButton) loginButton.hidden = true;
          if (logoutButton) logoutButton.hidden = false;
          updateMeta(localUser);
          setSuperAdminVisibility(false);
          if (isAdminPage) {
            initModerationPanel(localUser, false);
          } else if (isPartnersPage) {
            initPartnersPanel(localUser);
          }
          return;
        }
        setAuthState('denied');
        setStatus('admin_access_required');
        if (loginButton) loginButton.hidden = false;
        if (logoutButton) logoutButton.hidden = true;
        updateMeta(null);
        setSuperAdminVisibility(false);
        if (isAdminWorkspacePage) {
          window.location.href = getAdminLoginRedirect();
        }
        return;
      }

      if (!hasAdminRole(user)) {
        setAuthState('denied');
        setStatus('admin_access_denied');
        if (loginButton) loginButton.hidden = true;
        if (logoutButton) logoutButton.hidden = false;
        updateMeta(user);
        setSuperAdminVisibility(false);
        setAdminSession(false);
        if (isLoginPage) {
          setStatus('admin_login_error');
        }
        return;
      }

      setAuthState('granted');
      setStatus('admin_access_granted');
      if (loginButton) loginButton.hidden = true;
      if (logoutButton) logoutButton.hidden = false;
      updateMeta(user);
      setSuperAdminVisibility(isSuperAdmin(user));

      if (isLoginPage) {
        const redirect = searchParams.get('redirect') || './admin-page.html';
        window.location.href = hasAuthToken ? './admin-page.html' : redirect;
      }

      if (isAdminPage) {
        initModerationPanel(user, isSuperAdmin(user));
      } else if (isPartnersPage) {
        initPartnersPanel(user);
      }
    };

    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      window.location.hash && window.location.hash.includes('=')
        ? window.location.hash.slice(1)
        : ''
    );
    const hasRecoveryToken = searchParams.has('recovery_token') || hashParams.has('recovery_token');
    const hasInviteToken = searchParams.has('invite_token') || hashParams.has('invite_token');
    const hasConfirmToken =
      searchParams.has('confirmation_token') || hashParams.has('confirmation_token');
    const hasAuthToken = hasRecoveryToken || hasInviteToken || hasConfirmToken;

    window.netlifyIdentity.on('init', (user) => {
      handleUser(user);
      if (isLoginPage && !user && hasAuthToken) {
        const action = hasRecoveryToken ? 'recovery' : 'signup';
        window.netlifyIdentity.open(action);
      }
    });
    window.netlifyIdentity.on('login', (user) => {
      handleUser(user);
      window.netlifyIdentity.close();
    });
    window.netlifyIdentity.on('logout', () => {
      handleUser(null);
    });
    const currentUser = window.netlifyIdentity.currentUser?.();
    if (currentUser) {
      handleUser(currentUser);
    }
    initTimer = window.setTimeout(() => {
      if (document.body.dataset.adminAuth === 'checking') {
        handleUser(null);
      }
    }, 500);

    window.netlifyIdentity.init();
  };

  const initModerationPanel = (user, superAdmin) => {
    if (!moderationList || !modal || moderationList.dataset.ready) return;
    moderationList.dataset.ready = 'true';
    const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

    const pendingContainer = document.querySelector('[data-admin-pending]');
    const verificationContainer = document.querySelector('[data-admin-verifications]');
    const rejectedContainer = document.querySelector('[data-admin-rejected]');
    const archiveContainer = document.querySelector('[data-admin-archive]');
    const auditContainer = document.querySelector('[data-admin-audit]');
    const template = document.querySelector('#moderation-card-template');
    const verificationTemplate = document.querySelector('#verification-card-template');
    const auditTemplate = document.querySelector('#audit-row-template');
    const archiveTemplate = document.querySelector('#archive-card-template');
    const partnersContainer = document.querySelector('[data-admin-partners-list]');
    const partnerForm = document.querySelector('[data-admin-partner-form]');
    const partnerResetButton = document.querySelector('[data-admin-partner-reset]');
    const loadingEl = pendingContainer?.querySelector('[data-admin-loading]');
    const emptyEl = pendingContainer?.querySelector('[data-admin-empty]');
    const verificationEmptyEl = verificationContainer?.querySelector('[data-admin-verifications-empty]');
    const rejectedEmptyEl = rejectedContainer?.querySelector('[data-admin-rejected-empty]');
    const archiveEmptyEl = archiveContainer?.querySelector('[data-admin-archive-empty]');
    const auditEmptyEl = auditContainer?.querySelector('[data-admin-audit-empty]');
    const pendingMoreButton = document.querySelector('[data-admin-more="pending"]');
    const verificationMoreButton = document.querySelector('[data-admin-more="verifications"]');
    const rejectedMoreButton = document.querySelector('[data-admin-more="rejected"]');
    const archiveMoreButton = document.querySelector('[data-admin-more="archive"]');
    const auditMoreButton = document.querySelector('[data-admin-more="audit"]');
    const modalDialog = modal.querySelector('.modal__dialog');
    const modalTextarea = modal.querySelector('textarea[name="reject-reason"]');
    const modalCloseButtons = modal.querySelectorAll('[data-modal-close]');
    const modalConfirm = modal.querySelector('[data-modal-confirm]');
    const editModal = document.querySelector('[data-admin-edit-modal]');
    const editDialog = editModal?.querySelector('.modal__dialog');
    const editForm = editModal?.querySelector('[data-admin-edit-form]');
    const editLinks = editModal?.querySelector('[data-admin-edit-links]');
    const editCloseButtons = editModal
      ? editModal.querySelectorAll('[data-admin-edit-close]')
      : [];
    const editSave = editModal?.querySelector('[data-admin-edit-save]');
    let activeCard = null;
    let lastTrigger = null;
    let activeEditId = null;
    let lastEditTrigger = null;
    const pendingById = new Map();
    const archiveById = new Map();
    let partnersById = new Map();
    let activePartnerId = null;
    const PAGE_SIZE = 5;
    const listLimits = {
      pending: PAGE_SIZE,
      verifications: PAGE_SIZE,
      rejected: PAGE_SIZE,
      archive: PAGE_SIZE,
      audit: PAGE_SIZE
    };

    const applyListPagination = (key, container, selector, button) => {
      if (!container) return;
      const items = Array.from(container.querySelectorAll(selector));
      const limit = listLimits[key] || PAGE_SIZE;
      items.forEach((item, index) => {
        item.hidden = index >= limit;
      });
      if (button) {
        button.hidden = items.length <= limit;
      }
    };

    const bumpListPagination = (key, container, selector, button) => {
      listLimits[key] = (listLimits[key] || PAGE_SIZE) + PAGE_SIZE;
      applyListPagination(key, container, selector, button);
    };

    const resetListPagination = (key) => {
      listLimits[key] = PAGE_SIZE;
    };

    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    if (pendingMoreButton) {
      pendingMoreButton.addEventListener('click', () =>
        bumpListPagination('pending', pendingContainer, '[data-admin-card]', pendingMoreButton)
      );
    }
    if (verificationMoreButton) {
      verificationMoreButton.addEventListener('click', () =>
        bumpListPagination(
          'verifications',
          verificationContainer,
          '[data-admin-verification-row]',
          verificationMoreButton
        )
      );
    }
    if (rejectedMoreButton) {
      rejectedMoreButton.addEventListener('click', () =>
        bumpListPagination('rejected', rejectedContainer, '[data-admin-card]', rejectedMoreButton)
      );
    }
    if (archiveMoreButton) {
      archiveMoreButton.addEventListener('click', () =>
        bumpListPagination('archive', archiveContainer, '[data-admin-archive-card]', archiveMoreButton)
      );
    }
    if (auditMoreButton) {
      auditMoreButton.addEventListener('click', () =>
        bumpListPagination('audit', auditContainer, '[data-admin-audit-row]', auditMoreButton)
      );
    }

    const openModal = (triggerButton, card) => {
      activeCard = card;
      lastTrigger = triggerButton;
      modal.hidden = false;
      if (modalTextarea) {
        modalTextarea.value = '';
        modalTextarea.focus();
      }
    };

    const closeModal = () => {
      modal.hidden = true;
      activeCard = null;
      if (lastTrigger) {
        lastTrigger.focus();
      }
    };

    const closeEditModal = () => {
      if (!editModal) return;
      editModal.hidden = true;
      activeEditId = null;
      if (lastEditTrigger) {
        lastEditTrigger.focus();
      }
    };

    const normalizeUrl = (value) => {
      const trimmed = String(value || '').trim();
      if (!trimmed) return '';
      if (/^https?:\/\//i.test(trimmed)) return trimmed;
      return `https://${trimmed}`;
    };

    const renderEditLinks = (payload) => {
      if (!editLinks) return;
      const entries = [
        { label: 'Website', value: payload['contact-website'] || payload.website },
        { label: 'Instagram', value: payload['contact-instagram'] },
        { label: 'Facebook', value: payload['contact-facebook'] },
        { label: 'Telegram', value: payload['contact-telegram'] }
      ]
        .map((entry) => ({ ...entry, url: normalizeUrl(entry.value) }))
        .filter((entry) => entry.url);
      if (!entries.length) {
        editLinks.innerHTML = '<span class="admin-edit__links-empty">Немає посилань.</span>';
        return;
      }
      editLinks.innerHTML = entries
        .map(
          (entry) =>
            `<a class="admin-edit__link" href="${entry.url}" target="_blank" rel="noopener">${entry.label}</a>`
        )
        .join('');
    };

    const openEditModal = (triggerButton, item) => {
      if (!editModal || !editForm) return;
      const payload = item?.payload || {};
      activeEditId = item?.id || null;
      lastEditTrigger = triggerButton;
      const setValue = (name, value) => {
        const field = editForm.querySelector(`[name="${CSS.escape(name)}"]`);
        if (!field) return;
        if (
          field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement ||
          field instanceof HTMLSelectElement
        ) {
          field.value = value ?? '';
        }
      };
      setValue('title', payload.title || item?.title || '');
      setValue('description', payload.description || '');
      const tagsValue = Array.isArray(payload.tags) ? payload.tags.join(', ') : payload.tags || '';
      setValue('tags', tagsValue);
      setValue('start', payload.start || '');
      setValue('end', payload.end || '');
      setValue('format', payload.format || '');
      setValue('address', payload.address || '');
      setValue('city', payload.city || '');
      setValue('ticket-type', payload['ticket-type'] || '');
      const min = payload['price-min'];
      const max = payload['price-max'];
      if (min !== undefined || max !== undefined) {
        setValue(
          'price',
          min && max ? `${min}–${max}` : min || max || ''
        );
      } else {
        setValue('price', payload.price || '');
      }
      setValue('ticket-url', payload['ticket-url'] || '');
      setValue('contact-name', payload['contact-name'] || '');
      setValue('contact-email', payload['contact-email'] || '');
      setValue('contact-phone', payload['contact-phone'] || '');
      setValue('contact-facebook', payload['contact-facebook'] || '');
      setValue('contact-instagram', payload['contact-instagram'] || '');
      setValue('contact-telegram', payload['contact-telegram'] || '');
      setValue('contact-website', payload['contact-website'] || '');
      renderEditLinks(payload);
      editModal.hidden = false;
      const firstField = editForm.querySelector('input, textarea, select');
      if (firstField instanceof HTMLElement) {
        firstField.focus();
      }
    };

    const updateStatus = (card, statusKey, reason) => {
      const statusPill = card.querySelector('.status-pill');
      const reasonText = card.querySelector('[data-admin-reason]');
      if (!statusPill) return;
      statusPill.textContent = formatMessage(statusKey, {});
      statusPill.classList.remove('status-pill--pending', 'status-pill--published', 'status-pill--draft');
      if (statusKey === 'admin_status_approved') {
        statusPill.classList.add('status-pill--published');
        if (reasonText) {
          reasonText.hidden = true;
        }
      } else if (statusKey === 'admin_status_rejected') {
        statusPill.classList.add('status-pill--draft');
        if (reasonText) {
          reasonText.hidden = false;
          const label = formatMessage('admin_reason_label', {});
          reasonText.textContent = reason ? `${label}: ${reason}` : `${label}: —`;
        }
      }
    };

    const renderHistory = (card, history) => {
      const historyEl = card.querySelector('[data-admin-history]');
      const historyList = card.querySelector('[data-admin-history-list]');
      if (!historyEl || !historyList) return;
      historyList.innerHTML = '';
      if (!history || history.length === 0) {
        historyEl.hidden = true;
        return;
      }
      history.forEach((entry) => {
        const li = document.createElement('li');
        const actionKey =
          entry.action === 'approve' ? 'admin_status_approved' : 'admin_status_rejected';
        const actionLabel = formatMessage(actionKey, {});
        const actor = entry.actorEmail || '—';
        const tsText = entry.ts ? new Date(entry.ts).toLocaleString(getUiLocale()) : '—';
        li.textContent = formatMessage('admin_history_entry', { action: actionLabel, actor, ts: tsText });
        historyList.appendChild(li);
      });
      historyEl.hidden = false;
    };

    const renderCards = (container, items, withActions) => {
      if (!container || !template) return;
      container.querySelectorAll('[data-admin-card]').forEach((card) => card.remove());
      items.forEach((item) => {
        const card = template.content.firstElementChild.cloneNode(true);
        card.dataset.eventId = item.id;
        const titleEl = card.querySelector('[data-admin-title]');
        const metaEl = card.querySelector('[data-admin-meta]');
        const descriptionEl = card.querySelector('[data-admin-description]');
        if (titleEl) titleEl.textContent = item.title;
        if (metaEl) metaEl.textContent = item.meta;
        if (descriptionEl) {
          const description = item.payload?.description || '';
          descriptionEl.textContent = description;
        }
        if (!withActions) {
          const actions = card.querySelector('[data-admin-actions]');
          if (actions) actions.remove();
          updateStatus(card, 'admin_status_rejected', item.reason);
        }
        renderHistory(card, item.history || []);
        if (withActions) {
          attachInlineEditHandlers(card);
        }
        container.appendChild(card);
      });
    };

    const getInlineEditElements = (card) => ({
      descriptionEl: card.querySelector('[data-admin-description]'),
      editor: card.querySelector('[data-admin-inline-edit]'),
      titleInput: card.querySelector('[data-admin-inline-title]'),
      descriptionInput: card.querySelector('[data-admin-inline-description]'),
      actions: card.querySelector('[data-admin-actions]'),
      inlineActions: card.querySelector('[data-admin-edit-actions]'),
      saveButton: card.querySelector('[data-admin-inline-save]'),
      cancelButton: card.querySelector('[data-admin-inline-cancel]')
    });

    const toggleInlineEditUI = (card, editing) => {
      const elems = getInlineEditElements(card);
      if (elems.descriptionEl) elems.descriptionEl.hidden = editing;
      if (elems.editor) elems.editor.hidden = !editing;
      if (elems.actions) elems.actions.hidden = editing;
      if (elems.inlineActions) elems.inlineActions.hidden = !editing;
      card.classList.toggle('is-editing', editing);
    };

    const populateInlineForm = (card, eventData) => {
      const elems = getInlineEditElements(card);
      const payload = eventData.payload || {};
      if (elems.titleInput) {
        elems.titleInput.value = payload.title || eventData.title || '';
      }
      if (elems.descriptionInput) {
        elems.descriptionInput.value = payload.description || '';
      }
    };

    const startInlineEdit = (card) => {
      const eventId = card.dataset.eventId;
      const eventData = pendingById.get(eventId);
      if (!eventData) return;
      populateInlineForm(card, eventData);
      toggleInlineEditUI(card, true);
      getInlineEditElements(card).titleInput?.focus();
    };

    const cancelInlineEdit = (card) => {
      const eventId = card.dataset.eventId;
      const eventData = pendingById.get(eventId);
      if (eventData) {
        populateInlineForm(card, eventData);
      }
      toggleInlineEditUI(card, false);
    };

    const saveInlineEdit = async (card) => {
      const eventId = card.dataset.eventId;
      if (!eventId) return;
      const eventData = pendingById.get(eventId);
      if (!eventData) return;
      const elems = getInlineEditElements(card);
      const titleValue = elems.titleInput?.value.trim() || eventData.title || '';
      const descriptionValue = elems.descriptionInput?.value.trim() || '';
      const tags = Array.isArray(eventData.payload?.tags)
        ? [...eventData.payload.tags]
        : [];
      const payload = {
        title: titleValue,
        description: descriptionValue,
        tags
      };
      const lastModifiedByAdmin = new Date().toISOString();
      if (elems.saveButton) elems.saveButton.disabled = true;
      if (elems.cancelButton) elems.cancelButton.disabled = true;
      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch('/.netlify/functions/update-event', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders
          },
          body: JSON.stringify({ id: eventId, payload, lastModifiedByAdmin })
        });
        if (!response.ok) throw new Error('update failed');
        const result = await response.json();
        if (!result?.ok) throw new Error('update failed');
        const nextPayload = {
          ...(eventData.payload || {}),
          ...payload
        };
        eventData.payload = nextPayload;
        eventData.title = payload.title;
        pendingById.set(eventId, eventData);
        const titleEl = card.querySelector('[data-admin-title]');
        const descriptionEl = card.querySelector('[data-admin-description]');
        if (titleEl) titleEl.textContent = payload.title;
        if (descriptionEl) descriptionEl.textContent = payload.description || '';
        toggleInlineEditUI(card, false);
      } catch (error) {
        console.error('Inline update failed', error);
      } finally {
        if (elems.saveButton) elems.saveButton.disabled = false;
        if (elems.cancelButton) elems.cancelButton.disabled = false;
      }
    };

    const attachInlineEditHandlers = (card) => {
      const editButton = card.querySelector('[data-action="inline-edit"]');
      const saveButton = card.querySelector('[data-admin-inline-save]');
      const cancelButton = card.querySelector('[data-admin-inline-cancel]');
      if (editButton) {
        editButton.addEventListener('click', () => startInlineEdit(card));
      }
      if (saveButton) {
        saveButton.addEventListener('click', () => saveInlineEdit(card));
      }
      if (cancelButton) {
        cancelButton.addEventListener('click', () => cancelInlineEdit(card));
      }
    };

    const renderVerifications = (items) => {
      if (!verificationContainer || !verificationTemplate) return;
      verificationContainer
        .querySelectorAll('[data-admin-verification-row]')
        .forEach((card) => card.remove());
      items.forEach((item) => {
        const row = verificationTemplate.content.firstElementChild.cloneNode(true);
        const nameEl = row.querySelector('[data-admin-verification-name]');
        const metaEl = row.querySelector('[data-admin-verification-meta]');
        const linkEl = row.querySelector('[data-admin-verification-link]');
        const link = item.link || '—';
        const createdAt = item.createdAt
          ? new Date(item.createdAt).toLocaleString(getUiLocale())
          : '—';
        row.dataset.link = item.link || '';
        row.dataset.name = item.name || link;
        if (nameEl) nameEl.textContent = item.name || link;
        if (metaEl) metaEl.textContent = createdAt;
        if (linkEl) {
          linkEl.href = item.link || '#';
          linkEl.textContent = item.link || '—';
        }
        verificationContainer.appendChild(row);
      });
    };

    const renderArchive = (items) => {
      if (!archiveContainer || !archiveTemplate) return;
      archiveContainer
        .querySelectorAll('[data-admin-archive-card]')
        .forEach((card) => card.remove());
      archiveById.clear();
      if (!items || items.length === 0) {
        if (archiveEmptyEl) archiveEmptyEl.hidden = false;
        return;
      }
      if (archiveEmptyEl) archiveEmptyEl.hidden = true;
      items.forEach((item) => {
        const resolvedId = item?.id || item?.payload?.id || '';
        const card = archiveTemplate.content.firstElementChild.cloneNode(true);
        if (resolvedId) {
          card.dataset.eventId = resolvedId;
        }
        const titleEl = card.querySelector('[data-admin-archive-title]');
        const linkEl = card.querySelector('[data-admin-archive-link]');
        const metaEl = card.querySelector('[data-admin-archive-meta]');
        if (titleEl) {
          titleEl.hidden = true;
        }
        if (linkEl) {
          linkEl.textContent = item.title || '—';
          if (resolvedId) {
            linkEl.href = `./event-card.html?id=${encodeURIComponent(resolvedId)}&admin=1`;
          } else {
            linkEl.removeAttribute('href');
            linkEl.setAttribute('aria-disabled', 'true');
          }
        } else if (titleEl) {
          titleEl.textContent = item.title || '—';
        }
        if (metaEl) metaEl.textContent = item.meta || '—';
        if (resolvedId) {
          archiveById.set(resolvedId, item.payload || item);
        }
        archiveContainer.appendChild(card);
      });
    };

    const getAuditStatusLabel = (action) => {
      switch (action) {
        case 'approve':
          return formatMessage('admin_status_approved', {});
        case 'reject':
          return formatMessage('admin_status_rejected', {});
        case 'publish':
          return formatMessage('admin_audit_action_publish', {});
        case 'edit':
          return formatMessage('admin_audit_action_edit', {});
        case 'archive':
          return formatMessage('admin_audit_action_archive', {});
        case 'restore':
          return formatMessage('admin_audit_action_restore', {});
        case 'delete':
          return formatMessage('admin_audit_action_delete', {});
        default:
          return formatMessage('admin_status_pending', {});
      }
    };

    const resolveAuditEventId = (entry) => {
      if (!entry) return '';
      if (entry.eventId) return entry.eventId;
      if (entry.id && !String(entry.id).startsWith('audit_')) {
        return entry.id;
      }
      return '';
    };

    const renderAudit = (items) => {
      if (!auditContainer || !auditTemplate) return;
      auditContainer.querySelectorAll('[data-admin-audit-row]').forEach((row) => row.remove());
      if (!items || items.length === 0) {
        if (auditEmptyEl) auditEmptyEl.hidden = false;
        return;
      }
      if (auditEmptyEl) auditEmptyEl.hidden = true;
      items.forEach((entry) => {
        const row = auditTemplate.content.firstElementChild.cloneNode(true);
        const resolvedEventId = resolveAuditEventId(entry);
        if (resolvedEventId) {
          row.dataset.eventId = resolvedEventId;
        }
        row.dataset.action = entry.action || '';
        const titleEl = row.querySelector('[data-admin-audit-title]');
        const linkEl = row.querySelector('[data-admin-audit-link]');
        const metaEl = row.querySelector('[data-admin-audit-meta]');
        const statusEl = row.querySelector('[data-admin-audit-status]');
        const reasonEl = row.querySelector('[data-admin-audit-reason]');
        if (titleEl) {
          titleEl.hidden = true;
        }
        if (linkEl) {
          linkEl.textContent = entry.title;
          if (resolvedEventId && entry.action !== 'delete') {
            linkEl.href = `./event-card.html?id=${encodeURIComponent(resolvedEventId)}&admin=1`;
          } else {
            linkEl.removeAttribute('href');
            linkEl.setAttribute('aria-disabled', 'true');
            if (titleEl) {
              titleEl.textContent = entry.title;
              titleEl.hidden = false;
            }
            linkEl.hidden = true;
          }
        } else if (titleEl) {
          titleEl.textContent = entry.title;
        }
        const actor = entry.actorEmail || '—';
        const ts = entry.ts ? new Date(entry.ts).toLocaleString(getUiLocale()) : '—';
        if (metaEl) metaEl.textContent = `${actor} · ${ts}`;
        if (statusEl) {
          statusEl.textContent = getAuditStatusLabel(entry.action);
          statusEl.classList.remove('status-pill--pending', 'status-pill--published', 'status-pill--draft');
          if (entry.action === 'approve' || entry.action === 'publish') {
            statusEl.classList.add('status-pill--published');
          } else if (entry.action === 'reject' || entry.action === 'delete' || entry.action === 'archive') {
            statusEl.classList.add('status-pill--draft');
          } else {
            statusEl.classList.add('status-pill--pending');
          }
        }
        if (reasonEl) {
          if (entry.reason) {
            const label = formatMessage('admin_reason_label', {});
            reasonEl.textContent = `${label}: ${entry.reason}`;
            reasonEl.hidden = false;
          } else {
            reasonEl.hidden = true;
          }
        }
        auditContainer.appendChild(row);
      });
    };

    const setEmptyState = (el, isEmpty) => {
      if (!el) return;
      el.hidden = !isEmpty;
    };

    const getAuthHeaders = async () => {
      const token = user?.token?.access_token || (await getIdentityToken());
      return token ? { Authorization: `Bearer ${token}` } : {};
    };

    const formatEventMeta = (event) => {
      if (!event) return '—';
      const dateValue = event.start ? new Date(event.start) : null;
      const dateLabel =
        dateValue && !Number.isNaN(dateValue.getTime())
          ? dateValue.toLocaleDateString(getUiLocale(), { day: '2-digit', month: 'short' })
          : '—';
      const city = event.city || '—';
      return `${dateLabel} · ${city}`;
    };

    const fileToDataUrl = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('file_read_error'));
        reader.readAsDataURL(file);
      });

    const parseFaqRows = (value) =>
      String(value || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [question, answer] = line.split('||').map((item) => item.trim());
          return { question: question || '', answer: answer || '' };
        })
        .filter((entry) => entry.question || entry.answer);

    const resetPartnerForm = () => {
      if (!(partnerForm instanceof HTMLFormElement)) return;
      partnerForm.reset();
      const idField = partnerForm.elements.namedItem('id');
      if (idField instanceof HTMLInputElement) idField.value = '';
      const sortField = partnerForm.elements.namedItem('sort_order');
      if (sortField instanceof HTMLInputElement) sortField.value = '0';
      const activeField = partnerForm.elements.namedItem('is_active');
      if (activeField instanceof HTMLInputElement) activeField.checked = true;
      activePartnerId = null;
    };

    const mapPartnerFromForm = async () => {
      if (!(partnerForm instanceof HTMLFormElement)) return null;
      const formData = new FormData(partnerForm);
      const id = String(formData.get('id') || '').trim();
      const websiteUrlInput = String(formData.get('website_url') || '').trim();
      const deriveNameFromWebsite = (value) => {
        if (!value) return '';
        try {
          const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
          const host = new URL(normalized).hostname.replace(/^www\./i, '').trim();
          return host || '';
        } catch (error) {
          return '';
        }
      };
      const nameInput = String(formData.get('name') || '').trim();
      const derivedWebsiteName = deriveNameFromWebsite(websiteUrlInput);
      const name = nameInput || derivedWebsiteName || 'Партнер';
      const slugInput = String(formData.get('slug') || '').trim();
      const slug = normalizePartnerSlug(slugInput || name);
      const websiteUrl = websiteUrlInput;
      const logoUrl = String(formData.get('logo_url') || '').trim();
      const sortOrder = Number(formData.get('sort_order') || 0);
      const hasDetailPage = formData.get('has_detail_page') === 'on';
      const isActive = formData.get('is_active') === 'on';
      const forWhom = String(formData.get('detail_for_whom') || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const detailContent = {
        title: name,
        description: String(formData.get('detail_description') || '').trim(),
        forWhom,
        ctaLabel: String(formData.get('detail_cta_label') || '').trim(),
        ctaUrl: String(formData.get('detail_cta_url') || '').trim(),
        bonus: String(formData.get('detail_bonus') || '').trim(),
        faq: parseFaqRows(formData.get('detail_faq') || '')
      };
      const logoFile = formData.get('logo_file');
      let logoDataUrl = '';
      if (logoFile instanceof File && logoFile.size > 0) {
        logoDataUrl = await fileToDataUrl(logoFile);
      }
      return {
        id,
        name,
        slug,
        websiteUrl,
        logoUrl,
        logoDataUrl,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
        hasDetailPage,
        isActive,
        detailContent
      };
    };

    const renderPartnersList = (partners) => {
      if (!partnersContainer) return;
      const sorted = sortPartners(Array.isArray(partners) ? partners : []);
      partnersById = new Map(sorted.map((partner) => [partner.id, partner]));
      partnersContainer.innerHTML = sorted
        .map((partner) => {
          const logoUrl = partner.logoUrl || '';
          const activeLabel = partner.isActive ? 'Активний' : 'Неактивний';
          const detailLabel = partner.hasDetailPage ? 'Є detail' : 'Без detail';
          return `
            <article class="admin-partner-card" data-admin-partner-id="${partner.id}">
              <div>
                <strong>${partner.name || '—'}</strong>
                <p>${partner.slug || '—'} · ${activeLabel} · ${detailLabel}</p>
                <p>${partner.websiteUrl || ''}</p>
              </div>
              <div>
                ${logoUrl ? `<img class="admin-partner-card__logo" src="${logoUrl}" alt="${partner.name || ''}" />` : ''}
                <div class="admin-partner-card__actions">
                  <button class="btn ghost" type="button" data-action="edit-partner">Редагувати</button>
                  <button class="btn ghost" type="button" data-action="toggle-partner">${partner.isActive ? 'Деактивувати' : 'Активувати'}</button>
                  <button class="btn ghost" type="button" data-action="delete-partner">Видалити</button>
                </div>
              </div>
            </article>
          `;
        })
        .join('');
    };

    const setPartnerFormValues = (partner) => {
      if (!(partnerForm instanceof HTMLFormElement)) return;
      const setValue = (name, value) => {
        const field = partnerForm.elements.namedItem(name);
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
          field.value = value ?? '';
        }
      };
      setValue('id', partner.id || '');
      setValue('name', partner.name || '');
      setValue('slug', partner.slug || '');
      setValue('website_url', partner.websiteUrl || '');
      setValue('logo_url', partner.logoUrl || '');
      setValue('sort_order', String(partner.sortOrder ?? 0));
      const activeField = partnerForm.elements.namedItem('is_active');
      if (activeField instanceof HTMLInputElement) activeField.checked = partner.isActive !== false;
      const detailField = partnerForm.elements.namedItem('has_detail_page');
      if (detailField instanceof HTMLInputElement) detailField.checked = partner.hasDetailPage === true;
      const detail = partner.detailContent || {};
      setValue('detail_description', detail.description || '');
      setValue('detail_for_whom', Array.isArray(detail.forWhom) ? detail.forWhom.join('\n') : '');
      setValue('detail_cta_label', detail.ctaLabel || '');
      setValue('detail_cta_url', detail.ctaUrl || '');
      setValue('detail_bonus', detail.bonus || '');
      setValue(
        'detail_faq',
        Array.isArray(detail.faq)
          ? detail.faq
              .map((entry) => `${entry.question || ''} || ${entry.answer || ''}`)
              .join('\n')
          : ''
      );
      activePartnerId = partner.id || null;
    };

    const loadPartners = async () => {
      if (!partnersContainer && !(partnerForm instanceof HTMLFormElement)) {
        return;
      }
      try {
        if (isLocalHost) {
          const localPartners = getLocalPartners();
          renderPartnersList(localPartners);
          return;
        }
        const authHeaders = await getAuthHeaders();
        const response = await fetch('/.netlify/functions/admin-partners', {
          headers: { 'Content-Type': 'application/json', ...authHeaders }
        });
        if (!response.ok) throw new Error('partners_failed');
        const payload = await response.json();
        renderPartnersList(Array.isArray(payload?.partners) ? payload.partners : []);
      } catch (error) {
        renderPartnersList([]);
      }
    };

    const loadModerationQueue = async () => {
      if (loadingEl) loadingEl.hidden = false;
      if (emptyEl) emptyEl.hidden = true;
      if (verificationEmptyEl) verificationEmptyEl.hidden = true;
      if (rejectedEmptyEl) rejectedEmptyEl.hidden = true;
      if (archiveEmptyEl) archiveEmptyEl.hidden = true;
      if (auditEmptyEl) auditEmptyEl.hidden = true;
      try {
        const lang = 'uk';
        const authHeaders = await getAuthHeaders();
        const response = await fetch(`/.netlify/functions/admin-events?lang=${encodeURIComponent(lang)}`, {
          headers: { 'Content-Type': 'application/json', ...authHeaders, 'x-locale': lang }
        });
        if (!response.ok) {
          throw new Error('admin events failed');
        }
        const result = await response.json();
        const pending = Array.isArray(result?.pending) ? result.pending : [];
        const rejected = Array.isArray(result?.rejected) ? result.rejected : [];
        const audit = Array.isArray(result?.audit) ? result.audit : [];
        const verifications = Array.isArray(result?.verifications) ? result.verifications : [];
        const archive = Array.isArray(result?.archive) ? result.archive : [];
        pendingById.clear();
        pending.forEach((item) => {
          if (item?.id) pendingById.set(item.id, item);
        });
        renderCards(pendingContainer, pending, true);
        renderCards(rejectedContainer, rejected, false);
        renderVerifications(verifications);
        resetListPagination('pending');
        resetListPagination('rejected');
        resetListPagination('verifications');
        applyListPagination('pending', pendingContainer, '[data-admin-card]', pendingMoreButton);
        applyListPagination('rejected', rejectedContainer, '[data-admin-card]', rejectedMoreButton);
        applyListPagination(
          'verifications',
          verificationContainer,
          '[data-admin-verification-row]',
          verificationMoreButton
        );
        setEmptyState(emptyEl, pending.length === 0);
        setEmptyState(verificationEmptyEl, verifications.length === 0);
        setEmptyState(rejectedEmptyEl, rejected.length === 0);
        renderAudit(audit);
        resetListPagination('audit');
        applyListPagination('audit', auditContainer, '[data-admin-audit-row]', auditMoreButton);
        renderArchive(archive);
        resetListPagination('archive');
        applyListPagination('archive', archiveContainer, '[data-admin-archive-card]', archiveMoreButton);
        if (archive.length === 0 && isLocalHost) {
          const mergedEvents = await fetchMergedLocalEvents();
          const archived = mergedEvents
            .filter((item) => item?.archived === true || item?.status === 'archived')
            .map((item) => ({
              id: item.id,
              title: item.title,
              meta: formatEventMeta(item),
              payload: { ...item, __source: 'local' }
            }));
          renderArchive(archived);
          resetListPagination('archive');
          applyListPagination('archive', archiveContainer, '[data-admin-archive-card]', archiveMoreButton);
          const localAudit = getAuditLog();
          if (localAudit.length) {
            renderAudit(localAudit);
            resetListPagination('audit');
            applyListPagination('audit', auditContainer, '[data-admin-audit-row]', auditMoreButton);
          }
        }
      } catch (error) {
        setEmptyState(emptyEl, true);
        setEmptyState(verificationEmptyEl, true);
        setEmptyState(rejectedEmptyEl, true);
        if (auditEmptyEl) auditEmptyEl.hidden = false;
        if (isLocalHost) {
          try {
            const mergedEvents = await fetchMergedLocalEvents();
            const archived = mergedEvents
              .filter((item) => item?.archived === true || item?.status === 'archived')
              .map((item) => ({
                id: item.id,
                title: item.title,
                meta: formatEventMeta(item),
                payload: { ...item, __source: 'local' }
              }));
            renderArchive(archived);
            resetListPagination('archive');
            applyListPagination('archive', archiveContainer, '[data-admin-archive-card]', archiveMoreButton);
            const localAudit = getAuditLog();
            if (localAudit.length) {
              renderAudit(localAudit);
              resetListPagination('audit');
              applyListPagination('audit', auditContainer, '[data-admin-audit-row]', auditMoreButton);
            }
          } catch (localError) {
            if (archiveEmptyEl) archiveEmptyEl.hidden = false;
          }
        } else if (archiveEmptyEl) {
          archiveEmptyEl.hidden = false;
        }
      } finally {
        if (loadingEl) loadingEl.hidden = true;
      }
    };

    const sendModerationAction = async (eventId, action, reason, payload) => {
      try {
        const body = { id: eventId, action, reason };
        if (payload && typeof payload === 'object') {
          body.payload = payload;
        }
        const authHeaders = await getAuthHeaders();
        await fetch('/.netlify/functions/admin-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify(body)
        });
      } catch (error) {
        // Ignore network errors for optimistic UI.
      }
    };

    const sendVerificationAction = async ({ link, name, action }) => {
      try {
        const authHeaders = await getAuthHeaders();
        await fetch('/.netlify/functions/admin-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ link, name, action })
        });
      } catch (error) {
        // Ignore network errors for optimistic UI.
      }
    };

    const isLocalEventId = (id) => String(id || '').startsWith('evt-local-');

    const sendArchiveAction = async (eventId, action) => {
      if (isLocalEventId(eventId)) {
        try {
          const merged = await fetchMergedLocalEvents();
          const localEvent = merged.find((item) => item?.id === eventId);
          if (!localEvent) return;
          if (action === 'archive') {
            archiveLocalEvent(localEvent, user?.email || 'admin');
          } else if (action === 'restore') {
            restoreLocalEvent(localEvent, user?.email || 'admin');
          } else if (action === 'delete') {
            deleteLocalEvent(localEvent, user?.email || 'admin');
          }
        } catch {
          return;
        }
        return;
      }
      try {
        const authHeaders = await getAuthHeaders();
        await fetch('/.netlify/functions/admin-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ id: eventId, action })
        });
      } catch (error) {
        // Ignore network errors for optimistic UI.
      }
    };

    if (pendingContainer) {
      pendingContainer.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const card = target.closest('[data-admin-card]');
        if (!card) return;
        const eventId = card.dataset.eventId || '';
        if (target.dataset.action === 'view') {
          const item = pendingById.get(eventId);
          if (item) {
            openEditModal(target, item);
          }
          return;
        }
        if (target.dataset.action === 'approve') {
          updateStatus(card, 'admin_status_approved');
          sendModerationAction(eventId, 'approve').then(loadModerationQueue);
        }
        if (target.dataset.action === 'reject') {
          openModal(target, card);
        }
      });
    }

    if (verificationContainer) {
      verificationContainer.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.dataset.action !== 'approve-verification') return;
        const card = target.closest('[data-admin-verification-row]');
        if (!card) return;
        const link = card.dataset.link || '';
        const name = card.dataset.name || '';
        sendVerificationAction({ link, name, action: 'approve' });
        card.remove();
        const remaining =
          verificationContainer.querySelectorAll('[data-admin-verification-row]').length === 0;
        setEmptyState(verificationEmptyEl, remaining);
      });
    }

    if (archiveContainer) {
      archiveContainer.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest('a')) return;
        const card = target.closest('[data-admin-archive-card]');
        if (!card) return;
        const eventId = card.dataset.eventId || '';
        const eventData = archiveById.get(eventId);
        if (target.dataset.action === 'restore' && eventId) {
          if (eventData?.__source === 'local') {
            restoreLocalEvent(eventData, user?.email || 'admin');
            loadModerationQueue();
            return;
          }
          sendArchiveAction(eventId, 'restore').then(loadModerationQueue);
          return;
        }
        if (target.dataset.action === 'delete' && eventId) {
          if (!window.confirm(formatMessage('admin_confirm_delete', {}))) {
            return;
          }
          if (eventData?.__source === 'local') {
            deleteLocalEvent(eventData, user?.email || 'admin');
            loadModerationQueue();
            return;
          }
          sendArchiveAction(eventId, 'delete').then(loadModerationQueue);
          return;
        }
        if (target.dataset.action === 'edit-archive' && eventId) {
          window.location.href = `./new-event.html?id=${encodeURIComponent(eventId)}`;
          return;
        }
        if (eventId) {
          window.location.href = `./event-card.html?id=${encodeURIComponent(eventId)}&admin=1`;
        }
      });
    }

    if (auditContainer) {
      auditContainer.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest('a')) return;
        const row = target.closest('[data-admin-audit-row]');
        if (!row) return;
        const eventId = row.dataset.eventId || '';
        const action = row.dataset.action || '';
        if (!eventId || action === 'delete') return;
        window.location.href = `./event-card.html?id=${encodeURIComponent(eventId)}&admin=1`;
      });
    }

    modalCloseButtons.forEach((button) => {
      button.addEventListener('click', () => {
        closeModal();
      });
    });

    if (modalConfirm) {
      modalConfirm.addEventListener('click', () => {
        if (!activeCard || !modalTextarea) return;
        if (!modalTextarea.checkValidity()) {
          modalTextarea.reportValidity();
          return;
        }
        const reason = modalTextarea.value.trim();
        updateStatus(activeCard, 'admin_status_rejected', reason);
        sendModerationAction(activeCard.dataset.eventId || '', 'reject', reason).then(
          loadModerationQueue
        );
        closeModal();
      });
    }

    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;
      if (!modalDialog) return;
      const focusable = Array.from(modalDialog.querySelectorAll(focusableSelector));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    if (editModal) {
      editCloseButtons.forEach((button) => {
        button.addEventListener('click', () => {
          closeEditModal();
        });
      });

      editModal.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeEditModal();
          return;
        }
        if (event.key !== 'Tab') return;
        if (!editDialog) return;
        const focusable = Array.from(editDialog.querySelectorAll(focusableSelector));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });
    }

    if (editForm) {
      editForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!activeEditId) return;
        if (!editSave) return;
        editSave.disabled = true;
        const formData = new FormData(editForm);
        const payload = Object.fromEntries(formData.entries());
        try {
          const authHeaders = await getAuthHeaders();
          const response = await fetch('/.netlify/functions/admin-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ id: activeEditId, action: 'edit', payload })
          });
          if (!response.ok) throw new Error('edit failed');
          await loadModerationQueue();
          closeEditModal();
        } catch (error) {
          // Ignore edit failures for now.
        } finally {
          editSave.disabled = false;
        }
      });
    }

    if (partnersContainer) {
      partnersContainer.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const card = target.closest('[data-admin-partner-id]');
        if (!card) return;
        const partnerId = card.dataset.adminPartnerId || '';
        const partner = partnersById.get(partnerId);
        if (!partner) return;

        if (target.dataset.action === 'edit-partner') {
          setPartnerFormValues(partner);
          const nameField = partnerForm?.elements?.namedItem('name');
          if (nameField instanceof HTMLElement) nameField.focus();
          return;
        }

        if (target.dataset.action === 'toggle-partner') {
          const payload = { ...partner, isActive: !partner.isActive };
          if (isLocalHost) {
            upsertLocalPartner(payload);
            await loadPartners();
            return;
          }
          try {
            const authHeaders = await getAuthHeaders();
            await fetch('/.netlify/functions/admin-partners', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...authHeaders },
              body: JSON.stringify(payload)
            });
          } catch (error) {
            // Ignore network failure.
          }
          await loadPartners();
          return;
        }

        if (target.dataset.action === 'delete-partner') {
          if (!window.confirm('Видалити партнера?')) return;
          if (isLocalHost) {
            deleteLocalPartner(partnerId);
            await loadPartners();
            if (activePartnerId === partnerId) resetPartnerForm();
            return;
          }
          try {
            const authHeaders = await getAuthHeaders();
            await fetch(`/.netlify/functions/admin-partners?id=${encodeURIComponent(partnerId)}`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', ...authHeaders }
            });
          } catch (error) {
            // Ignore network failure.
          }
          await loadPartners();
          if (activePartnerId === partnerId) resetPartnerForm();
        }
      });
    }

    if (partnerForm instanceof HTMLFormElement) {
      partnerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = await mapPartnerFromForm();
        if (!payload?.name || !payload?.slug) {
          return;
        }
        if (isLocalHost) {
          const localId =
            payload.id ||
            `partner-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const logoUrl = payload.logoDataUrl || payload.logoUrl || '';
          upsertLocalPartner({
            id: localId,
            name: payload.name,
            slug: payload.slug,
            logoUrl,
            websiteUrl: payload.websiteUrl,
            hasDetailPage: payload.hasDetailPage,
            isActive: payload.isActive,
            sortOrder: payload.sortOrder,
            detailContent: payload.detailContent
          });
          resetPartnerForm();
          await loadPartners();
          return;
        }
        try {
          const authHeaders = await getAuthHeaders();
          await fetch('/.netlify/functions/admin-partners', {
            method: payload.id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify(payload)
          });
          resetPartnerForm();
          await loadPartners();
        } catch (error) {
          // Ignore network failure.
        }
      });
    }

    if (partnerResetButton instanceof HTMLButtonElement) {
      partnerResetButton.addEventListener('click', () => {
        resetPartnerForm();
      });
    }

    loadModerationQueue();
    loadPartners();
  };

  setupAdminAuth();
};
