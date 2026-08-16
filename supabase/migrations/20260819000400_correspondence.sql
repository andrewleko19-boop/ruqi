-- ════════════════════════════════════════════════════════════════════════════
--  المراسلات الإدارية: الوزارة ↔ المديرية ↔ المدرسة.
--
--  في النظام اليوم مساراتٌ كثيرة تحمل قراراً: طلبٌ يُقبل أو يُرفض، بيانٌ
--  يُعتمد، جلاءٌ يُصدَر، بلاغٌ يُحَلّ. وكلُّها **مقيَّدة الشكل**: لكلٍّ نموذجُه
--  وحقولُه وقرارُه. فما لا يقع في نموذجٍ منها لا سبيل إلى قوله — «متى يبدأ
--  الدوام الصيفيّ؟»، «أرسلوا لنا معلّم رياضيات»، «الطالبة كذا وثيقتها ناقصة».
--  فيُقال هاتفياً، فلا يبقى منه أثر، ويختلف الطرفان بعد شهرٍ على ما قيل.
--
--  فقناةٌ نصّية ثنائية: رسالةٌ وردٌّ في خيطٍ واحد له موضوع.
--
--  والخيطُ بين طرفين اثنين لا أكثر — ولذلك لا يُبنى «مستقبِلون» عامّون:
--   · وزارة ↔ مديرية  ⇐ school_id فارغ
--   · مديرية ↔ مدرسة  ⇐ school_id محدَّد
--  والمديريةُ طرفٌ في الحالتين، فمعرّفُها إلزاميٌّ دائماً. هذا يجعل كلَّ
--  استعلامٍ فهرساً واحداً، ويجعل نطاقَ RLS ثلاثة شروطٍ لا مصفوفة.
--
--  ⚠ ما لا يُبنى عمداً: قناةُ معلّم ↔ وليّ أمر. رفضها المستخدمُ صراحةً في
--  جولةٍ سابقة، والبناءُ هنا لا يفتحها: لا دورَ للمعلّم ولا لوليّ الأمر في
--  أيّ سياسةٍ أدناه.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.correspondence_threads (
  id           uuid primary key default gen_random_uuid(),
  subject      text not null,
  -- المديرية طرفٌ دائماً: مع الوزارة فوقها، أو مع مدرسةٍ تحتها.
  directorate_id uuid not null references public.directorates(id) on delete cascade,
  -- فارغ ⇒ الخيط وزارة↔مديرية. محدَّد ⇒ مديرية↔مدرسة.
  school_id    uuid references public.schools(id) on delete cascade,
  status       text not null default 'open' check (status in ('open', 'closed')),
  opened_by    uuid references public.users(id),
  opened_side  text not null check (opened_side in ('ministry', 'directorate', 'school')),
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  -- آخرُ قراءةٍ لكلّ طرف: منها يُشتقّ «غير مقروء» بلا جدولِ قراءاتٍ لكلّ رسالة.
  ministry_read_at    timestamptz,
  directorate_read_at timestamptz,
  school_read_at      timestamptz
);

create index if not exists idx_corr_dir   on public.correspondence_threads (directorate_id, last_message_at desc);
create index if not exists idx_corr_school on public.correspondence_threads (school_id, last_message_at desc)
  where school_id is not null;

create table if not exists public.correspondence_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.correspondence_threads(id) on delete cascade,
  body       text not null check (length(btrim(body)) > 0),
  sender_id  uuid references public.users(id),
  sender_side text not null check (sender_side in ('ministry', 'directorate', 'school')),
  created_at timestamptz not null default now()
);

create index if not exists idx_corr_msg on public.correspondence_messages (thread_id, created_at);


