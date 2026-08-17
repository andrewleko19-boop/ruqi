-- ════════════════════════════════════════════════════════════════════════════
--  ثلاثةُ أعطالٍ متجاورة كشفها التشغيل على مدرسةٍ إعدادية:
--
--  ١) العام الدراسيّ الخاطئ عند إضافة صفّ.
--     review_school_request عند قبول «add_class» كان يختم الصفّ بـ
--       extract(year from now()) || '-' || (extract(year)+1)
--     أي «2026-2027» في آبَ 2026 — متجاهلاً قاعدةَ أيلول التي تعتمدها
--     get_academic_year(): قبل أيلولَ العامُ هو (السنة-1)-السنة أي «2025-2026».
--     فالصفوفُ المُضافةُ عبر الطلب تُختم بعامٍ «متقدّمٍ بعام» عن الصفوف المُنشأة
--     مباشرةً (التي تأخذ الافتراضَ الصحيح get_academic_year()). ولأنّ الرئيسية
--     كانت تصفّي على «أحدث عامٍ مخزَّن»، صار العامُ الخاطئ هو الأحدث فتُعرَض
--     الصفوفُ الفارغةُ الجديدةُ ويُخفى الصفُّ الحقيقيّ ذو الطلاب — وتظهر الأعدادُ
--     «—». الإصلاح: استعمالُ public.get_academic_year() كبقيّة النظام.
--
--  ٢) إصلاحُ البيانات المتضرّرة (محافظٌ تماماً).
--     نُعيد كلَّ صفٍّ خُتم بعامٍ متقدّمٍ عن تاريخ إنشائه إلى عامه الصحيح المحسوب
--     من created_at (وهو ما كان الافتراضُ لينتجه). ولا نمسّ صفوفاً أنشأتها
--     الترقيةُ السنوية عمداً للعام القادم: كلُّ صفٍّ ترقيةٍ له قيدُ audit_log
--     بـ action='promote' يشير إليه بـ to_class — فنستثنيه.
--     (القيدُ UNIQUE(school_id,grade,section) يضمن ألّا يسبّب هذا التصادمَ:
--      لكلّ صفٍّ/شعبةٍ صفٌّ واحدٌ في المدرسة أصلاً.)
--
--  ٣) دلالةُ «أرسلت المدرسة حضورَ اليوم» في المديرية.
--     get_directorate_compliance كانت تقرأ daily_student_attendance (كشوفُ
--     الموجهين لكلّ طالب)، فتُضيء «أرسلت» فور تسجيل موجّهٍ صفاً واحداً — بينما
--     بوّابةُ المدرسة نفسها تقرأ daily_attendance (سجلُّ المدير اليوميّ) وتقول
--     «لم يُرسل سجلّ الحضور». شاشتان تتناقضان. القرار: المديرية تعكس السجلَّ
--     الرسميَّ اليوميَّ للمدرسة (daily_attendance) — فلا تُعَدّ المدرسةُ «مُرسِلةً»
--     إلّا بعد أن يُرسل مديرُها سجلَّ اليوم.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ١) معالجُ الطلبات: العام الدراسيّ من get_academic_year() ──────────────────
create or replace function public.review_school_request(
  p_request_id uuid, p_decision text, p_reason text default null
) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  v_dir     uuid;
  v_req     public.school_requests;
  v_payload jsonb;
