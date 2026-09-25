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
Создать файл `.env.local` (в git **не** коммитить):

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # только для админ-скриптов / edge functions
```

В репозитории уже есть `.gitignore` правило для `.env*`.

## Шаг 5. Роли
- `authenticated` — ученик (видит себя, свои записи)
- `service_role` / запись в `admin_users` — админ

Админа добавить вручную после первого входа:

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

1. Выполнить `supabase/schema.sql` (он идемпотентный: политики пересоздаются, созвоны сеются только если таблица пустая).
2. Вписать URL и anon key в `js/config.js`.
3. Authentication → URL Configuration: Site URL и Redirect — адрес `cabinet.html` на GitHub Pages.
4. Для мгновенного входа без письма: Authentication → Providers → Email → выключить Confirm email.

Новый пользователь получает 1 бесплатное занятие (`source = welcome`). Запись и отмена идут через функции `book_session` и `cancel_booking`.
