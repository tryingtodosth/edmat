-- Generated from the reference db.sqlite3 (Django is the sole migration authority).
-- Regenerate: python3 -c "..." — see PORTS-BRIEF.md §3.

CREATE TABLE "accounts_certificate" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "title" varchar(200) NOT NULL, "issuer" varchar(200) NOT NULL, "issued_on" date NULL, "expires_on" date NULL, "credential_id" varchar(120) NOT NULL, "url" varchar(200) NOT NULL, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "profile_id" bigint NOT NULL REFERENCES "accounts_profile" ("id") DEFERRABLE INITIALLY DEFERRED, CONSTRAINT "unique_certificate_per_profile" UNIQUE ("profile_id", "title", "issuer"));

CREATE TABLE "accounts_donationlink" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "platform" varchar(20) NOT NULL, "label" varchar(100) NOT NULL, "url" varchar(200) NOT NULL, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "profile_id" bigint NOT NULL REFERENCES "accounts_profile" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "accounts_experienceentry" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "kind" varchar(12) NOT NULL, "title" varchar(200) NOT NULL, "organisation" varchar(200) NOT NULL, "started_on" date NULL, "ended_on" date NULL, "description" text NOT NULL, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "profile_id" bigint NOT NULL REFERENCES "accounts_profile" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "accounts_profile" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "display_name" varchar(100) NOT NULL, "avatar" varchar(100) NULL, "preferred_locale" varchar(8) NOT NULL, "is_verified_contributor" bool NOT NULL, "joined_at" datetime NOT NULL, "user_id" integer NOT NULL UNIQUE REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "notify_on_comment_reply" bool NOT NULL, "notify_on_content_action" bool NOT NULL, "notify_on_moderation_decision" bool NOT NULL, "show_profile_publicly" bool NOT NULL, "muted_notification_types" text NOT NULL CHECK ((JSON_VALID("muted_notification_types") OR "muted_notification_types" IS NULL)), "offers_tutoring" bool NOT NULL, "tutoring_note" varchar(200) NOT NULL, "notify_on_course_activity" bool NOT NULL, "bio" text NOT NULL, "notify_on_booking" bool NOT NULL, "time_format" varchar(3) NOT NULL, "week_starts_on" varchar(8) NOT NULL, "notify_on_event" bool NOT NULL, "max_courses" smallint unsigned NOT NULL CHECK ("max_courses" >= 0), "material_upload_quota_bytes" bigint unsigned NOT NULL CHECK ("material_upload_quota_bytes" >= 0), "save_menu_layout" varchar(8) NOT NULL);

CREATE TABLE "accounts_skillentry" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "label" varchar(100) NOT NULL, "level" varchar(12) NOT NULL, "evidence" varchar(16) NOT NULL, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "profile_id" bigint NOT NULL REFERENCES "accounts_profile" ("id") DEFERRABLE INITIALLY DEFERRED, "branch_id" bigint NULL REFERENCES "taxonomy_branch" ("id") DEFERRABLE INITIALLY DEFERRED, "discipline_id" bigint NULL REFERENCES "taxonomy_discipline" ("id") DEFERRABLE INITIALLY DEFERRED, CONSTRAINT "unique_skill_label_per_profile" UNIQUE ("profile_id", "label"));

CREATE TABLE "auth_group" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "name" varchar(150) NOT NULL UNIQUE);

CREATE TABLE "auth_group_permissions" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "group_id" integer NOT NULL REFERENCES "auth_group" ("id") DEFERRABLE INITIALLY DEFERRED, "permission_id" integer NOT NULL REFERENCES "auth_permission" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "auth_permission" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "content_type_id" integer NOT NULL REFERENCES "django_content_type" ("id") DEFERRABLE INITIALLY DEFERRED, "codename" varchar(100) NOT NULL, "name" varchar(255) NOT NULL);

CREATE TABLE "auth_user" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "password" varchar(128) NOT NULL, "last_login" datetime NULL, "is_superuser" bool NOT NULL, "username" varchar(150) NOT NULL UNIQUE, "last_name" varchar(150) NOT NULL, "email" varchar(254) NOT NULL, "is_staff" bool NOT NULL, "is_active" bool NOT NULL, "date_joined" datetime NOT NULL, "first_name" varchar(150) NOT NULL);

CREATE TABLE "auth_user_groups" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "user_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "group_id" integer NOT NULL REFERENCES "auth_group" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "auth_user_user_permissions" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "user_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "permission_id" integer NOT NULL REFERENCES "auth_permission" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "authtoken_token" ("key" varchar(40) NOT NULL PRIMARY KEY, "created" datetime NOT NULL, "user_id" integer NOT NULL UNIQUE REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "booking_availabilityexception" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "date" date NOT NULL, "kind" varchar(8) NOT NULL, "start_time" time NULL, "end_time" time NULL, "note" varchar(200) NOT NULL, "created_at" datetime NOT NULL, "tutor_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "booking_availabilityrule" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "weekday" smallint unsigned NOT NULL CHECK ("weekday" >= 0), "start_time" time NOT NULL, "end_time" time NOT NULL, "created_at" datetime NOT NULL, "service_id" bigint NULL REFERENCES "services_service" ("id") DEFERRABLE INITIALLY DEFERRED, "tutor_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "booking_booking" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "starts_at" datetime NOT NULL, "ends_at" datetime NOT NULL, "status" varchar(12) NOT NULL, "student_note" text NOT NULL, "tutor_note" text NOT NULL, "decided_at" datetime NULL, "created_at" datetime NOT NULL, "updated_at" datetime NOT NULL, "cancelled_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "service_id" bigint NOT NULL REFERENCES "services_service" ("id") DEFERRABLE INITIALLY DEFERRED, "student_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "tutor_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "community_comment" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "object_id" integer unsigned NOT NULL CHECK ("object_id" >= 0), "body" text NOT NULL, "created_at" datetime NOT NULL, "is_removed" bool NOT NULL, "author_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "content_type_id" integer NOT NULL REFERENCES "django_content_type" ("id") DEFERRABLE INITIALLY DEFERRED, "auto_hidden_at" datetime NULL, "edited_at" datetime NULL, "removed_by_author" bool NOT NULL, "parent_id" bigint NULL REFERENCES "community_comment" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "community_review" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "rating" smallint unsigned NOT NULL CHECK ("rating" >= 0), "body" text NOT NULL, "created_at" datetime NOT NULL, "author_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "exercise_id" bigint NOT NULL REFERENCES "exercises_exercise" ("id") DEFERRABLE INITIALLY DEFERRED, "auto_hidden_at" datetime NULL, "is_removed" bool NOT NULL);

CREATE TABLE "courses_attachment" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "file" varchar(100) NOT NULL, "title" varchar(200) NOT NULL, "description" text NOT NULL, "created_at" datetime NOT NULL, "course_id" bigint NOT NULL REFERENCES "courses_course" ("id") DEFERRABLE INITIALLY DEFERRED, "uploaded_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "courses_attachmentreview" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "rating" smallint unsigned NOT NULL CHECK ("rating" >= 0), "body" text NOT NULL, "created_at" datetime NOT NULL, "attachment_id" bigint NOT NULL REFERENCES "courses_attachment" ("id") DEFERRABLE INITIALLY DEFERRED, "author_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "courses_chapter" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "title" varchar(200) NOT NULL, "description" text NOT NULL, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "unlocks_at" datetime NULL, "course_id" bigint NOT NULL REFERENCES "courses_course" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "courses_chapterreview" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "rating" smallint unsigned NOT NULL CHECK ("rating" >= 0), "body" text NOT NULL, "created_at" datetime NOT NULL, "author_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "chapter_id" bigint NOT NULL REFERENCES "courses_chapter" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "courses_course" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "title" varchar(200) NOT NULL, "summary" varchar(300) NOT NULL, "description" text NOT NULL, "status" varchar(12) NOT NULL, "enrollment_policy" varchar(12) NOT NULL, "capacity" smallint unsigned NOT NULL CHECK ("capacity" >= 0), "language" varchar(8) NOT NULL, "starts_on" date NULL, "ends_on" date NULL, "price" decimal NULL, "currency" varchar(3) NOT NULL, "created_at" datetime NOT NULL, "updated_at" datetime NOT NULL, "field_id" bigint NULL REFERENCES "taxonomy_discipline" ("id") DEFERRABLE INITIALLY DEFERRED, "instructor_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "announce_new_lessons" bool NOT NULL, "announce_new_posts" bool NOT NULL, "discussion_mode" varchar(12) NOT NULL, "contribution_policy" varchar(12) NOT NULL, "upload_quota_bytes" bigint unsigned NOT NULL CHECK ("upload_quota_bytes" >= 0), "visibility" varchar(12) NOT NULL, "progress_visibility" varchar(16) NOT NULL);

