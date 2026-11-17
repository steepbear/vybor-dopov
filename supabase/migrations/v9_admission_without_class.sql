-- V9: admission to school precedes class allocation.
-- Only a stable UUID and technical login are stored server-side; no FIO fields.
BEGIN;
CREATE SEQUENCE IF NOT EXISTS private.v9_branch_code_seq;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS v9_code integer;
WITH assigned AS (
  SELECT id, row_number() OVER (ORDER BY name, id) AS code
  FROM public.branches WHERE v9_code IS NULL
)
UPDATE public.branches AS b SET v9_code = a.code FROM assigned AS a WHERE a.id = b.id;
SELECT setval('private.v9_branch_code_seq', GREATEST(COALESCE(MAX(v9_code),0),1), true) FROM public.branches;
ALTER TABLE public.branches ALTER COLUMN v9_code SET DEFAULT nextval('private.v9_branch_code_seq');
GRANT USAGE ON SCHEMA private TO service_role;
GRANT USAGE ON SEQUENCE private.v9_branch_code_seq TO service_role;
ALTER TABLE public.branches ALTER COLUMN v9_code SET NOT NULL;
ALTER TABLE public.branches ADD CONSTRAINT branches_v9_code_key UNIQUE (v9_code);

-- Class information belongs exclusively to v9_class_documents and enrollments.
-- Preserve legacy values for test data and compatibility with old views.
ALTER TABLE public.students ALTER COLUMN grade DROP NOT NULL;
ALTER TABLE public.students ALTER COLUMN class_letter DROP NOT NULL;

-- Existing latin logins continue to work unchanged.
ALTER TABLE public.student_accounts DROP CONSTRAINT student_accounts_login_check;
ALTER TABLE public.student_accounts ADD CONSTRAINT student_accounts_login_check
  CHECK (login ~ '^[A-Za-z][A-Za-z0-9]{1,31}-[0-9]{3}$'
     OR login ~ '^20[2-9][0-9]_Ф[1-9][0-9]*_Ученик_[0-9]{4,6}$');
COMMIT;
