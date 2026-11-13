-- V9 / Stage 2: year-scoped class documents, separate from permanent student catalog.
-- Non-destructive: legacy students.grade/class_letter and existing V8 selections remain unchanged.
CREATE TABLE IF NOT EXISTS public.v9_class_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  year_start smallint NOT NULL CHECK (year_start BETWEEN 2025 AND 2100),
  grade smallint NOT NULL CHECK (grade BETWEEN 1 AND 4),
  class_letter text NOT NULL CHECK (class_letter ~ '^[А-ЯЁ]{1,3}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','finished')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, year_start, grade, class_letter),
  UNIQUE (id, branch_id, year_start)
);

-- The student is permanent; his branch must match that of the class document.
ALTER TABLE public.students
  ADD CONSTRAINT students_v9_id_branch_unique UNIQUE (id, branch_id);

CREATE TABLE IF NOT EXISTS public.v9_class_enrollments (
  document_id uuid NOT NULL,
  student_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  year_start smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, student_id),
  UNIQUE (branch_id, year_start, student_id),
  CONSTRAINT v9_enrollment_document_fk
    FOREIGN KEY (document_id, branch_id, year_start)
    REFERENCES public.v9_class_documents (id, branch_id, year_start) ON DELETE RESTRICT,
  CONSTRAINT v9_enrollment_student_branch_fk
    FOREIGN KEY (student_id, branch_id)
    REFERENCES public.students (id, branch_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS v9_class_docs_branch_year_idx
  ON public.v9_class_documents (branch_id, year_start, grade);
CREATE INDEX IF NOT EXISTS v9_class_enrollments_student_idx
  ON public.v9_class_enrollments (student_id, year_start);

-- Four document dimensions are immutable. Statuses only progress forward.
CREATE OR REPLACE FUNCTION private.v9_guard_class_document()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.branch_id, NEW.year_start, NEW.grade, NEW.class_letter, NEW.created_at)
     IS DISTINCT FROM
     (OLD.branch_id, OLD.year_start, OLD.grade, OLD.class_letter, OLD.created_at) THEN
    RAISE EXCEPTION 'Измерения документа класса нельзя менять после создания';
  END IF;
  IF (OLD.status = 'draft' AND NEW.status NOT IN ('draft','active'))
     OR (OLD.status = 'active' AND NEW.status NOT IN ('active','finished'))
     OR (OLD.status = 'finished' AND NEW.status IS DISTINCT FROM 'finished') THEN
    RAISE EXCEPTION 'Недопустимый переход статуса документа класса';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER v9_guard_class_document
  BEFORE UPDATE ON public.v9_class_documents
  FOR EACH ROW EXECUTE FUNCTION private.v9_guard_class_document();

-- Serialize enrollment edits with document status updates so a finished
-- class cannot receive/lose members even under concurrent requests.
CREATE OR REPLACE FUNCTION private.v9_guard_class_enrollment()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_status text; v_document uuid;
BEGIN
  v_document := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
  SELECT status INTO v_status FROM public.v9_class_documents
    WHERE id = v_document FOR UPDATE;
  IF v_status IS DISTINCT FROM 'draft' AND v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Состав завершённого документа класса изменять нельзя';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER v9_guard_class_enrollment
  BEFORE INSERT OR DELETE ON public.v9_class_enrollments
  FOR EACH ROW EXECUTE FUNCTION private.v9_guard_class_enrollment();

ALTER TABLE public.v9_class_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v9_class_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY v9_class_docs_read ON public.v9_class_documents
  FOR SELECT TO authenticated
  USING (
    (SELECT private.my_role()) = 'methodologist'
    AND branch_id = (SELECT private.my_branch_id())
  );
CREATE POLICY v9_class_docs_insert ON public.v9_class_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.my_role()) = 'methodologist'
    AND branch_id = (SELECT private.my_branch_id())
    AND status = 'draft'
  );
CREATE POLICY v9_class_docs_update ON public.v9_class_documents
  FOR UPDATE TO authenticated
  USING (
    (SELECT private.my_role()) = 'methodologist'
    AND branch_id = (SELECT private.my_branch_id())
  )
  WITH CHECK (
    (SELECT private.my_role()) = 'methodologist'
    AND branch_id = (SELECT private.my_branch_id())
  );

CREATE POLICY v9_class_enrollments_read ON public.v9_class_enrollments
  FOR SELECT TO authenticated
  USING (
    (SELECT private.my_role()) = 'methodologist'
    AND branch_id = (SELECT private.my_branch_id())
  );
CREATE POLICY v9_class_enrollments_insert ON public.v9_class_enrollments
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.my_role()) = 'methodologist'
    AND branch_id = (SELECT private.my_branch_id())
    AND EXISTS (
      SELECT 1 FROM public.v9_class_documents d
      WHERE d.id = document_id AND d.branch_id = branch_id
        AND d.year_start = year_start AND d.status IN ('draft','active')
    )
  );
CREATE POLICY v9_class_enrollments_delete ON public.v9_class_enrollments
  FOR DELETE TO authenticated
  USING (
    (SELECT private.my_role()) = 'methodologist'
    AND branch_id = (SELECT private.my_branch_id())
    AND EXISTS (
      SELECT 1 FROM public.v9_class_documents d
      WHERE d.id = document_id AND d.status IN ('draft','active')
    )
  );

REVOKE ALL ON public.v9_class_documents FROM anon;
REVOKE ALL ON public.v9_class_enrollments FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.v9_class_documents TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.v9_class_enrollments TO authenticated;