-- ── مَن طرفٌ في هذا الخيط؟ ──────────────────────────────────────────────────
--  SECURITY DEFINER عمداً: تعبيرُ USING يُنفَّذ بصلاحيات المستدعي، فلو استعلم
--  من users أو schools مباشرةً لاعتمد على ما يقرؤه المستدعي منهما — وهي العلّة
--  نفسها التي عطّلت staff_leaves_own_read بكاملها فبقيت خضراءَ سنةً.
create or replace function public.corr_thread_side(p_thread uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select case
           when u.role = 'ministry_user'::public.user_role    and t.school_id is null      then 'ministry'
           when u.role = 'directorate_user'::public.user_role and u.directorate_id = t.directorate_id then 'directorate'
           when u.role = 'school_admin'::public.user_role     and u.school_id = t.school_id then 'school'
           else null
         end
    from public.correspondence_threads t
    join public.users u on u.id = auth.uid() and u.is_active
   where t.id = p_thread
$$;

alter function public.corr_thread_side(uuid) owner to postgres;
revoke all on function public.corr_thread_side(uuid) from public, anon;
grant execute on function public.corr_thread_side(uuid) to authenticated, service_role;

comment on function public.corr_thread_side(uuid) is
  'أيُّ طرفٍ في الخيط هو المستدعي (ministry/directorate/school)، أو فارغ إن لم يكن طرفاً.';


-- ── سياسات الخيوط ───────────────────────────────────────────────────────────
alter table public.correspondence_threads enable row level security;

drop policy if exists corr_thread_read on public.correspondence_threads;
create policy corr_thread_read on public.correspondence_threads
  for select to authenticated
  using (public.corr_thread_side(id) is not null);

/* الفتحُ يُقيَّد بالاتّجاه: الوزارةُ تفتح مع مديرية (school_id فارغ)، والمديريةُ
   مع مدرسةٍ في نطاقها أو مع الوزارة، والمدرسةُ مع مديريتها وحدها. والجانبُ
   المعلن (opened_side) يجب أن يطابق دورَ الكاتب — وإلّا ادّعى مديرُ مدرسةٍ
   أنّه الوزارة فظهرت رسالتُه بتلك الصفة. */
drop policy if exists corr_thread_insert on public.correspondence_threads;
create policy corr_thread_insert on public.correspondence_threads
  for insert to authenticated
  with check (
    opened_by = auth.uid()
    and (
      ( opened_side = 'ministry'
        and public.current_user_role() = 'ministry_user'::public.user_role
        and school_id is null )
      or
      ( opened_side = 'directorate'
        and public.current_user_role() = 'directorate_user'::public.user_role
        and directorate_id = public.current_user_directorate_id()
        and ( school_id is null
              or exists (select 1 from public.schools s
                          where s.id = school_id and s.directorate_id = directorate_id) ) )
      or
      ( opened_side = 'school'
        and public.current_user_role() = 'school_admin'::public.user_role
        and school_id = public.current_user_school_id()
        and exists (select 1 from public.schools s
                     where s.id = school_id and s.directorate_id = directorate_id) )
    )
  );

-- التحديث للطرفين — لكنّه محصورٌ بختم القراءة والإغلاق عبر زنادٍ أدناه.
drop policy if exists corr_thread_update on public.correspondence_threads;
create policy corr_thread_update on public.correspondence_threads
  for update to authenticated
  using      (public.corr_thread_side(id) is not null)
  with check (public.corr_thread_side(id) is not null);

grant select, insert, update on public.correspondence_threads to authenticated;

/* الخيطُ سجلٌّ لا لوحةٌ تُمحى: الموضوعُ والطرفان وتاريخُ الإنشاء ثوابت. يُسمح
   بختم القراءة وبالإغلاق/الفتح، ويُثبَّت ما عداه على قيمه — فلا يُحوَّل خيطٌ
   من مدرسةٍ إلى أخرى بتحديثٍ واحد، ولا يُزوَّر تاريخُ آخر رسالة. */
create or replace function public.trg_corr_thread_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;   -- service_role وزنادُ الرسائل
  new.id             := old.id;
  new.subject        := old.subject;
  new.directorate_id := old.directorate_id;
  new.school_id      := old.school_id;
  new.opened_by      := old.opened_by;
  new.opened_side    := old.opened_side;
  new.created_at     := old.created_at;
  new.last_message_at := old.last_message_at;

  -- كلُّ طرفٍ يختم قراءتَه هو لا قراءةَ غيره: وإلّا أخفى طرفٌ إشعارَ الآخر.
  case public.corr_thread_side(new.id)
    when 'ministry'    then new.directorate_read_at := old.directorate_read_at;
                            new.school_read_at      := old.school_read_at;
    when 'directorate' then new.ministry_read_at    := old.ministry_read_at;
                            new.school_read_at      := old.school_read_at;
    when 'school'      then new.ministry_read_at    := old.ministry_read_at;
                            new.directorate_read_at := old.directorate_read_at;
    else raise exception 'غير مصرّح: لست طرفاً في هذه المراسلة' using errcode = '42501';
  end case;
  return new;
end; $$;

alter function public.trg_corr_thread_guard() owner to postgres;
revoke all on function public.trg_corr_thread_guard() from public, anon;

drop trigger if exists t_corr_thread_guard on public.correspondence_threads;
create trigger t_corr_thread_guard
  before update on public.correspondence_threads
  for each row execute function public.trg_corr_thread_guard();


-- ── سياسات الرسائل ──────────────────────────────────────────────────────────
alter table public.correspondence_messages enable row level security;

drop policy if exists corr_msg_read on public.correspondence_messages;
create policy corr_msg_read on public.correspondence_messages
  for select to authenticated
  using (public.corr_thread_side(thread_id) is not null);

/* لا كتابةَ في خيطٍ مغلق، ولا انتحالَ لجانبٍ لست فيه. والجانبُ لا يُؤخذ من
   الحمولة بل يُقارَن بما تقوله الدالّة — فالادّعاء لا يُصدَّق. */
drop policy if exists corr_msg_insert on public.correspondence_messages;
create policy corr_msg_insert on public.correspondence_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and sender_side = public.corr_thread_side(thread_id)
    and exists (select 1 from public.correspondence_threads t
                 where t.id = thread_id and t.status = 'open')
  );

