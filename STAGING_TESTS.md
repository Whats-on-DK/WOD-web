# Staging Tests (What’s on DK)

Це окремий набір тестів для прогону після деплою на staging.

## Підготовка (один раз на сесію)
```bash
export STAGING_BASE_URL="https://<preview-or-staging-site>.netlify.app"
```

Для адмін-циклу (створення/редагування/архів/restore/delete) також потрібен:
```bash
export ADMIN_JWT="YOUR_ADMIN_BEARER_TOKEN"
```

## Рекомендований запуск перед merge в `main`

### 1) Quick smoke (швидко)
```bash
npm run test:e2e:staging
```

### 2) Extended e2e (детальніше)
```bash
npm run test:e2e:staging:extended
```

### 3) Admin lifecycle (реальні мутації на staging DB)
```bash
npm run test:staging:admin-cycle
npm run test:staging:admin-cycle:extended
```

### 4) Повний pre-merge прогін (рекомендовано)
```bash
npm run test:staging:premerge
```

## Що перевіряє набір

### Quick smoke
- головна + каталог відкриваються
- меню `Поділитися` працює
- `Messenger` є і стоїть після `Facebook`
- social href + UTM коректні
- `Copy link` показує toast
- mobile: `Messenger` є, `Instagram Stories` відсутній

### Extended e2e
- відкриття/закриття розширених фільтрів
- `Вибрані` фільтр з локально збереженою подією
- на detail-сторінці доступні `Поділитися` і `Додати в календар`
- `Messenger` URL посилається на `/.netlify/functions/share-event?id=...`
- mobile share-меню містить очікувані канали

### Admin lifecycle (реальні перевірки CRUD)
- створення події через `submit-event`
- читання через `admin-event`
- редагування через `admin-update`
- архівація, відновлення, видалення
- валідація, що статуси реально змінюються у staging даних

## Корисні команди

### Запуск у видимому браузері
```bash
npm run test:e2e:staging:headed
npm run test:e2e:staging:extended:headed
```

### HTML звіт
```bash
npm run test:e2e:report
```

## Важливо
- Ці тести працюють проти реального staging середовища.
- `test:staging:admin-cycle*` змінює staging дані (створює/редагує/архівує/видаляє тестову подію).
- Якщо на staging немає опублікованих подій, частина e2e може бути `skipped` — це нормально.
- Продакшен ці тести не зачіпають.
