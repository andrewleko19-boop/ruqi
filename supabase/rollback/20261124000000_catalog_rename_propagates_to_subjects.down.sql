-- عكس 20261124000000 (لا يُنشر؛ يُشغَّل يدوياً عند الحاجة). لا يُعيد أسماءً سبق تحديثُها
-- — الهجرةُ لا تُغيّر إلا أسماءً طابقت اسمَ الفهرس القديم، والنسخةُ المحدَّثة صحيحة.
drop trigger if exists trg_catalog_rename_propagate on public.subject_catalog;
drop function if exists public.propagate_catalog_rename();