grant select, insert on public.correspondence_messages to authenticated;

/* الرسالةُ لا تُعدَّل ولا تُحذف: قناةٌ إدارية يُحتجّ بها، فمحوُ رسالةٍ بعد
   قراءتها يُفرغها من قيمتها. لا سياسةَ UPDATE ولا DELETE — والغياب هو المنع. */


-- ── وصولُ الرسالة يُحرّك الخيط ويُشعر الطرفَ الآخر ────────────────────────────
create or replace function public.trg_corr_message_new()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  t          public.correspondence_threads;
  v_sender   text;
  v_preview  text;
begin
  select * into t from public.correspondence_threads where id = new.thread_id;
  if not found then return new; end if;

  -- الخيطُ يرتفع، وجانبُ المرسِل يُعدّ مقروءاً عنده (كتبها فقد قرأها).
  update public.correspondence_threads
     set last_message_at     = new.created_at,
         ministry_read_at    = case when new.sender_side = 'ministry'    then new.created_at else ministry_read_at    end,
         directorate_read_at = case when new.sender_side = 'directorate' then new.created_at else directorate_read_at end,
         school_read_at      = case when new.sender_side = 'school'      then new.created_at else school_read_at      end
   where id = new.thread_id;

  select coalesce(u.full_name, 'مراسلة') into v_sender
    from public.users u where u.id = new.sender_id;
  v_preview := left(new.body, 90);

  /* الإشعارُ يذهب إلى الطرف الآخر وحده. الوزارةُ ليست مستخدماً واحداً فتُبلَّغ
     جماعةً؛ وكذلك مدراءُ المدرسة وموظّفو المديرية. */
  if new.sender_side <> 'ministry' and t.school_id is null then
    perform public.notify_user(u.id, 'correspondence', 'مراسلة: ' || t.subject,
                               v_sender || ' — ' || v_preview, 'correspondence', t.id)
       from public.users u
      where u.role = 'ministry_user'::public.user_role and u.is_active;
  end if;

  if new.sender_side <> 'directorate' then
    perform public.notify_user(u.id, 'correspondence', 'مراسلة: ' || t.subject,
                               v_sender || ' — ' || v_preview, 'correspondence', t.id)
       from public.users u
      where u.role = 'directorate_user'::public.user_role
        and u.directorate_id = t.directorate_id and u.is_active;
  end if;

  if new.sender_side <> 'school' and t.school_id is not null then
    perform public.notify_user(u.id, 'correspondence', 'مراسلة: ' || t.subject,
                               v_sender || ' — ' || v_preview, 'correspondence', t.id)
       from public.users u
      where u.role = 'school_admin'::public.user_role
        and u.school_id = t.school_id and u.is_active;
  end if;

  return new;
end; $$;

alter function public.trg_corr_message_new() owner to postgres;
revoke all on function public.trg_corr_message_new() from public, anon;

drop trigger if exists t_corr_message_new on public.correspondence_messages;
create trigger t_corr_message_new
  after insert on public.correspondence_messages
  for each row execute function public.trg_corr_message_new();


-- ── الخيوط مع عدد ما لم يُقرأ ───────────────────────────────────────────────
create or replace function public.get_correspondence_threads()
returns table (
  id uuid, subject text, status text,
  directorate_id uuid, directorate_name text,
  school_id uuid, school_name text,
  my_side text, last_message_at timestamptz,
  last_body text, unread integer
)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.subject, t.status,
         t.directorate_id, d.name, t.school_id, s.name,
         public.corr_thread_side(t.id),
         t.last_message_at,
         (select m.body from public.correspondence_messages m
           where m.thread_id = t.id order by m.created_at desc limit 1),
         (select count(*)::int from public.correspondence_messages m
           where m.thread_id = t.id
             and m.sender_side is distinct from public.corr_thread_side(t.id)
             and m.created_at > coalesce(
                   case public.corr_thread_side(t.id)
                     when 'ministry'    then t.ministry_read_at
                     when 'directorate' then t.directorate_read_at
                     else                    t.school_read_at
                   end, 'epoch'::timestamptz))
    from public.correspondence_threads t
    join public.directorates d on d.id = t.directorate_id
    left join public.schools  s on s.id = t.school_id
   where public.corr_thread_side(t.id) is not null
   order by t.last_message_at desc
   limit 200
$$;

alter function public.get_correspondence_threads() owner to postgres;
revoke all on function public.get_correspondence_threads() from public, anon;
grant execute on function public.get_correspondence_threads() to authenticated, service_role;

comment on function public.get_correspondence_threads() is
  'خيوطُ مراسلات المستدعي مع آخر رسالةٍ وعددِ ما لم يقرأه هو.';

notify pgrst, 'reload schema';
