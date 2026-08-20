-- ════════════════════════════════════════════════════════════════════════════
--  زرعةُ العرض — «رُقِيّ» ممتلئٌ بالحياة في البوّابات الستّ.
--
--  الغرض: فيديو عرضٍ للأستاذ فادي، تُقرأ فيه الفروقُ بين المدارس والمحافظات
--  بلا شرحٍ من أحد. تُلصَق كما هي في Supabase → SQL Editor وتُشغَّل مرّةً.
--
--  ── الوسمُ الذي يسمح بالحذف الكامل ────────────────────────────────────────
--  كلُّ صفٍّ يزرعه هذا الملفّ معرّفُه يبدأ بـ 'dddddddd'. فحذفُ العرض كلِّه
--  سطرٌ لكلّ جدول، ولا يقارب بياناتِك الحقيقية. انظر tools/demo-reset.sql.
--
--  والمدارسُ القائمة عندك («طارق بن زياد» و«أسامة بن زيد») **تُعاد استعمالاً
--  لا تُكرَّر**: يُبحَث عنها بالاسم فتُملأ، ولا تُنشأ ثانيةً — فلا تظهر مدرستان
--  بالاسم نفسه في لوحة الوزارة.
--
--  ── لماذا لم تعمل حساباتُ seed.sql القديمة ────────────────────────────────
--  كانت تكتب في auth.users بتشفيرٍ صحيح، **ولا تكتب صفّاً واحداً في
--  auth.identities**. وGoTrue يبحث عن هويّةٍ من نوع email قبل أن يوازن كلمةَ
--  المرور — فبلا ذلك الصفّ يردّ «Invalid login credentials» رغم أنّ الحساب
--  موجودٌ وكلمتُه صحيحة. هنا يُكتب الصفّان معاً، ولذلك تعمل.
--
--  ── الحسابات (كلمةُ المرور واحدة: TestPass123) ───────────────────────────
--    مدير مدرسة «طارق بن زياد»   tareq@ruqi.demo
--    مدير مدرسة «أسامة بن زيد»   osama@ruqi.demo
--    معلّم (صفوفٌ وحصصٌ وطلاب)    moalem@ruqi.demo
--    موظّف مديرية اللاذقية        latakia@ruqi.demo
--    موظّف وزارة                  wizara@ruqi.demo
--    مشرف نظام                    admin@ruqi.demo
--    وليّ أمر — بلا كلمة مرور: رقم الجوّال 0955123456 ورمزٌ يُقرأ كما هو
--    موثَّقٌ في نهاية هذا الملفّ.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── أدواتٌ داخلية ───────────────────────────────────────────────────────────
-- معرّفٌ ثابتٌ مشتقٌّ من نصّ: إعادةُ التشغيل تُنتج المعرّفات نفسها، فالزرعُ
-- idempotent ولا يتضاعف. والبادئةُ 'dddddddd' هي وسمُ الحذف.
create or replace function pg_temp.did(seed text) returns uuid language sql immutable as $$
  select ('dddddddd-' || substr(md5(seed), 1, 4) || '-' || substr(md5(seed), 5, 4)
                      || '-' || substr(md5(seed), 9, 4) || '-' || substr(md5(seed), 13, 12))::uuid
$$;

-- إنشاءُ حسابٍ يعمل فعلاً: auth.users + auth.identities معاً + public.users.
create or replace function pg_temp.mk_user(
  p_email text, p_name text, p_role public.user_role,
  p_school uuid, p_dir uuid, p_perm text
) returns uuid language plpgsql as $$
declare v_id uuid := pg_temp.did('user:' || p_email);
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, extensions.crypt('TestPass123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_name), now(), now()
  )
  on conflict (id) do update
    set encrypted_password = excluded.encrypted_password,
        email_confirmed_at = excluded.email_confirmed_at;

  -- ⚠️ هذا الصفُّ هو الفرق بين حسابٍ يعمل وحسابٍ يرفض الدخول.
  insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', p_email, 'email_verified', true),
    'email', now(), now(), now()
  )
  on conflict (provider_id, provider) do nothing;

  if p_role is not null then
    insert into public.users (id, full_name, role, school_id, directorate_id, permission_role, is_active)
    values (v_id, p_name, p_role, p_school, p_dir, p_perm, true)
    on conflict (id) do update
      set full_name = excluded.full_name, role = excluded.role,
          school_id = excluded.school_id, directorate_id = excluded.directorate_id,
          permission_role = excluded.permission_role, is_active = true;
  end if;
  return v_id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
