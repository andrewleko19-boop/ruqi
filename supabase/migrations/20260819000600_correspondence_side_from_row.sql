-- ════════════════════════════════════════════════════════════════════════════
--  «تُدرَج ولا تُرَدّ»: INSERT … RETURNING يسقط والإدراجُ وحده ينجح.
--
--  السياسة كُتبت using (corr_thread_side(id) is not null)، والدالّة تبحث عن
--  الخيط في الجدول بمعرّفه. وهي stable، فتقرأ لقطةَ بداية الجملة — والصفُّ
--  الذي يُدرَج الآن ليس فيها. فيُقيَّم الجانبُ فارغاً، فتسقط سياسةُ SELECT التي
--  يستلزمها RETURNING، ويُبلَّغ الخطأُ بوصفه «new row violates row-level
--  security policy» فيُوهم أنّ شرطَ الكتابة هو الساقط.
--
--  والأثرُ في الاستعمال: أوّلُ ما تفعله الواجهة بعد فتح المراسلة أن تأخذ
--  معرّفَ الخيط لتكتب فيه أوّلَ رسالة. فبلا RETURNING لا مراسلةَ أصلاً.
--
--  الإصلاح: الجانبُ يُحسم من **أعمدة الصفّ** لا من معرّفه. فلا تحتاج السياسةُ
--  أن تقرأ ما تحرسه — وهو الشكلُ الصحيح أصلاً: سياسةٌ تستعلم عن صفِّها نفسه
--  دَوْرٌ لا لزوم له، ولزومُه هنا كان يخفي أنّ اللقطة لا تراه.
-- ════════════════════════════════════════════════════════════════════════════

/* لا تقرأ إلّا users — وهي ما تقرؤه current_user_* أصلاً. فلا استعلامَ عن
   correspondence_threads ولا عن schools داخل أيّ تعبير سياسة. */
create or replace function public.corr_side_for(p_directorate uuid, p_school uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select case
           when u.role = 'ministry_user'::public.user_role    and p_school is null              then 'ministry'
           when u.role = 'directorate_user'::public.user_role and u.directorate_id = p_directorate then 'directorate'
           when u.role = 'school_admin'::public.user_role     and u.school_id      = p_school     then 'school'
           else null
         end
    from public.users u
   where u.id = auth.uid() and u.is_active
$$;

alter function public.corr_side_for(uuid, uuid) owner to postgres;
revoke all on function public.corr_side_for(uuid, uuid) from public, anon;
grant execute on function public.corr_side_for(uuid, uuid) to authenticated, service_role;

comment on function public.corr_side_for(uuid, uuid) is
  'جانبُ المستدعي في خيطٍ طرفاه (مديرية، مدرسة) — من أعمدة الصفّ لا من معرّفه، فتصحّ في INSERT … RETURNING.';

-- الصيغةُ القديمة تبقى للرسائل: الخيطُ موجودٌ حين تُكتب فيها، فلا مسألةَ لقطة.
create or replace function public.corr_thread_side(p_thread uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select public.corr_side_for(t.directorate_id, t.school_id)
    from public.correspondence_threads t
   where t.id = p_thread
$$;


drop policy if exists corr_thread_read on public.correspondence_threads;
create policy corr_thread_read on public.correspondence_threads
  for select to authenticated
  using (public.corr_side_for(directorate_id, school_id) is not null);

drop policy if exists corr_thread_update on public.correspondence_threads;
create policy corr_thread_update on public.correspondence_threads
  for update to authenticated
  using      (public.corr_side_for(directorate_id, school_id) is not null)
  with check (public.corr_side_for(directorate_id, school_id) is not null);


-- الزنادُ كذلك: كان ينادي corr_thread_side(new.id) فيعيد قراءةَ الصفّ.
create or replace function public.trg_corr_thread_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_side text;
begin
  if auth.uid() is null then return new; end if;   -- service_role وزنادُ الرسائل
  v_side := public.corr_side_for(old.directorate_id, old.school_id);
  if v_side is null then
    raise exception 'غير مصرّح: لست طرفاً في هذه المراسلة' using errcode = '42501';
  end if;

  -- الخيطُ سجلٌّ لا لوحةٌ تُمحى: هويّتُه ثوابت، ويبقى المسموحُ ختمَ القراءة
  -- والإغلاق/الفتح.
  new.id             := old.id;
  new.subject        := old.subject;
  new.directorate_id := old.directorate_id;
  new.school_id      := old.school_id;
  new.opened_by      := old.opened_by;
  new.opened_side    := old.opened_side;
  new.created_at     := old.created_at;
  new.last_message_at := old.last_message_at;

  -- كلُّ طرفٍ يختم قراءتَه هو لا قراءةَ غيره: وإلّا أخفى طرفٌ إشعارَ الآخر.
  if v_side <> 'ministry'    then new.ministry_read_at    := old.ministry_read_at;    end if;
  if v_side <> 'directorate' then new.directorate_read_at := old.directorate_read_at; end if;
  if v_side <> 'school'      then new.school_read_at      := old.school_read_at;      end if;

  return new;
end; $$;

-- والكشفُ كذلك: كان ينادي corr_thread_side(t.id) أربع مرّاتٍ لكلّ صفّ.
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
         side.v,
         t.last_message_at,
         (select m.body from public.correspondence_messages m
           where m.thread_id = t.id order by m.created_at desc limit 1),
         (select count(*)::int from public.correspondence_messages m
           where m.thread_id = t.id
             and m.sender_side is distinct from side.v
             and m.created_at > coalesce(
                   case side.v
                     when 'ministry'    then t.ministry_read_at
                     when 'directorate' then t.directorate_read_at
                     else                    t.school_read_at
                   end, 'epoch'::timestamptz))
    from public.correspondence_threads t
    join public.directorates d on d.id = t.directorate_id
    left join public.schools  s on s.id = t.school_id
    cross join lateral (select public.corr_side_for(t.directorate_id, t.school_id) as v) side
   where side.v is not null
   order by t.last_message_at desc
   limit 200
$$;

notify pgrst, 'reload schema';
