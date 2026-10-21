CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    migration_id character varying(150) NOT NULL,
    product_version character varying(32) NOT NULL,
    CONSTRAINT pk___ef_migrations_history PRIMARY KEY (migration_id)
);

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE TABLE babies (
        id uuid NOT NULL,
        name character varying(100) NOT NULL,
        birth_date date NOT NULL,
        created_at timestamp with time zone NOT NULL,
        CONSTRAINT pk_babies PRIMARY KEY (id)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE TABLE users (
        id uuid NOT NULL,
        subject character varying(255) NOT NULL,
        display_name character varying(100) NOT NULL,
        created_at timestamp with time zone NOT NULL,
        CONSTRAINT pk_users PRIMARY KEY (id)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE TABLE event_types (
        id uuid NOT NULL,
        baby_id uuid,
        key character varying(50) NOT NULL,
        name character varying(100) NOT NULL,
        icon character varying(64) NOT NULL,
        color character varying(7) NOT NULL,
        has_duration boolean NOT NULL,
        fields jsonb NOT NULL,
        CONSTRAINT pk_event_types PRIMARY KEY (id),
        CONSTRAINT fk_event_types_babies_baby_id FOREIGN KEY (baby_id) REFERENCES babies (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE TABLE medications (
        id uuid NOT NULL,
        baby_id uuid NOT NULL,
        name character varying(100) NOT NULL,
        default_dose_amount numeric(10,3),
        default_dose_unit character varying(20),
        notes character varying(1000),
        is_usual boolean NOT NULL,
        created_at timestamp with time zone NOT NULL,
        CONSTRAINT pk_medications PRIMARY KEY (id),
        CONSTRAINT fk_medications_babies_baby_id FOREIGN KEY (baby_id) REFERENCES babies (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE TABLE baby_members (
        id uuid NOT NULL,
        baby_id uuid NOT NULL,
        user_id uuid NOT NULL,
        role character varying(16) NOT NULL,
        joined_at timestamp with time zone NOT NULL,
        CONSTRAINT pk_baby_members PRIMARY KEY (id),
        CONSTRAINT fk_baby_members_babies_baby_id FOREIGN KEY (baby_id) REFERENCES babies (id) ON DELETE CASCADE,
        CONSTRAINT fk_baby_members_users_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE TABLE invites (
        id uuid NOT NULL,
        baby_id uuid NOT NULL,
        token character varying(128) NOT NULL,
        role character varying(16) NOT NULL,
        created_by uuid NOT NULL,
        created_at timestamp with time zone NOT NULL,
        expires_at timestamp with time zone NOT NULL,
        accepted_at timestamp with time zone,
        accepted_by uuid,
        CONSTRAINT pk_invites PRIMARY KEY (id),
        CONSTRAINT fk_invites_babies_baby_id FOREIGN KEY (baby_id) REFERENCES babies (id) ON DELETE CASCADE,
        CONSTRAINT fk_invites_users_accepted_by FOREIGN KEY (accepted_by) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT fk_invites_users_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE TABLE events (
        id uuid NOT NULL,
        baby_id uuid NOT NULL,
        type_id uuid NOT NULL,
        started_at timestamp with time zone NOT NULL,
        ended_at timestamp with time zone,
        payload jsonb NOT NULL,
        notes character varying(2000),
        created_by uuid NOT NULL,
        created_at timestamp with time zone NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        deleted_at timestamp with time zone,
        CONSTRAINT pk_events PRIMARY KEY (id),
        CONSTRAINT fk_events_babies_baby_id FOREIGN KEY (baby_id) REFERENCES babies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_events_event_types_type_id FOREIGN KEY (type_id) REFERENCES event_types (id) ON DELETE RESTRICT,
        CONSTRAINT fk_events_users_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    INSERT INTO event_types (id, baby_id, color, fields, has_duration, icon, key, name)
    VALUES ('07a1ea45-7ba6-4fe3-9e38-a335da9ea12c', NULL, '#ec407a', '[{"key":"intensity","label":"Intensity","kind":"number","isRequired":true,"min":1,"max":5}]', FALSE, 'sick', 'belly_pain', 'Belly pain');
    INSERT INTO event_types (id, baby_id, color, fields, has_duration, icon, key, name)
    VALUES ('318d1395-e373-4d89-a3cd-cdd7ad5187ab', NULL, '#8d6e63', '[]', FALSE, 'baby_changing_station', 'diaper', 'Diaper');
    INSERT INTO event_types (id, baby_id, color, fields, has_duration, icon, key, name)
    VALUES ('543cbd04-e226-435c-9639-810ecd066056', NULL, '#ffa726', '[]', TRUE, 'child_care', 'tummy_time', 'Tummy time');
    INSERT INTO event_types (id, baby_id, color, fields, has_duration, icon, key, name)
    VALUES ('5cbe3692-d4df-4d5f-85d6-2282d9733b35', NULL, '#7e57c2', '[]', TRUE, 'bedtime', 'sleep', 'Sleep');
    INSERT INTO event_types (id, baby_id, color, fields, has_duration, icon, key, name)
    VALUES ('833cf001-7e12-4bc6-b7a5-7adabb174aa5', NULL, '#26a69a', '[]', FALSE, 'bathtub', 'bath', 'Bath');
    INSERT INTO event_types (id, baby_id, color, fields, has_duration, icon, key, name)
    VALUES ('bd43d7fb-e12c-438a-852e-c710b41a7c76', NULL, '#ef5350', '[]', FALSE, 'medication', 'medication', 'Medication');
    INSERT INTO event_types (id, baby_id, color, fields, has_duration, icon, key, name)
    VALUES ('e6428ccb-7061-4cf4-a5d0-67c89a396a5f', NULL, '#4f8ef7', '[{"key":"method","label":"Method","kind":"select","isRequired":true,"options":["breast","bottle","solid"]},{"key":"side","label":"Side","kind":"select","isRequired":false,"options":["left","right","both"]},{"key":"amount","label":"Amount","kind":"number","isRequired":false,"min":0,"unit":"ml"}]', TRUE, 'local_drink', 'feeding', 'Feeding');
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE UNIQUE INDEX ix_baby_members_baby_id_user_id ON baby_members (baby_id, user_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE INDEX ix_baby_members_user_id ON baby_members (user_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE UNIQUE INDEX ix_event_types_baby_id_key ON event_types (baby_id, key) NULLS NOT DISTINCT;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE INDEX ix_events_baby_id_started_at ON events (baby_id, started_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE INDEX ix_events_baby_id_updated_at ON events (baby_id, updated_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE INDEX ix_events_created_by ON events (created_by);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE INDEX ix_events_type_id ON events (type_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE INDEX ix_invites_accepted_by ON invites (accepted_by);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE INDEX ix_invites_baby_id ON invites (baby_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE INDEX ix_invites_created_by ON invites (created_by);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE UNIQUE INDEX ix_invites_token ON invites (token);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE INDEX ix_medications_baby_id ON medications (baby_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    CREATE UNIQUE INDEX ix_users_subject ON users (subject);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261020231413_InitialCreate') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261020231413_InitialCreate', '8.0.11');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021000249_BuiltInFieldFixups') THEN
    UPDATE event_types SET fields = '[{"key":"content","label":"Content","kind":"select","isRequired":true,"options":["WET","DIRTY","MIXED"]}]'
    WHERE id = '318d1395-e373-4d89-a3cd-cdd7ad5187ab';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021000249_BuiltInFieldFixups') THEN
    UPDATE event_types SET fields = '[{"key":"mood","label":"Mood","kind":"text","isRequired":false}]'
    WHERE id = '543cbd04-e226-435c-9639-810ecd066056';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021000249_BuiltInFieldFixups') THEN
    UPDATE event_types SET fields = '[{"key":"kind","label":"Kind","kind":"select","isRequired":false,"options":["nap","night","night_waking"]},{"key":"mood","label":"Mood","kind":"text","isRequired":false}]'
    WHERE id = '5cbe3692-d4df-4d5f-85d6-2282d9733b35';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021000249_BuiltInFieldFixups') THEN
    UPDATE event_types SET fields = '[{"key":"temperature_c","label":"Water temperature","kind":"number","isRequired":false,"min":0,"max":60,"unit":"C"}]'
    WHERE id = '833cf001-7e12-4bc6-b7a5-7adabb174aa5';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021000249_BuiltInFieldFixups') THEN
    UPDATE event_types SET fields = '[{"key":"method","label":"Method","kind":"select","isRequired":true,"options":["breast","bottle","solid"]},{"key":"side","label":"Side","kind":"select","isRequired":false,"options":["left","right","both"]},{"key":"amount_ml","label":"Amount","kind":"number","isRequired":false,"min":0,"unit":"ml"},{"key":"bottle_feeding_type","label":"Bottle content","kind":"select","isRequired":false,"options":["FORMULA","BREAST_MILK"]},{"key":"breast_left_seconds","label":"Left breast","kind":"number","isRequired":false,"min":0,"unit":"s"},{"key":"breast_right_seconds","label":"Right breast","kind":"number","isRequired":false,"min":0,"unit":"s"}]'
    WHERE id = 'e6428ccb-7061-4cf4-a5d0-67c89a396a5f';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021000249_BuiltInFieldFixups') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261021000249_BuiltInFieldFixups', '8.0.11');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021000934_AddMeasurements') THEN
    CREATE TABLE measurements (
        id uuid NOT NULL,
        baby_id uuid NOT NULL,
        date date NOT NULL,
        weight_kg numeric(6,2),
        height_cm numeric(6,2),
        head_circumference_cm numeric(6,2),
        notes character varying(1000),
        created_by uuid NOT NULL,
        created_at timestamp with time zone NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        CONSTRAINT pk_measurements PRIMARY KEY (id),
        CONSTRAINT fk_measurements_babies_baby_id FOREIGN KEY (baby_id) REFERENCES babies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_measurements_users_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021000934_AddMeasurements') THEN
    CREATE INDEX ix_measurements_baby_id_date ON measurements (baby_id, date);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021000934_AddMeasurements') THEN
    CREATE INDEX ix_measurements_created_by ON measurements (created_by);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021000934_AddMeasurements') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261021000934_AddMeasurements', '8.0.11');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021002724_SleepKindBedWake') THEN
    UPDATE event_types SET fields = '[{"key":"kind","label":"Kind","kind":"select","isRequired":false,"options":["nap","night","night_waking","bed_time","woke_up"]},{"key":"mood","label":"Mood","kind":"text","isRequired":false}]'
    WHERE id = '5cbe3692-d4df-4d5f-85d6-2282d9733b35';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021002724_SleepKindBedWake') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261021002724_SleepKindBedWake', '8.0.11');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021010818_EventClientUpdatedAt') THEN
    ALTER TABLE events ADD client_updated_at timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021010818_EventClientUpdatedAt') THEN
    UPDATE events SET client_updated_at = updated_at WHERE client_updated_at IS NULL;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021010818_EventClientUpdatedAt') THEN
    ALTER TABLE events ALTER COLUMN client_updated_at SET NOT NULL;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021010818_EventClientUpdatedAt') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261021010818_EventClientUpdatedAt', '8.0.11');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021014553_Wave2Hardening') THEN
    UPDATE users SET display_name = 'Parent' WHERE display_name LIKE '%@%';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021014553_Wave2Hardening') THEN
    DROP INDEX ix_users_subject;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021014553_Wave2Hardening') THEN
    ALTER TABLE users ADD issuer character varying(255) NOT NULL DEFAULT '';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021014553_Wave2Hardening') THEN
    CREATE UNIQUE INDEX ix_users_issuer_subject ON users (issuer, subject);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021014553_Wave2Hardening') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261021014553_Wave2Hardening', '8.0.11');
    END IF;
END $EF$;
COMMIT;