do $seed$
declare
  v_year          text := public.get_academic_year();
  v_dir_lat       uuid;
  v_dir_dam       uuid;
  v_dir_hom       uuid;
  v_sch           uuid;
  v_cls           uuid;
  v_admin_uid     uuid;
  v_teacher_uid   uuid;
  v_parent_uid    uuid;
  v_stu           uuid;
  r               record;
  i               int;
  d               int;
  g               int;
  n_boys          int;
  n_girls         int;
  v_absent        int;
  v_present       int;
  v_status        text;

  -- أسماءٌ سورية واقعية — القائمةُ تدور، فلا يتكرّر اسمٌ داخل الشعبة الواحدة.
  boys  text[] := array['محمد','أحمد','عمر','يوسف','كرم','جاد','زيد','باسل','رامي','سامر',
                        'وسيم','فادي','مهند','أنس','خالد','طارق','بشار','حسان','ماهر','نور'];
  girls text[] := array['ليان','سارة','رنا','مايا','جنى','لمى','ريم','هبة','دانا','سلمى',
                        'رهف','نور','شهد','بيان','ملك','لينا','عُلا','ديما','رغد','آية'];
  fams  text[] := array['العلي','حسن','إبراهيم','شاهين','الخطيب','عيسى','سليمان','مرعي',
                        'الحاج','ديب','صقر','ونوس','عباس','يازجي','قاسم'];
  subj  text[] := array['اللغة العربية','الرياضيات','العلوم العامة','اللغة الإنكليزية',
                        'الاجتماعيات','التربية الدينية'];