CREATE TABLE "courses_course_subjects" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "course_id" bigint NOT NULL REFERENCES "courses_course" ("id") DEFERRABLE INITIALLY DEFERRED, "branch_id" bigint NOT NULL REFERENCES "taxonomy_branch" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "courses_courseinvite" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "token" varchar(64) NOT NULL UNIQUE, "role" varchar(12) NOT NULL, "label" varchar(120) NOT NULL, "created_at" datetime NOT NULL, "max_uses" integer unsigned NOT NULL CHECK ("max_uses" >= 0), "uses" integer unsigned NOT NULL CHECK ("uses" >= 0), "expires_at" datetime NULL, "revoked_at" datetime NULL, "course_id" bigint NOT NULL REFERENCES "courses_course" ("id") DEFERRABLE INITIALLY DEFERRED, "created_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "courses_courseitem" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "note" varchar(500) NOT NULL, "status" varchar(12) NOT NULL, "decided_at" datetime NULL, "decision_note" varchar(500) NOT NULL, "created_at" datetime NOT NULL, "course_id" bigint NOT NULL REFERENCES "courses_course" ("id") DEFERRABLE INITIALLY DEFERRED, "decided_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "exercise_id" bigint NULL REFERENCES "exercises_exercise" ("id") DEFERRABLE INITIALLY DEFERRED, "material_id" bigint NULL REFERENCES "materials_material" ("id") DEFERRABLE INITIALLY DEFERRED, "submitted_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "lesson_id" bigint NULL REFERENCES "courses_lesson" ("id") DEFERRABLE INITIALLY DEFERRED, "attachment_id" bigint NULL REFERENCES "courses_attachment" ("id") DEFERRABLE INITIALLY DEFERRED, "chapter_id" bigint NULL REFERENCES "courses_chapter" ("id") DEFERRABLE INITIALLY DEFERRED, "event_id" bigint NULL REFERENCES "events_event" ("id") DEFERRABLE INITIALLY DEFERRED, CONSTRAINT "course_item_exactly_one_target" CHECK ((("attachment_id" IS NULL AND "event_id" IS NULL AND "exercise_id" IS NULL AND "material_id" IS NOT NULL) OR ("attachment_id" IS NULL AND "event_id" IS NULL AND "exercise_id" IS NOT NULL AND "material_id" IS NULL) OR ("attachment_id" IS NOT NULL AND "event_id" IS NULL AND "exercise_id" IS NULL AND "material_id" IS NULL) OR ("attachment_id" IS NULL AND "event_id" IS NOT NULL AND "exercise_id" IS NULL AND "material_id" IS NULL))), CONSTRAINT "course_item_one_filing_target" CHECK (("lesson_id" IS NULL OR "chapter_id" IS NULL)));

CREATE TABLE "courses_coursenote" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "body" text NOT NULL, "created_at" datetime NOT NULL, "updated_at" datetime NOT NULL, "author_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "course_id" bigint NOT NULL REFERENCES "courses_course" ("id") DEFERRABLE INITIALLY DEFERRED, "lesson_id" bigint NULL REFERENCES "courses_lesson" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "courses_coursestaff" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "role" varchar(12) NOT NULL, "added_at" datetime NOT NULL, "added_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "course_id" bigint NOT NULL REFERENCES "courses_course" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, CONSTRAINT "unique_staff_per_course" UNIQUE ("course_id", "user_id"));

CREATE TABLE "courses_enrollment" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "status" varchar(12) NOT NULL, "request_note" varchar(500) NOT NULL, "requested_at" datetime NOT NULL, "decided_at" datetime NULL, "participant_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "course_id" bigint NOT NULL REFERENCES "courses_course" ("id") DEFERRABLE INITIALLY DEFERRED, "notify" bool NOT NULL, CONSTRAINT "unique_enrollment_per_course" UNIQUE ("course_id", "participant_id"));

CREATE TABLE "courses_lesson" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "title" varchar(200) NOT NULL, "description" text NOT NULL, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "scheduled_at" datetime NULL, "duration_minutes" smallint unsigned NULL CHECK ("duration_minutes" >= 0), "participant_notes" text NOT NULL, "chapter_id" bigint NOT NULL REFERENCES "courses_chapter" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "courses_lessonexerciseset" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "title" varchar(200) NOT NULL, "note" varchar(500) NOT NULL, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "linked_at" datetime NOT NULL, "refreshed_at" datetime NULL, "exercise_set_id" bigint NULL REFERENCES "study_exerciseset" ("id") DEFERRABLE INITIALLY DEFERRED, "lesson_id" bigint NOT NULL REFERENCES "courses_lesson" ("id") DEFERRABLE INITIALLY DEFERRED, "linked_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "courses_lessonprogress" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "status" varchar(12) NOT NULL, "created_at" datetime NOT NULL, "updated_at" datetime NOT NULL, "lesson_id" bigint NOT NULL REFERENCES "courses_lesson" ("id") DEFERRABLE INITIALLY DEFERRED, "participant_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "courses_lessonreview" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "rating" smallint unsigned NOT NULL CHECK ("rating" >= 0), "body" text NOT NULL, "created_at" datetime NOT NULL, "author_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "lesson_id" bigint NOT NULL REFERENCES "courses_lesson" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "courses_lessonsetexercise" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "exercise_id" bigint NOT NULL REFERENCES "exercises_exercise" ("id") DEFERRABLE INITIALLY DEFERRED, "link_id" bigint NOT NULL REFERENCES "courses_lessonexerciseset" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "django_admin_log" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "object_id" text NULL, "object_repr" varchar(200) NOT NULL, "action_flag" smallint unsigned NOT NULL CHECK ("action_flag" >= 0), "change_message" text NOT NULL, "content_type_id" integer NULL REFERENCES "django_content_type" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "action_time" datetime NOT NULL);

CREATE TABLE "django_content_type" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "app_label" varchar(100) NOT NULL, "model" varchar(100) NOT NULL);

CREATE TABLE "django_migrations" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "app" varchar(255) NOT NULL, "name" varchar(255) NOT NULL, "applied" datetime NOT NULL);

CREATE TABLE "django_session" ("session_key" varchar(40) NOT NULL PRIMARY KEY, "session_data" text NOT NULL, "expire_date" datetime NOT NULL);

CREATE TABLE "django_site" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "name" varchar(50) NOT NULL, "domain" varchar(100) NOT NULL UNIQUE);

CREATE TABLE "events_event" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "title" varchar(200) NOT NULL, "summary" varchar(300) NOT NULL, "description" text NOT NULL, "status" varchar(10) NOT NULL, "starts_at" datetime NOT NULL, "duration_minutes" smallint unsigned NOT NULL CHECK ("duration_minutes" >= 0), "location_kind" varchar(8) NOT NULL, "location_text" varchar(300) NOT NULL, "online_url" varchar(500) NOT NULL, "capacity" smallint unsigned NOT NULL CHECK ("capacity" >= 0), "language" varchar(8) NOT NULL, "created_at" datetime NOT NULL, "updated_at" datetime NOT NULL, "host_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "discipline_id" bigint NULL REFERENCES "taxonomy_discipline" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "events_event_subjects" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "event_id" bigint NOT NULL REFERENCES "events_event" ("id") DEFERRABLE INITIALLY DEFERRED, "branch_id" bigint NOT NULL REFERENCES "taxonomy_branch" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "events_eventattendance" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "status" varchar(10) NOT NULL, "note" varchar(300) NOT NULL, "responded_at" datetime NOT NULL, "created_at" datetime NOT NULL, "attendee_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "event_id" bigint NOT NULL REFERENCES "events_event" ("id") DEFERRABLE INITIALLY DEFERRED, CONSTRAINT "unique_event_attendance" UNIQUE ("event_id", "attendee_id"));

