# Инфраструктура MVP — Lesichi

## Цель этапа
Поднять backend, базу, auth и окружение, чтобы дальше строить кабинет, запись и оплату.

## Стек (зафиксировано)
| Компонент | Решение |
|-----------|---------|
| Backend + БД + Auth | Supabase (PostgreSQL) |
| Фронт (пока) | GitHub Pages / статический сайт |
| Секреты | Supabase Dashboard + `.env` (не в git) |
| Бэкапы | Автобэкапы Supabase (Pro) или ручной export |
| CI/CD фронта | GitHub → Pages (как сейчас) |

## Шаг 1. Аккаунты
1. [supabase.com](https://supabase.com) — создать organization + project `lesichi`
2. Регион: ближайший (например Frankfurt `eu-central-1`)
3. Сохранить: **Project URL**, **anon key**, **service_role key** (service_role — только сервер, не в фронт)

## Шаг 2. База
1. Supabase → SQL Editor
2. Выполнить файл `supabase/schema.sql` целиком
3. Table Editor: проверить таблицы `profiles`, `sessions`, `bookings` и т.д.

## Шаг 3. Auth
1. Authentication → Providers
2. Включить **Email** (и при желании Google / позже Telegram)
3. Site URL: пока `http://localhost:3000` или URL сайта
4. Redirect URLs: добавить production URL GitHub Pages / домен

## Шаг 4. Секреты (локально)
Сайт статический, поэтому ключи в сборку не подставляются: публичные URL и publishable (anon) key лежат в `js/config.js`.
`service_role` key нигде в репозитории не хранить. Если он понадобится для админ-скриптов или edge functions, держи его
в `.env.local` (в git не коммитится, правило есть в `.gitignore`):

```env
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

## Шаг 5. Роли
- `authenticated` — ученик (видит себя, свои записи)
- `service_role` / запись в `admin_users` — админ

Функции `claim_first_admin` больше нет (по ней первый вызвавший мог стать админом). Админа добавлять только вручную после его первого входа:

```sql
insert into public.admin_users (user_id) values ('uuid-пользователя');
```

## Шаг 6. Бэкапы
- Free: периодически Export schema + data из Table Editor
- Pro: включить Point-in-Time Recovery

## Шаг 7. Домен и хостинг (можно параллельно)
- Домен → DNS
- Фронт: GitHub Pages или Vercel
- Позже: кастомный домен в Supabase Auth redirect

## Что НЕ делаем на этом этапе
- Оплату, Telegram-бота, CRM UI
- Переписывание всего сайта на React

## Кабинет
Страница `cabinet.html` уже ходит в Supabase: регистрация, вход, профиль, баланс, запись и отмена.

1. Выполнить по очереди в SQL Editor: `supabase/schema.sql`, `rebook.sql`, `admin.sql`, `speakers.sql`, затем **`hardening.sql`** (безопасность и исправления логики; идемпотентный, перед первым запуском сделай бэкап).
2. Вписать URL и anon key в `js/config.js`.
3. Authentication → URL Configuration: Site URL и Redirect — адрес `cabinet.html` на GitHub Pages.
4. Authentication → Providers → Email → **включить Confirm email**. Без этого бесплатное занятие можно получать, регистрируя любые выдуманные адреса.

### Как это устроено после `hardening.sql`
- **Запись и отмена** — только через функции `book_session` и `cancel_booking`. Прямые `insert/update` в `bookings` пользователю запрещены. Отмена возможна не позднее чем за 2 часа до начала (интервал меняется в `cancel_booking`).
- **Бесплатное занятие** выдаёт `claim_welcome_session()`: один раз на нормализованный email (точки и `+tag` в gmail не считаются) и только после подтверждения почты. Кабинет вызывает её при загрузке.
- **Zoom-ссылки** лежат в таблице `session_links`: их видят админ и пользователи, записанные на этот созвон. Публичный view `sessions_with_seats` ссылок не содержит.
- **Покупка**: `create_order(code)` создаёт платёж `pending`. Когда админ ставит ему статус `paid` (вкладка «Оплаты»), триггер один раз добавляет занятия; `refunded`/`failed` их снимает. Подключая настоящий эквайринг, ставь статус `paid` из вебхука (edge function с `service_role`), а не с клиента.
- **Админские операции**: `admin_delete_session` (возвращает занятия записанным и удаляет созвон) и `admin_set_booking_status` (возврат/списание занятия и пересчёт мест).

## Защита от паузы Supabase (free-план)

Free-проекты Supabase приостанавливаются после недели без активности: сайт при этом перестаёт входить, записывать и показывать созвоны.
Workflow `.github/workflows/keepalive.yml` дважды в неделю (пн и чт) делает лёгкий запрос к базе (`packages`, читается анонимно), URL и публичный ключ берёт из `js/config.js`.

- После первого пуша запусти его вручную один раз: GitHub → Actions → **Keep Supabase awake** → Run workflow. Зелёная галочка означает, что запрос прошёл.
- Если workflow упадёт (база недоступна или ключ сменили), GitHub пришлёт письмо.
- GitHub отключает расписание в репозитории без активности 60 дней. Любой коммит или кнопка Enable workflow в разделе Actions его возвращает.
- Если проект всё же уснул: Supabase Dashboard → проект → Restore project (несколько минут).
- Версия `supabase-js` закреплена в HTML (`@supabase/supabase-js@2.119.0`). Обновляй осознанно, проверяя вход, запись и заказ.
