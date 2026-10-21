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

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021043358_SleepKindFellAsleep') THEN
    UPDATE event_types SET fields = '[{"key":"kind","label":"Kind","kind":"select","isRequired":false,"options":["nap","night","night_waking","bed_time","woke_up","fell_asleep"]},{"key":"mood","label":"Mood","kind":"text","isRequired":false}]'
    WHERE id = '5cbe3692-d4df-4d5f-85d6-2282d9733b35';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021043358_SleepKindFellAsleep') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261021043358_SleepKindFellAsleep', '8.0.11');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021045736_ConditionalFieldsAndBreastPump') THEN
    UPDATE event_types SET fields = '[{"key":"method","label":"Method","kind":"select","isRequired":true,"options":["breast","bottle","solid"]},{"key":"side","label":"Side","kind":"select","isRequired":false,"options":["left","right","both"],"visibleWhen":{"field":"method","equals":["breast"]}},{"key":"amount_ml","label":"Amount","kind":"number","isRequired":false,"min":0,"unit":"ml","visibleWhen":{"field":"method","equals":["bottle"]}},{"key":"bottle_feeding_type","label":"Bottle content","kind":"select","isRequired":false,"options":["formula","breast_milk"],"visibleWhen":{"field":"method","equals":["bottle"]}},{"key":"breast_left_seconds","label":"Left breast","kind":"number","isRequired":false,"min":0,"unit":"s","visibleWhen":{"field":"method","equals":["breast"]}},{"key":"breast_right_seconds","label":"Right breast","kind":"number","isRequired":false,"min":0,"unit":"s","visibleWhen":{"field":"method","equals":["breast"]}},{"key":"food","label":"Food","kind":"text","isRequired":false,"visibleWhen":{"field":"method","equals":["solid"]}}]'
    WHERE id = 'e6428ccb-7061-4cf4-a5d0-67c89a396a5f';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021045736_ConditionalFieldsAndBreastPump') THEN
    INSERT INTO event_types (id, baby_id, color, fields, has_duration, icon, key, name)
    VALUES ('ddfdaa52-57ee-4d34-8129-a78262c2172c', NULL, '#26c6da', '[{"key":"amount_left_ml","label":"Left amount","kind":"number","isRequired":false,"min":0,"unit":"ml"},{"key":"amount_right_ml","label":"Right amount","kind":"number","isRequired":false,"min":0,"unit":"ml"}]', TRUE, 'opacity', 'breast_pump', 'Breast pump');
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021045736_ConditionalFieldsAndBreastPump') THEN
    UPDATE events
    SET payload = jsonb_set(payload, '{bottle_feeding_type}', to_jsonb(lower(payload ->> 'bottle_feeding_type'))),
        updated_at = now()
    WHERE type_id = 'e6428ccb-7061-4cf4-a5d0-67c89a396a5f'
      AND payload ->> 'bottle_feeding_type' IN ('FORMULA', 'BREAST_MILK');
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021045736_ConditionalFieldsAndBreastPump') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261021045736_ConditionalFieldsAndBreastPump', '8.0.11');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    ALTER TABLE medications ADD product_id uuid;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    CREATE TABLE prescriptions (
        id uuid NOT NULL,
        baby_id uuid NOT NULL,
        medication_id uuid NOT NULL,
        status character varying(16) NOT NULL,
        dose_amount numeric(10,3) NOT NULL,
        dose_unit character varying(20) NOT NULL,
        dose_per_kg boolean NOT NULL,
        dose_rounding_step numeric(10,3),
        kind character varying(16) NOT NULL,
        times_of_day character varying(144),
        every_minutes integer,
        min_interval_minutes integer,
        max_doses_per_24h integer,
        indication character varying(200),
        interval_group character varying(50),
        start_date date NOT NULL,
        end_date date,
        prescriber character varying(100),
        instructions character varying(1000),
        created_by uuid NOT NULL,
        created_at timestamp with time zone NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        client_updated_at timestamp with time zone NOT NULL,
        deleted_at timestamp with time zone,
        CONSTRAINT pk_prescriptions PRIMARY KEY (id),
        CONSTRAINT fk_prescriptions_babies_baby_id FOREIGN KEY (baby_id) REFERENCES babies (id) ON DELETE RESTRICT,
        CONSTRAINT fk_prescriptions_users_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    CREATE TABLE products (
        id uuid NOT NULL,
        name character varying(100) NOT NULL,
        normalized_name character varying(100) NOT NULL,
        form character varying(16) NOT NULL,
        country character(2) NOT NULL,
        status character varying(16) NOT NULL,
        created_by uuid,
        merged_into_id uuid,
        created_at timestamp with time zone NOT NULL,
        CONSTRAINT pk_products PRIMARY KEY (id),
        CONSTRAINT fk_products_products_merged_into_id FOREIGN KEY (merged_into_id) REFERENCES products (id) ON DELETE RESTRICT,
        CONSTRAINT fk_products_users_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    CREATE TABLE substances (
        id uuid NOT NULL,
        key character varying(50) NOT NULL,
        name_en character varying(100) NOT NULL,
        name_pt_br character varying(100) NOT NULL,
        synonyms character varying(520) NOT NULL,
        created_at timestamp with time zone NOT NULL,
        CONSTRAINT pk_substances PRIMARY KEY (id)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    CREATE TABLE product_substances (
        product_id uuid NOT NULL,
        substance_id uuid NOT NULL,
        strength_amount numeric(10,3),
        strength_unit character varying(20),
        strength_per_amount numeric(10,3),
        strength_per_unit character varying(20),
        CONSTRAINT pk_product_substances PRIMARY KEY (product_id, substance_id),
        CONSTRAINT fk_product_substances_products_product_id FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
        CONSTRAINT fk_product_substances_substances_substance_id FOREIGN KEY (substance_id) REFERENCES substances (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    INSERT INTO substances (id, created_at, key, name_en, name_pt_br, synonyms)
    VALUES ('1765da22-94c0-46b7-b321-4feb5f3ad86e', TIMESTAMPTZ '2026-10-21T00:00:00+00:00', 'paracetamol', 'Paracetamol', 'Paracetamol', 'Acetaminophen');
    INSERT INTO substances (id, created_at, key, name_en, name_pt_br, synonyms)
    VALUES ('2f468145-66a8-4fad-a6c1-45ce69aaeaa3', TIMESTAMPTZ '2026-10-21T00:00:00+00:00', 'simethicone', 'Simethicone', 'Simeticona', '');
    INSERT INTO substances (id, created_at, key, name_en, name_pt_br, synonyms)
    VALUES ('46e6ebde-ff2c-4e67-a132-2ff1ef9b1c66', TIMESTAMPTZ '2026-10-21T00:00:00+00:00', 'cholecalciferol', 'Cholecalciferol', 'Colecalciferol', 'Vitamin D3');
    INSERT INTO substances (id, created_at, key, name_en, name_pt_br, synonyms)
    VALUES ('cce5fca3-cf4a-4099-b9fc-ded1a076ca1f', TIMESTAMPTZ '2026-10-21T00:00:00+00:00', 'metamizole', 'Metamizole', 'Dipirona', 'Dipyrone');
    INSERT INTO substances (id, created_at, key, name_en, name_pt_br, synonyms)
    VALUES ('cf40d2c1-711c-4ffa-9754-06f5c6844142', TIMESTAMPTZ '2026-10-21T00:00:00+00:00', 'ibuprofen', 'Ibuprofen', 'Ibuprofeno', '');
    INSERT INTO substances (id, created_at, key, name_en, name_pt_br, synonyms)
    VALUES ('d71efa75-1cb2-46fe-a019-b4d4a9df1710', TIMESTAMPTZ '2026-10-21T00:00:00+00:00', 'limosilactobacillus_reuteri', 'Limosilactobacillus reuteri', 'Limosilactobacillus reuteri', 'Lactobacillus reuteri');
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    CREATE INDEX ix_medications_product_id ON medications (product_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    CREATE INDEX ix_prescriptions_baby_id_medication_id ON prescriptions (baby_id, medication_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    CREATE INDEX ix_prescriptions_baby_id_updated_at ON prescriptions (baby_id, updated_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    CREATE INDEX ix_prescriptions_created_by ON prescriptions (created_by);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    CREATE INDEX ix_product_substances_substance_id ON product_substances (substance_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    CREATE INDEX ix_products_created_by ON products (created_by);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    CREATE INDEX ix_products_merged_into_id ON products (merged_into_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    CREATE UNIQUE INDEX ix_products_normalized_name_form_country ON products (normalized_name, form, country) WHERE merged_into_id IS NULL;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    CREATE UNIQUE INDEX ix_substances_key ON substances (key);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    ALTER TABLE medications ADD CONSTRAINT fk_medications_products_product_id FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021104705_MedicationsPrescriptionsCatalog') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261021104705_MedicationsPrescriptionsCatalog', '8.0.11');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021120142_PauseAndSleepDetailFields') THEN
    UPDATE event_types SET fields = '[{"key":"mood","label":"Mood","kind":"text","isRequired":false},{"key":"pause_count","label":"Pauses","kind":"number","isRequired":false,"min":0,"max":100,"hidden":true,"integer":true},{"key":"paused_seconds","label":"Paused time","kind":"number","isRequired":false,"min":0,"max":86400,"unit":"s","hidden":true,"integer":true},{"key":"paused_at","label":"Paused at","kind":"text","isRequired":false,"hidden":true}]'
    WHERE id = '543cbd04-e226-435c-9639-810ecd066056';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021120142_PauseAndSleepDetailFields') THEN
    UPDATE event_types SET fields = '[{"key":"kind","label":"Kind","kind":"select","isRequired":false,"options":["nap","night","night_waking","bed_time","woke_up","fell_asleep"]},{"key":"mood","label":"Mood","kind":"text","isRequired":false,"hidden":true},{"key":"how_slept","label":"How slept","kind":"select","isRequired":false,"options":["in_bed","nursing","held","next_to_me","bottle","stroller","car","swing","other"],"visibleWhen":{"field":"kind","equals":["nap","night"]}},{"key":"fall_asleep","label":"Falling asleep","kind":"select","isRequired":false,"options":["easy","took_long","fussy"],"visibleWhen":{"field":"kind","equals":["nap","night"]}},{"key":"time_to_fall_asleep_minutes","label":"Time to fall asleep","kind":"number","isRequired":false,"min":0,"max":240,"unit":"min","visibleWhen":{"field":"kind","equals":["nap","night"]},"integer":true},{"key":"how_woke","label":"How woke","kind":"select","isRequired":false,"options":["naturally","woken"],"visibleWhen":{"field":"kind","equals":["nap","night"]}},{"key":"mood_on_wake","label":"Mood on waking","kind":"select","isRequired":false,"options":["good","neutral","bad"],"visibleWhen":{"field":"kind","equals":["nap","night"]}},{"key":"pause_count","label":"Pauses","kind":"number","isRequired":false,"min":0,"max":100,"hidden":true,"integer":true},{"key":"paused_seconds","label":"Paused time","kind":"number","isRequired":false,"min":0,"max":86400,"unit":"s","hidden":true,"integer":true},{"key":"paused_at","label":"Paused at","kind":"text","isRequired":false,"hidden":true}]'
    WHERE id = '5cbe3692-d4df-4d5f-85d6-2282d9733b35';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021120142_PauseAndSleepDetailFields') THEN
    UPDATE event_types SET fields = '[{"key":"temperature_c","label":"Water temperature","kind":"number","isRequired":false,"min":0,"max":60,"unit":"C"},{"key":"pause_count","label":"Pauses","kind":"number","isRequired":false,"min":0,"max":100,"hidden":true,"integer":true},{"key":"paused_seconds","label":"Paused time","kind":"number","isRequired":false,"min":0,"max":86400,"unit":"s","hidden":true,"integer":true},{"key":"paused_at","label":"Paused at","kind":"text","isRequired":false,"hidden":true}]'
    WHERE id = '833cf001-7e12-4bc6-b7a5-7adabb174aa5';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021120142_PauseAndSleepDetailFields') THEN
    UPDATE event_types SET fields = '[{"key":"amount_left_ml","label":"Left amount","kind":"number","isRequired":false,"min":0,"unit":"ml"},{"key":"amount_right_ml","label":"Right amount","kind":"number","isRequired":false,"min":0,"unit":"ml"},{"key":"pause_count","label":"Pauses","kind":"number","isRequired":false,"min":0,"max":100,"hidden":true,"integer":true},{"key":"paused_seconds","label":"Paused time","kind":"number","isRequired":false,"min":0,"max":86400,"unit":"s","hidden":true,"integer":true},{"key":"paused_at","label":"Paused at","kind":"text","isRequired":false,"hidden":true}]'
    WHERE id = 'ddfdaa52-57ee-4d34-8129-a78262c2172c';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021120142_PauseAndSleepDetailFields') THEN
    UPDATE event_types SET fields = '[{"key":"method","label":"Method","kind":"select","isRequired":true,"options":["breast","bottle","solid"]},{"key":"side","label":"Side","kind":"select","isRequired":false,"options":["left","right","both"],"visibleWhen":{"field":"method","equals":["breast"]}},{"key":"amount_ml","label":"Amount","kind":"number","isRequired":false,"min":0,"unit":"ml","visibleWhen":{"field":"method","equals":["bottle"]}},{"key":"bottle_feeding_type","label":"Bottle content","kind":"select","isRequired":false,"options":["formula","breast_milk"],"visibleWhen":{"field":"method","equals":["bottle"]}},{"key":"breast_left_seconds","label":"Left breast","kind":"number","isRequired":false,"min":0,"unit":"s","visibleWhen":{"field":"method","equals":["breast"]}},{"key":"breast_right_seconds","label":"Right breast","kind":"number","isRequired":false,"min":0,"unit":"s","visibleWhen":{"field":"method","equals":["breast"]}},{"key":"food","label":"Food","kind":"text","isRequired":false,"visibleWhen":{"field":"method","equals":["solid"]}},{"key":"pause_count","label":"Pauses","kind":"number","isRequired":false,"min":0,"max":100,"hidden":true,"integer":true},{"key":"paused_seconds","label":"Paused time","kind":"number","isRequired":false,"min":0,"max":86400,"unit":"s","hidden":true,"integer":true},{"key":"paused_at","label":"Paused at","kind":"text","isRequired":false,"hidden":true}]'
    WHERE id = 'e6428ccb-7061-4cf4-a5d0-67c89a396a5f';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021120142_PauseAndSleepDetailFields') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261021120142_PauseAndSleepDetailFields', '8.0.11');
    END IF;
END $EF$;
COMMIT;

START TRANSACTION;


DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    ALTER TABLE baby_members ADD CONSTRAINT ak_baby_members_baby_id_user_id UNIQUE (baby_id, user_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    CREATE TABLE baby_notification_preferences (
        baby_id uuid NOT NULL,
        user_id uuid NOT NULL,
        dose_due boolean NOT NULL,
        dose_lead_minutes smallint NOT NULL,
        nap_window boolean NOT NULL,
        nap_lead_minutes smallint NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        CONSTRAINT pk_baby_notification_preferences PRIMARY KEY (baby_id, user_id),
        CONSTRAINT fk_baby_notification_preferences_baby_members_baby_id_user_id FOREIGN KEY (baby_id, user_id) REFERENCES baby_members (baby_id, user_id) ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    CREATE TABLE job_leases (
        name character varying(40) NOT NULL,
        holder_id character varying(64) NOT NULL,
        lease_until timestamp with time zone NOT NULL,
        CONSTRAINT pk_job_leases PRIMARY KEY (name)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    CREATE TABLE notification_actions (
        user_id uuid NOT NULL,
        base_key character varying(120) NOT NULL,
        baby_id uuid NOT NULL,
        action character varying(10) NOT NULL,
        snoozed_until timestamp with time zone,
        snooze_count smallint NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        CONSTRAINT pk_notification_actions PRIMARY KEY (user_id, base_key)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    CREATE TABLE push_subscriptions (
        id uuid NOT NULL,
        user_id uuid NOT NULL,
        endpoint character varying(2048) NOT NULL,
        endpoint_hash character(43) NOT NULL,
        locale character varying(10) NOT NULL,
        device_label character varying(60),
        expires_at timestamp with time zone,
        created_at timestamp with time zone NOT NULL,
        last_seen_at timestamp with time zone NOT NULL,
        last_success_at timestamp with time zone,
        consecutive_failures integer NOT NULL,
        revoked_at timestamp with time zone,
        revoked_reason character varying(16),
        auth character varying(24) NOT NULL,
        p256dh character varying(88) NOT NULL,
        CONSTRAINT pk_push_subscriptions PRIMARY KEY (id),
        CONSTRAINT fk_push_subscriptions_users_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    CREATE TABLE user_notification_settings (
        user_id uuid NOT NULL,
        time_zone character varying(64) NOT NULL,
        quiet_hours_enabled boolean NOT NULL,
        quiet_start time without time zone NOT NULL,
        quiet_end time without time zone NOT NULL,
        quiet_includes_medicine boolean NOT NULL,
        show_names boolean NOT NULL,
        updated_at timestamp with time zone NOT NULL,
        CONSTRAINT pk_user_notification_settings PRIMARY KEY (user_id),
        CONSTRAINT fk_user_notification_settings_users_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    CREATE TABLE notification_deliveries (
        id uuid NOT NULL,
        subscription_id uuid NOT NULL,
        user_id uuid NOT NULL,
        baby_id uuid,
        kind character varying(24) NOT NULL,
        base_key character varying(120) NOT NULL,
        dedupe_key character varying(124) NOT NULL,
        due_at timestamp with time zone NOT NULL,
        expires_at timestamp with time zone NOT NULL,
        status character varying(12) NOT NULL,
        attempts smallint NOT NULL,
        next_attempt_at timestamp with time zone,
        last_status_code smallint,
        action_token_hash character(43),
        created_at timestamp with time zone NOT NULL,
        sent_at timestamp with time zone,
        CONSTRAINT pk_notification_deliveries PRIMARY KEY (id),
        CONSTRAINT fk_notification_deliveries_push_subscriptions_subscription_id FOREIGN KEY (subscription_id) REFERENCES push_subscriptions (id) ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    CREATE INDEX ix_baby_notification_preferences_baby_id ON baby_notification_preferences (baby_id) WHERE dose_due OR nap_window;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    CREATE INDEX ix_notification_deliveries_created_at ON notification_deliveries (created_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    CREATE INDEX ix_notification_deliveries_status_next_attempt_at ON notification_deliveries (status, next_attempt_at);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    CREATE UNIQUE INDEX ix_notification_deliveries_subscription_id_dedupe_key ON notification_deliveries (subscription_id, dedupe_key);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    CREATE INDEX ix_notification_deliveries_user_id_base_key ON notification_deliveries (user_id, base_key);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    CREATE UNIQUE INDEX ix_push_subscriptions_endpoint_hash ON push_subscriptions (endpoint_hash);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    CREATE INDEX ix_push_subscriptions_user_id ON push_subscriptions (user_id) WHERE revoked_at IS NULL;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "migration_id" = '20261021182304_PushNotifications') THEN
    INSERT INTO "__EFMigrationsHistory" (migration_id, product_version)
    VALUES ('20261021182304_PushNotifications', '8.0.11');
    END IF;
END $EF$;
COMMIT;