CREATE TABLE "events_eventpost" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "body" text NOT NULL, "image" varchar(100) NOT NULL, "created_at" datetime NOT NULL, "edited_at" datetime NULL, "author_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "event_id" bigint NOT NULL REFERENCES "events_event" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "events_eventpostlink" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "url" varchar(500) NOT NULL, "position" smallint unsigned NOT NULL CHECK ("position" >= 0), "post_id" bigint NOT NULL REFERENCES "events_eventpost" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "exercises_exercise" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "number" integer unsigned NOT NULL CHECK ("number" >= 0), "difficulty" varchar(10) NOT NULL, "published" bool NOT NULL, "verified" bool NOT NULL, "original_locale" varchar(8) NOT NULL, "created_at" datetime NOT NULL, "updated_at" datetime NOT NULL, "submitted_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "auto_hidden_at" datetime NULL, "branch_id" bigint NOT NULL REFERENCES "taxonomy_branch" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "exercises_exercise_tags" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "exercise_id" bigint NOT NULL REFERENCES "exercises_exercise" ("id") DEFERRABLE INITIALLY DEFERRED, "tag_id" bigint NOT NULL REFERENCES "exercises_tag" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "exercises_exercise_topics" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "exercise_id" bigint NOT NULL REFERENCES "exercises_exercise" ("id") DEFERRABLE INITIALLY DEFERRED, "topic_id" bigint NOT NULL REFERENCES "taxonomy_topic" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "exercises_exerciserequirement" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "label" varchar(200) NOT NULL, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "is_removed" bool NOT NULL, "exercise_id" bigint NOT NULL REFERENCES "exercises_exercise" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "exercises_exerciserequirementvote" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "value" smallint NOT NULL, "created_at" datetime NOT NULL, "requirement_id" bigint NOT NULL REFERENCES "exercises_exerciserequirement" ("id") DEFERRABLE INITIALLY DEFERRED, "voter_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "exercises_exercisesource" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "type" varchar(10) NOT NULL, "collection" varchar(200) NOT NULL, "original_problem_number" integer unsigned NULL CHECK ("original_problem_number" >= 0), "pages" varchar(20) NOT NULL, "chapter" integer unsigned NULL CHECK ("chapter" >= 0), "exercise_id" bigint NOT NULL UNIQUE REFERENCES "exercises_exercise" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "exercises_exercisesourcetranslation" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "locale" varchar(8) NOT NULL, "name" varchar(300) NOT NULL, "source_id" bigint NOT NULL REFERENCES "exercises_exercisesource" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "exercises_exercisetranslation" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "locale" varchar(8) NOT NULL, "title" varchar(300) NOT NULL, "statement" text NOT NULL, "hint" text NOT NULL, "answer" text NOT NULL, "solution" text NOT NULL, "status" varchar(10) NOT NULL, "review_note" text NOT NULL, "created_at" datetime NOT NULL, "exercise_id" bigint NOT NULL REFERENCES "exercises_exercise" ("id") DEFERRABLE INITIALLY DEFERRED, "reviewed_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "translated_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "exercises_tag" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "slug" varchar(50) NOT NULL UNIQUE, "is_removed" bool NOT NULL);

CREATE TABLE "exercises_tagfollow" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "notify" bool NOT NULL, "created_at" datetime NOT NULL, "tag_id" bigint NOT NULL REFERENCES "exercises_tag" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "identity_coursegrade" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "code" varchar(64) NOT NULL, "name" varchar(200) NOT NULL, "term" varchar(32) NOT NULL, "ects" smallint unsigned NOT NULL CHECK ("ects" >= 0), "value" varchar(16) NOT NULL, "scale" varchar(20) NOT NULL, "matched_course_id" bigint NULL REFERENCES "taxonomy_branch" ("id") DEFERRABLE INITIALLY DEFERRED, "profile_id" bigint NOT NULL REFERENCES "identity_educationprofile" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "identity_diploma" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "title" varchar(200) NOT NULL, "level" varchar(64) NOT NULL, "programme" varchar(200) NOT NULL, "issued_on" date NULL, "final_grade" varchar(16) NOT NULL, "source_id" varchar(64) NOT NULL, "profile_id" bigint NOT NULL REFERENCES "identity_educationprofile" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "identity_educationprofile" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "other_school_name" varchar(200) NOT NULL, "verification" varchar(20) NOT NULL, "status" varchar(20) NOT NULL, "verified_at" datetime NULL, "verified_via" varchar(20) NOT NULL, "programme" varchar(200) NOT NULL, "study_year" smallint unsigned NULL CHECK ("study_year" >= 0), "usos_user_id" varchar(64) NOT NULL, "usos_student_number" varchar(64) NOT NULL, "usos_connected_at" datetime NULL, "usos_last_synced_at" datetime NULL, "usos_scopes" text NOT NULL CHECK ((JSON_VALID("usos_scopes") OR "usos_scopes" IS NULL)), "share_school" bool NOT NULL, "share_diploma" bool NOT NULL, "share_grades" bool NOT NULL, "updated_at" datetime NOT NULL, "user_id" integer NOT NULL UNIQUE REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "school_id" bigint NULL REFERENCES "identity_school" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "identity_school" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "slug" varchar(50) NOT NULL UNIQUE, "name" varchar(200) NOT NULL, "short_name" varchar(32) NOT NULL, "country" varchar(2) NOT NULL, "city" varchar(100) NOT NULL, "email_domains" text NOT NULL CHECK ((JSON_VALID("email_domains") OR "email_domains" IS NULL)), "grade_scale" varchar(20) NOT NULL, "usos_base_url" varchar(200) NOT NULL, "is_active" bool NOT NULL);

CREATE TABLE "materials_material" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "slug" varchar(50) NOT NULL, "type" varchar(32) NOT NULL, "file" varchar(100) NOT NULL, "author" varchar(200) NOT NULL, "published" bool NOT NULL, "featured" bool NOT NULL, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "created_at" datetime NOT NULL, "estimated_minutes" integer unsigned NULL CHECK ("estimated_minutes" >= 0), "price_amount" decimal NULL, "price_currency" varchar(3) NOT NULL, "submitted_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "source_url" varchar(500) NOT NULL, "branch_id" bigint NOT NULL REFERENCES "taxonomy_branch" ("id") DEFERRABLE INITIALLY DEFERRED, "url" varchar(500) NOT NULL);

CREATE TABLE "materials_material_tags" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "material_id" bigint NOT NULL REFERENCES "materials_material" ("id") DEFERRABLE INITIALLY DEFERRED, "tag_id" bigint NOT NULL REFERENCES "exercises_tag" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "materials_materialcoverage" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "level" smallint unsigned NOT NULL CHECK ("level" >= 0), "created_at" datetime NOT NULL, "material_id" bigint NOT NULL REFERENCES "materials_material" ("id") DEFERRABLE INITIALLY DEFERRED, "proposed_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "subtopic_id" bigint NULL REFERENCES "taxonomy_subtopic" ("id") DEFERRABLE INITIALLY DEFERRED, "topic_id" bigint NOT NULL REFERENCES "taxonomy_topic" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "materials_materialcoveragevote" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "value" smallint NOT NULL, "created_at" datetime NOT NULL, "coverage_id" bigint NOT NULL REFERENCES "materials_materialcoverage" ("id") DEFERRABLE INITIALLY DEFERRED, "voter_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "materials_materialrequirement" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "label" varchar(200) NOT NULL, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "material_id" bigint NOT NULL REFERENCES "materials_material" ("id") DEFERRABLE INITIALLY DEFERRED, "is_removed" bool NOT NULL);