begin
  -- تحقق من الدور
  select u.directorate_id into v_dir
  from public.users u
  where u.id = auth.uid() and u.role = 'directorate_user';
  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي المديرية فقط';
  end if;

  if p_decision not in ('approved','rejected') then
    raise exception 'قيمة القرار غير صالحة';
  end if;

  -- جلب الطلب وتحقق من الملكية
  select * into v_req
  from public.school_requests r
  where r.id = p_request_id
    and r.directorate_id = v_dir
    and r.status = 'pending';
  if not found then
    raise exception 'الطلب غير موجود أو ليس ضمن نطاق صلاحيتك أو ليس معلقاً';
  end if;

  -- تحديث الحالة
  update public.school_requests set
    status        = p_decision,
    reviewed_by   = auth.uid(),
    review_reason = p_reason,
    updated_at    = now()
  where id = p_request_id;

  -- تطبيق تلقائي عند الموافقة
  if p_decision = 'approved' then
    v_payload := v_req.payload;

    if v_req.type = 'add_class' then
      insert into public.classes(id, school_id, grade, section, academic_year, name)
      values (
        gen_random_uuid(),
        v_req.school_id,
        (v_payload->>'grade')::int,
        v_payload->>'section',
        -- كان: extract(year from now())||'-'||(extract(year)+1) — يتجاهل أيلول.
        -- الآن: نفسُ القاعدة المعتمدة في كامل النظام.
        coalesce(nullif(v_payload->>'academic_year',''), public.get_academic_year()),
        coalesce(nullif(v_payload->>'name',''), '')
      )
      on conflict do nothing;

    elsif v_req.type = 'add_student' then
      insert into public.students(
        id, school_id, class_id,
        first_name, father_name, family_name, full_name,
        national_id, gender, birth_date,
        is_active, recorded_by, updated_at
      ) values (
        gen_random_uuid(),
        v_req.school_id,
        nullif(v_payload->>'class_id','')::uuid,
        nullif(trim(v_payload->>'first_name'),''),
        nullif(trim(v_payload->>'father_name'),''),
        nullif(trim(v_payload->>'family_name'),''),
        trim(concat_ws(' ',
          nullif(trim(v_payload->>'first_name'),''),
          nullif(trim(v_payload->>'father_name'),''),
          nullif(trim(v_payload->>'family_name'),'')))::text,
        nullif(trim(v_payload->>'national_id'),''),
        nullif(v_payload->>'gender',''),
        nullif(v_payload->>'birth_date','')::date,
        true, auth.uid(), now()
      );

    elsif v_req.type = 'correct_student' then
      -- انظر التعليقَ في الأساس: القفلُ الوطنيّ يُرفَع لمدّة هذا التصحيح وحده.
      set local nsams.skip_registry_lock = 'true';

      update public.students set
        first_name  = coalesce(nullif(trim(v_payload->>'first_name'), ''),  first_name),
        father_name = coalesce(nullif(trim(v_payload->>'father_name'),''), father_name),
        family_name = coalesce(nullif(trim(v_payload->>'family_name'),''), family_name),
        birth_date  = coalesce(nullif(v_payload->>'birth_date','')::date,   birth_date),
        national_id = coalesce(nullif(trim(v_payload->>'national_id'),''),  national_id),
        full_name   = trim(concat_ws(' ',
                        coalesce(nullif(trim(v_payload->>'first_name'), ''),  first_name),
                        coalesce(nullif(trim(v_payload->>'father_name'),''), father_name),
                        coalesce(nullif(trim(v_payload->>'family_name'),''), family_name))),
        updated_at  = now()
      where id      = (v_payload->>'student_id')::uuid
        and school_id = v_req.school_id;
    end if;

    update public.school_requests
      set applied_at = now()
    where id = p_request_id;
  end if;

  -- إشعار المدرسة بالنتيجة
  perform public.notify_user(
    v_req.created_by,
    case p_decision when 'approved' then 'request_approved' else 'request_rejected' end,
    case p_decision when 'approved' then 'طلبك قُبل ✓'       else 'طلبك رُفض' end,
    coalesce(p_reason,
      case p_decision
        when 'approved' then 'تمت الموافقة على الطلب وتطبيقه.'
        else                 'رُفض الطلب من قِبل المديرية.'
      end),
    'school_requests',
    p_request_id
  );
end; $$;


-- ── ٢) إصلاحُ الصفوف المختومة بعامٍ متقدّمٍ عن تاريخ إنشائها ───────────────────
--  نُعيد كلَّ صفٍّ عامُه أحدثُ من get_academic_year(created_at) إلى ذلك العام
--  الصحيح — إلّا ما أنشأته الترقيةُ عمداً (له قيدُ promote يشير إليه).
update public.classes c
   set academic_year = public.get_academic_year(c.created_at::date)
 where c.academic_year <> public.get_academic_year(c.created_at::date)
   and c.academic_year >  public.get_academic_year(c.created_at::date)
   and not exists (
     select 1 from public.audit_log a
     where a.action = 'promote'
       and (a.changes->>'to_class')::uuid = c.id
   );


-- ── ٣) الامتثال: «أرسلت اليوم» = سجلُّ المدير اليوميّ لا كشفُ موجّهٍ واحد ───────
create or replace function public.get_directorate_compliance(p_days integer default 30)
returns table(school_id uuid, days_reported integer, reported_today boolean)
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  v_dir uuid;
begin
  select u.directorate_id into v_dir
  from public.users u
  where u.id = auth.uid() and u.role = 'directorate_user';

  if v_dir is null then
    raise exception 'غير مصرّح: هذه الدالة لمستخدمي المديرية فقط';
  end if;

  if p_days is null or p_days < 1 or p_days > 92 then
    p_days := 30;
  end if;

  return query
  select
    da.school_id,
    count(distinct da.date)
      filter (where public.is_school_day(da.date))::integer,
    bool_or(da.date = current_date)
  from public.daily_attendance da
  join public.schools s on s.id = da.school_id
  where s.directorate_id = v_dir
    and da.date >  current_date - p_days
    and da.date <= current_date
  group by da.school_id;
end; $$;
