import { renderStarButton } from '../modules/saved-events.js';

const buildTagMarkup = (tag, helpers) => {
  const { formatMessage, getLocalizedTag } = helpers;
  const isPending = tag.status === 'pending';
  const pendingClass = isPending ? ' event-card__tag--pending' : '';
  const localizedLabel = getLocalizedTag(tag.label);
  const ariaKey = isPending ? 'tag_pending_aria' : 'tag_aria';
  const ariaLabel = formatMessage(ariaKey, { label: localizedLabel });
  const pendingTooltip = isPending ? formatMessage('pending_tooltip', {}) : '';
  const pendingAttrs = pendingTooltip ? ` title="${pendingTooltip}"` : '';
  return `<span class="event-card__tag${pendingClass}" aria-label="${ariaLabel}" data-tag-label="${localizedLabel}"${pendingAttrs}>${localizedLabel}</span>`;
};

export const EventCard = (event, helpers) => {
  const {
    formatPriceLabel,
    formatMessage,
    getTagList,
    getLocalizedTag,
    getLocalizedEventTitle,
    getLocalizedCity,
    formatDateRange,
    isPast,
    isArchived
  } = helpers;
  const normalizePart = (value) => String(value || '').trim().toLowerCase();
  const ONLINE_PATTERN = /zoom|google meet|meet\.google|teams\.microsoft|teams|online|webinar/i;
  const normalizeLocationPart = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const image = event.images && event.images.length ? event.images[0] : '';
  const priceInfo =
    event.priceType === 'free'
      ? {
          label: formatPriceLabel('free'),
          className: 'event-card__price--free'
        }
      : {
          label: formatPriceLabel(event.priceType, event.priceMin, event.priceMax),
          className: 'event-card__price--paid'
        };
  const isFree = event.priceType === 'free';
  const pastEvent = isPast(event);
  const archivedEvent = isArchived ? isArchived(event) : false;
  const title = getLocalizedEventTitle(event);
  const languageLabel = typeof helpers.getLanguageLabel === 'function'
    ? helpers.getLanguageLabel(event.language)
    : event.language || '';
  const imageMarkup = image
    ? `<img class="poster-card__img event-card__image" src="${image}" alt="${title}" loading="lazy" width="800" height="1200" />`
    : '<div class="poster-card__placeholder event-card__image event-card__image--placeholder" aria-hidden="true"></div>';
  const cardClass = `event-card ${isFree ? 'event-card--free' : 'event-card--paid'}${
    pastEvent || archivedEvent ? ' event-card--archived' : ''
  }`;
  const archivedLabel = formatMessage('archived_label', {});
  const archivedMarkup = archivedEvent
    ? `<span class="event-card__status" aria-label="${archivedLabel}">${archivedLabel}</span>`
    : '';
  const baseTags = getTagList(event.tags);
  const firstTag = baseTags.length ? buildTagMarkup(baseTags[0], helpers) : '';
  const rawTicketUrl = event.ticketUrl || '';
  const detailUrl = `event-card.html?id=${encodeURIComponent(event.id)}`;
  const cta =
    event.priceType !== 'free'
      ? {
          label: formatMessage('ticket_cta', {}),
          href: rawTicketUrl || detailUrl,
          className: 'event-card__cta--ticket'
        }
      : rawTicketUrl
        ? {
            label: formatMessage('register_cta', {}),
            href: rawTicketUrl,
            className: 'event-card__cta--ticket'
          }
        : {
            label: formatMessage('cta_details', {}),
            href: detailUrl,
            className: 'event-card__cta--details'
          };
  const formatValue = String(event.format || '').toLowerCase();
  const onlineLocationText = [event.address, event.venue].filter(Boolean).join(' ');
  const isOnline = formatValue.includes('online') || ONLINE_PATTERN.test(onlineLocationText);
  const cityLabel = isOnline
    ? formatMessage('online', {}) || 'Онлайн'
    : getLocalizedCity(event.city);
  const location = cityLabel ? cityLabel : '';
  const languageMarkup = languageLabel ? `<p class="event-card__language">${languageLabel}</p>` : '';
  const statusLabel = archivedEvent ? 'archived' : pastEvent ? 'past' : 'active';
  const firstTagMarkup = firstTag ? `<div class="event-card__tags">${firstTag}</div>` : '';
  return `
        <article class="${cardClass}" data-event-id="${event.id}" data-status="${statusLabel}" data-testid="event-card">
          ${archivedMarkup}
          <div class="poster-card poster-card--catalog">
            <div class="poster-card__media">
              ${imageMarkup}
              <a class="poster-card__cover-link" href="${detailUrl}" aria-label="${title}"></a>
              ${renderStarButton(event.id, 'catalog')}
              <div class="poster-card__overlay">
                <div class="poster-card__content">
                  <div class="event-card__meta">
                    <div class="event-card__meta-left">
                      <span class="event-card__datetime">${formatDateRange(event.start, event.end)}</span>
                      <span class="event-card__price ${priceInfo.className}">${priceInfo.label}</span>
                    </div>
                  </div>
                  <div class="poster-card__bottom poster-card__bottom--center">
                    <h3 class="poster-card__title event-card__title">
                      <a class="event-card__link" href="${detailUrl}">${title}</a>
                    </h3>
                    <p class="poster-card__meta event-card__location">${location}</p>
                    ${languageMarkup}
                    ${firstTagMarkup}
                    <div class="event-card__actions">
                      <a class="event-card__cta ${cta.className}" href="${cta.href}" rel="noopener" data-testid="ticket-cta">${cta.label}</a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </article>
      `;
};