CREATE TABLE "materials_materialrequirementvote" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "value" smallint NOT NULL, "created_at" datetime NOT NULL, "requirement_id" bigint NOT NULL REFERENCES "materials_materialrequirement" ("id") DEFERRABLE INITIALLY DEFERRED, "voter_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "materials_materialreview" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "rating" smallint unsigned NOT NULL CHECK ("rating" >= 0), "body" text NOT NULL, "created_at" datetime NOT NULL, "author_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "material_id" bigint NOT NULL REFERENCES "materials_material" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "materials_materialtranslation" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "locale" varchar(8) NOT NULL, "title" varchar(300) NOT NULL, "description" text NOT NULL, "material_id" bigint NOT NULL REFERENCES "materials_material" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "materials_materialtype" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "status" varchar(10) NOT NULL, "proposed_at" datetime NULL, "slug" varchar(50) NOT NULL UNIQUE, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "proposed_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "materials_materialtypetranslation" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "locale" varchar(8) NOT NULL, "name" varchar(100) NOT NULL, "material_type_id" bigint NOT NULL REFERENCES "materials_materialtype" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "materials_materialview" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "viewed_at" datetime NOT NULL, "material_id" bigint NOT NULL REFERENCES "materials_material" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "moderation_contentview" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "viewed_at" datetime NOT NULL, "exercise_id" bigint NOT NULL REFERENCES "exercises_exercise" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "moderation_editsuggestion" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "locale" varchar(8) NOT NULL, "field" varchar(30) NOT NULL, "proposed_value" text NOT NULL, "reason" text NOT NULL, "status" varchar(10) NOT NULL, "created_at" datetime NOT NULL, "exercise_id" bigint NOT NULL REFERENCES "exercises_exercise" ("id") DEFERRABLE INITIALLY DEFERRED, "reviewed_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "submitted_by_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "review_note" text NOT NULL);

CREATE TABLE "moderation_exercisesubmission" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "payload" text NOT NULL CHECK ((JSON_VALID("payload") OR "payload" IS NULL)), "status" varchar(10) NOT NULL, "review_note" text NOT NULL, "created_at" datetime NOT NULL, "resulting_exercise_id" bigint NULL REFERENCES "exercises_exercise" ("id") DEFERRABLE INITIALLY DEFERRED, "reviewed_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "submitted_by_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "branch_id" bigint NOT NULL REFERENCES "taxonomy_branch" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "moderation_featureflag" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "key" varchar(40) NOT NULL UNIQUE, "is_enabled" bool NOT NULL, "updated_at" datetime NOT NULL, "updated_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "moderation_materialsubmission" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "type" varchar(20) NOT NULL, "title" varchar(300) NOT NULL, "description" text NOT NULL, "locale" varchar(8) NOT NULL, "file" varchar(100) NOT NULL, "scan_status" varchar(10) NOT NULL, "scan_detail" varchar(300) NOT NULL, "status" varchar(10) NOT NULL, "review_note" text NOT NULL, "created_at" datetime NOT NULL, "resulting_material_id" bigint NULL REFERENCES "materials_material" ("id") DEFERRABLE INITIALLY DEFERRED, "reviewed_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "submitted_by_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "estimated_minutes" integer unsigned NULL CHECK ("estimated_minutes" >= 0), "price_amount" decimal NULL, "price_currency" varchar(3) NOT NULL, "requirements" text NOT NULL CHECK ((JSON_VALID("requirements") OR "requirements" IS NULL)), "coverage" text NOT NULL CHECK ((JSON_VALID("coverage") OR "coverage" IS NULL)), "author" varchar(200) NOT NULL, "source_url" varchar(500) NOT NULL, "branch_id" bigint NOT NULL REFERENCES "taxonomy_branch" ("id") DEFERRABLE INITIALLY DEFERRED, "file_reclaimed_at" datetime NULL, "reclaimed_file_bytes" bigint unsigned NOT NULL CHECK ("reclaimed_file_bytes" >= 0), "url" varchar(500) NOT NULL);

CREATE TABLE "moderation_nodegovernor" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "object_id" integer unsigned NOT NULL CHECK ("object_id" >= 0), "created_at" datetime NOT NULL, "content_type_id" integer NOT NULL REFERENCES "django_content_type" ("id") DEFERRABLE INITIALLY DEFERRED, "granted_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "moderation_report" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "object_id" integer unsigned NOT NULL CHECK ("object_id" >= 0), "reason" text NOT NULL, "status" varchar(10) NOT NULL, "resolved_note" text NOT NULL, "created_at" datetime NOT NULL, "content_type_id" integer NOT NULL REFERENCES "django_content_type" ("id") DEFERRABLE INITIALLY DEFERRED, "reported_by_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "resolved_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "notifications_notification" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "type" varchar(32) NOT NULL, "target_label" varchar(300) NOT NULL, "note" text NOT NULL, "is_read" bool NOT NULL, "created_at" datetime NOT NULL, "actor_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "exercise_id" bigint NULL REFERENCES "exercises_exercise" ("id") DEFERRABLE INITIALLY DEFERRED, "recipient_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "material_id" bigint NULL REFERENCES "materials_material" ("id") DEFERRABLE INITIALLY DEFERRED, "event_id" bigint NULL REFERENCES "events_event" ("id") DEFERRABLE INITIALLY DEFERRED, "course_id" bigint NULL REFERENCES "courses_course" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "postman_message" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "subject" varchar(120) NOT NULL, "body" text NOT NULL, "email" varchar(254) NOT NULL, "sent_at" datetime NOT NULL, "read_at" datetime NULL, "replied_at" datetime NULL, "sender_archived" bool NOT NULL, "recipient_archived" bool NOT NULL, "sender_deleted_at" datetime NULL, "recipient_deleted_at" datetime NULL, "moderation_status" varchar(1) NOT NULL, "moderation_date" datetime NULL, "moderation_reason" varchar(120) NOT NULL, "moderation_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "parent_id" integer NULL REFERENCES "postman_message" ("id") DEFERRABLE INITIALLY DEFERRED, "recipient_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "sender_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "thread_id" integer NULL REFERENCES "postman_message" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "services_service" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "title" varchar(200) NOT NULL, "description" text NOT NULL, "hourly_rate" decimal NULL, "currency" varchar(3) NOT NULL, "is_active" bool NOT NULL, "created_at" datetime NOT NULL, "updated_at" datetime NOT NULL, "provider_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "delivery_mode" varchar(12) NOT NULL, "location_label" varchar(300) NOT NULL, "location_lat" decimal NULL, "location_lon" decimal NULL, "availability_mode" varchar(10) NOT NULL, "session_minutes" smallint unsigned NOT NULL CHECK ("session_minutes" >= 0));

CREATE TABLE "services_service_branches" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "service_id" bigint NOT NULL REFERENCES "services_service" ("id") DEFERRABLE INITIALLY DEFERRED, "branch_id" bigint NOT NULL REFERENCES "taxonomy_branch" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "services_servicereview" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "rating" smallint unsigned NOT NULL CHECK ("rating" >= 0), "body" text NOT NULL, "created_at" datetime NOT NULL, "author_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "service_id" bigint NOT NULL REFERENCES "services_service" ("id") DEFERRABLE INITIALLY DEFERRED, "is_removed" bool NOT NULL);

CREATE TABLE "services_servicewatch" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "created_at" datetime NOT NULL, "service_id" bigint NOT NULL REFERENCES "services_service" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "study_exerciseset" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "name" varchar(100) NOT NULL, "created_at" datetime NOT NULL, "owner_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "is_public" bool NOT NULL, "slug" varchar(16) NOT NULL UNIQUE);

CREATE TABLE "study_exercisesetitem" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "exercise_id" bigint NOT NULL REFERENCES "exercises_exercise" ("id") DEFERRABLE INITIALLY DEFERRED, "exercise_set_id" bigint NOT NULL REFERENCES "study_exerciseset" ("id") DEFERRABLE INITIALLY DEFERRED, "include_answer" bool NOT NULL, "include_hint" bool NOT NULL, "include_solution" bool NOT NULL);

CREATE TABLE "taxonomy_branch" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "slug" varchar(50) NOT NULL UNIQUE, "published" bool NOT NULL, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "discipline_id" bigint NOT NULL REFERENCES "taxonomy_discipline" ("id") DEFERRABLE INITIALLY DEFERRED, "proposed_at" datetime NULL, "proposed_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "status" varchar(10) NOT NULL);

