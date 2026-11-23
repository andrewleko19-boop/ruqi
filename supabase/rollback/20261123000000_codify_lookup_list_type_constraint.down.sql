-- عكس 20261123000000: القيد بإحدى عشرة قيمة (مع school_complex) كما تركته 20260813000000.
alter table public.lookup_lists drop constraint if exists lookup_lists_list_type_check;
alter table public.lookup_lists add constraint lookup_lists_list_type_check check (
  list_type = any (array[
    'admin_role', 'specialization', 'certificate', 'higher_degree',
    'leave_type', 'ministerial_doc', 'support_job', 'educational_zone',
    'job_title', 'school_admin_role', 'school_complex'
  ])
);
comment on column public.lookup_lists.list_type is
  'نوع القائمة المرجعية. school_complex وeducational_zone لكل مديرية (directorate_id غير فارغ)، والبقية عامّة.';