begin
  -- ── ١) المديريات: ثلاثُ محافظاتٍ يُقرأ الفرقُ بينها ──────────────────────
  -- القائمةُ تُطابَق بالاسم: مديريتُك الحقيقية تُستعمل ولا تُكرَّر.
  select id into v_dir_lat from public.directorates where governorate = 'اللاذقية' limit 1;
  if v_dir_lat is null then
    v_dir_lat := pg_temp.did('dir:lat');
    insert into public.directorates (id, name, governorate)
    values (v_dir_lat, 'مديرية تربية اللاذقية', 'اللاذقية');
  end if;

  select id into v_dir_dam from public.directorates where governorate = 'دمشق' limit 1;
  if v_dir_dam is null then
    v_dir_dam := pg_temp.did('dir:dam');
    insert into public.directorates (id, name, governorate)
    values (v_dir_dam, 'مديرية تربية دمشق', 'دمشق');
  end if;

  select id into v_dir_hom from public.directorates where governorate = 'حمص' limit 1;
  if v_dir_hom is null then
    v_dir_hom := pg_temp.did('dir:hom');
    insert into public.directorates (id, name, governorate)
    values (v_dir_hom, 'مديرية تربية حمص', 'حمص');
  end if;

  -- ── ٢) المدارس ────────────────────────────────────────────────────────────
  -- الإحداثياتُ حقيقيةٌ داخل كلّ محافظة كي تنتشر الدبابيسُ على الخريطة الحيّة
  -- انتشاراً معقولاً لا فوق بعضها.
  for r in
    select * from (values
      -- (الاسم, المديرية, النوع, خط العرض, خط الطول, عددُ الشعب, طلابٌ لكلّ شعبة)
      ('طارق بن زياد',   'lat', 'preparatory', 35.5171, 35.7915, 3, 24),
      ('أسامة بن زيد',   'lat', 'primary',     35.5320, 35.7830, 4, 22),
      ('خالد بن الوليد', 'lat', 'secondary',   35.5240, 35.8010, 3, 26),
      ('البخاري',        'lat', 'primary',     35.5410, 35.7760, 4, 20),
      ('عدنان المالكي',  'lat', 'preparatory', 35.5090, 35.7880, 3, 23),
      ('جمال عبد الناصر','dam', 'secondary',   33.5138, 36.2765, 3, 30),
      ('ابن خلدون',      'dam', 'primary',     33.5020, 36.2910, 4, 28),
      ('الرشيد',         'dam', 'preparatory', 33.5250, 36.2650, 3, 27),
      ('الوليد بن عبد الملك','hom','primary',  34.7324, 36.7137, 3, 18),
      ('أسد بن الفرات',  'hom', 'preparatory', 34.7210, 36.7280, 2, 19)
    ) t(nm, dr, sty, la, lo, sections, per_section)
  loop
    -- المدرسةُ القائمة تُستعمل كما هي؛ الجديدةُ تُنشأ بوسم العرض.
    select id into v_sch from public.schools where name = r.nm limit 1;
    if v_sch is null then
      v_sch := pg_temp.did('sch:' || r.nm);
      insert into public.schools (id, directorate_id, name, school_type, lat, lng,
                                  min_attendance_pct, education_type, shift, day_type)
      values (v_sch,
              case r.dr when 'lat' then v_dir_lat when 'dam' then v_dir_dam else v_dir_hom end,
              r.nm, r.sty, r.la, r.lo, 75, 'عام', 'صباحي', 'كامل');
    else
      -- مدرسةٌ حقيقية: يُضبط نوعُها وموقعُها فقط كي تُقرأ في اللوحات والخريطة.
      update public.schools
         set school_type = r.sty,
             lat = coalesce(lat, r.la), lng = coalesce(lng, r.lo)
       where id = v_sch;
    end if;

    -- ٢أ) الكادر: الفئاتُ الخمس كلُّها، فتُقرأ بطاقةُ «الكادر حسب الفئة».
    for i in 1 .. (r.sections + 6) loop
      insert into public.staff_records (
        id, school_id, staff_type, full_name, gender, national_id, self_number,
        specialization, certificate, job_title, weekly_lessons, active, seniority_year
      ) values (
        pg_temp.did('stf:' || r.nm || ':' || i),
        v_sch,
        case when i <= r.sections + 2 then 'teaching'
             when i = r.sections + 3   then 'admin'
             when i = r.sections + 4   then 'professional'
             when i = r.sections + 5   then 'worker'
             else 'guard' end,
        case when i % 2 = 0
             then boys[1 + (i * 3) % array_length(boys, 1)]  || ' ' || fams[1 + i % array_length(fams,1)]
             else girls[1 + (i * 5) % array_length(girls,1)] || ' ' || fams[1 + (i*2) % array_length(fams,1)] end,
        case when i % 2 = 0 then 'male' else 'female' end,
        lpad((10000000000 + (hashtext(r.nm || i) % 89999999))::text, 11, '0'),
        lpad((100000 + i * 7)::text, 6, '0'),
        subj[1 + i % array_length(subj, 1)],
        case when i % 3 = 0 then 'جامعة' else 'معهد' end,
        case when i <= r.sections + 2 then 'معلم صف' else 'إداري' end,
        case when i <= r.sections + 2 then 16 + (i % 8) else null end,
        true,
        1998 + (i % 22)
      ) on conflict (id) do nothing;
    end loop;

    -- ٢ب) الشعب والطلاب.
    for g in 1 .. r.sections loop
      v_cls := pg_temp.did('cls:' || r.nm || ':' || g);
      insert into public.classes (id, school_id, name, grade, section, academic_year, foreign_language)
      values (v_cls, v_sch,
              'الصف ' || g::text || ' - ' || chr(1571 + g),
              (case r.sty when 'primary' then g when 'preparatory' then g + 6 else g + 9 end)::text,
              chr(1571 + g), v_year, 'انكليزي')
      on conflict (school_id, grade, section) do nothing;

      n_boys  := r.per_section / 2;
      n_girls := r.per_section - n_boys;
      for i in 1 .. r.per_section loop
        v_stu := pg_temp.did('stu:' || r.nm || ':' || g || ':' || i);
        insert into public.students (
          id, school_id, class_id, full_name, gender, birth_date, national_id,
          father_name, mother_name, parent_phone, contact_phone, seat_number, status
        ) values (
          v_stu, v_sch, v_cls,
          case when i <= n_boys
               then boys[1 + (i * 7 + g) % array_length(boys, 1)]
               else girls[1 + (i * 11 + g) % array_length(girls, 1)] end
            || ' ' || fams[1 + (i + g) % array_length(fams, 1)],
          case when i <= n_boys then 'male' else 'female' end,
          date '2010-01-01' + ((i * 37 + g * 11) % 2000),
          lpad((20000000000 + (abs(hashtext(r.nm || g || i)) % 89999999))::text, 11, '0'),
          boys[1 + (i * 3) % array_length(boys, 1)],
          girls[1 + (i * 5) % array_length(girls, 1)],
          -- طالبٌ واحدٌ بعينه يحمل رقمَ وليّ الأمر التجريبيّ (انظر البند ٦).
          case when r.nm = 'طارق بن زياد' and g = 1 and i = 1
               then '0955123456' else '09' || lpad((10000000 + (i * 991 + g * 77))::text, 8, '0') end,
          case when r.nm = 'طارق بن زياد' and g = 1 and i = 1
               then '0955123456' else null end,
          i, 'active'
        ) on conflict (id) do nothing;
      end loop;
    end loop;

    -- ٢ج) الأعدادُ المعلَنة في بطاقة المدرسة.
    update public.schools
       set total_students = (select count(*) from public.students s where s.school_id = v_sch and s.is_active),
           total_teachers = (select count(*) from public.staff_records f where f.school_id = v_sch and f.active and f.staff_type = 'teaching')
     where id = v_sch;
  end loop;