CREATE TABLE "taxonomy_branchtranslation" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "locale" varchar(8) NOT NULL, "name" varchar(200) NOT NULL, "description" text NOT NULL, "branch_id" bigint NOT NULL REFERENCES "taxonomy_branch" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "taxonomy_chapter" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "number" integer unsigned NOT NULL CHECK ("number" >= 0), "start_page" integer unsigned NULL CHECK ("start_page" >= 0), "branch_id" bigint NOT NULL REFERENCES "taxonomy_branch" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "taxonomy_chapter_topics" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "chapter_id" bigint NOT NULL REFERENCES "taxonomy_chapter" ("id") DEFERRABLE INITIALLY DEFERRED, "topic_id" bigint NOT NULL REFERENCES "taxonomy_topic" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "taxonomy_chaptertranslation" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "locale" varchar(8) NOT NULL, "title" varchar(300) NOT NULL, "chapter_id" bigint NOT NULL REFERENCES "taxonomy_chapter" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "taxonomy_discipline" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "slug" varchar(50) NOT NULL UNIQUE, "published" bool NOT NULL, "proposed_at" datetime NULL, "proposed_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "status" varchar(10) NOT NULL);

CREATE TABLE "taxonomy_disciplinetranslation" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "locale" varchar(8) NOT NULL, "name" varchar(200) NOT NULL, "description" text NOT NULL, "discipline_id" bigint NOT NULL REFERENCES "taxonomy_discipline" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "taxonomy_subtopic" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "slug" varchar(50) NOT NULL, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "topic_id" bigint NOT NULL REFERENCES "taxonomy_topic" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "taxonomy_subtopictranslation" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "locale" varchar(8) NOT NULL, "name" varchar(300) NOT NULL, "subtopic_id" bigint NOT NULL REFERENCES "taxonomy_subtopic" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE "taxonomy_topic" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "slug" varchar(50) NOT NULL, "order" integer unsigned NOT NULL CHECK ("order" >= 0), "branch_id" bigint NOT NULL REFERENCES "taxonomy_branch" ("id") DEFERRABLE INITIALLY DEFERRED, "proposed_at" datetime NULL, "proposed_by_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "status" varchar(10) NOT NULL);

CREATE TABLE "taxonomy_topictranslation" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "locale" varchar(8) NOT NULL, "name" varchar(300) NOT NULL, "topic_id" bigint NOT NULL REFERENCES "taxonomy_topic" ("id") DEFERRABLE INITIALLY DEFERRED);

CREATE INDEX "accounts_certificate_profile_id_70354d35" ON "accounts_certificate" ("profile_id");

CREATE INDEX "accounts_donationlink_profile_id_ef066556" ON "accounts_donationlink" ("profile_id");

CREATE INDEX "accounts_experienceentry_profile_id_669c0e3b" ON "accounts_experienceentry" ("profile_id");

CREATE INDEX "accounts_skillentry_branch_id_282cc04a" ON "accounts_skillentry" ("branch_id");

CREATE INDEX "accounts_skillentry_discipline_id_0d1b7845" ON "accounts_skillentry" ("discipline_id");

CREATE INDEX "accounts_skillentry_profile_id_a6fea829" ON "accounts_skillentry" ("profile_id");

CREATE INDEX "auth_group_permissions_group_id_b120cbf9" ON "auth_group_permissions" ("group_id");

CREATE UNIQUE INDEX "auth_group_permissions_group_id_permission_id_0cd325b0_uniq" ON "auth_group_permissions" ("group_id", "permission_id");

CREATE INDEX "auth_group_permissions_permission_id_84c5c92e" ON "auth_group_permissions" ("permission_id");

CREATE INDEX "auth_permission_content_type_id_2f476e4b" ON "auth_permission" ("content_type_id");

CREATE UNIQUE INDEX "auth_permission_content_type_id_codename_01ab375a_uniq" ON "auth_permission" ("content_type_id", "codename");

CREATE INDEX "auth_user_groups_group_id_97559544" ON "auth_user_groups" ("group_id");

CREATE INDEX "auth_user_groups_user_id_6a12ed8b" ON "auth_user_groups" ("user_id");

CREATE UNIQUE INDEX "auth_user_groups_user_id_group_id_94350c0c_uniq" ON "auth_user_groups" ("user_id", "group_id");

CREATE INDEX "auth_user_user_permissions_permission_id_1fbb5f2c" ON "auth_user_user_permissions" ("permission_id");

CREATE INDEX "auth_user_user_permissions_user_id_a95ead1b" ON "auth_user_user_permissions" ("user_id");

CREATE UNIQUE INDEX "auth_user_user_permissions_user_id_permission_id_14a6b632_uniq" ON "auth_user_user_permissions" ("user_id", "permission_id");

CREATE INDEX "booking_availabilityexception_tutor_id_bc1a0c79" ON "booking_availabilityexception" ("tutor_id");

CREATE INDEX "booking_availabilityrule_service_id_ed2b4baa" ON "booking_availabilityrule" ("service_id");

CREATE INDEX "booking_availabilityrule_tutor_id_405efa0e" ON "booking_availabilityrule" ("tutor_id");

CREATE INDEX "booking_boo_tutor_i_9566f5_idx" ON "booking_booking" ("tutor_id", "status", "starts_at");

CREATE INDEX "booking_booking_cancelled_by_id_bb79d48c" ON "booking_booking" ("cancelled_by_id");

CREATE INDEX "booking_booking_service_id_3f5c0fe1" ON "booking_booking" ("service_id");

CREATE INDEX "booking_booking_student_id_26c87fb2" ON "booking_booking" ("student_id");

CREATE INDEX "booking_booking_tutor_id_f0c4c031" ON "booking_booking" ("tutor_id");

CREATE INDEX "community_comment_author_id_51c65c2a" ON "community_comment" ("author_id");

CREATE INDEX "community_comment_content_type_id_e16a72b0" ON "community_comment" ("content_type_id");

CREATE INDEX "community_comment_parent_id_2fd9f894" ON "community_comment" ("parent_id");

CREATE INDEX "community_review_author_id_bc768e73" ON "community_review" ("author_id");

CREATE INDEX "community_review_exercise_id_75f1678d" ON "community_review" ("exercise_id");

CREATE UNIQUE INDEX "community_review_exercise_id_author_id_582d6a34_uniq" ON "community_review" ("exercise_id", "author_id");

CREATE INDEX "courses_attachment_course_id_136ce9fa" ON "courses_attachment" ("course_id");

CREATE INDEX "courses_attachment_uploaded_by_id_3c5bbf2f" ON "courses_attachment" ("uploaded_by_id");

CREATE INDEX "courses_attachmentreview_attachment_id_2b4afe37" ON "courses_attachmentreview" ("attachment_id");

CREATE UNIQUE INDEX "courses_attachmentreview_attachment_id_author_id_1a64925e_uniq" ON "courses_attachmentreview" ("attachment_id", "author_id");

CREATE INDEX "courses_attachmentreview_author_id_f57e06e4" ON "courses_attachmentreview" ("author_id");

CREATE INDEX "courses_chapter_course_id_24d15099" ON "courses_chapter" ("course_id");

CREATE INDEX "courses_chapterreview_author_id_abc63705" ON "courses_chapterreview" ("author_id");

CREATE UNIQUE INDEX "courses_chapterreview_chapter_id_author_id_6f4cd82c_uniq" ON "courses_chapterreview" ("chapter_id", "author_id");

CREATE INDEX "courses_chapterreview_chapter_id_eb4777a4" ON "courses_chapterreview" ("chapter_id");

CREATE INDEX "courses_course_field_id_71c4ac82" ON "courses_course" ("field_id");

CREATE INDEX "courses_course_instructor_id_5b0643dc" ON "courses_course" ("instructor_id");

CREATE INDEX "courses_course_subjects_branch_id_8f927cb2" ON "courses_course_subjects" ("branch_id");

CREATE INDEX "courses_course_subjects_course_id_768b1a0b" ON "courses_course_subjects" ("course_id");

CREATE UNIQUE INDEX "courses_course_subjects_course_id_branch_id_555e8dfd_uniq" ON "courses_course_subjects" ("course_id", "branch_id");

CREATE INDEX "courses_courseinvite_course_id_130ddcd3" ON "courses_courseinvite" ("course_id");

CREATE INDEX "courses_courseinvite_created_by_id_5fa671c1" ON "courses_courseinvite" ("created_by_id");

CREATE INDEX "courses_courseitem_attachment_id_15a2bb1c" ON "courses_courseitem" ("attachment_id");

CREATE INDEX "courses_courseitem_chapter_id_d55cb2d3" ON "courses_courseitem" ("chapter_id");

CREATE INDEX "courses_courseitem_course_id_529fd5a2" ON "courses_courseitem" ("course_id");

CREATE INDEX "courses_courseitem_decided_by_id_8bc2198d" ON "courses_courseitem" ("decided_by_id");

CREATE INDEX "courses_courseitem_event_id_cb953740" ON "courses_courseitem" ("event_id");

CREATE INDEX "courses_courseitem_exercise_id_cb2a375c" ON "courses_courseitem" ("exercise_id");

CREATE INDEX "courses_courseitem_lesson_id_51ad4955" ON "courses_courseitem" ("lesson_id");

CREATE INDEX "courses_courseitem_material_id_36a010b3" ON "courses_courseitem" ("material_id");

CREATE INDEX "courses_courseitem_submitted_by_id_414ac0fb" ON "courses_courseitem" ("submitted_by_id");

CREATE INDEX "courses_coursenote_author_id_034977e8" ON "courses_coursenote" ("author_id");

CREATE INDEX "courses_coursenote_course_id_fd8d892b" ON "courses_coursenote" ("course_id");

CREATE INDEX "courses_coursenote_lesson_id_bc645b43" ON "courses_coursenote" ("lesson_id");

CREATE INDEX "courses_coursestaff_added_by_id_67d46c89" ON "courses_coursestaff" ("added_by_id");

CREATE INDEX "courses_coursestaff_course_id_b60434a8" ON "courses_coursestaff" ("course_id");

CREATE INDEX "courses_coursestaff_user_id_1ec0c7a2" ON "courses_coursestaff" ("user_id");

CREATE INDEX "courses_enrollment_course_id_2631503e" ON "courses_enrollment" ("course_id");

CREATE INDEX "courses_enrollment_participant_id_878f3068" ON "courses_enrollment" ("participant_id");

CREATE INDEX "courses_lesson_chapter_id_401d021a" ON "courses_lesson" ("chapter_id");

CREATE INDEX "courses_lessonexerciseset_exercise_set_id_41953643" ON "courses_lessonexerciseset" ("exercise_set_id");

CREATE INDEX "courses_lessonexerciseset_lesson_id_0e46c3b8" ON "courses_lessonexerciseset" ("lesson_id");

CREATE INDEX "courses_lessonexerciseset_linked_by_id_078b6578" ON "courses_lessonexerciseset" ("linked_by_id");

CREATE INDEX "courses_lessonprogress_lesson_id_b0b36960" ON "courses_lessonprogress" ("lesson_id");

CREATE UNIQUE INDEX "courses_lessonprogress_lesson_id_participant_id_a01e89e9_uniq" ON "courses_lessonprogress" ("lesson_id", "participant_id");

CREATE INDEX "courses_lessonprogress_participant_id_7c1cbb86" ON "courses_lessonprogress" ("participant_id");

CREATE INDEX "courses_lessonreview_author_id_8046c0a0" ON "courses_lessonreview" ("author_id");

CREATE INDEX "courses_lessonreview_lesson_id_a8689190" ON "courses_lessonreview" ("lesson_id");

CREATE UNIQUE INDEX "courses_lessonreview_lesson_id_author_id_d972331d_uniq" ON "courses_lessonreview" ("lesson_id", "author_id");

CREATE INDEX "courses_lessonsetexercise_exercise_id_df7ca224" ON "courses_lessonsetexercise" ("exercise_id");

CREATE INDEX "courses_lessonsetexercise_link_id_80144f91" ON "courses_lessonsetexercise" ("link_id");

CREATE UNIQUE INDEX "courses_lessonsetexercise_link_id_exercise_id_c1d7fd6f_uniq" ON "courses_lessonsetexercise" ("link_id", "exercise_id");

CREATE INDEX "django_admin_log_content_type_id_c4bce8eb" ON "django_admin_log" ("content_type_id");

CREATE INDEX "django_admin_log_user_id_c564eba6" ON "django_admin_log" ("user_id");

CREATE UNIQUE INDEX "django_content_type_app_label_model_76bd3d3b_uniq" ON "django_content_type" ("app_label", "model");

CREATE INDEX "django_session_expire_date_a5c62663" ON "django_session" ("expire_date");

CREATE INDEX "events_even_event_i_09cad8_idx" ON "events_eventpost" ("event_id", "created_at" DESC);

CREATE INDEX "events_even_status_5c3d55_idx" ON "events_event" ("status", "starts_at");

CREATE INDEX "events_event_discipline_id_0751045c" ON "events_event" ("discipline_id");

CREATE INDEX "events_event_host_id_522ba98e" ON "events_event" ("host_id");

CREATE INDEX "events_event_subjects_branch_id_8edf0d26" ON "events_event_subjects" ("branch_id");

CREATE UNIQUE INDEX "events_event_subjects_event_id_branch_id_52d55d7f_uniq" ON "events_event_subjects" ("event_id", "branch_id");

CREATE INDEX "events_event_subjects_event_id_fec25726" ON "events_event_subjects" ("event_id");

CREATE INDEX "events_eventattendance_attendee_id_6b7e9ed2" ON "events_eventattendance" ("attendee_id");

CREATE INDEX "events_eventattendance_event_id_dc4f95aa" ON "events_eventattendance" ("event_id");

CREATE INDEX "events_eventpost_author_id_8ec77673" ON "events_eventpost" ("author_id");

CREATE INDEX "events_eventpost_event_id_3a3b7df9" ON "events_eventpost" ("event_id");

CREATE INDEX "events_eventpostlink_post_id_1d7135e6" ON "events_eventpostlink" ("post_id");

CREATE INDEX "exercises_exercise_branch_id_14482e61" ON "exercises_exercise" ("branch_id");

CREATE UNIQUE INDEX "exercises_exercise_branch_id_number_f87adbe9_uniq" ON "exercises_exercise" ("branch_id", "number");

CREATE INDEX "exercises_exercise_submitted_by_id_d7d79edd" ON "exercises_exercise" ("submitted_by_id");

CREATE INDEX "exercises_exercise_tags_exercise_id_b7dac3d0" ON "exercises_exercise_tags" ("exercise_id");

CREATE UNIQUE INDEX "exercises_exercise_tags_exercise_id_tag_id_dcd98aa3_uniq" ON "exercises_exercise_tags" ("exercise_id", "tag_id");

CREATE INDEX "exercises_exercise_tags_tag_id_5e28a94b" ON "exercises_exercise_tags" ("tag_id");

CREATE INDEX "exercises_exercise_topics_exercise_id_39b2ee3a" ON "exercises_exercise_topics" ("exercise_id");

CREATE UNIQUE INDEX "exercises_exercise_topics_exercise_id_topic_id_973ff19f_uniq" ON "exercises_exercise_topics" ("exercise_id", "topic_id");

CREATE INDEX "exercises_exercise_topics_topic_id_04e71541" ON "exercises_exercise_topics" ("topic_id");

CREATE INDEX "exercises_exerciserequirement_exercise_id_db06722a" ON "exercises_exerciserequirement" ("exercise_id");

CREATE INDEX "exercises_exerciserequirementvote_requirement_id_4cf89a57" ON "exercises_exerciserequirementvote" ("requirement_id");

CREATE UNIQUE INDEX "exercises_exerciserequirementvote_requirement_id_voter_id_eb21fc8b_uniq" ON "exercises_exerciserequirementvote" ("requirement_id", "voter_id");

CREATE INDEX "exercises_exerciserequirementvote_voter_id_9e15ec42" ON "exercises_exerciserequirementvote" ("voter_id");

CREATE INDEX "exercises_exercisesourcetranslation_source_id_60790736" ON "exercises_exercisesourcetranslation" ("source_id");

CREATE UNIQUE INDEX "exercises_exercisesourcetranslation_source_id_locale_7d9da965_uniq" ON "exercises_exercisesourcetranslation" ("source_id", "locale");

CREATE INDEX "exercises_exercisetranslation_exercise_id_0eec1af4" ON "exercises_exercisetranslation" ("exercise_id");

CREATE INDEX "exercises_exercisetranslation_reviewed_by_id_3978da41" ON "exercises_exercisetranslation" ("reviewed_by_id");

CREATE INDEX "exercises_exercisetranslation_translated_by_id_c010f6b5" ON "exercises_exercisetranslation" ("translated_by_id");

CREATE INDEX "exercises_tagfollow_tag_id_ad991129" ON "exercises_tagfollow" ("tag_id");