end $seed$;

commit;


-- ════════════════════════════════════════════════════════════════════════════
--  الجزء الثاني — الحسابات، والحياة اليومية، والوثائق الرسمية
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $seed2$
declare
  v_year        text := public.get_academic_year();
  v_dir_lat     uuid;
  v_tareq       uuid;
  v_osama       uuid;
  v_admin_t     uuid;
  v_admin_o     uuid;
  v_teacher     uuid;
  v_dirstaff    uuid;
  v_min         uuid;
  v_sysadmin    uuid;
  v_parent      uuid;
  r             record;
  c             record;
  s             record;
  d             date;
  v_day         date;
  i             int;
  v_abs         int;
  v_pre         int;
  v_subj        uuid;
  v_comp        uuid;
  v_sheet       uuid;
  subj text[] := array['اللغة العربية','الرياضيات','العلوم العامة','اللغة الإنكليزية',
                       'الاجتماعيات','التربية الدينية'];
begin
  select id into v_dir_lat from public.directorates where governorate = 'اللاذقية' limit 1;
  select id into v_tareq   from public.schools where name = 'طارق بن زياد' limit 1;
  select id into v_osama   from public.schools where name = 'أسامة بن زيد'  limit 1;

  -- ── ٣) الحسابات — كلُّها بكلمة TestPass123 ───────────────────────────────
  v_admin_t  := pg_temp.mk_user('tareq@ruqi.demo',   'وليد محمد كبولة',  'school_admin',     v_tareq, null, 'school_admin');
  v_admin_o  := pg_temp.mk_user('osama@ruqi.demo',   'سميرة أحمد ديب',   'school_admin',     v_osama, null, 'school_admin');
  v_teacher  := pg_temp.mk_user('moalem@ruqi.demo',  'أسماء محمد زروق',  'teacher',          v_tareq, null, 'teacher');
  v_dirstaff := pg_temp.mk_user('latakia@ruqi.demo', 'عدنان أحمد حسن',   'directorate_user', null, v_dir_lat, 'directorate_staff');
  v_min      := pg_temp.mk_user('wizara@ruqi.demo',  'تمام نصر حمود',    'ministry_user',    null, null, 'ministry_staff');
  v_sysadmin := pg_temp.mk_user('admin@ruqi.demo',   'مشرف النظام',      'ministry_user',    null, null, 'ministry_staff');
  -- وليُّ الأمر لا صفَّ له في public.users: يُصادَق بـauth.users + parent_links
  -- وحدهما (كما تقول parent-auth صراحةً)، وrole='parent' يخالف chk_role_school.
  v_parent   := pg_temp.mk_user('p963955123456@parent.nsams.local', 'وليّ أمر تجريبي', null, null, null, null);

  -- بياناتُ دخول المعلّم في تبويب «الكادر» لدى مديره.
  insert into public.staff_credentials (id, school_id, user_id, username, password, created_by)
  values (pg_temp.did('cred:moalem'), v_tareq, v_teacher, 'moalem', null, v_admin_t)
  on conflict (username) do nothing;

  -- ── ٤) المعلّم مربوطٌ بصفوفه وحصصه ────────────────────────────────────────
  for c in select id, grade from public.classes where school_id = v_tareq order by grade loop
    insert into public.class_teacher (id, class_id, teacher_id, academic_year, role)
    values (pg_temp.did('ct:' || c.id::text), c.id, v_teacher, v_year, 'homeroom')
    on conflict (class_id, teacher_id, academic_year) do nothing;

    insert into public.staff_assignments (
      id, school_id, staff_id, user_id, assignment_kind, job_title,
      class_id, lesson_count, academic_year, active
    )
    select pg_temp.did('sa:' || c.id::text), v_tareq, f.id, v_teacher,
           'technical', 'معلم صف', c.id, 7, v_year, true
      from public.staff_records f
     where f.school_id = v_tareq and f.staff_type = 'teaching'
     order by f.created_at limit 1
    on conflict (id) do nothing;
  end loop;

  -- ── ٥) المواد والدرجات — بوّابةُ المعلّم وبطاقةُ العلامات ─────────────────
  for c in select distinct grade from public.classes where school_id = v_tareq loop
    for i in 1 .. array_length(subj, 1) loop
      v_subj := pg_temp.did('subj:' || v_tareq::text || c.grade || i);
      insert into public.subjects (
        id, school_id, grade, name, max_total, pass_mark,
        is_core_arabic, is_core_math, is_foreign_language, sort_order, is_active
      ) values (
        v_subj, v_tareq, c.grade::int, subj[i], 100,
        case when i = 1 then 50 else 40 end,
        i = 1, i = 2, i = 4, i, true
      ) on conflict (id) do nothing;

      -- ثلاثةُ مكوّنات مجموعُها ١٠٠، كما يشترط حفظُ المادة في الواجهة.
      insert into public.subject_components (id, subject_id, name, max_mark, sort_order)
      values (pg_temp.did('cmp:' || v_subj::text || ':1'), v_subj, 'مذاكرة',        20, 1),
             (pg_temp.did('cmp:' || v_subj::text || ':2'), v_subj, 'شفهي / وظائف',  20, 2),
             (pg_temp.did('cmp:' || v_subj::text || ':3'), v_subj, 'امتحان فصلي',   60, 3)
      on conflict (id) do nothing;
    end loop;
  end loop;

  -- درجاتُ الفصلين لصفٍّ واحد كي تكتمل بطاقةُ العلامات وتُصدَر نتيجتُها.
  for c in select id, grade from public.classes where school_id = v_tareq order by grade limit 1 loop
    for s in select id, seat_number from public.students where class_id = c.id loop
      for i in 1 .. array_length(subj, 1) loop
        v_subj := pg_temp.did('subj:' || v_tareq::text || c.grade || i);
        insert into public.student_grades (
          id, student_id, class_id, school_id, subject_id, component_id,
          semester, academic_year, mark, recorded_by
        )
        select pg_temp.did('gr:' || s.id::text || i || k || sem),
               s.id, c.id, v_tareq, v_subj,
               pg_temp.did('cmp:' || v_subj::text || ':' || k),
               sem, v_year,
               -- نطاقٌ واقعيّ: أغلبهم ناجحون وقلّةٌ على الحدّ، فتُقرأ البطاقة حيّة.
               round((case k when 1 then 20 when 2 then 20 else 60 end)
                     * (0.55 + ((abs(hashtext(s.id::text || i || k || sem)) % 40) / 100.0)))::numeric,
               v_teacher
          from generate_series(1, 3) k, generate_series(1, 2) sem
        on conflict (student_id, component_id, semester, academic_year) do update set mark = excluded.mark;
      end loop;
      insert into public.student_conduct (id, student_id, class_id, school_id, academic_year, mark, recorded_by)
      values (pg_temp.did('cond:' || s.id::text), s.id, c.id, v_tareq, v_year,
              75 + (abs(hashtext(s.id::text)) % 25), v_teacher)
      on conflict (student_id, academic_year) do update set mark = excluded.mark;
    end loop;
  end loop;

  -- ── ٦) الحضور: عشرةُ أيامِ دوامٍ ماضية ────────────────────────────────────
  -- سلسلةٌ لا يومٌ واحد: الرسومُ البيانية والاتجاهاتُ تحتاج تاريخاً لتُقرأ.
  -- والجمعةُ والسبت عطلةٌ رسمية فتُتخطّى.
  for r in select id, name from public.schools order by name loop
    d := current_date;
    i := 0;
    while i < 10 loop
      if extract(dow from d) not in (5, 6) then
        v_pre := 0; v_abs := 0;
        for c in select id from public.classes where school_id = r.id loop
          for s in select id from public.students where class_id = c.id loop
            -- نسبةُ غيابٍ تختلف بين المدارس فتظهر الفروقُ في لوحة المديرية.
            if (abs(hashtext(s.id::text || d::text)) % 100) < (4 + (abs(hashtext(r.name)) % 7)) then
              v_abs := v_abs + 1;
              insert into public.daily_student_attendance
                (id, student_id, class_id, school_id, date, status, recorded_by)
              values (pg_temp.did('att:' || s.id::text || d::text), s.id, c.id, r.id, d,
                      case when (abs(hashtext(s.id::text || d::text)) % 3) = 0 then 'excused' else 'absent' end,
                      null)
              on conflict (student_id, date) do update set status = excluded.status;
            else
              v_pre := v_pre + 1;
              insert into public.daily_student_attendance
                (id, student_id, class_id, school_id, date, status, recorded_by)
              values (pg_temp.did('att:' || s.id::text || d::text), s.id, c.id, r.id, d,
                      case when (abs(hashtext(s.id::text || d::text)) % 37) = 0 then 'late' else 'present' end,
                      null)
              on conflict (student_id, date) do update set status = excluded.status;
            end if;
          end loop;
        end loop;

        -- بيانُ المدير اليوميّ — وهو إشارةُ «أرسلت المدرسة حضورها» في المديرية.
        insert into public.daily_attendance (
          id, school_id, date, students_present, students_absent,
          teachers_present, teachers_absent, admins_present, admins_absent,
          workers_present, workers_absent
        ) values (
          pg_temp.did('da:' || r.id::text || d::text), r.id, d, v_pre, v_abs,
          greatest(1, (select count(*) from public.staff_records f
                        where f.school_id = r.id and f.staff_type = 'teaching' and f.active) - (i % 2)),
          i % 2, 1, 0, 1, 0
        ) on conflict (school_id, date) do update set
            students_present = excluded.students_present,
            students_absent  = excluded.students_absent;

        i := i + 1;
      end if;
      d := d - 1;
    end loop;
  end loop;

  -- ── ٧) البلاغات الطارئة — بشدّاتٍ وحالاتٍ مختلفة ─────────────────────────
  insert into public.emergency_reports (id, school_id, submitted_by, type, description,
                                        severity, status, receipt_number, created_at)
  values
    (pg_temp.did('er:1'), v_tareq, v_admin_t, 'infrastructure_damage',
     'الكهرباء مقطوعة عن المدرسة منذ الصباح، والمخبر بلا تهوية.', 4, 'open',
     'BLG-' || to_char(now(), 'YYYYMMDD') || '-001', now() - interval '3 hours'),
    (pg_temp.did('er:2'), v_osama, v_admin_o, 'health_emergency',
     'إصابة طالبة في ساحة المدرسة، أُسعفت إلى المشفى الوطني.', 5, 'acknowledged',
     'BLG-' || to_char(now(), 'YYYYMMDD') || '-002', now() - interval '1 day'),
    (pg_temp.did('er:3'), v_tareq, v_admin_t, 'teacher_shortage',
     'نقصٌ في معلّمي مادة الرياضيات للصفوف الثلاثة.', 2, 'resolved',
     'BLG-' || to_char(now(), 'YYYYMMDD') || '-003', now() - interval '6 days')
  on conflict (receipt_number) do update set status = excluded.status, severity = excluded.severity;
  update public.emergency_reports
     set resolved_by = v_dirstaff, resolved_at = now() - interval '2 days'
   where id = pg_temp.did('er:3');
  update public.emergency_reports
     set acknowledged_by = v_dirstaff, acknowledged_at = now() - interval '20 hours'
   where id = pg_temp.did('er:2');

  -- ── ٨) طلباتٌ إدارية إلى المديرية ────────────────────────────────────────
  insert into public.school_requests (id, school_id, directorate_id, type, status, payload, created_by, created_at)
  values
    (pg_temp.did('req:1'), v_tareq, v_dir_lat, 'add_class', 'pending',
     jsonb_build_object('grade', '8', 'section', 'د', 'reason', 'ازدحام الشعبة الثالثة'),
     v_admin_t, now() - interval '2 days'),
    (pg_temp.did('req:2'), v_osama, v_dir_lat, 'add_student', 'approved',
     jsonb_build_object('full_name', 'ريم خالد العلي', 'gender', 'female', 'grade', '3'),
     v_admin_o, now() - interval '5 days'),
    (pg_temp.did('req:3'), v_tareq, v_dir_lat, 'correct_student', 'pending',
     jsonb_build_object('field', 'national_id', 'reason', 'خطأ مطبعي في الرقم الوطني'),
     v_admin_t, now() - interval '1 day')
  on conflict (id) do nothing;

  -- ── ٩) البيان الشهريّ — ثلاثُ حالاتٍ تُظهر المسار كلَّه ───────────────────
  insert into public.monthly_statements (id, school_id, month, year, status, snapshot_data, submitted_at)
  values
    (pg_temp.did('ms:1'), v_tareq, extract(month from current_date)::smallint,
     extract(year from current_date)::smallint, 'submitted', '{}'::jsonb, now() - interval '2 days'),
    (pg_temp.did('ms:2'), v_osama, extract(month from current_date)::smallint,
     extract(year from current_date)::smallint, 'approved', '{}'::jsonb, now() - interval '9 days'),
    (pg_temp.did('ms:3'), v_tareq, (extract(month from current_date) - 1)::smallint,
     extract(year from current_date)::smallint, 'approved', '{}'::jsonb, now() - interval '35 days')
  on conflict (school_id, year, month) do update set status = excluded.status;

  -- ── ١٠) الجلاءات — واحدٌ صادرٌ يُفتح للقراءة في المديرية والوزارة ─────────
  for c in select id, grade from public.classes where school_id = v_tareq order by grade limit 1 loop
    v_sheet := pg_temp.did('rs:' || c.id::text);
    insert into public.result_sheets (id, school_id, class_id, academic_year, term, status,
                                      snapshot_data, submitted_at, issued_at, issued_by)
    select v_sheet, v_tareq, c.id, v_year, 'year', 'issued',
           jsonb_build_object(
             'students', coalesce(jsonb_agg(jsonb_build_object(
               'name', st.full_name,
               'result', case when (abs(hashtext(st.id::text)) % 10) < 9 then 'ناجح' else 'راسب' end,
               'finalPercent', 55 + (abs(hashtext(st.id::text)) % 42)
             )), '[]'::jsonb)),
           now() - interval '10 days', now() - interval '3 days', v_dirstaff
      from public.students st where st.class_id = c.id
    on conflict (class_id, academic_year, term) do update set status = excluded.status, snapshot_data = excluded.snapshot_data;
  end loop;

  -- ── ١١) وثيقةُ نقلٍ «لا مانع» ─────────────────────────────────────────────
  for s in select id, full_name, national_id, gender from public.students
            where school_id = v_osama limit 1 loop
    insert into public.transfer_documents (
      id, doc_type, student_id, student_national_id, student_full_name, student_gender,
      from_school_id, from_school_name, from_grade_label,
      to_school_id, to_school_name, to_grade_label, to_directorate_name,
      academic_year, outgoing_number, status, transfer_reason, issued_by, issued_by_name, issued_at
    ) values (
      pg_temp.did('td:1'), 'regular', s.id, s.national_id, s.full_name, s.gender,
      v_osama, 'أسامة بن زيد', '3',
      v_tareq, 'طارق بن زياد', '3', 'اللاذقية',
      v_year, 1041, 'pending', 'انتقال سكن الأسرة', v_admin_o, 'سميرة أحمد ديب', now() - interval '4 days'
    ) on conflict (to_school_id, academic_year, outgoing_number) do update set status = excluded.status;
  end loop;

  -- ── ١٢) دوامُ الكادر اليوم ────────────────────────────────────────────────
  insert into public.staff_attendance (id, school_id, date, kind, teacher_id, status, recorded_by)
  values (pg_temp.did('sa-att:1'), v_tareq, current_date, 'teacher', v_teacher, 'present', v_admin_t)
  on conflict (teacher_id, date) do update set status = excluded.status;

  -- ── ١٣) وليُّ الأمر: الربطُ برقم الجوّال ──────────────────────────────────
  insert into public.parent_links (id, user_id, student_id)
  select pg_temp.did('pl:' || st.id::text), v_parent, st.id
    from public.students st
   where st.parent_phone = '0955123456'
  on conflict (user_id, student_id) do nothing;

  raise notice 'الزرعة اكتملت.';
end $seed2$;

commit;