CREATE INDEX "exercises_tagfollow_user_id_3c5bca2f" ON "exercises_tagfollow" ("user_id");

CREATE UNIQUE INDEX "exercises_tagfollow_user_id_tag_id_5e05d816_uniq" ON "exercises_tagfollow" ("user_id", "tag_id");

CREATE INDEX "identity_coursegrade_matched_course_id_fc159053" ON "identity_coursegrade" ("matched_course_id");

CREATE INDEX "identity_coursegrade_profile_id_84cd7b8a" ON "identity_coursegrade" ("profile_id");

CREATE INDEX "identity_diploma_profile_id_2fca7dad" ON "identity_diploma" ("profile_id");

CREATE INDEX "identity_educationprofile_school_id_8171427b" ON "identity_educationprofile" ("school_id");

CREATE INDEX "materials_material_branch_id_26a82a4d" ON "materials_material" ("branch_id");

CREATE UNIQUE INDEX "materials_material_branch_id_slug_b1bf4f8e_uniq" ON "materials_material" ("branch_id", "slug");

CREATE INDEX "materials_material_slug_2876d4dc" ON "materials_material" ("slug");

CREATE INDEX "materials_material_submitted_by_id_f0aeade1" ON "materials_material" ("submitted_by_id");

CREATE INDEX "materials_material_tags_material_id_666111e1" ON "materials_material_tags" ("material_id");

CREATE UNIQUE INDEX "materials_material_tags_material_id_tag_id_97c49e4b_uniq" ON "materials_material_tags" ("material_id", "tag_id");

CREATE INDEX "materials_material_tags_tag_id_97f2c062" ON "materials_material_tags" ("tag_id");

CREATE INDEX "materials_materialcoverage_material_id_90b86b21" ON "materials_materialcoverage" ("material_id");

CREATE UNIQUE INDEX "materials_materialcoverage_material_id_topic_id_subtopic_id_7453a0ed_uniq" ON "materials_materialcoverage" ("material_id", "topic_id", "subtopic_id");

CREATE INDEX "materials_materialcoverage_proposed_by_id_10ab5396" ON "materials_materialcoverage" ("proposed_by_id");

CREATE INDEX "materials_materialcoverage_subtopic_id_3113ca58" ON "materials_materialcoverage" ("subtopic_id");

CREATE INDEX "materials_materialcoverage_topic_id_4765b28f" ON "materials_materialcoverage" ("topic_id");

CREATE INDEX "materials_materialcoveragevote_coverage_id_6bcfa30e" ON "materials_materialcoveragevote" ("coverage_id");

CREATE UNIQUE INDEX "materials_materialcoveragevote_coverage_id_voter_id_d5932964_uniq" ON "materials_materialcoveragevote" ("coverage_id", "voter_id");

CREATE INDEX "materials_materialcoveragevote_voter_id_f5abdafc" ON "materials_materialcoveragevote" ("voter_id");

CREATE INDEX "materials_materialrequirement_material_id_4eb5d574" ON "materials_materialrequirement" ("material_id");

CREATE INDEX "materials_materialrequirementvote_requirement_id_115921f6" ON "materials_materialrequirementvote" ("requirement_id");

CREATE UNIQUE INDEX "materials_materialrequirementvote_requirement_id_voter_id_5fc88e0c_uniq" ON "materials_materialrequirementvote" ("requirement_id", "voter_id");

CREATE INDEX "materials_materialrequirementvote_voter_id_f64825e8" ON "materials_materialrequirementvote" ("voter_id");

CREATE INDEX "materials_materialreview_author_id_9421ed06" ON "materials_materialreview" ("author_id");

CREATE INDEX "materials_materialreview_material_id_10f50dc6" ON "materials_materialreview" ("material_id");

CREATE UNIQUE INDEX "materials_materialreview_material_id_author_id_ae7e4b30_uniq" ON "materials_materialreview" ("material_id", "author_id");

CREATE INDEX "materials_materialtranslation_material_id_8196b42f" ON "materials_materialtranslation" ("material_id");

CREATE UNIQUE INDEX "materials_materialtranslation_material_id_locale_dadd8c78_uniq" ON "materials_materialtranslation" ("material_id", "locale");

CREATE INDEX "materials_materialtype_proposed_by_id_63764c2f" ON "materials_materialtype" ("proposed_by_id");

CREATE INDEX "materials_materialtypetranslation_material_type_id_1c31ee2f" ON "materials_materialtypetranslation" ("material_type_id");

CREATE UNIQUE INDEX "materials_materialtypetranslation_material_type_id_locale_f1680a96_uniq" ON "materials_materialtypetranslation" ("material_type_id", "locale");

CREATE INDEX "materials_materialview_material_id_7db49960" ON "materials_materialview" ("material_id");

CREATE INDEX "materials_materialview_user_id_32055d85" ON "materials_materialview" ("user_id");

CREATE INDEX "moderation_contentview_exercise_id_e470a390" ON "moderation_contentview" ("exercise_id");

CREATE INDEX "moderation_contentview_user_id_c98f032f" ON "moderation_contentview" ("user_id");

CREATE UNIQUE INDEX "moderation_contentview_user_id_exercise_id_0900a65b_uniq" ON "moderation_contentview" ("user_id", "exercise_id");

CREATE INDEX "moderation_editsuggestion_exercise_id_eb1b5b01" ON "moderation_editsuggestion" ("exercise_id");

CREATE INDEX "moderation_editsuggestion_reviewed_by_id_731d7c02" ON "moderation_editsuggestion" ("reviewed_by_id");

CREATE INDEX "moderation_editsuggestion_submitted_by_id_06cfbf34" ON "moderation_editsuggestion" ("submitted_by_id");

CREATE INDEX "moderation_exercisesubmission_branch_id_ffebcb35" ON "moderation_exercisesubmission" ("branch_id");

CREATE INDEX "moderation_exercisesubmission_resulting_exercise_id_d4551445" ON "moderation_exercisesubmission" ("resulting_exercise_id");

CREATE INDEX "moderation_exercisesubmission_reviewed_by_id_c6f49a63" ON "moderation_exercisesubmission" ("reviewed_by_id");

CREATE INDEX "moderation_exercisesubmission_submitted_by_id_18808206" ON "moderation_exercisesubmission" ("submitted_by_id");

CREATE INDEX "moderation_featureflag_updated_by_id_7d8922ea" ON "moderation_featureflag" ("updated_by_id");

CREATE INDEX "moderation_materialsubmission_branch_id_87bce412" ON "moderation_materialsubmission" ("branch_id");

CREATE INDEX "moderation_materialsubmission_resulting_material_id_1f7cd2c2" ON "moderation_materialsubmission" ("resulting_material_id");

CREATE INDEX "moderation_materialsubmission_reviewed_by_id_b398f176" ON "moderation_materialsubmission" ("reviewed_by_id");

CREATE INDEX "moderation_materialsubmission_submitted_by_id_80c9871f" ON "moderation_materialsubmission" ("submitted_by_id");

CREATE INDEX "moderation_nodegovernor_content_type_id_dd13c409" ON "moderation_nodegovernor" ("content_type_id");

CREATE INDEX "moderation_nodegovernor_granted_by_id_58ab29ca" ON "moderation_nodegovernor" ("granted_by_id");

CREATE UNIQUE INDEX "moderation_nodegovernor_user_id_content_type_id_object_id_9ed51c53_uniq" ON "moderation_nodegovernor" ("user_id", "content_type_id", "object_id");

CREATE INDEX "moderation_nodegovernor_user_id_fd3ace57" ON "moderation_nodegovernor" ("user_id");

CREATE INDEX "moderation_report_content_type_id_5f339eaf" ON "moderation_report" ("content_type_id");

CREATE UNIQUE INDEX "moderation_report_content_type_id_object_id_reported_by_id_76cb5318_uniq" ON "moderation_report" ("content_type_id", "object_id", "reported_by_id");

CREATE INDEX "moderation_report_reported_by_id_fdcf9730" ON "moderation_report" ("reported_by_id");

CREATE INDEX "moderation_report_resolved_by_id_0439d611" ON "moderation_report" ("resolved_by_id");

CREATE INDEX "notifications_notification_actor_id_ec6170c3" ON "notifications_notification" ("actor_id");

CREATE INDEX "notifications_notification_course_id_2a871310" ON "notifications_notification" ("course_id");

CREATE INDEX "notifications_notification_event_id_28551f97" ON "notifications_notification" ("event_id");

CREATE INDEX "notifications_notification_exercise_id_6c9f79f6" ON "notifications_notification" ("exercise_id");

CREATE INDEX "notifications_notification_material_id_245ed845" ON "notifications_notification" ("material_id");

CREATE INDEX "notifications_notification_recipient_id_d055f3f0" ON "notifications_notification" ("recipient_id");

CREATE UNIQUE INDEX "one_published_translation_per_locale" ON "exercises_exercisetranslation" ("exercise_id", "locale") WHERE "status" = 'published';

CREATE INDEX "postman_message_moderation_by_id_f0d43d80" ON "postman_message" ("moderation_by_id");

CREATE INDEX "postman_message_parent_id_4b6238da" ON "postman_message" ("parent_id");

CREATE INDEX "postman_message_recipient_id_5f2df2fc" ON "postman_message" ("recipient_id");

CREATE INDEX "postman_message_sender_id_6d102a43" ON "postman_message" ("sender_id");

CREATE INDEX "postman_message_thread_id_cd603329" ON "postman_message" ("thread_id");

CREATE INDEX "services_service_branches_branch_id_9f07af89" ON "services_service_branches" ("branch_id");

CREATE UNIQUE INDEX "services_service_branches_service_id_branch_id_1e54e103_uniq" ON "services_service_branches" ("service_id", "branch_id");

CREATE INDEX "services_service_branches_service_id_f20cd5ee" ON "services_service_branches" ("service_id");

CREATE INDEX "services_service_provider_id_04163c24" ON "services_service" ("provider_id");

CREATE INDEX "services_servicereview_author_id_0ea21070" ON "services_servicereview" ("author_id");

CREATE UNIQUE INDEX "services_servicereview_service_id_author_id_3f4d9122_uniq" ON "services_servicereview" ("service_id", "author_id");

CREATE INDEX "services_servicereview_service_id_c71e9e80" ON "services_servicereview" ("service_id");

CREATE INDEX "services_servicewatch_service_id_b8770d0a" ON "services_servicewatch" ("service_id");

CREATE INDEX "services_servicewatch_user_id_962132de" ON "services_servicewatch" ("user_id");

CREATE UNIQUE INDEX "services_servicewatch_user_id_service_id_19a51f1b_uniq" ON "services_servicewatch" ("user_id", "service_id");

CREATE INDEX "study_exerciseset_owner_id_05d77b69" ON "study_exerciseset" ("owner_id");

CREATE INDEX "study_exercisesetitem_exercise_id_54bc9861" ON "study_exercisesetitem" ("exercise_id");

CREATE UNIQUE INDEX "study_exercisesetitem_exercise_set_id_exercise_id_75ee5edc_uniq" ON "study_exercisesetitem" ("exercise_set_id", "exercise_id");

CREATE INDEX "study_exercisesetitem_exercise_set_id_f6b335ea" ON "study_exercisesetitem" ("exercise_set_id");

CREATE INDEX "taxonomy_branch_discipline_id_7c587260" ON "taxonomy_branch" ("discipline_id");

CREATE INDEX "taxonomy_branch_proposed_by_id_426f1c27" ON "taxonomy_branch" ("proposed_by_id");

CREATE INDEX "taxonomy_branchtranslation_branch_id_101492e1" ON "taxonomy_branchtranslation" ("branch_id");

CREATE UNIQUE INDEX "taxonomy_branchtranslation_branch_id_locale_1f06beba_uniq" ON "taxonomy_branchtranslation" ("branch_id", "locale");

CREATE INDEX "taxonomy_chapter_branch_id_23021863" ON "taxonomy_chapter" ("branch_id");

CREATE UNIQUE INDEX "taxonomy_chapter_branch_id_number_7ca32680_uniq" ON "taxonomy_chapter" ("branch_id", "number");

CREATE INDEX "taxonomy_chapter_topics_chapter_id_719d3e2e" ON "taxonomy_chapter_topics" ("chapter_id");

CREATE UNIQUE INDEX "taxonomy_chapter_topics_chapter_id_topic_id_c27bb534_uniq" ON "taxonomy_chapter_topics" ("chapter_id", "topic_id");

CREATE INDEX "taxonomy_chapter_topics_topic_id_eea0b43f" ON "taxonomy_chapter_topics" ("topic_id");

CREATE INDEX "taxonomy_chaptertranslation_chapter_id_4a6756c6" ON "taxonomy_chaptertranslation" ("chapter_id");

CREATE UNIQUE INDEX "taxonomy_chaptertranslation_chapter_id_locale_00eac58d_uniq" ON "taxonomy_chaptertranslation" ("chapter_id", "locale");

CREATE INDEX "taxonomy_discipline_proposed_by_id_40808260" ON "taxonomy_discipline" ("proposed_by_id");

CREATE INDEX "taxonomy_disciplinetranslation_discipline_id_a0e9452e" ON "taxonomy_disciplinetranslation" ("discipline_id");

CREATE UNIQUE INDEX "taxonomy_disciplinetranslation_discipline_id_locale_da3d0851_uniq" ON "taxonomy_disciplinetranslation" ("discipline_id", "locale");

CREATE INDEX "taxonomy_subtopic_slug_d52a8bf8" ON "taxonomy_subtopic" ("slug");

CREATE INDEX "taxonomy_subtopic_topic_id_cae97185" ON "taxonomy_subtopic" ("topic_id");

CREATE UNIQUE INDEX "taxonomy_subtopic_topic_id_slug_ebba0880_uniq" ON "taxonomy_subtopic" ("topic_id", "slug");

CREATE INDEX "taxonomy_subtopictranslation_subtopic_id_0e4b39a9" ON "taxonomy_subtopictranslation" ("subtopic_id");

CREATE UNIQUE INDEX "taxonomy_subtopictranslation_subtopic_id_locale_26c755ef_uniq" ON "taxonomy_subtopictranslation" ("subtopic_id", "locale");

CREATE INDEX "taxonomy_topic_branch_id_040408c3" ON "taxonomy_topic" ("branch_id");

CREATE UNIQUE INDEX "taxonomy_topic_branch_id_slug_8b0bc927_uniq" ON "taxonomy_topic" ("branch_id", "slug");

CREATE INDEX "taxonomy_topic_proposed_by_id_92d4209d" ON "taxonomy_topic" ("proposed_by_id");

CREATE INDEX "taxonomy_topic_slug_6f903fd8" ON "taxonomy_topic" ("slug");

CREATE INDEX "taxonomy_topictranslation_topic_id_9dfa86be" ON "taxonomy_topictranslation" ("topic_id");

CREATE UNIQUE INDEX "taxonomy_topictranslation_topic_id_locale_4da3adf4_uniq" ON "taxonomy_topictranslation" ("topic_id", "locale");

CREATE UNIQUE INDEX "unique_attachment_per_course" ON "courses_courseitem" ("course_id", "attachment_id") WHERE "attachment_id" IS NOT NULL;

CREATE UNIQUE INDEX "unique_event_per_course" ON "courses_courseitem" ("course_id", "event_id") WHERE "event_id" IS NOT NULL;

CREATE UNIQUE INDEX "unique_exercise_per_course" ON "courses_courseitem" ("course_id", "exercise_id") WHERE "exercise_id" IS NOT NULL;

CREATE UNIQUE INDEX "unique_material_per_course" ON "courses_courseitem" ("course_id", "material_id") WHERE "material_id" IS NOT NULL;

CREATE UNIQUE INDEX "unique_note_per_course" ON "courses_coursenote" ("author_id", "course_id") WHERE "lesson_id" IS NULL;

CREATE UNIQUE INDEX "unique_note_per_lesson" ON "courses_coursenote" ("author_id", "course_id", "lesson_id") WHERE "lesson_id" IS NOT NULL;

CREATE UNIQUE INDEX "unique_owner_per_course" ON "courses_coursestaff" ("course_id") WHERE "role" = 'owner';

CREATE UNIQUE INDEX "unique_set_per_lesson" ON "courses_lessonexerciseset" ("lesson_id", "exercise_set_id") WHERE "exercise_set_id" IS NOT NULL;
